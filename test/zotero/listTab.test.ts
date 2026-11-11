/// <reference types="mocha" />
import { expect } from "chai";
import { config } from "../../package.json";
import {
  parseReadingList,
  writeReadingList,
  type ReadingListDoc,
} from "../../src/format/readingList";
import {
  altArrow,
  collectionMenuEntry,
  command,
  delay,
  dragSession,
  idle,
  makeListNote,
  makePaper,
  rowKeys,
  waitFor,
} from "./helpers";

const OPEN = `${config.addonRef}-open-reading-list`;
const TAB_TYPE = `${config.addonRef}-list`;
const TOPIC = "Tab fixture";
const OPEN_TABS = `extensions.${config.addonRef}.openTabs`;
const ICON = "meristema-reading-list";
const LOGO = `chrome://${config.addonRef}/content/icons/reading.svg`;

describe("The list tab", function () {
  this.timeout(60_000);
  let win: any;
  let collection: any;
  let x: Zotero.Item;
  let y: Zotero.Item;
  let note: Zotero.Item;

  const listTabs = () =>
    (win.Zotero_Tabs._tabs as any[]).filter((tab) => tab.type === TAB_TYPE);
  const view = () =>
    win.document.querySelector(".mr-list.mr-tab") as HTMLElement | null;
  /** The folder keys the plugin's open-tab record holds. */
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
  const tabIcon = (tabID: string): HTMLElement | null =>
    win.document.querySelector(
      `#tab-bar-container .tab[data-id="${tabID}"] .icon-item-type`,
    );

  async function openFromMenu(): Promise<void> {
    win.Zotero_Tabs.select("zotero-pane");
    const { popup, entry } = await collectionMenuEntry(
      win,
      collection.id,
      OPEN,
    );
    const offered = Boolean(entry) && !entry.hidden;
    // A popup left open would show stale entries to the next case.
    if (!offered) popup.hidePopup();
    expect(offered, "Open Reading List offered").to.equal(true);
    const reached = command(entry);
    popup.hidePopup();
    await reached;
  }

  before(async function () {
    win = Zotero.getMainWindows()[0];
    Zotero.Prefs.clear(OPEN_TABS, true);
    collection = new Zotero.Collection();
    collection.libraryID = Zotero.Libraries.userLibraryID;
    collection.name = TOPIC;
    await collection.saveTx();
    x = await makePaper("Paper X", undefined, collection.id);
    y = await makePaper("Paper Y", undefined, collection.id);
    note = await makeListNote(
      collection.id,
      writeReadingList(
        {
          version: 1,
          topic: TOPIC,
          steps: [
            { key: x.key, why: "why x" },
            { key: y.key, why: "" },
          ],
        },
        (key) => key,
        { kind: "user" },
      ),
    );
    await idle();
  });

  after(async function () {
    for (const tab of listTabs()) win.Zotero_Tabs.close(tab.id);
    Zotero.Prefs.clear(OPEN_TABS, true);
    win.Zotero_Tabs.select("zotero-pane");
    await win.ZoteroPane.collectionsView.selectLibrary(
      Zotero.Libraries.userLibraryID,
    );
    await Zotero.Items.erase([note.id, x.id, y.id]);
    await collection.eraseTx();
    await idle();
  });

  it("opens the list in a tab from the folder menu, reasons in full", async function () {
    await openFromMenu();
    const tab = await waitFor(() => listTabs()[0], 10_000);
    expect(tab, "the list tab").to.exist;
    expect(tab.title).to.equal(TOPIC);
    const shown = await waitFor(
      () => rowKeys(view(), ".mr-step").join() === [x.key, y.key].join(),
      10_000,
    );
    expect(shown, `the tab's cards: ${rowKeys(view(), ".mr-step")}`).to.equal(
      true,
    );
    const why = view()!.querySelector(
      `[data-key="${x.key}"] .mr-why`,
    ) as HTMLTextAreaElement;
    expect(why.value).to.equal("why x");
    expect(why.rows, "reasons in full").to.equal(3);
    // Zotero lays out its context pane after notifier events: let them run.
    await delay(500);
    const pane = win.document.getElementById("zotero-context-pane");
    const splitter = win.document.getElementById("zotero-context-splitter");
    const sidenav = win.document.getElementById("zotero-context-pane-sidenav");
    const seen = {
      collapsed: pane?.getAttribute("collapsed"),
      splitterHidden: splitter?.getAttribute("hidden"),
      sidenavHidden: Boolean(sidenav?.hidden),
    };
    expect(
      seen,
      `Zotero's context pane stays shut over the tab: ${JSON.stringify(seen)}; splitter state ${splitter?.getAttribute("state")}`,
    ).to.deep.equal({
      collapsed: "true",
      splitterHidden: "true",
      sidenavHidden: true,
    });
  });

  it("keeps Zotero's context pane shut when Zotero lays it out again", async function () {
    win.Zotero_Tabs.select(listTabs()[0].id);
    const splitter = win.document.getElementById("zotero-context-splitter");
    const stacked = win.document.getElementById(
      "zotero-context-splitter-stacked",
    );
    // A window resize runs Zotero's context-pane layout, as the tab-select
    // notifier does when it reaches the pane late; it shows the splitter for
    // any tab but the library's.
    win.dispatchEvent(new win.Event("resize"));
    await delay(100);
    const seen = {
      splitterHidden: splitter?.getAttribute("hidden"),
      stackedHidden: stacked?.getAttribute("hidden"),
      collapsed: win.document
        .getElementById("zotero-context-pane")
        ?.getAttribute("collapsed"),
    };
    expect(
      seen,
      `the context pane after a layout pass: ${JSON.stringify(seen)}`,
    ).to.deep.equal({
      splitterHidden: "true",
      stackedHidden: "true",
      collapsed: "true",
    });
  });

  it("reorders from the tab and rewrites the note", async function () {
    altArrow(win, view()!.querySelector(`[data-key="${y.key}"]`)!, "ArrowUp");
    await idle();
    const parsed = parseReadingList(note.getNote());
    expect(
      (parsed as { ok: true; value: ReadingListDoc }).value.steps.map(
        (step) => step.key,
      ),
    ).to.deep.equal([y.key, x.key]);
    const redrawn = await waitFor(
      () => rowKeys(view(), ".mr-step").join() === [y.key, x.key].join(),
      10_000,
    );
    expect(redrawn, "the tab redraws").to.equal(true);
  });

  it("drops a dragged card where its slot opens", async function () {
    const card = (key: string) =>
      view()!.querySelector(`[data-key="${key}"]`) as HTMLElement;
    const list = view()!.querySelector(".mr-steps")!;
    const handle = card(x.key).querySelector(".mr-handle")!;
    const { fire } = dragSession(win);
    fire(handle, "dragstart");
    const above = Math.round(card(y.key).getBoundingClientRect().top + 2);
    fire(card(y.key), "dragover", { y: above });
    const order = Array.from(list.children).map((node) =>
      node.classList.contains("mr-drop-slot")
        ? "slot"
        : ((node as HTMLElement).dataset.key ?? "?"),
    );
    expect(order, `the slot opens above y; dragover at ${above}`).to.deep.equal(
      ["slot", y.key, x.key],
    );
    fire(card(y.key), "drop", { y: above });
    fire(handle, "dragend");
    await idle();
    const parsed = parseReadingList(note.getNote());
    expect(
      (parsed as { ok: true; value: ReadingListDoc }).value.steps.map(
        (step) => step.key,
      ),
    ).to.deep.equal([x.key, y.key]);
    const redrawn = await waitFor(
      () => rowKeys(view(), ".mr-step").join() === [x.key, y.key].join(),
      10_000,
    );
    expect(redrawn, "the tab redraws in the dropped order").to.equal(true);
  });

  it("shows a clicked paper in its folder in the library tab", async function () {
    const tabID = listTabs()[0].id;
    // Somewhere else in the library first, so the click has to find the folder.
    await win.ZoteroPane.collectionsView.selectLibrary(
      Zotero.Libraries.userLibraryID,
    );
    win.Zotero_Tabs.select(tabID);
    (
      view()!.querySelector(`[data-key="${x.key}"] .mr-title`) as HTMLElement
    ).click();
    const seen = () =>
      JSON.stringify({
        tab: win.Zotero_Tabs.selectedID,
        folder: win.ZoteroPane.getSelectedCollection(true),
        selected: win.ZoteroPane.getSelectedItems().map(
          (item: Zotero.Item) => item.id,
        ),
        collection: collection.id,
        x: x.id,
      });
    const shown = await waitFor(
      () =>
        win.Zotero_Tabs.selectedID === "zotero-pane" &&
        win.ZoteroPane.getSelectedCollection(true) === collection.id &&
        win.ZoteroPane.getSelectedItems()
          .map((item: Zotero.Item) => item.id)
          .join() === String(x.id),
      10_000,
    );
    expect(shown, `the library tab shows x in its folder: ${seen()}`).to.equal(
      true,
    );
    expect(listTabs(), "the list tab stays open").to.have.length(1);
  });

  it("renames the tab when the list's topic changes", async function () {
    const parsed = parseReadingList(note.getNote());
    const doc = (parsed as { ok: true; value: ReadingListDoc }).value;
    note.setNote(
      writeReadingList({ ...doc, topic: "Renamed fixture" }, (key) => key, {
        kind: "user",
      }),
    );
    await note.saveTx();
    await idle();
    const renamed = await waitFor(
      () => listTabs()[0]?.title === "Renamed fixture",
      10_000,
    );
    expect(
      renamed,
      `the tab's title: ${listTabs().map((tab) => tab.title)}`,
    ).to.equal(true);
  });

  it("selects the open tab rather than opening a second", async function () {
    await openFromMenu();
    await idle();
    expect(listTabs(), "list tabs").to.have.length(1);
    expect(win.Zotero_Tabs.selectedID).to.equal(listTabs()[0].id);
  });

  it("shows the logo, and comes back in the background after a restart", async function () {
    const tabID = listTabs()[0].id;
    const icon = () => {
      const elem = tabIcon(tabID);
      return {
        type: elem?.getAttribute("data-item-type") ?? null,
        image: elem ? win.getComputedStyle(elem).backgroundImage : null,
      };
    };
    const before = icon();
    expect(before.type, `the tab's icon: ${JSON.stringify(before)}`).to.equal(
      ICON,
    );
    expect(before.image, "the icon draws the logo").to.contain(LOGO);
    expect(recorded(), "the open tab is recorded").to.deep.equal([
      collection.key,
    ]);
    win.Zotero_Tabs.select("zotero-pane");
    // Disabling and enabling runs the plugin's real shutdown and startup, in
    // a fresh copy, as a restart does.
    const { AddonManager } = (globalThis as any).ChromeUtils.importESModule(
      "resource://gre/modules/AddonManager.sys.mjs",
    );
    const addon = await AddonManager.getAddonByID(config.addonID);
    await addon.disable();
    const closed = await waitFor(() => listTabs().length === 0, 10_000);
    expect(closed, "disabling closes the tab").to.equal(true);
    expect(recorded(), "disabling keeps the record").to.deep.equal([
      collection.key,
    ]);
    await addon.enable();
    const started = await waitFor(
      () => (Zotero as any)[config.addonInstance]?.data?.initialized,
      30_000,
    );
    expect(started, "the plugin starts again").to.equal(true);
    const back = await waitFor(() => listTabs()[0], 10_000);
    const seen = () =>
      JSON.stringify({
        tabs: (win.Zotero_Tabs._tabs as any[]).map((tab) => tab.type),
        selected: win.Zotero_Tabs.selectedID,
        record: recorded(),
        icon: icon(),
      });
    expect(back, `the tab is back: ${seen()}`).to.exist;
    expect(back!.id, "the same tab").to.equal(tabID);
    expect(
      win.Zotero_Tabs.selectedID,
      `the library tab stays selected: ${seen()}`,
    ).to.equal("zotero-pane");
    const drawn = await waitFor(() => icon().type === ICON, 10_000);
    expect(drawn, `the restored tab's icon: ${seen()}`).to.equal(true);
    expect(icon().image, "the icon draws the logo").to.contain(LOGO);
    expect(recorded(), "one record, not two").to.deep.equal([collection.key]);
    win.Zotero_Tabs.select(tabID);
    const shown = await waitFor(
      () => rowKeys(view(), ".mr-step").join() === [x.key, y.key].join(),
      10_000,
    );
    expect(
      shown,
      `the restored tab's cards: ${rowKeys(view(), ".mr-step")}`,
    ).to.equal(true);
  });

  it("closes, and forgets the tab", async function () {
    win.Zotero_Tabs.close(listTabs()[0].id);
    const gone = await waitFor(() => !view(), 10_000);
    expect(gone, "the tab's view is gone").to.equal(true);
    expect(recorded(), "the record no longer holds it").to.deep.equal([]);
  });
});
