/// <reference types="mocha" />
import { expect } from "chai";
import { config } from "../../package.json";
import {
  parseReadingList,
  READING_LIST_TAG,
  writeReadingList,
  type ReadingListDoc,
} from "../../src/format/readingList";
import {
  collectionMenuEntry,
  command,
  idle,
  makePaper,
  plugin,
  waitFor,
} from "./helpers";

const MAKE = `${config.addonRef}-make-reading-list`;
const TOPIC = "Reading list fixture";

describe("Reading lists", function () {
  this.timeout(60_000);
  let win: any;
  let collection: any;
  let alpha: Zotero.Item;
  let bravo: Zotero.Item;
  let charlie: Zotero.Item;

  function listNotes(): Zotero.Item[] {
    return collection
      .getChildItems(false, false)
      .filter(
        (item: Zotero.Item) => item.isNote() && item.hasTag(READING_LIST_TAG),
      );
  }

  /** Types `text` into the quick-search box and runs its search, as Enter does. */
  async function quickSearch(text: string): Promise<void> {
    const box = win.document.getElementById("zotero-tb-search");
    box.searchTextbox.value = text;
    await win.ZoteroPane.search();
  }

  /** The Step column in the item list's tree, made visible for the case. */
  function stepColumn(): any {
    const key = plugin().api.stepColumnKey() as string;
    return win.ZoteroPane.itemsView.tree?._columns?._columns?.find(
      (column: any) => column.dataKey === key,
    );
  }

  /** The Step cell the item list draws for `item`, read from its row. */
  function renderedStep(item: Zotero.Item): string | null {
    const key = plugin().api.stepColumnKey() as string;
    const view = win.ZoteroPane.itemsView;
    const index = view.getRowIndexByID(item.id);
    if (index === false || index === undefined) return null;
    const row = view.tree?._jsWindow?.getElementByIndex(index) as
      HTMLElement | undefined;
    const cell = row
      ? Array.from(row.children).find((node) =>
          (node as Element).classList.contains(key),
        )
      : undefined;
    return cell ? (cell.textContent ?? "") : null;
  }

  function writeSteps(keys: string[], why = ""): Promise<unknown> {
    const [note] = listNotes();
    note.setNote(
      writeReadingList(
        {
          version: 1,
          topic: TOPIC,
          steps: keys.map((key) => ({ key, why })),
        },
        (key) => key,
        { kind: "user" },
      ),
    );
    return note.saveTx();
  }

  function cells(): string[] {
    return [bravo, alpha, charlie].map(
      (item) => plugin().api.stepCell(item.id, collection.id) as string,
    );
  }

  before(async function () {
    win = Zotero.getMainWindows()[0];
    collection = new Zotero.Collection();
    collection.libraryID = Zotero.Libraries.userLibraryID;
    collection.name = TOPIC;
    await collection.saveTx();
    charlie = await makePaper("Charlie paper", undefined, collection.id);
    alpha = await makePaper("alpha paper", undefined, collection.id);
    bravo = await makePaper("Bravo paper", undefined, collection.id);
    await idle();
  });

  after(async function () {
    await quickSearch("");
    // Reset the tree to the library before erasing what it shows.
    await win.ZoteroPane.collectionsView.selectLibrary(
      Zotero.Libraries.userLibraryID,
    );
    await Zotero.Items.erase([
      ...listNotes().map((note) => note.id),
      alpha.id,
      bravo.id,
      charlie.id,
    ]);
    await collection.eraseTx();
    await idle();
  });

  it("makes a list from the folder menu, in the item list's order", async function () {
    await win.ZoteroPane.collectionsView.selectCollection(collection.id);
    // Title order is alpha, Bravo, Charlie, and so is the item list's default
    // sort. A quick search that shows only Charlie tells the two apart: the
    // shown paper comes first, then the ones it hid, by lowercased title.
    await quickSearch("Charlie");
    const shownKeys = await waitFor(() => {
      const items = win.ZoteroPane.getSortedItems() as Zotero.Item[];
      return items.length === 1 ? items.map((item) => item.key) : null;
    }, 10_000);
    expect(
      shownKeys,
      `the item list shows only Charlie; it shows ${(
        win.ZoteroPane.getSortedItems() as Zotero.Item[]
      ).map((item) => item.getField("title"))}`,
    ).to.deep.equal([charlie.key]);
    const { popup, entry } = await collectionMenuEntry(
      win,
      collection.id,
      MAKE,
    );
    expect(
      Boolean(entry) && !entry.hidden,
      "Make Reading List offered",
    ).to.equal(true);
    const reached = command(entry);
    popup.hidePopup();
    await reached;
    await idle();
    await quickSearch("");
    const notes = listNotes();
    expect(notes, "list notes in the folder").to.have.length(1);
    expect(parseReadingList(notes[0].getNote())).to.deep.equal({
      ok: true,
      value: {
        version: 1,
        topic: TOPIC,
        steps: [charlie.key, alpha.key, bravo.key].map((key) => ({
          key,
          why: "",
        })),
      },
    });
    expect(notes[0].getNote()).to.contain(
      `zotero://select/library/items/${alpha.key}`,
    );
  });

  it("no longer offers Make Reading List once the folder holds a list", async function () {
    const { popup, entry } = await collectionMenuEntry(
      win,
      collection.id,
      MAKE,
    );
    popup.hidePopup();
    expect(
      Boolean(entry) && !entry.hidden,
      "Make Reading List offered again",
    ).to.equal(false);
  });

  it("numbers the Step column in reading order, unordered papers after the last step", async function () {
    const [note] = listNotes();
    const doc: ReadingListDoc = {
      version: 1,
      topic: TOPIC,
      steps: [
        { key: bravo.key, why: "start here" },
        { key: alpha.key, why: "" },
      ],
    };
    note.setNote(writeReadingList(doc, (key) => key, { kind: "user" }));
    await note.saveTx();
    await idle();
    expect(cells(), "Bravo, alpha, Charlie").to.deep.equal([
      "00001",
      "00002",
      "00003u",
    ]);
    const key = plugin().api.stepColumnKey() as string | null;
    expect(
      Boolean(key) && Zotero.ItemTreeManager.isCustomColumn(key),
      `the Step column is registered (${key})`,
    ).to.equal(true);
  });

  it("draws each paper's step in the item list's Step column", async function () {
    await win.ZoteroPane.collectionsView.selectCollection(collection.id);
    await win.ZoteroPane.itemsView.waitForLoad();
    const column = stepColumn();
    expect(column, "the Step column in the item list").to.exist;
    const wasHidden = Boolean(column.hidden);
    const toggle = () =>
      win.ZoteroPane.itemsView.tree._columns.toggleHidden(
        win.ZoteroPane.itemsView.tree._columns._columns.indexOf(stepColumn()),
      );
    // The column picker persists `hidden`: show it, and put it back after.
    if (wasHidden) toggle();
    try {
      const drawn = () =>
        [bravo, alpha, charlie].map((item) => renderedStep(item));
      const first = await waitFor(
        () => drawn().join() === "1,2," && drawn(),
        10_000,
      );
      expect(
        first,
        `Bravo 1, alpha 2, Charlie blank; drawn ${JSON.stringify(drawn())}`,
      ).to.deep.equal(["1", "2", ""]);
      // A new order changes the cells, so the column is drawn again.
      await writeSteps([alpha.key, bravo.key]);
      await idle();
      const second = await waitFor(
        () => drawn().join() === "2,1," && drawn(),
        10_000,
      );
      expect(
        second,
        `Bravo 2, alpha 1, Charlie blank; drawn ${JSON.stringify(drawn())}`,
      ).to.deep.equal(["2", "1", ""]);
    } finally {
      if (Boolean(stepColumn()?.hidden) !== wasHidden) toggle();
      await writeSteps([bravo.key, alpha.key]);
      await idle();
    }
  });

  it("re-sorts a list sorted by Step when the order changes, keeping the selection", async function () {
    await win.ZoteroPane.collectionsView.selectCollection(collection.id);
    await win.ZoteroPane.itemsView.waitForLoad();
    const view = win.ZoteroPane.itemsView;
    const columns = () => view.tree._columns._columns as any[];
    const column = stepColumn();
    expect(column, "the Step column in the item list").to.exist;
    const wasHidden = Boolean(column.hidden);
    if (wasHidden) view.tree._columns.toggleHidden(columns().indexOf(column));
    const previous = columns().find((c: any) => c.sortDirection);
    const previousDirection = previous?.sortDirection;
    const keys = () => {
      const out: string[] = [];
      for (let i = 0; i < view.rowCount; i++) out.push(view.getRow(i).ref.key);
      return out;
    };
    const named = (rows: string[]) =>
      `rows ${rows.join()}; bravo ${bravo.key}, alpha ${alpha.key}`;
    try {
      await view._handleColumnSort(columns().indexOf(stepColumn()), 1);
      await view.waitForLoad();
      const first = keys();
      expect(
        first.indexOf(bravo.key) < first.indexOf(alpha.key),
        `sorted by Step, Bravo (1) before alpha (2); ${named(first)}`,
      ).to.equal(true);
      await view.selectItem(alpha.id);
      await writeSteps([alpha.key, bravo.key]);
      await idle();
      await waitFor(() => {
        const rows = keys();
        return rows.indexOf(alpha.key) < rows.indexOf(bravo.key);
      }, 10_000);
      const rows = keys();
      expect(
        rows.indexOf(alpha.key) < rows.indexOf(bravo.key),
        `alpha (1) before Bravo (2) after the reorder; ${named(rows)}`,
      ).to.equal(true);
      expect(
        view.getSelectedItems(true),
        "the selection stays on alpha",
      ).to.deep.equal([alpha.id]);
    } finally {
      const now = columns().find((c: any) => c.sortDirection);
      if (previous && previous !== now) {
        await view._handleColumnSort(
          columns().indexOf(previous),
          previousDirection,
        );
      }
      if (Boolean(stepColumn()?.hidden) !== wasHidden)
        view.tree._columns.toggleHidden(columns().indexOf(stepColumn()));
      await writeSteps([bravo.key, alpha.key]);
      await idle();
    }
  });

  it("still redraws the views when one item tree's sort throws", async function () {
    await win.ZoteroPane.collectionsView.selectCollection(collection.id);
    await win.ZoteroPane.itemsView.waitForLoad();
    const view = win.ZoteroPane.itemsView;
    const key = plugin().api.stepColumnKey() as string;
    const realSort = view.getSortField;
    const realRun = view.sort;
    view.getSortField = () => key;
    view.sort = () => {
      throw new Error("sort not ready");
    };
    try {
      const before = plugin().api.changesEmitted() as number;
      await writeSteps([alpha.key, bravo.key]);
      await idle();
      expect(
        plugin().api.changesEmitted() as number,
        "views redrawn although sort threw",
      ).to.be.greaterThan(before);
    } finally {
      view.getSortField = realSort;
      view.sort = realRun;
      await writeSteps([bravo.key, alpha.key]);
      await idle();
    }
  });

  it("redraws the column and the views only when a cell or a list changes", async function () {
    const api = plugin().api;
    // An unrelated folder and paper, and a child note of a listed paper.
    const other = new Zotero.Collection();
    other.libraryID = Zotero.Libraries.userLibraryID;
    other.name = "Unrelated folder";
    await other.saveTx();
    const stranger = await makePaper("Unrelated paper", undefined, other.id);
    const child = new Zotero.Item("note");
    child.libraryID = Zotero.Libraries.userLibraryID;
    child.parentID = bravo.id;
    child.setNote("<p>A child note</p>");
    await child.saveTx({ skipSelect: true });
    await idle();
    try {
      const counts = () => ({
        column: api.columnRefreshes() as number,
        views: api.changesEmitted() as number,
      });
      const before = counts();
      child.setNote("<p>A child note, edited</p>");
      await child.saveTx();
      stranger.setField("title", "Unrelated paper, renamed");
      await stranger.saveTx();
      await idle();
      expect(counts(), "after unrelated edits").to.deep.equal(before);

      // A reason changes the list but no cell: the views, not the column.
      await writeSteps([bravo.key, alpha.key], "a reason");
      await idle();
      const afterReason = counts();
      expect(afterReason.column, "column after a reason").to.equal(
        before.column,
      );
      expect(afterReason.views, "views after a reason").to.be.greaterThan(
        before.views,
      );

      // A new order changes the cells: both.
      await writeSteps([alpha.key, bravo.key], "a reason");
      await idle();
      const afterOrder = counts();
      expect(afterOrder.column, "column after a new order").to.be.greaterThan(
        afterReason.column,
      );
      expect(afterOrder.views, "views after a new order").to.be.greaterThan(
        afterReason.views,
      );
    } finally {
      await Zotero.Items.erase([child.id, stranger.id]);
      await other.eraseTx();
      await writeSteps([bravo.key, alpha.key]);
      await idle();
    }
  });

  it("drops a paper from the steps once it leaves the folder", async function () {
    alpha.removeFromCollection(collection.id);
    await alpha.saveTx();
    await idle();
    expect(cells(), "Bravo, alpha, Charlie").to.deep.equal([
      "00001",
      "",
      "00002u",
    ]);
  });
});
