/// <reference types="mocha" />
import { expect } from "chai";
import { config } from "../../package.json";
import {
  emptyReadState,
  parseReadState,
  READ_STATE_TAG,
  setState,
  writeReadState,
  type ReadStateDoc,
} from "../../src/format/readState";
import {
  allStateNotes,
  type Alert,
  eraseStateNotes,
  idle,
  makePaper,
  markThroughMenu,
  withAlerts,
  withLoggedErrors,
} from "./helpers";

function stateIn(note: Zotero.Item): ReadStateDoc {
  const parsed = parseReadState(note.getNote());
  expect(parsed.ok, `the state note parses: ${note.getNote()}`).to.equal(true);
  return (parsed as { ok: true; value: ReadStateDoc }).value;
}

async function stateNote(html: string): Promise<Zotero.Item> {
  const note = new Zotero.Item("note");
  note.libraryID = Zotero.Libraries.userLibraryID;
  note.setNote(html);
  note.addTag(READ_STATE_TAG);
  await note.saveTx({ skipSelect: true });
  return note;
}

/** Whether `_read` or `_reading` is stored on the item, read from the database. */
async function storedTags(item: Zotero.Item): Promise<string[]> {
  const rows = await Zotero.DB.columnQueryAsync(
    "SELECT name FROM itemTags JOIN tags USING (tagID) WHERE itemID = ?",
    [item.id],
  );
  return ((rows || []) as string[])
    .filter((name) => name === "_read" || name === "_reading")
    .sort();
}

/** Makes the next `saveTx` among `items` throw; the others save as usual. */
function failFirstSave(items: Zotero.Item[]): {
  saved: () => number;
  restore: () => void;
} {
  let calls = 0;
  let saved = 0;
  for (const item of items) {
    const real = Zotero.Item.prototype.saveTx;
    (item as any).saveTx = async function (this: Zotero.Item, ...args: any[]) {
      if (calls++ === 0) throw new Error("saveTx refused by the test");
      const result = await (real as any).apply(this, args);
      saved++;
      return result;
    };
  }
  return {
    saved: () => saved,
    restore: () => {
      for (const item of items) delete (item as any).saveTx;
    },
  };
}

// Every case starts from no state notes, so none depends on another; the
// papers are shared and their mirror tags follow whatever the case marks.
describe("Read state failures", function () {
  this.timeout(60_000);
  let win: any;
  let first: Zotero.Item;
  let second: Zotero.Item;

  before(async function () {
    win = Zotero.getMainWindows()[0];
    first = await makePaper("Read state failure fixture one");
    second = await makePaper("Read state failure fixture two");
    await idle();
  });

  beforeEach(async function () {
    await eraseStateNotes();
    await idle();
  });

  after(async function () {
    await win.ZoteroPane.collectionsView.selectLibrary(
      Zotero.Libraries.userLibraryID,
    );
    await Zotero.Items.erase([first.id, second.id]);
    await eraseStateNotes();
    await idle();
  });

  it("never rewrites an unreadable state note and refuses the mark with a message", async function () {
    const html =
      '<pre data-meristema-reading-state="1">{"version":2,"states":{}}</pre>';
    const note = await stateNote(html);
    await idle();
    const alerts = await withAlerts(async (alerts) => {
      await markThroughMenu(win, [first.id], "read");
      return alerts;
    });
    expect(note.getNote(), "the unreadable note's HTML").to.equal(html);
    expect(
      (await allStateNotes()).map((item) => item.key),
      "notes carrying the state tag",
    ).to.deep.equal([note.key]);
    expect(await storedTags(first), "the paper's mirror tags").to.deep.equal(
      [],
    );
    expect(alerts, "alerts shown").to.have.length(1);
    expect(alerts[0].title, "the alert's title").to.equal(config.addonName);
    expect(alerts[0].text, "the alert's message").to.match(/cannot be read/);
  });

  it("ignores a trashed state note and starts a new one", async function () {
    await withAlerts(() => markThroughMenu(win, [first.id], "read"));
    const [trashed] = await allStateNotes();
    expect(trashed, "the first mark's state note").to.exist;
    trashed.deleted = true;
    await trashed.saveTx();
    await idle();
    const trashedHTML = trashed.getNote();

    const alerts = await withAlerts(async (alerts) => {
      await markThroughMenu(win, [second.id], "reading");
      return alerts;
    });
    expect(alerts, "alerts shown").to.deep.equal([]);
    const notes = await allStateNotes();
    expect(
      notes.map((item) => item.deleted).sort(),
      "notes carrying the state tag, by deleted",
    ).to.deep.equal([false, true]);
    const fresh = notes.find((item) => !item.deleted)!;
    expect(
      Object.keys(stateIn(fresh).states),
      "the new note's papers",
    ).to.deep.equal([`user:${second.key}`]);
    expect(stateIn(fresh).states[`user:${second.key}`].state).to.equal(
      "reading",
    );
    expect(trashed.getNote(), "the trashed note's HTML").to.equal(trashedHTML);
    expect(await storedTags(second), "the new mark mirrored").to.deep.equal([
      "_reading",
    ]);
  });

  it("mirrors the other papers when one paper's tags fail to save", async function () {
    const saves = failFirstSave([first, second]);
    let outcome: { alerts: Alert[]; errors: string[] };
    try {
      outcome = await withLoggedErrors(async (errors) => ({
        alerts: await withAlerts(async (alerts) => {
          await markThroughMenu(win, [first.id, second.id], "read");
          return alerts;
        }),
        errors,
      }));
    } finally {
      saves.restore();
    }
    expect(outcome.alerts, "alerts shown").to.deep.equal([]);
    // report() wraps an error from another global: match the message.
    expect(outcome.errors, "errors reported").to.have.length(1);
    expect(outcome.errors[0], "the error reported").to.contain(
      "saveTx refused by the test",
    );
    expect(saves.saved(), "mirror saves that went through").to.equal(1);
    const stored = [await storedTags(first), await storedTags(second)];
    expect(stored, "stored mirror tags of the two papers").to.deep.include([
      "_read",
    ]);
    expect(stored, "stored mirror tags of the two papers").to.deep.include([]);
  });

  it("tells the user when a mark fails for another reason", async function () {
    const note = await stateNote(
      writeReadState(
        setState(
          emptyReadState(),
          `user:${second.key}`,
          "read",
          "2026-01-01T00:00:00Z",
        ),
      ),
    );
    await idle();
    (note as any).saveTx = async () => {
      throw new Error("state note save refused by the test");
    };
    let outcome: { alerts: Alert[]; errors: string[] };
    try {
      outcome = await withLoggedErrors(async (errors) => ({
        alerts: await withAlerts(async (alerts) => {
          await markThroughMenu(win, [first.id], "read");
          return alerts;
        }),
        errors,
      }));
    } finally {
      delete (note as any).saveTx;
    }
    // report() wraps an error from another global: match the message.
    expect(outcome.errors, "errors reported").to.have.length(1);
    expect(outcome.errors[0], "the error reported").to.contain(
      "state note save refused by the test",
    );
    expect(outcome.alerts, "alerts shown").to.deep.equal([
      {
        title: config.addonName,
        text: "Meristema Reading could not mark the papers. See the error console.",
      },
    ]);
  });
});
