/// <reference types="mocha" />
import { expect } from "chai";
import {
  parseReadingList,
  writeReadingList,
  type ReadingListDoc,
  type ReadingListStep,
} from "../../src/format/readingList";
import { parseReadState, type ReadStateDoc } from "../../src/format/readState";
import {
  altArrow,
  drag,
  eraseStateNotes,
  idle,
  makeListNote,
  makePaper,
  rowKeys,
  stateNotes,
  waitFor,
} from "./helpers";

const TOPIC = "Section fixture";

describe("The Reading list section", function () {
  this.timeout(60_000);
  let win: any;
  let collection: any;
  let a: Zotero.Item;
  let b: Zotero.Item;
  let c: Zotero.Item;
  let note: Zotero.Item;
  const extraNotes: number[] = [];

  const view = () =>
    win.document.querySelector(".mr-list.mr-sidebar") as HTMLElement | null;
  const row = (key: string) =>
    view()!.querySelector(`[data-key="${key}"]`) as HTMLElement;
  const stepsInNote = (): ReadingListStep[] => {
    const parsed = parseReadingList(note.getNote());
    expect(parsed.ok, `the list note parses: ${note.getNote()}`).to.equal(true);
    return (parsed as { ok: true; value: ReadingListDoc }).value.steps;
  };
  async function untilSteps(keys: string[]): Promise<void> {
    const ok = await waitFor(
      () => rowKeys(view(), ".mr-step").join() === keys.join(),
      10_000,
    );
    expect(
      ok,
      `the section shows ${keys}; it shows ${rowKeys(view(), ".mr-step")}`,
    ).to.equal(true);
  }

  before(async function () {
    win = Zotero.getMainWindows()[0];
    await eraseStateNotes();
    collection = new Zotero.Collection();
    collection.libraryID = Zotero.Libraries.userLibraryID;
    collection.name = TOPIC;
    await collection.saveTx();
    a = await makePaper("Paper A", undefined, collection.id);
    b = await makePaper("Paper B", undefined, collection.id);
    c = await makePaper("Paper C", undefined, collection.id);
    note = await makeListNote(
      collection.id,
      writeReadingList(
        {
          version: 1,
          topic: TOPIC,
          steps: [
            { key: a.key, why: "first" },
            { key: b.key, why: "" },
          ],
        },
        (key) => key,
        { kind: "user" },
      ),
    );
    await idle();
  });

  after(async function () {
    win.Zotero_Tabs.select("zotero-pane");
    await win.ZoteroPane.collectionsView.selectLibrary(
      Zotero.Libraries.userLibraryID,
    );
    await Zotero.Items.erase([note.id, ...extraNotes, a.id, b.id, c.id]);
    await collection.eraseTx();
    await eraseStateNotes();
    await idle();
  });

  it("shows the steps, the unordered papers and next up for a paper in the folder", async function () {
    await win.ZoteroPane.collectionsView.selectCollection(collection.id);
    await win.ZoteroPane.selectItem(b.id);
    await untilSteps([a.key, b.key]);
    expect(rowKeys(view(), ".mr-paper"), "unordered papers").to.deep.equal([
      c.key,
    ]);
    expect(rowKeys(view(), ".mr-next"), "next up").to.deep.equal([a.key]);
    expect(rowKeys(view(), ".mr-current"), "the selected paper").to.deep.equal([
      b.key,
    ]);
    expect(view()!.querySelector(".mr-topic")?.textContent).to.equal(TOPIC);
    expect(
      (row(a.key).querySelector(".mr-why") as HTMLTextAreaElement).value,
    ).to.equal("first");
  });

  it("moves a step with Alt+Down and rewrites the note", async function () {
    altArrow(win, row(a.key), "ArrowDown");
    await idle();
    expect(stepsInNote()).to.deep.equal([
      { key: b.key, why: "" },
      { key: a.key, why: "first" },
    ]);
    const html = note.getNote();
    expect(
      html.indexOf(`items/${b.key}`),
      "readable part rebuilt in the new order",
    ).to.be.lessThan(html.indexOf(`items/${a.key}`));
    await untilSteps([b.key, a.key]);
  });

  it("drops an unordered paper into the steps before the step it lands on", async function () {
    drag(win, row(c.key), row(b.key));
    await idle();
    expect(stepsInNote().map((step) => step.key)).to.deep.equal([
      c.key,
      b.key,
      a.key,
    ]);
    await untilSteps([c.key, b.key, a.key]);
  });

  it("takes a step out when it is dropped on the unordered papers", async function () {
    drag(
      win,
      row(a.key).querySelector(".mr-handle")!,
      view()!.querySelector(".mr-unordered")!,
    );
    await idle();
    expect(stepsInNote().map((step) => step.key)).to.deep.equal([c.key, b.key]);
    await untilSteps([c.key, b.key]);
    expect(rowKeys(view(), ".mr-paper")).to.deep.equal([a.key]);
  });

  it("saves an edited reason", async function () {
    const why = row(b.key).querySelector(".mr-why") as HTMLTextAreaElement;
    why.value = 'Read <this> & "that"';
    why.dispatchEvent(new win.Event("change", { bubbles: true }));
    await idle();
    expect(stepsInNote()).to.deep.equal([
      { key: c.key, why: "" },
      { key: b.key, why: 'Read <this> & "that"' },
    ]);
  });

  it("toggles a step's read state, and next up follows", async function () {
    (row(b.key).querySelector(".mr-state") as HTMLElement).click();
    await idle();
    const [stateNote] = await stateNotes();
    const parsed = parseReadState(stateNote.getNote());
    expect(
      (parsed as { ok: true; value: ReadStateDoc }).value.states[
        `user:${b.key}`
      ]?.state,
    ).to.equal("reading");
    expect(b.hasTag("_reading"), "the mirror tag").to.equal(true);
    const moved = await waitFor(
      () => rowKeys(view(), ".mr-next")[0] === b.key,
      10_000,
    );
    expect(
      moved,
      `next up is the Reading step; it is ${rowKeys(view(), ".mr-next")}`,
    ).to.equal(true);
  });

  it("names a second list note it ignores", async function () {
    const second = await makeListNote(
      collection.id,
      writeReadingList(
        { version: 1, topic: "Second list", steps: [] },
        (key) => key,
        {
          kind: "user",
        },
      ),
    );
    extraNotes.push(second.id);
    await idle();
    const named = await waitFor(
      () =>
        view()
          ?.querySelector(".mr-ignored")
          ?.textContent?.includes("Second list"),
      10_000,
    );
    expect(named, "the ignored note is named").to.equal(true);
  });

  it("says a list it cannot read and offers no editing", async function () {
    const broken = '<pre data-meristema-reading-list="1">{"version":2}</pre>';
    note.setNote(broken);
    await note.saveTx();
    await idle();
    const said = await waitFor(
      () =>
        view()
          ?.querySelector(".mr-failure")
          ?.textContent?.includes("unknown-version"),
      10_000,
    );
    expect(said, "the section says the list cannot be read").to.equal(true);
    expect(view()!.querySelectorAll(".mr-step, .mr-why").length).to.equal(0);
    expect(note.getNote(), "the note is left as it was").to.equal(broken);
  });
});
