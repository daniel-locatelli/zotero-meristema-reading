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
  idle,
  makeListNote,
  makePaper,
  rowKeys,
  waitFor,
} from "./helpers";

const OPEN = `${config.addonRef}-open-reading-list`;
const TAB_TYPE = `${config.addonRef}-list`;
const TOPIC = "Tab fixture";

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

  it("selects the open tab rather than opening a second", async function () {
    await openFromMenu();
    await idle();
    expect(listTabs(), "list tabs").to.have.length(1);
    expect(win.Zotero_Tabs.selectedID).to.equal(listTabs()[0].id);
  });

  it("closes", async function () {
    win.Zotero_Tabs.close(listTabs()[0].id);
    const gone = await waitFor(() => !view(), 10_000);
    expect(gone, "the tab's view is gone").to.equal(true);
  });
});
