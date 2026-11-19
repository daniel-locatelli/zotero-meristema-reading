/// <reference types="mocha" />
import { expect } from "chai";
import { config } from "../../package.json";
import {
  parseReadingList,
  writeReadingList,
  type ReadingListDoc,
} from "../../src/format/readingList";
import {
  idle,
  makeListNote,
  makePaper,
  openSecondWindow,
  plugin,
  waitFor,
} from "./helpers";

const TAB_TYPE = `${config.addonRef}-list`;
const OPEN_TABS = `extensions.${config.addonRef}.openTabs`;
const TOPIC = "Two windows fixture";

describe("A list tab open in two windows", function () {
  this.timeout(60_000);
  let one: any;
  let two: any;
  let collection: any;
  let paper: Zotero.Item;
  let note: Zotero.Item;

  const listTabs = (win: any) =>
    (win.Zotero_Tabs._tabs as any[]).filter((tab) => tab.type === TAB_TYPE);
  const reasonIn = (win: any): string | null =>
    (
      win.document.querySelector(
        `.mr-list.mr-tab [data-key="${paper.key}"] .mr-why`,
      ) as HTMLTextAreaElement | null
    )?.value ?? null;
  /** The collection keys the plugin's open-tab record holds. */
  const recorded = (): string[] => {
    try {
      const raw = JSON.parse(String(Zotero.Prefs.get(OPEN_TABS, true) ?? ""));
      return Array.isArray(raw)
        ? raw.map((tab: any) => String(tab?.collectionKey))
        : [];
    } catch {
      return [];
    }
  };
  async function setReason(why: string): Promise<void> {
    const parsed = parseReadingList(note.getNote());
    const doc = (parsed as { ok: true; value: ReadingListDoc }).value;
    note.setNote(
      writeReadingList(
        { ...doc, steps: [{ key: paper.key, why }] },
        (key) => key,
        { kind: "user" },
      ),
    );
    await note.saveTx();
    await idle();
  }
  async function untilReason(win: any, why: string, name: string) {
    const shown = await waitFor(() => reasonIn(win) === why, 10_000);
    expect(
      shown,
      `the tab in ${name} shows “${why}”; it shows “${reasonIn(win)}”`,
    ).to.equal(true);
  }

  before(async function () {
    one = Zotero.getMainWindows()[0];
    Zotero.Prefs.clear(OPEN_TABS, true);
    collection = new Zotero.Collection();
    collection.libraryID = Zotero.Libraries.userLibraryID;
    collection.name = TOPIC;
    await collection.saveTx();
    paper = await makePaper("Paper W", undefined, collection.id);
    note = await makeListNote(
      collection.id,
      writeReadingList(
        { version: 1, topic: TOPIC, steps: [{ key: paper.key, why: "first" }] },
        (key) => key,
        { kind: "user" },
      ),
    );
    two = await openSecondWindow();
  });

  after(async function () {
    for (const win of [one, two]) {
      if (!win || win.closed) continue;
      for (const tab of listTabs(win)) win.Zotero_Tabs.close(tab.id);
    }
    if (two && !two.closed) two.close();
    Zotero.Prefs.clear(OPEN_TABS, true);
    one.Zotero_Tabs.select("zotero-pane");
    await Zotero.Items.erase([note.id, paper.id]);
    await collection.eraseTx();
    await idle();
  });

  it("redraws the list in both windows, and in the first after the second closes its tab", async function () {
    plugin().api.openList(one, collection.id);
    plugin().api.openList(two, collection.id);
    await untilReason(one, "first", "the first window");
    await untilReason(two, "first", "the second window");

    await setReason("second");
    await untilReason(one, "second", "the first window");
    await untilReason(two, "second", "the second window");

    for (const tab of listTabs(two)) two.Zotero_Tabs.close(tab.id);
    await setReason("third");
    await untilReason(one, "third", "the first window");
  });

  it("keeps the tab recorded while one window still shows it", async function () {
    plugin().api.openList(two, collection.id);
    await untilReason(two, "third", "the second window");
    expect(recorded(), "one record for the two tabs").to.deep.equal([
      collection.key,
    ]);
    for (const tab of listTabs(two)) two.Zotero_Tabs.close(tab.id);
    expect(
      recorded(),
      "closed in the second window, still open in the first",
    ).to.deep.equal([collection.key]);
    for (const tab of listTabs(one)) one.Zotero_Tabs.close(tab.id);
    expect(recorded(), "closed in both windows").to.deep.equal([]);
  });
});
