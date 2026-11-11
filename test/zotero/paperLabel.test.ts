/// <reference types="mocha" />
import { expect } from "chai";
import { config } from "../../package.json";
import { writeReadingList } from "../../src/format/readingList";
import { eraseStateNotes, idle, makeListNote, waitFor } from "./helpers";

const TOPIC = "Paper label fixture";
const PAPER_LABEL = `${config.prefsPrefix}.paperLabel`;

describe("The paper label setting", function () {
  this.timeout(60_000);
  let win: any;
  let collection: any;
  let paper: Zotero.Item;
  let note: Zotero.Item;

  const view = () =>
    win.document.querySelector(".mr-list.mr-sidebar") as HTMLElement | null;
  const label = (): string =>
    view()?.querySelector(`[data-key="${paper.key}"] .mr-title`)?.textContent ??
    "";
  async function untilLabel(wanted: string): Promise<void> {
    const ok = await waitFor(() => label() === wanted, 10_000);
    expect(
      ok,
      `the section labels the paper "${wanted}"; it shows "${label()}", pref ${String(Zotero.Prefs.get(PAPER_LABEL, true))}`,
    ).to.equal(true);
  }

  before(async function () {
    win = Zotero.getMainWindows()[0];
    await eraseStateNotes();
    collection = new Zotero.Collection();
    collection.libraryID = Zotero.Libraries.userLibraryID;
    collection.name = TOPIC;
    await collection.saveTx();
    paper = new Zotero.Item("journalArticle");
    paper.libraryID = Zotero.Libraries.userLibraryID;
    paper.setField("title", "Notes on the engine");
    paper.setField("date", "1843");
    paper.setCreators([
      { firstName: "Ada", lastName: "Lovelace", creatorType: "author" },
    ]);
    paper.setCollections([collection.id]);
    await paper.saveTx({ skipSelect: true });
    note = await makeListNote(
      collection.id,
      writeReadingList(
        { version: 1, topic: TOPIC, steps: [{ key: paper.key, why: "" }] },
        (key) => key,
        { kind: "user" },
      ),
    );
    await idle();
  });

  after(async function () {
    Zotero.Prefs.clear(PAPER_LABEL, true);
    await win.ZoteroPane.collectionsView.selectLibrary(
      Zotero.Libraries.userLibraryID,
    );
    await Zotero.Items.erase([note.id, paper.id]);
    await collection.eraseTx();
    await eraseStateNotes();
    await idle();
  });

  it("adds Meristema Reading's settings pane", function () {
    const panes = (Zotero.PreferencePanes as any).pluginPanes as Array<{
      id: string;
    }>;
    const pane = panes.find(
      (entry) => entry.id === `${config.addonRef}-preferences`,
    );
    const shown = JSON.stringify(pane ?? panes.map((entry) => entry.id));
    expect(shown, "the pane is registered with its label").to.include(
      "Meristema Reading",
    );
  });

  it("redraws the section in the chosen style", async function () {
    try {
      await win.ZoteroPane.collectionsView.selectCollection(collection.id);
      await win.ZoteroPane.selectItem(paper.id);
      await untilLabel("Lovelace, 1843, Notes on the engine");
      Zotero.Prefs.set(PAPER_LABEL, "title", true);
      await untilLabel("Notes on the engine");
      Zotero.Prefs.set(PAPER_LABEL, "author-year", true);
      await untilLabel("Lovelace, 1843");
      Zotero.Prefs.clear(PAPER_LABEL, true);
      await untilLabel("Lovelace, 1843, Notes on the engine");
    } finally {
      Zotero.Prefs.clear(PAPER_LABEL, true);
    }
  });
});
