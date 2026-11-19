/// <reference types="mocha" />
import { expect } from "chai";
import { config } from "../../package.json";
import { writeReadingList } from "../../src/format/readingList";
import { idle, makeListNote, makePaper, plugin, waitFor } from "./helpers";

const LIST_TAB_TYPE = `${config.addonRef}-list`;
const OVERVIEW_TAB_TYPE = `${config.addonRef}-overview`;
const OPEN_TABS = `extensions.${config.addonRef}.openTabs`;

describe("A list whose collection is in the trash", function () {
  this.timeout(60_000);
  let win: any;
  let collection: any;
  let paper: Zotero.Item;
  let note: Zotero.Item;

  const tab = () =>
    win.document.querySelector(".mr-list.mr-tab") as HTMLElement | null;
  const row = () =>
    win.document.querySelector(
      `.mr-overview .mr-overview-row[data-collection-id="${collection.id}"]`,
    ) as HTMLElement | null;
  const tabsOf = (type: string) =>
    (win.Zotero_Tabs._tabs as any[]).filter((open) => open.type === type);
  const seen = () =>
    JSON.stringify({
      steps: tab()?.querySelectorAll(".mr-step").length ?? null,
      empty: Boolean(tab()?.querySelector(".mr-empty")),
      row: row()?.textContent ?? null,
      cell: plugin().api.stepCell(paper.id, collection.id),
    });

  async function until(probe: () => boolean, what: string): Promise<void> {
    const ok = await waitFor(probe, 10_000);
    expect(ok, `${what}; it shows ${seen()}`).to.equal(true);
  }
  async function trash(deleted: boolean): Promise<void> {
    collection.deleted = deleted;
    await collection.saveTx();
    await idle();
  }

  before(async function () {
    win = Zotero.getMainWindows()[0];
    Zotero.Prefs.clear(OPEN_TABS, true);
    collection = new Zotero.Collection();
    collection.libraryID = Zotero.Libraries.userLibraryID;
    collection.name = "Collection trash fixture";
    await collection.saveTx();
    paper = await makePaper("Paper T", undefined, collection.id);
    note = await makeListNote(
      collection.id,
      writeReadingList(
        {
          version: 1,
          topic: "Trash topic",
          steps: [{ key: paper.key, why: "" }],
        },
        (key) => key,
        { kind: "user" },
      ),
    );
    await idle();
    plugin().api.openList(win, collection.id);
    plugin().api.openOverview(win);
  });

  after(async function () {
    for (const open of [
      ...tabsOf(LIST_TAB_TYPE),
      ...tabsOf(OVERVIEW_TAB_TYPE),
    ]) {
      win.Zotero_Tabs.close(open.id);
    }
    Zotero.Prefs.clear(OPEN_TABS, true);
    win.Zotero_Tabs.select("zotero-pane");
    if (collection.deleted) await trash(false);
    await Zotero.Items.erase([note.id, paper.id]);
    await collection.eraseTx();
    await idle();
  });

  it("holds no list while it is in the trash, and holds it again once restored", async function () {
    await until(
      () => tab()?.querySelectorAll(".mr-step").length === 1 && Boolean(row()),
      "the tab shows the step and the Overview the list",
    );

    await trash(true);
    await until(
      () =>
        Boolean(tab()?.querySelector(".mr-empty")) &&
        !tab()?.querySelector(".mr-step") &&
        !row() &&
        plugin().api.stepCell(paper.id, collection.id) === "",
      "the tab says there is no list, the Overview drops it and the Step cell is blank",
    );

    await trash(false);
    await until(
      () =>
        tab()?.querySelectorAll(".mr-step").length === 1 &&
        Boolean(row()) &&
        plugin().api.stepCell(paper.id, collection.id) === "00001",
      "the tab, the Overview and the Step cell show the list again",
    );
  });

  it("shows a renamed collection's new name in the Overview", async function () {
    collection.name = "Collection trash fixture, renamed";
    await collection.saveTx();
    await idle();
    await until(
      () =>
        row()?.querySelector(".mr-row-folder")?.textContent ===
        "Collection trash fixture, renamed",
      "the Overview row names the renamed collection",
    );
  });
});
