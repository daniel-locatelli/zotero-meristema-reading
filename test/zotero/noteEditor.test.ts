/// <reference types="mocha" />
import { expect } from "chai";
import {
  parseReadState,
  setState,
  writeReadState,
  type ReadStateDoc,
} from "../../src/format/readState";
import {
  delay,
  eraseStateNotes,
  idle,
  makePaper,
  markThroughMenu,
  stateNotes,
  waitFor,
} from "./helpers";

function stateIn(note: Zotero.Item): ReadStateDoc {
  const parsed = parseReadState(note.getNote());
  expect(parsed.ok, `the state note parses: ${note.getNote()}`).to.equal(true);
  return (parsed as { ok: true; value: ReadStateDoc }).value;
}

/** What the item pane's note editor holds, for assertion messages. */
function editorEvidence(editor: any): string {
  return JSON.stringify({
    item: editor?.item?.id,
    mode: editor?.mode,
    width: editor?.getBoundingClientRect().width,
    instance: !!editor?.getCurrentInstance(),
  });
}

describe("Note editor round trip", function () {
  this.timeout(60_000);
  let win: any;
  let paper: Zotero.Item;
  let plain: Zotero.Item;

  before(async function () {
    win = Zotero.getMainWindows()[0];
    await eraseStateNotes();
    await idle();
    paper = await makePaper("Note editor fixture");
    plain = new Zotero.Item("note");
    plain.libraryID = Zotero.Libraries.userLibraryID;
    plain.setNote("<p>An ordinary note</p>");
    await plain.saveTx({ skipSelect: true });
    await idle();
  });

  after(async function () {
    await win.ZoteroPane.collectionsView.selectLibrary(
      Zotero.Libraries.userLibraryID,
    );
    await Zotero.Items.erase([paper.id, plain.id]);
    await eraseStateNotes();
    await idle();
  });

  it("reads a state note the note editor has saved, and writes its attribute back once the editor lets go", async function () {
    const id = `user:${paper.key}`;
    await markThroughMenu(win, [paper.id], "read");
    const notes = await stateNotes();
    expect(notes, "state notes in My Library").to.have.length(1);
    const note = notes[0];

    // Open the note in the item pane's editor and wait until it is loaded.
    await win.ZoteroPane.collectionsView.selectLibrary(
      Zotero.Libraries.userLibraryID,
    );
    await win.ZoteroPane.selectItem(note.id);
    const editor = win.document.getElementById("zotero-note-editor");
    const instance = await waitFor(
      () => editor?.item?.id === note.id && editor.getCurrentInstance(),
      20_000,
    );
    expect(
      instance,
      `the note editor opened the note: ${editorEvidence(editor)}`,
    ).to.be.ok;
    await instance._initPromise;

    // Opening alone saves nothing (Zotero 10.0.8 saves only a changed
    // document). A write to the open note from elsewhere, as a sync from
    // another device makes, is replayed into the editor, which saves it back
    // in its own HTML.
    note.setNote(
      writeReadState(
        setState(stateIn(note), id, "read", new Date().toISOString()),
      ),
    );
    await note.saveTx();
    const saved = await waitFor(
      () => note.getNote().includes("data-schema-version"),
      20_000,
    );
    expect(
      saved,
      `the note editor saved the note within 20 s: ${note.getNote()}; ${editorEvidence(editor)}`,
    ).to.equal(true);
    await win.ZoteroPane.selectItem(paper.id);
    await idle();

    const html = note.getNote();
    expect(
      html.includes("data-meristema-reading-state"),
      `the editor dropped the attribute: ${html}`,
    ).to.equal(false);
    expect(
      stateIn(note).states[id]?.state,
      `Read after the editor: ${html}`,
    ).to.equal("read");

    // Selecting the paper does not release the item pane's editor: it keeps
    // the note, replays the plugin's next write and saves it back in its own
    // HTML, so the note must still read through the fallback.
    await markThroughMenu(win, [paper.id], "reading");
    expect(
      (await stateNotes()).map((item) => item.key),
      "state notes after the next mark",
    ).to.deep.equal([note.key]);
    expect(
      stateIn(note).states[id]?.state,
      `Reading after the mark; editor ${editorEvidence(editor)}: ${note.getNote()}`,
    ).to.equal("reading");

    // Opening another note releases it; the next write keeps its attribute.
    // The item list restores a selection it cached when a notifier event
    // began, so a save landing around the select (the editor writing the
    // state note back) can put the state note back: wait for the list to
    // settle, select, and select again if the selection did not hold.
    await win.ZoteroPane.collectionsView.selectLibrary(
      Zotero.Libraries.userLibraryID,
    );
    const attempts: string[] = [];
    let released: any = null;
    for (let attempt = 1; attempt <= 5 && !released; attempt++) {
      await win.ZoteroPane.itemsView.waitForLoad();
      await idle();
      const picked = await win.ZoteroPane.selectItem(plain.id);
      released = await waitFor(
        () =>
          editor?.item?.id === plain.id &&
          win.ZoteroPane.getSelectedItems()
            .map((item: Zotero.Item) => item.id)
            .join() === String(plain.id) &&
          editor.getCurrentInstance(),
        5_000,
      );
      // It must hold, not only flash: a late restore would reopen the state note.
      if (released) {
        await delay(500);
        await idle();
        if (editor?.item?.id !== plain.id) released = null;
      }
      attempts.push(
        JSON.stringify({
          attempt,
          picked,
          editor: editorEvidence(editor),
          selected: win.ZoteroPane.getSelectedItems().map(
            (item: Zotero.Item) => item.id,
          ),
          tab: win.Zotero_Tabs.selectedID,
          paneMode: win.ZoteroPane.itemPane?.mode,
        }),
      );
    }
    expect(
      released,
      `the editor opened the other note (plain ${plain.id}, state note ${note.id}, paper ${paper.id}): ${attempts.join("; ")}`,
    ).to.be.ok;
    // The runner prints what the test window's `debug` sends it.
    const debug = (globalThis as any).debug;
    if (typeof debug === "function") {
      debug(
        `Note editor round trip: the other note held after ${attempts.length} select attempt(s)`,
      );
    }
    await released._initPromise;
    await markThroughMenu(win, [paper.id], "read");
    expect(
      (await stateNotes()).map((item) => item.key),
      "state notes after the last mark",
    ).to.deep.equal([note.key]);
    expect(
      stateIn(note).states[id]?.state,
      `Read after the last mark: ${note.getNote()}`,
    ).to.equal("read");
    expect(
      note.getNote(),
      `the attribute written back; editor ${editorEvidence(editor)}`,
    ).to.contain('data-meristema-reading-state="1"');
  });
});
