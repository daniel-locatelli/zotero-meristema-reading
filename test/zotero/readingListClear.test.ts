/// <reference types="mocha" />
import { expect } from "chai";
import { config } from "../../package.json";
import {
  parseReadingList,
  READING_LIST_TAG,
  writeReadingList,
} from "../../src/format/readingList";
import {
  collectionMenuEntry,
  command,
  idle,
  makeListNote,
  makePaper,
  markThroughMenu,
  plugin,
  stateNotes,
  withLoggedErrors,
} from "./helpers";

const CLEAR = `${config.addonRef}-clear-reading-list`;

describe("Clearing a reading list", function () {
  this.timeout(60_000);
  let win: any;
  let collection: any;
  let papers: Zotero.Item[];
  let bare: any;

  const note = (c: any): Zotero.Item =>
    c
      .getChildItems(false, false)
      .find((i: Zotero.Item) => i.isNote() && i.hasTag(READING_LIST_TAG));
  const stepKeys = (): string[] => {
    const parsed = parseReadingList(note(collection).getNote()) as any;
    return parsed.ok
      ? parsed.value.steps.map((s: any) => s.key)
      : ["unreadable"];
  };
  const stateHtml = async (): Promise<string> =>
    (await stateNotes()).map((n) => n.getNote()).join("|");

  /** What the dialog was asked with: its text, buttons and button flags. */
  interface Asked {
    text: string;
    flags: number;
    button0: string | null;
  }
  /** The flags the dialog should pass: Clear, then Cancel as the default. */
  const clearFlags = (): number => {
    const p = Services.prompt as any;
    return (
      p.BUTTON_POS_0 * p.BUTTON_TITLE_IS_STRING +
      p.BUTTON_POS_1 * p.BUTTON_TITLE_CANCEL +
      p.BUTTON_POS_1_DEFAULT
    );
  };
  const warning = (count: string) =>
    `Clear Reading List: Clear the ${count} of “Clear fixture”? Their papers stay in the folder, under Not in the steps, and keep their read states. This cannot be undone.`;

  /** Runs the menu command with Services.prompt answering `button`. */
  async function clearWith(button: number): Promise<Asked[]> {
    const asked: Asked[] = [];
    const services = Services as any;
    const own = Object.getOwnPropertyDescriptor(services, "prompt");
    const real = services.prompt;
    const stub: Record<string, unknown> = {
      confirmEx(
        _w: unknown,
        title: string,
        text: string,
        flags: number,
        button0: string | null,
      ) {
        asked.push({ text: `${title}: ${text}`, flags, button0 });
        return button;
      },
      alert() {},
    };
    for (const name of [
      "BUTTON_POS_0",
      "BUTTON_POS_1",
      "BUTTON_POS_2",
      "BUTTON_TITLE_IS_STRING",
      "BUTTON_TITLE_CANCEL",
      "BUTTON_TITLE_OK",
      "BUTTON_POS_1_DEFAULT",
      "STD_OK_CANCEL_BUTTONS",
    ]) {
      stub[name] = real[name];
    }
    Object.defineProperty(services, "prompt", {
      configurable: true,
      value: stub,
    });
    try {
      const { popup, entry } = await collectionMenuEntry(
        win,
        collection.id,
        CLEAR,
      );
      expect(Boolean(entry) && !entry.hidden, "Clear offered").to.equal(true);
      const reached = command(entry);
      popup.hidePopup();
      await reached;
      await idle();
    } finally {
      await idle();
      if (own) Object.defineProperty(services, "prompt", own);
      else delete services.prompt;
    }
    return asked;
  }

  before(async function () {
    win = Zotero.getMainWindows()[0];
    collection = new Zotero.Collection();
    collection.libraryID = Zotero.Libraries.userLibraryID;
    collection.name = "Clear fixture";
    await collection.saveTx();
    bare = new Zotero.Collection();
    bare.libraryID = Zotero.Libraries.userLibraryID;
    bare.name = "Clear fixture without list";
    await bare.saveTx();
    papers = [];
    for (const t of ["Clear one", "Clear two", "Clear three"]) {
      papers.push(await makePaper(t, undefined, collection.id));
    }
    const n = await makeListNote(
      collection.id,
      writeReadingList(
        {
          version: 1,
          topic: "Clear fixture",
          steps: papers.map((p) => ({ key: p.key, why: "" })),
        },
        (k) => k,
        { kind: "user" },
      ),
    );
    void n;
    await idle();
    await markThroughMenu(win, [papers[0].id], "read");
    await markThroughMenu(win, [papers[1].id], "reading");
  });

  after(async function () {
    await win.ZoteroPane.collectionsView.selectLibrary(
      Zotero.Libraries.userLibraryID,
    );
    await Zotero.Items.erase([note(collection).id, ...papers.map((p) => p.id)]);
    await collection.eraseTx();
    await bare.eraseTx();
    await idle();
  });

  it("changes nothing when cancelled, after asking", async function () {
    const states = await stateHtml();
    const { asked, errors } = await withLoggedErrors(async (errors) => ({
      asked: await clearWith(1),
      errors,
    }));
    expect(errors, "the button's string is found").to.deep.equal([]);
    expect(
      asked,
      "one warning, Clear then Cancel as the default",
    ).to.deep.equal([
      { text: warning("3 steps"), flags: clearFlags(), button0: "Clear" },
    ]);
    expect(
      clearFlags() & (Services.prompt as any).BUTTON_POS_1_DEFAULT,
      "Enter cancels",
    ).to.not.equal(0);
    expect(stepKeys(), "steps kept").to.deep.equal(papers.map((p) => p.key));
    expect(await stateHtml(), "read states kept").to.equal(states);
  });

  it("names a single step in the singular", async function () {
    const list = note(collection);
    const before = list.getNote();
    list.setNote(
      writeReadingList(
        {
          version: 1,
          topic: "Clear fixture",
          steps: [{ key: papers[0].key, why: "" }],
        },
        (k) => k,
        { kind: "user" },
      ),
    );
    await list.saveTx({ skipSelect: true });
    await idle();
    try {
      const asked = await clearWith(1);
      expect(
        asked.map((a) => a.text),
        "the warning",
      ).to.deep.equal([warning("1 step")]);
      expect(stepKeys(), "the step kept").to.deep.equal([papers[0].key]);
    } finally {
      list.setNote(before);
      await list.saveTx({ skipSelect: true });
      await idle();
    }
  });

  it("is hidden for a folder with no list", async function () {
    const { popup, entry } = await collectionMenuEntry(win, bare.id, CLEAR);
    popup.hidePopup();
    expect(Boolean(entry) && !entry.hidden, "Clear offered").to.equal(false);
  });

  it("is hidden in a read-only library", async function () {
    const library: any = Zotero.Libraries.get(Zotero.Libraries.userLibraryID);
    Object.defineProperty(library, "editable", {
      configurable: true,
      get: () => false,
    });
    try {
      const { popup, entry } = await collectionMenuEntry(
        win,
        collection.id,
        CLEAR,
      );
      popup.hidePopup();
      expect(Boolean(entry) && !entry.hidden, "Clear offered").to.equal(false);
    } finally {
      delete library.editable;
    }
  });

  it("empties the steps when confirmed, keeping papers, note and read states", async function () {
    const states = await stateHtml();
    await clearWith(0);
    expect(stepKeys(), "no steps").to.deep.equal([]);
    expect(
      collection
        .getChildItems(false, false)
        .filter((i: Zotero.Item) => i.isRegularItem()).length,
      "papers in the folder",
    ).to.equal(3);
    expect(
      papers.map((p) =>
        /^\d{5}u$/.test(plugin().api.stepCell(p.id, collection.id)),
      ),
      "all under Not in the steps",
    ).to.deep.equal([true, true, true]);
    expect(await stateHtml(), "read states kept").to.equal(states);
  });

  it("is shown but disabled for a list with no steps", async function () {
    const { popup, entry } = await collectionMenuEntry(
      win,
      collection.id,
      CLEAR,
    );
    const drawn = {
      offered: Boolean(entry) && !entry.hidden,
      disabled: Boolean(entry?.disabled),
      attribute: entry?.getAttribute("disabled") ?? null,
    };
    popup.hidePopup();
    expect(
      { offered: drawn.offered, disabled: drawn.disabled },
      `the entry with no steps: ${JSON.stringify(drawn)}`,
    ).to.deep.equal({ offered: true, disabled: true });
    expect(stepKeys()).to.deep.equal([]);
  });
});
