/// <reference types="mocha" />
import { expect } from "chai";
import { config } from "../../package.json";
import { writeReadingList } from "../../src/format/readingList";
import { READING_QUEUE_TAG } from "../../src/format/readingQueue";
import {
  emptyReadState,
  READ_STATE_TAG,
  setState,
  writeReadState,
  type ReadState,
} from "../../src/format/readState";
import {
  collectionMenuEntry,
  command,
  eraseStateNotes,
  idle,
  libraryMenuEntry,
  makeListNote,
  makePaper,
  plugin,
  rowKeys,
  waitFor,
} from "./helpers";

const LIST_TAB_TYPE = `${config.addonRef}-list`;
const OVERVIEW_TAB_TYPE = `${config.addonRef}-overview`;
const OPEN_TABS = `extensions.${config.addonRef}.openTabs`;

describe("The Overview tab", function () {
  this.timeout(60_000);
  let win: any;
  let shells: any;
  let queueFolder: any;
  let a: Zotero.Item;
  let b: Zotero.Item;
  let c: Zotero.Item;
  let shellsNote: Zotero.Item;
  let queueNote: Zotero.Item;

  const view = () =>
    win.document.querySelector(".mr-overview") as HTMLElement | null;
  const find = (selector: string) =>
    view()?.querySelector(selector) as HTMLElement | null | undefined;
  const textOf = (selector: string) => find(selector)?.textContent ?? null;
  const nextKey = () => find(".mr-queue-next")?.dataset.key ?? null;
  const shellsRow = () =>
    find(`.mr-overview-row[data-collection-id="${shells.id}"]`);
  const tabsOf = (type: string) =>
    (win.Zotero_Tabs._tabs as any[]).filter((tab) => tab.type === type);
  const recorded = (): unknown[] => {
    try {
      const raw = JSON.parse(String(Zotero.Prefs.get(OPEN_TABS, true) ?? ""));
      return Array.isArray(raw) ? raw : [];
    } catch {
      return [];
    }
  };
  /** What the view shows, for assertion messages. */
  const seen = () =>
    JSON.stringify({
      next: nextKey(),
      nextState: find(".mr-queue-next .mr-state")?.dataset.state ?? null,
      after: rowKeys(view(), ".mr-queue-after .mr-queue-step"),
      none: textOf(".mr-queue-none"),
      empty: textOf(".mr-queue-empty"),
      done: textOf(".mr-queue-done"),
      failure: textOf(".mr-failure"),
      duplicates: Array.from(
        view()?.querySelectorAll(".mr-queue-duplicate") ?? [],
      ).map((node) => (node as Element).textContent),
      sources: Array.from(
        view()?.querySelectorAll(".mr-queue-next .mr-source") ?? [],
      ).map((node) => (node as Element).textContent),
      shells: {
        progress: shellsRow()?.querySelector(".mr-row-progress")?.textContent,
        next: shellsRow()?.querySelector(".mr-row-next")?.textContent,
      },
      keys: { a: a?.key, b: b?.key, c: c?.key },
    });

  /** Writes the read states as a sync would bring them; every other paper is Unread. */
  async function writeStates(
    states: Array<[Zotero.Item, ReadState]>,
  ): Promise<void> {
    await eraseStateNotes();
    let doc = emptyReadState();
    for (const [paper, state] of states) {
      doc = setState(doc, `user:${paper.key}`, state, "2026-03-01T00:00:00Z");
    }
    const note = new Zotero.Item("note");
    note.libraryID = Zotero.Libraries.userLibraryID;
    note.setNote(writeReadState(doc));
    note.addTag(READ_STATE_TAG);
    await note.saveTx({ skipSelect: true });
    await idle();
  }

  function listHtml(topic: string, keys: string[]): string {
    return writeReadingList(
      { version: 1, topic, steps: keys.map((key) => ({ key, why: "" })) },
      (key) => key,
      { kind: "user" },
    );
  }

  before(async function () {
    win = Zotero.getMainWindows()[0];
    Zotero.Prefs.clear(OPEN_TABS, true);
    await eraseStateNotes();
    shells = new Zotero.Collection();
    shells.libraryID = Zotero.Libraries.userLibraryID;
    shells.name = "Shells";
    await shells.saveTx();
    queueFolder = new Zotero.Collection();
    queueFolder.libraryID = Zotero.Libraries.userLibraryID;
    queueFolder.name = "Overview queue";
    await queueFolder.saveTx();
    a = await makePaper("Paper A", undefined, shells.id);
    b = await makePaper("Paper B", undefined, shells.id);
    c = await makePaper("Paper C", undefined, queueFolder.id);
    for (const paper of [a, b]) {
      paper.setCollections([shells.id, queueFolder.id]);
      await paper.saveTx({ skipSelect: true });
    }
    // The queue note is the older, so it wins the pick over a second one.
    queueNote = new Zotero.Item("note");
    queueNote.libraryID = Zotero.Libraries.userLibraryID;
    queueNote.setNote(
      writeReadingList(
        {
          version: 1,
          topic: "Reading queue",
          steps: [
            { key: b.key, why: "start with b" },
            { key: a.key, why: "" },
            { key: c.key, why: "" },
          ],
        },
        (key) => key,
        { kind: "user" },
      ),
    );
    queueNote.addTag("meristema-reading-list");
    queueNote.addTag(READING_QUEUE_TAG);
    queueNote.setCollections([queueFolder.id]);
    queueNote.setField("dateAdded", "2020-01-01 00:00:00");
    await queueNote.saveTx({ skipSelect: true });
    shellsNote = await makeListNote(
      shells.id,
      listHtml("Shells", [a.key, b.key]),
    );
    await writeStates([[a, "read"]]);
  });

  after(async function () {
    for (const tab of [
      ...tabsOf(LIST_TAB_TYPE),
      ...tabsOf(OVERVIEW_TAB_TYPE),
    ]) {
      win.Zotero_Tabs.close(tab.id);
    }
    Zotero.Prefs.clear(OPEN_TABS, true);
    win.Zotero_Tabs.select("zotero-pane");
    await win.ZoteroPane.collectionsView.selectLibrary(
      Zotero.Libraries.userLibraryID,
    );
    await Zotero.Items.erase([shellsNote.id, queueNote.id, a.id, b.id, c.id]);
    await shells.eraseTx();
    await queueFolder.eraseTx();
    await eraseStateNotes();
    await idle();
  });

  it("shows the queue's next up, the steps after it, and each list's progress", async function () {
    expect(
      queueNote.dateAdded < shellsNote.dateAdded,
      `the queue note is older: ${queueNote.dateAdded} < ${shellsNote.dateAdded}`,
    ).to.equal(true);
    plugin().api.openOverview(win);
    const tab = await waitFor(() => tabsOf(OVERVIEW_TAB_TYPE)[0], 10_000);
    expect(tab, "the overview tab").to.exist;
    expect(tab.title).to.equal("Reading Overview");
    expect(win.Zotero_Tabs.selectedID, "the tab is selected").to.equal(tab.id);
    const drawn = await waitFor(
      () =>
        nextKey() === b.key &&
        rowKeys(view(), ".mr-queue-after .mr-queue-step").join() === c.key &&
        shellsRow()?.querySelector(".mr-row-progress")?.textContent ===
          "1 read · 0 reading · 1 left",
      10_000,
    );
    expect(drawn, `the overview: ${seen()}`).to.equal(true);
    expect(textOf(".mr-queue-next .mr-why"), seen()).to.equal("start with b");
    expect(
      Array.from(view()!.querySelectorAll(".mr-queue-next .mr-source")).map(
        (node) => (node as Element).textContent,
      ),
      `the sources: ${seen()}`,
    ).to.deep.equal(["Shells"]);
    expect(
      find(".mr-queue-next .mr-source")?.dataset.collectionId,
      seen(),
    ).to.equal(String(shells.id));
    expect(
      shellsRow()?.querySelector(".mr-row-next")?.textContent,
      `Shells' next up is B: ${seen()}`,
    ).to.equal("Paper B");
    expect(find(".mr-open-queue")?.textContent, seen()).to.equal("Open queue");
    expect(
      find(`.mr-overview-row[data-collection-id="${queueFolder.id}"]`),
      "the queue has no row of its own",
    ).to.not.exist;
  });

  it("marks next up Read and moves on to the next step", async function () {
    find(".mr-queue-next .mr-state")!.click();
    await idle();
    const reading = await waitFor(
      () =>
        nextKey() === b.key &&
        find(".mr-queue-next .mr-state")?.dataset.state === "reading",
      10_000,
    );
    expect(reading, `B is Reading: ${seen()}`).to.equal(true);
    find(".mr-queue-next .mr-state")!.click();
    await idle();
    const moved = await waitFor(() => nextKey() === c.key, 10_000);
    expect(moved, `next up moves on to C: ${seen()}`).to.equal(true);
    expect(
      rowKeys(view(), ".mr-queue-after .mr-queue-step"),
      seen(),
    ).to.deep.equal([]);
    // Back to A Read alone, for the cases after.
    await writeStates([[a, "read"]]);
    const reset = await waitFor(() => nextKey() === b.key, 10_000);
    expect(reset, `B is next up again: ${seen()}`).to.equal(true);
  });

  it("opens a source list's tab and the queue's tab", async function () {
    const overviewID = tabsOf(OVERVIEW_TAB_TYPE)[0].id;
    find(".mr-queue-next .mr-source")!.click();
    const shellsTab = `${LIST_TAB_TYPE}-${shells.id}`;
    const opened = await waitFor(
      () => win.Zotero_Tabs.selectedID === shellsTab,
      10_000,
    );
    expect(
      opened,
      `the Shells tab is selected: ${win.Zotero_Tabs.selectedID}`,
    ).to.equal(true);
    win.Zotero_Tabs.select(overviewID);
    find(".mr-open-queue")!.click();
    const queueTab = `${LIST_TAB_TYPE}-${queueFolder.id}`;
    const queueOpened = await waitFor(
      () => win.Zotero_Tabs.selectedID === queueTab,
      10_000,
    );
    expect(
      queueOpened,
      `the queue's tab is selected: ${win.Zotero_Tabs.selectedID}`,
    ).to.equal(true);
    for (const tab of tabsOf(LIST_TAB_TYPE)) win.Zotero_Tabs.close(tab.id);
    win.Zotero_Tabs.select(overviewID);
  });

  it("says when there is no queue, and names a second queue note", async function () {
    queueNote.removeTag(READING_QUEUE_TAG);
    await queueNote.saveTx({ skipSelect: true });
    await idle();
    const none = await waitFor(
      () => textOf(".mr-queue-none") === "No reading queue yet.",
      10_000,
    );
    expect(none, `no queue: ${seen()}`).to.equal(true);
    expect(textOf(".mr-queue-hint"), seen()).to.equal(
      "Ask Claude to write one with zot.py reading-list --queue.",
    );
    expect(find(".mr-open-queue"), "no Open queue without a queue").to.not
      .exist;
    queueNote.addTag(READING_QUEUE_TAG);
    await queueNote.saveTx({ skipSelect: true });
    shellsNote.addTag(READING_QUEUE_TAG);
    await shellsNote.saveTx({ skipSelect: true });
    await idle();
    const named = await waitFor(
      () =>
        nextKey() === b.key &&
        textOf(".mr-queue-duplicate")?.includes("“Shells” (Shells)"),
      10_000,
    );
    expect(named, `the second queue note is named: ${seen()}`).to.equal(true);
    expect(textOf(".mr-queue-duplicate"), seen()).to.equal(
      "Also tagged as the queue: “Shells” (Shells). Remove its meristema-reading-queue tag to keep one queue.",
    );
    shellsNote.removeTag(READING_QUEUE_TAG);
    await shellsNote.saveTx({ skipSelect: true });
    await idle();
    const restored = await waitFor(
      () => !find(".mr-queue-duplicate") && Boolean(shellsRow()),
      10_000,
    );
    expect(restored, `one queue again: ${seen()}`).to.equal(true);
  });

  it("shows a list that cannot be read as such, not as All read", async function () {
    const html = shellsNote.getNote();
    shellsNote.setNote("<p>No list here</p>");
    await shellsNote.saveTx({ skipSelect: true });
    await idle();
    const unreadable = await waitFor(
      () =>
        shellsRow()?.querySelector(".mr-row-progress")?.textContent ===
        "Cannot be read",
      10_000,
    );
    expect(unreadable, `Shells cannot be read: ${seen()}`).to.equal(true);
    expect(
      shellsRow()?.querySelector(".mr-row-next")?.textContent,
      `no All read for a list that cannot be read: ${seen()}`,
    ).to.equal("");
    shellsNote.setNote(html);
    await shellsNote.saveTx({ skipSelect: true });
    await idle();
    const back = await waitFor(
      () =>
        shellsRow()?.querySelector(".mr-row-progress")?.textContent ===
        "1 read · 0 reading · 1 left",
      10_000,
    );
    expect(back, `Shells reads again: ${seen()}`).to.equal(true);
  });

  it("says The queue is empty when the queue has no steps", async function () {
    const html = queueNote.getNote();
    queueNote.setNote(listHtml("Reading queue", []));
    await queueNote.saveTx({ skipSelect: true });
    await idle();
    const empty = await waitFor(
      () => textOf(".mr-queue-empty") === "The queue is empty.",
      10_000,
    );
    expect(empty, `the empty queue: ${seen()}`).to.equal(true);
    expect(find(".mr-queue-next"), seen()).to.not.exist;
    expect(find(".mr-open-queue")?.textContent, seen()).to.equal("Open queue");
    queueNote.setNote(html);
    await queueNote.saveTx({ skipSelect: true });
    await idle();
    const back = await waitFor(() => nextKey() === b.key, 10_000);
    expect(back, `the queue reads again: ${seen()}`).to.equal(true);
  });

  it("says All read when every queue step is read", async function () {
    await writeStates([
      [a, "read"],
      [b, "read"],
      [c, "read"],
    ]);
    const done = await waitFor(
      () => textOf(".mr-queue-done") === "All read.",
      10_000,
    );
    expect(done, `every step read: ${seen()}`).to.equal(true);
    expect(find(".mr-queue-next"), seen()).to.not.exist;
    expect(find(".mr-open-queue")?.textContent, seen()).to.equal("Open queue");
    expect(
      shellsRow()?.querySelector(".mr-row-next")?.textContent,
      `Shells is all read too: ${seen()}`,
    ).to.equal("All read");
  });

  it("opens from My Library's menu", async function () {
    for (const tab of tabsOf(OVERVIEW_TAB_TYPE)) win.Zotero_Tabs.close(tab.id);
    const library = await libraryMenuEntry(
      win,
      `${config.addonRef}-open-reading-overview`,
    );
    try {
      expect(library.entry, "the entry is on My Library's menu").to.exist;
      expect(library.entry.hidden, "the entry is shown").to.equal(false);
      await command(library.entry);
    } finally {
      library.popup.hidePopup();
    }
    const tab = await waitFor(() => tabsOf(OVERVIEW_TAB_TYPE)[0], 10_000);
    expect(tab, "the overview tab opened").to.exist;
    expect(win.Zotero_Tabs.selectedID, "it is selected").to.equal(tab.id);
    win.Zotero_Tabs.select("zotero-pane");
    const folder = await collectionMenuEntry(
      win,
      shells.id,
      `${config.addonRef}-open-reading-overview`,
    );
    try {
      expect(
        !folder.entry || folder.entry.hidden,
        "the entry is hidden on a folder's menu",
      ).to.equal(true);
    } finally {
      folder.popup.hidePopup();
    }
  });

  it("opens from a list tab's header", async function () {
    for (const tab of tabsOf(OVERVIEW_TAB_TYPE)) win.Zotero_Tabs.close(tab.id);
    const queueTab = `${LIST_TAB_TYPE}-${queueFolder.id}`;
    plugin().api.openOverview(win);
    await waitFor(() => find(".mr-open-queue"), 10_000);
    find(".mr-open-queue")!.click();
    const opened = await waitFor(
      () => win.Zotero_Tabs.selectedID === queueTab,
      10_000,
    );
    expect(opened, `the queue's tab: ${win.Zotero_Tabs.selectedID}`).to.equal(
      true,
    );
    const button = await waitFor(
      () =>
        win.document.querySelector(
          ".mr-list.mr-tab .mr-open-overview",
        ) as HTMLElement | null,
      10_000,
    );
    expect(button, "the header link").to.exist;
    expect(button!.textContent).to.equal("Reading Overview");
    button!.click();
    const tab = await waitFor(() => tabsOf(OVERVIEW_TAB_TYPE)[0], 10_000);
    expect(tab, "the overview tab opened").to.exist;
    const selected = await waitFor(
      () => win.Zotero_Tabs.selectedID === tab.id,
      10_000,
    );
    expect(selected, `selected: ${win.Zotero_Tabs.selectedID}`).to.equal(true);
    for (const open of tabsOf(LIST_TAB_TYPE)) win.Zotero_Tabs.close(open.id);
  });

  it("comes back after a restart", async function () {
    const tabID = tabsOf(OVERVIEW_TAB_TYPE)[0].id;
    expect(recorded(), "the open tab is recorded").to.deep.equal([
      { kind: "overview" },
    ]);
    win.Zotero_Tabs.select("zotero-pane");
    const { AddonManager } = (globalThis as any).ChromeUtils.importESModule(
      "resource://gre/modules/AddonManager.sys.mjs",
    );
    const addon = await AddonManager.getAddonByID(config.addonID);
    await addon.disable();
    const closed = await waitFor(
      () => tabsOf(OVERVIEW_TAB_TYPE).length === 0,
      10_000,
    );
    expect(closed, "disabling closes the tab").to.equal(true);
    expect(recorded(), "disabling keeps the record").to.deep.equal([
      { kind: "overview" },
    ]);
    await addon.enable();
    const started = await waitFor(
      () => (Zotero as any)[config.addonInstance]?.data?.initialized,
      30_000,
    );
    expect(started, "the plugin starts again").to.equal(true);
    const back = await waitFor(() => tabsOf(OVERVIEW_TAB_TYPE)[0], 10_000);
    const state = () =>
      JSON.stringify({
        tabs: (win.Zotero_Tabs._tabs as any[]).map((tab) => tab.type),
        selected: win.Zotero_Tabs.selectedID,
        record: recorded(),
      });
    expect(back, `the tab is back: ${state()}`).to.exist;
    expect(back!.id, "the same tab").to.equal(tabID);
    expect(
      win.Zotero_Tabs.selectedID,
      `the library tab stays selected: ${state()}`,
    ).to.equal("zotero-pane");
    expect(recorded(), `one record, not two: ${state()}`).to.deep.equal([
      { kind: "overview" },
    ]);
    win.Zotero_Tabs.select(tabID);
    const drawn = await waitFor(
      () => textOf(".mr-queue-done") === "All read.",
      10_000,
    );
    expect(drawn, `the restored tab draws: ${seen()}`).to.equal(true);
  });
});
