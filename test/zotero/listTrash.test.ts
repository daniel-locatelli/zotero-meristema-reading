/// <reference types="mocha" />
import { expect } from "chai";
import { config } from "../../package.json";
import {
  parseReadingList,
  writeReadingList,
  type ReadingListDoc,
  type ReadingListStep,
} from "../../src/format/readingList";
import {
  altArrow,
  idle,
  makeListNote,
  makePaper,
  plugin,
  rowKeys,
  waitFor,
} from "./helpers";

const TAB_TYPE = `${config.addonRef}-list`;
const OPEN_TABS = `extensions.${config.addonRef}.openTabs`;
const TOPIC = "Trash fixture";

describe("A step whose paper is in the trash", function () {
  this.timeout(60_000);
  let win: any;
  let collection: any;
  let p: Zotero.Item;
  let q: Zotero.Item;
  let r: Zotero.Item;
  let note: Zotero.Item;

  const view = () =>
    win.document.querySelector(".mr-list.mr-tab") as HTMLElement | null;
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
      `the tab shows ${keys}; it shows ${rowKeys(view(), ".mr-step")}`,
    ).to.equal(true);
  }
  async function trash(item: Zotero.Item, deleted: boolean): Promise<void> {
    item.deleted = deleted;
    await item.saveTx();
    await idle();
  }

  before(async function () {
    win = Zotero.getMainWindows()[0];
    Zotero.Prefs.clear(OPEN_TABS, true);
    collection = new Zotero.Collection();
    collection.libraryID = Zotero.Libraries.userLibraryID;
    collection.name = TOPIC;
    await collection.saveTx();
    p = await makePaper("Paper P", undefined, collection.id);
    q = await makePaper("Paper Q", undefined, collection.id);
    r = await makePaper("Paper R", undefined, collection.id);
    note = await makeListNote(
      collection.id,
      writeReadingList(
        {
          version: 1,
          topic: TOPIC,
          steps: [
            { key: p.key, why: "" },
            { key: q.key, why: "keep me" },
            { key: r.key, why: "" },
          ],
        },
        (key) => key,
        { kind: "user" },
      ),
    );
    await idle();
  });

  after(async function () {
    for (const tab of (win.Zotero_Tabs._tabs as any[]).filter(
      (tab) => tab.type === TAB_TYPE,
    )) {
      win.Zotero_Tabs.close(tab.id);
    }
    Zotero.Prefs.clear(OPEN_TABS, true);
    win.Zotero_Tabs.select("zotero-pane");
    await Zotero.Items.erase([note.id, p.id, q.id, r.id]);
    await collection.eraseTx();
    await idle();
  });

  it("keeps its place and reason through an edit, and comes back with the paper", async function () {
    plugin().api.openList(win, collection.id);
    await untilSteps([p.key, q.key, r.key]);
    await trash(q, true);
    await untilSteps([p.key, r.key]);

    altArrow(win, view()!.querySelector(`[data-key="${r.key}"]`)!, "ArrowUp");
    await idle();
    // Q stays before R, the step that followed it.
    expect(stepsInNote(), "the steps in the note").to.deep.equal([
      { key: q.key, why: "keep me" },
      { key: r.key, why: "" },
      { key: p.key, why: "" },
    ]);
    await untilSteps([r.key, p.key]);

    await trash(q, false);
    await untilSteps([q.key, r.key, p.key]);
  });
});
