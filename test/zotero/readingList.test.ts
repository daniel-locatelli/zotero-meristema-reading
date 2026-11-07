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
