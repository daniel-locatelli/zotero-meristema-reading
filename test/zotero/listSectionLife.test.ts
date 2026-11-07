/// <reference types="mocha" />
import { expect } from "chai";
import { config } from "../../package.json";
import { READING_LIST_TAG } from "../../src/format/readingList";
import {
  collectionMenuEntry,
  command,
  idle,
  makePaper,
  rowKeys,
  waitFor,
  withAlerts,
} from "./helpers";

const MAKE = `${config.addonRef}-make-reading-list`;
const TOPIC = "Section life fixture";

describe("The Reading list section follows the stores", function () {
  this.timeout(60_000);
  let win: any;
  let collection: any;
  let p: Zotero.Item;
  let q: Zotero.Item;

  /** The library item pane's Reading list section, if Zotero has made it. */
  const section = (): any =>
    win.document
      .getElementById("zotero-item-pane")
      ?.querySelector('item-pane-custom-section[data-pane$="reading-list"]') ??
    null;
  const shownSteps = (): string[] => {
    const elem = section();
    if (!elem || elem.hidden) return [];
    return rowKeys(elem.querySelector(".mr-list.mr-sidebar"), ".mr-step");
  };
  const evidence = (): string =>
    JSON.stringify({
      section: Boolean(section()),
      hidden: section()?.hidden,
      steps: rowKeys(section()?.querySelector(".mr-list"), ".mr-step"),
      text: section()?.querySelector(".mr-list")?.textContent?.slice(0, 160),
      paneItem: win.document.querySelector("#zotero-item-pane item-details")
        ?.item?.id,
      selected: win.ZoteroPane.getSelectedItems().map(
        (item: Zotero.Item) => item.id,
      ),
      folder: win.ZoteroPane.getSelectedCollection(true),
      p: p.id,
      q: q.id,
    });
  const listNotes = (): Zotero.Item[] =>
    (collection.getChildItems(false, true) as Zotero.Item[]).filter(
      (item) => item.isNote() && item.hasTag(READING_LIST_TAG),
    );

  before(async function () {
    win = Zotero.getMainWindows()[0];
    win.Zotero_Tabs.select("zotero-pane");
    collection = new Zotero.Collection();
    collection.libraryID = Zotero.Libraries.userLibraryID;
    collection.name = TOPIC;
    await collection.saveTx();
    p = await makePaper("Paper P", undefined, collection.id);
    q = await makePaper("Paper Q", undefined, collection.id);
    await idle();
  });

  after(async function () {
    win.Zotero_Tabs.select("zotero-pane");
    await win.ZoteroPane.collectionsView.selectLibrary(
      Zotero.Libraries.userLibraryID,
    );
    await Zotero.Items.erase([
      ...listNotes().map((note) => note.id),
      p.id,
      q.id,
    ]);
    await collection.eraseTx();
    await idle();
  });

  it("appears once a list is made for the selected paper's folder, and goes with the list", async function () {
    await win.ZoteroPane.collectionsView.selectCollection(collection.id);
    await win.ZoteroPane.selectItem(p.id);
    // The item pane has drawn p, so its sections exist and know the item.
    const drawn = await waitFor(
      () =>
        win.document.querySelector("#zotero-item-pane item-details")?.item
          ?.id === p.id && section(),
      10_000,
    );
    expect(drawn, `the item pane shows p: ${evidence()}`).to.be.ok;
    expect(
      section().hidden,
      `no list yet, so no section: ${evidence()}`,
    ).to.equal(true);

    const { popup, entry } = await collectionMenuEntry(
      win,
      collection.id,
      MAKE,
    );
    const offered = Boolean(entry) && !entry.hidden;
    if (!offered) popup.hidePopup();
    expect(offered, "Make Reading List offered").to.equal(true);
    const reached = command(entry);
    popup.hidePopup();
    await reached;
    await idle();

    const appeared = await waitFor(
      () => shownSteps().sort().join() === [p.key, q.key].sort().join(),
      10_000,
    );
    expect(
      appeared,
      `the section shows the new list's steps with p still selected: ${evidence()}`,
    ).to.equal(true);
    expect(
      win.ZoteroPane.getSelectedItems().map((item: Zotero.Item) => item.id),
      "p stays selected",
    ).to.deep.equal([p.id]);

    // A reason field from the view, kept for the next step.
    const why = section().querySelector(
      `.mr-step[data-key="${p.key}"] .mr-why`,
    ) as HTMLTextAreaElement;
    expect(why, "p's reason field").to.exist;

    const [note] = listNotes();
    note.deleted = true;
    await note.saveTx();
    await idle();
    const gone = await waitFor(() => !section() || section().hidden, 10_000);
    expect(gone, `the section goes with the list: ${evidence()}`).to.equal(
      true,
    );

    // An edit from a view drawn before the list went says so plainly.
    await withAlerts(async (alerts) => {
      why.value = "too late";
      why.dispatchEvent(new win.Event("change", { bubbles: true }));
      await idle();
      expect(
        alerts.map((alert) => alert.text),
        "the alert for a list that is gone",
      ).to.deep.equal(["This folder's reading list is gone."]);
    });
    expect(note.getNote(), "the trashed note is left alone").not.to.contain(
      "too late",
    );
  });
});
