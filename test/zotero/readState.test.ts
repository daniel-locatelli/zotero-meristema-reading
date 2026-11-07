/// <reference types="mocha" />
import { expect } from "chai";
import {
  emptyReadState,
  parseReadState,
  READ_STATE_TAG,
  setState,
  writeReadState,
  type ReadStateDoc,
} from "../../src/format/readState";
import {
  eraseStateNotes,
  idle,
  makePaper,
  markThroughMenu,
  plugin,
  stateNotes,
} from "./helpers";

function stateIn(note: Zotero.Item): ReadStateDoc {
  const parsed = parseReadState(note.getNote());
  expect(parsed.ok, `the state note parses: ${note.getNote()}`).to.equal(true);
  return (parsed as { ok: true; value: ReadStateDoc }).value;
}

async function stateNote(html: string): Promise<Zotero.Item> {
  const note = new Zotero.Item("note");
  note.libraryID = Zotero.Libraries.userLibraryID;
  note.setNote(html);
  note.addTag(READ_STATE_TAG);
  await note.saveTx();
  return note;
}

// The cases share the two papers and run in order: "un-marks" undoes the
// first case's marks, and "overwrites" relies on the merge case's Reading.
describe("Read state", function () {
  this.timeout(60_000);
  const DOI_ID = "doi:10.5555/meristema-reading.1";
  let win: any;
  let withDOI: Zotero.Item;
  let withoutDOI: Zotero.Item;

  before(async function () {
    win = Zotero.getMainWindows()[0];
    await eraseStateNotes();
    await idle();
    withDOI = await makePaper(
      "Read state fixture with a DOI",
      "10.5555/Meristema-Reading.1",
    );
    withoutDOI = await makePaper("Read state fixture without a DOI");
    await idle();
  });

  after(async function () {
    await win.ZoteroPane.collectionsView.selectLibrary(
      Zotero.Libraries.userLibraryID,
    );
    await Zotero.Items.erase([withDOI.id, withoutDOI.id]);
    await eraseStateNotes();
    await idle();
  });

  it("marks a selection Read in one state note and mirrors it onto tags", async function () {
    await markThroughMenu(win, [withDOI.id, withoutDOI.id], "read");
    const notes = await stateNotes();
    expect(notes, "state notes in My Library").to.have.length(1);
    expect(notes[0].getCollections(), "the state note's folders").to.deep.equal(
      [],
    );
    const { states } = stateIn(notes[0]);
    expect(Object.keys(states).sort()).to.deep.equal(
      [DOI_ID, `user:${withoutDOI.key}`].sort(),
    );
    expect(Object.values(states).map((entry) => entry.state)).to.deep.equal([
      "read",
      "read",
    ]);
    expect(withDOI.hasTag("_read"), "the DOI paper's mirror tag").to.equal(
      true,
    );
    expect(withoutDOI.hasTag("_read"), "the keyed paper's mirror tag").to.equal(
      true,
    );
  });

  it("un-marks to Unread tombstones and takes the tags off", async function () {
    await markThroughMenu(win, [withDOI.id, withoutDOI.id], "unread");
    const notes = await stateNotes();
    expect(notes, "state notes in My Library").to.have.length(1);
    const { states } = stateIn(notes[0]);
    expect(Object.values(states).map((entry) => entry.state)).to.deep.equal([
      "unread",
      "unread",
    ]);
    expect(
      withDOI.hasTag("_read") || withoutDOI.hasTag("_read"),
      "a _read tag left behind",
    ).to.equal(false);
  });

  it("merges two state notes into the one with the smaller key and trashes the other", async function () {
    await eraseStateNotes();
    await idle();
    const keyed = `user:${withoutDOI.key}`;
    const first = await stateNote(
      writeReadState(
        setState(emptyReadState(), keyed, "read", "2026-01-01T00:00:00Z"),
      ),
    );
    const second = await stateNote(
      writeReadState(
        setState(
          setState(emptyReadState(), keyed, "reading", "2026-02-01T00:00:00Z"),
          DOI_ID,
          "read",
          "2026-01-15T00:00:00Z",
        ),
      ),
    );
    await idle();
    const [keeper, other] =
      first.key < second.key ? [first, second] : [second, first];
    const notes = await stateNotes();
    expect(
      notes.map((note) => note.key),
      "untrashed state notes",
    ).to.deep.equal([keeper.key]);
    expect(other.deleted, "the other note is in the trash").to.equal(true);
    expect(stateIn(keeper).states).to.deep.equal({
      [keyed]: { state: "reading", at: "2026-02-01T00:00:00Z" },
      [DOI_ID]: { state: "read", at: "2026-01-15T00:00:00Z" },
    });
    expect(
      withoutDOI.hasTag("_reading"),
      "the merged Reading mirrored",
    ).to.equal(true);
    expect(withDOI.hasTag("_read"), "the merged Read mirrored").to.equal(true);
  });

  it("overwrites a mirror tag added or removed by hand", async function () {
    withoutDOI.removeTag("_reading");
    withoutDOI.addTag("_read");
    await withoutDOI.saveTx();
    await idle();
    expect(withoutDOI.hasTag("_reading"), "_reading put back").to.equal(true);
    expect(withoutDOI.hasTag("_read"), "_read taken off").to.equal(false);
  });

  it("keeps a reader's own tags and tags every paper sharing a DOI", async function () {
    const doi = "10.5555/meristema-reading.shared";
    const tagged = new Zotero.Item("journalArticle");
    tagged.libraryID = Zotero.Libraries.userLibraryID;
    tagged.setField("title", "Shared DOI, tagged copy");
    tagged.setField("DOI", doi);
    tagged.addTag("my-topic");
    await tagged.saveTx({ skipSelect: true });
    const copy = await makePaper("Shared DOI, plain copy", doi.toUpperCase());
    await idle();
    try {
      await markThroughMenu(win, [copy.id], "read");
      const tags = (item: Zotero.Item) =>
        item
          .getTags()
          .map((tag: { tag: string }) => tag.tag)
          .sort();
      expect(
        { tagged: tags(tagged), copy: tags(copy) },
        "both copies Read, the reader's tag kept",
      ).to.deep.equal({ tagged: ["_read", "my-topic"], copy: ["_read"] });
      await markThroughMenu(win, [tagged.id], "unread");
      expect(
        { tagged: tags(tagged), copy: tags(copy) },
        "both copies Unread, the reader's tag kept",
      ).to.deep.equal({ tagged: ["my-topic"], copy: [] });
    } finally {
      await win.ZoteroPane.collectionsView.selectLibrary(
        Zotero.Libraries.userLibraryID,
      );
      await Zotero.Items.erase([tagged.id, copy.id]);
      await idle();
    }
  });

  it("mirrors once a sync finishes, not paper by paper during it", async function () {
    const api = plugin().api;
    let arrived: Zotero.Item | null = null;
    let unmarked: Zotero.Item | null = null;
    api.simulateSync(true);
    try {
      // The sync removes the state note: the papers keep their tags for now.
      await eraseStateNotes();
      await idle();
      expect(
        withDOI.hasTag("_read"),
        "no mirror while the sync runs, after the state note went",
      ).to.equal(true);
      // A paper the sync brings with its mirror tag, before the state note.
      arrived = new Zotero.Item("journalArticle");
      arrived.libraryID = Zotero.Libraries.userLibraryID;
      arrived.setField("title", "Synced paper, already Read");
      arrived.addTag("_read");
      await arrived.saveTx({ skipSelect: true });
      unmarked = await makePaper("Synced paper, Read on the server");
      await idle();
      expect(
        arrived.hasTag("_read"),
        "the synced tag survives the paper's arrival",
      ).to.equal(true);
      let doc = emptyReadState();
      for (const item of [arrived, unmarked]) {
        doc = setState(doc, `user:${item.key}`, "read", "2026-03-01T00:00:00Z");
      }
      await stateNote(writeReadState(doc));
      await idle();
      expect(
        unmarked.hasTag("_read"),
        "no mirror while the sync runs",
      ).to.equal(false);
      api.simulateSync(false);
      await Zotero.Notifier.trigger("finish", "sync", []);
      await idle();
      expect(
        {
          arrived: arrived.hasTag("_read"),
          unmarked: unmarked.hasTag("_read"),
          withDOI: withDOI.hasTag("_read"),
          withoutDOI: withoutDOI.hasTag("_reading"),
        },
        "one full mirror once the sync finished",
      ).to.deep.equal({
        arrived: true,
        unmarked: true,
        withDOI: false,
        withoutDOI: false,
      });
    } finally {
      api.simulateSync(null);
      const ids = [arrived, unmarked]
        .filter((item): item is Zotero.Item => Boolean(item?.id))
        .map((item) => item.id);
      if (ids.length) await Zotero.Items.erase(ids);
      await idle();
    }
  });
});
