/// <reference types="mocha" />
import { expect } from "chai";
import { writeReadingList } from "../../src/format/readingList";
import {
  idle,
  makeListNote,
  makePaper,
  openSecondWindow,
  plugin,
  waitFor,
} from "./helpers";

/**
 * Two windows, each showing a different collection with its own list. Zotero
 * hands the Step column only the item, never its window, so each window must
 * still number and sort its papers by its own collection's list.
 */
describe("The Step column in two windows", function () {
  this.timeout(60_000);
  let one: any;
  let two: any;
  let a: any;
  let b: any;
  let x: Zotero.Item;
  let y: Zotero.Item;
  let z: Zotero.Item;
  let noteA: Zotero.Item;
  let noteB: Zotero.Item;
  const restore: (() => Promise<void> | void)[] = [];

  const listHTML = (topic: string, keys: string[]) =>
    writeReadingList(
      { version: 1, topic, steps: keys.map((key) => ({ key, why: "" })) },
      (key) => key,
      { kind: "user" },
    );
  const columns = (win: any) =>
    win.ZoteroPane.itemsView.tree._columns._columns as any[];
  const stepColumn = (win: any) =>
    columns(win).find(
      (column) => column.dataKey === plugin().api.stepColumnKey(),
    );
  /** The Step cell `win`'s item list draws for `item`. */
  function drawn(win: any, item: Zotero.Item): string | null {
    const view = win.ZoteroPane.itemsView;
    const index = view.getRowIndexByID(item.id);
    if (index === false || index === undefined) return null;
    const row = view.tree?._jsWindow?.getElementByIndex(index) as
      HTMLElement | undefined;
    const cell = row
      ? Array.from(row.children).find((node) =>
          (node as Element).classList.contains(plugin().api.stepColumnKey()),
        )
      : undefined;
    return cell ? (cell.textContent ?? "") : null;
  }
  function rows(win: any): string[] {
    const view = win.ZoteroPane.itemsView;
    const out: string[] = [];
    for (let i = 0; i < view.rowCount; i++) out.push(view.getRow(i).ref.key);
    // The papers only: the list note is a row too.
    return out.filter((key) => [x.key, y.key, z.key].includes(key));
  }
  const name = (keys: string[]) =>
    keys.map((key) => ({ [x.key]: "X", [y.key]: "Y", [z.key]: "Z" })[key]);

  async function show(win: any, collection: any): Promise<void> {
    await win.ZoteroPane.collectionsView.selectCollection(collection.id);
    await win.ZoteroPane.itemsView.waitForLoad();
    const column = stepColumn(win);
    expect(column, "the Step column in the item list").to.exist;
    if (column.hidden) {
      const toggle = () =>
        win.ZoteroPane.itemsView.tree._columns.toggleHidden(
          columns(win).indexOf(stepColumn(win)),
        );
      toggle();
      restore.push(() => {
        if (!win.closed && !stepColumn(win)?.hidden) toggle();
      });
    }
  }

  before(async function () {
    one = Zotero.getMainWindows()[0];
    a = new Zotero.Collection();
    a.libraryID = Zotero.Libraries.userLibraryID;
    a.name = "Step window A";
    await a.saveTx();
    b = new Zotero.Collection();
    b.libraryID = Zotero.Libraries.userLibraryID;
    b.name = "Step window B";
    await b.saveTx();
    x = await makePaper("Paper X", undefined, a.id);
    x.setCollections([a.id, b.id]);
    await x.saveTx({ skipSelect: true });
    y = await makePaper("Paper Y", undefined, a.id);
    y.setCollections([a.id, b.id]);
    await y.saveTx({ skipSelect: true });
    z = await makePaper("Paper Z", undefined, b.id);
    noteA = await makeListNote(a.id, listHTML(a.name, [y.key, x.key]));
    noteB = await makeListNote(b.id, listHTML(b.name, [x.key, y.key, z.key]));
    two = await openSecondWindow();
    await show(one, a);
    await show(two, b);
  });

  after(async function () {
    for (const undo of restore.reverse()) await undo();
    if (two && !two.closed) two.close();
    await one.ZoteroPane.collectionsView.selectLibrary(
      Zotero.Libraries.userLibraryID,
    );
    await Zotero.Items.erase([noteA.id, noteB.id, x.id, y.id, z.id]);
    await a.eraseTx();
    await b.eraseTx();
    await idle();
  });

  it("numbers each window's papers by the collection it shows", async function () {
    const cells = () => ({
      one: [drawn(one, y), drawn(one, x)],
      two: [drawn(two, x), drawn(two, y), drawn(two, z)],
    });
    const right = await waitFor(
      () =>
        JSON.stringify(cells()) ===
        JSON.stringify({ one: ["1", "2"], two: ["1", "2", "3"] }),
      10_000,
    );
    expect(
      right,
      `Y 1, X 2 in the first window; X 1, Y 2, Z 3 in the second; drawn ${JSON.stringify(cells())}`,
    ).to.equal(true);
  });

  it("sorts each window by its own collection's list after a change", async function () {
    for (const win of [one, two]) {
      const view = win.ZoteroPane.itemsView;
      const previous = columns(win).find((column) => column.sortDirection);
      const direction = previous?.sortDirection;
      await view._handleColumnSort(columns(win).indexOf(stepColumn(win)), 1);
      await view.waitForLoad();
      restore.push(async () => {
        // Sorting again by the column it is sorted by never settles. A sort
        // builds the columns anew, so they are told apart by their key.
        const now = columns(win).find((column) => column.sortDirection);
        if (win.closed || !previous || previous.dataKey === now?.dataKey) {
          return;
        }
        await view._handleColumnSort(columns(win).indexOf(previous), direction);
      });
    }
    // Every paper has a number in both windows, and the two orders disagree.
    noteB.setNote(listHTML(b.name, [x.key, z.key, y.key]));
    await noteB.saveTx({ skipSelect: true });
    await idle();
    const sorted = await waitFor(
      () =>
        rows(one).join() === [y.key, x.key].join() &&
        rows(two).join() === [x.key, z.key, y.key].join(),
      10_000,
    );
    expect(
      sorted,
      `Y, X in the first window and X, Z, Y in the second; they show ${name(rows(one))} and ${name(rows(two))}`,
    ).to.equal(true);
  });
});
