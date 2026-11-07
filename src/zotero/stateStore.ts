import { applyMark } from "../domain/marks";
import { planMirror } from "../domain/mirrorPlan";
import { pickStateNotes } from "../domain/stateNotes";
import {
  emptyReadState,
  paperId,
  READ_STATE_TAG,
  stateOf,
  writeReadState,
  type ReadState,
  type ReadStateDoc,
} from "../format/readState";
import { Refusal } from "./alerts";
import { emitChange } from "./changes";
import { paperRefOf, taggedNotes } from "./items";
import { enqueue } from "./queue";
import { report } from "./report";

export class UnreadableStateError extends Refusal {}

let doc: ReadStateDoc = emptyReadState();
let keeperID: number | null = null;
let unreadable = false;

function userLibraryID(): number {
  return Zotero.Libraries.userLibraryID;
}

/** Reads the state notes, and writes the merge when a sync left two. */
async function load(): Promise<void> {
  const notes = await taggedNotes(userLibraryID(), READ_STATE_TAG);
  const pick = pickStateNotes(
    notes.map((note) => ({ key: note.key, html: note.getNote() })),
  );
  unreadable = pick.kind === "unreadable";
  if (pick.kind !== "ok") {
    doc = emptyReadState();
    keeperID = null;
    return;
  }
  const byKey = new Map(notes.map((note) => [note.key, note]));
  const keeper = byKey.get(pick.keeper)!;
  doc = pick.doc;
  keeperID = keeper.id;
  if (!pick.trash.length) return;
  keeper.setNote(writeReadState(doc));
  await keeper.saveTx();
  for (const key of pick.trash) {
    const other = byKey.get(key)!;
    other.deleted = true;
    await other.saveTx();
  }
}

async function save(next: ReadStateDoc): Promise<void> {
  const html = writeReadState(next);
  const keeper =
    keeperID === null
      ? null
      : (Zotero.Items.get(keeperID) as Zotero.Item | false);
  if (keeper) {
    keeper.setNote(html);
    await keeper.saveTx();
  } else {
    const note = new Zotero.Item("note");
    note.libraryID = userLibraryID();
    note.setNote(html);
    note.addTag(READ_STATE_TAG);
    // Unselected: the items list selects a new note, and the note editor
    // then rewrites it, dropping the data block's attribute.
    keeperID = (await note.saveTx({ skipSelect: true })) as number;
  }
  doc = next;
}

/** Rewrites the mirror tags on `items`, keeping only regular items of My Library. */
async function mirror(items: Zotero.Item[]): Promise<void> {
  if (unreadable) return;
  const own = items.filter(
    (item) =>
      item.libraryID === userLibraryID() &&
      item.isRegularItem() &&
      !item.deleted,
  );
  const changes = planMirror(
    doc,
    own.map((item) => ({
      id: item.id,
      paperId: paperId(paperRefOf(item)),
      tags: item.getTags().map((tag: { tag: string }) => tag.tag),
    })),
  );
  for (const change of changes) {
    const item = Zotero.Items.get(change.id) as Zotero.Item;
    for (const tag of change.add) item.addTag(tag);
    for (const tag of change.remove) item.removeTag(tag);
    // One paper that cannot be saved must not keep the rest from their tags.
    try {
      await item.saveTx({ skipDateModifiedUpdate: true });
    } catch (error) {
      report(error);
    }
  }
}

async function mirrorAll(): Promise<void> {
  const items = await Zotero.Items.getAll(userLibraryID(), false, false);
  await Zotero.Items.loadDataTypes(items, ["itemData", "tags"]);
  await mirror(items);
}

export function startStateStore(): Promise<void> {
  return enqueue(async () => {
    await load();
    await mirrorAll();
    emitChange();
  });
}

export function resetStateStore(): void {
  doc = emptyReadState();
  keeperID = null;
  unreadable = false;
}

/**
 * Marks papers Unread, Reading or Read. The notes are read again first, so a
 * change a sync brought in since the last event is merged, not overwritten.
 */
export function markItems(
  items: Zotero.Item[],
  state: ReadState,
): Promise<void> {
  return enqueue(async () => {
    await load();
    if (unreadable) {
      throw new UnreadableStateError(
        "Your reading-state note cannot be read, so nothing was marked. Fix it or move it to the trash, then mark again.",
      );
    }
    const ids = items.map((item) => paperId(paperRefOf(item)));
    const next = applyMark(doc, ids, state, new Date().toISOString());
    if (next === doc) {
      emitChange();
      return;
    }
    await save(next);
    await mirrorAll();
    emitChange();
  });
}

/** A paper's read state, as the last read of the state note had it. */
export function stateOfItem(item: Zotero.Item): ReadState {
  return stateOf(doc, paperId(paperRefOf(item)));
}

/** A note changed: it may be, or have been, a state note. */
export function stateChanged(): Promise<void> {
  return enqueue(async () => {
    const before = unreadable ? null : writeReadState(doc);
    await load();
    const after = unreadable ? null : writeReadState(doc);
    if (after !== null && after !== before) await mirrorAll();
    emitChange();
  });
}

/** Regular items changed (added, retagged, their DOI edited): mirror them again. */
export function itemsChanged(ids: number[]): Promise<void> {
  return enqueue(async () => {
    const items = (await Zotero.Items.getAsync(ids)).filter(Boolean);
    await mirror(items);
  });
}
