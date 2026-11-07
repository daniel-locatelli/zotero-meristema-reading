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
});
