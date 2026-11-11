import { applyMark } from "../domain/marks";
import { planMirror } from "../domain/mirrorPlan";
import { pickStateNotes } from "../domain/stateNotes";
import {
  emptyReadState,
  mergeReadStates,
  paperId,
  parseReadState,
  READ_STATE_TAG,
  stateOf,
  writeReadState,
  type ReadState,
  type ReadStateDoc,
} from "../format/readState";
import { READING_LIST_TAG } from "../format/readingList";
import { Refusal } from "./alerts";
import { emitChange } from "./changes";
import { paperRefOf, taggedNotes } from "./items";
import { enqueue } from "./queue";
import { report } from "./report";

export class UnreadableStateError extends Refusal {}

const UNREADABLE_MESSAGE =
  "Your reading-state note cannot be read, so nothing was marked. Fix it or move it to the trash, then mark again.";

let doc: ReadStateDoc = emptyReadState();
let keeperID: number | null = null;
let unreadable = false;
/** A full mirror put off while a sync ran. */
let mirrorOwed = false;
/** The Zotero suite's stand-in for a sync running; null for the real one. */
let syncOverride: boolean | null = null;
/**
 * The papers in a reading list when the last full mirror ran, kept up as
 * papers join and leave lists; null until a full mirror has run.
 */
let lastListed: Set<number> | null = null;
/** How many times every paper of My Library was mirrored, for the Zotero suite. */
let fullMirrors = 0;

/**
 * Whether a sync is bringing items in. During one, a paper can arrive before
 * the state note that holds its read state, so mirroring it from the state in
 * memory would strip its tags and upload that.
 */
function syncing(): boolean {
  return syncOverride ?? Boolean((Zotero as any).Sync?.Runner?.syncInProgress);
}

/** For the Zotero suite, which cannot start a real sync. */
export function simulateSync(inProgress: boolean | null): void {
  syncOverride = inProgress;
}

/** What the views draw of the read state, to tell whether it changed. */
function stateKey(): string {
  return unreadable ? "unreadable" : writeReadState(doc);
}

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
  const keeper =
    keeperID === null
      ? null
      : (Zotero.Items.get(keeperID) as Zotero.Item | false);
  if (keeper) {
    // A sync may have rewritten the note since it was read: merge into it.
    const current = parseReadState(keeper.getNote());
    if (!current.ok) throw new UnreadableStateError(UNREADABLE_MESSAGE);
    next = mergeReadStates(current.value, next);
    keeper.setNote(writeReadState(next));
    await keeper.saveTx();
  } else {
    const note = new Zotero.Item("note");
    note.libraryID = userLibraryID();
    note.setNote(writeReadState(next));
    note.addTag(READ_STATE_TAG);
    // Unselected: the items list selects a new note, and the note editor
    // then rewrites it, dropping the data block's attribute.
    keeperID = (await note.saveTx({ skipSelect: true })) as number;
  }
  doc = next;
}

/** The regular items of every My Library folder that holds a list note. */
async function listedItemIDs(): Promise<Set<number>> {
  const ids = new Set<number>();
  const notes = await taggedNotes(userLibraryID(), READING_LIST_TAG);
  const folders = new Set(notes.flatMap((note) => note.getCollections()));
  for (const folderID of folders) {
    const folder = Zotero.Collections.get(folderID);
    if (!folder || folder.deleted) continue;
    const children: Zotero.Item[] = folder.getChildItems(false, false);
    for (const item of children) if (item.isRegularItem()) ids.add(item.id);
  }
  return ids;
}

/** Rewrites the mirror tags on `items`, keeping only regular items of My Library. */
async function mirror(
  items: Zotero.Item[],
  known?: Set<number>,
): Promise<void> {
  if (unreadable) return;
  const listed = known ?? (await listedItemIDs());
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
      listed: listed.has(item.id),
    })),
  );
  for (const change of changes) {
    const item = Zotero.Items.get(change.id) as Zotero.Item;
    for (const tag of change.add) item.addTag(tag);
    for (const tag of change.remove) item.removeTag(tag);
    // One paper that cannot be saved must not keep the rest from their tags.
    try {
      await item.saveTx({
        skipDateModifiedUpdate: true,
        // Meristema skips modifies so marked: a mirror tag is not a reader's edit.
        notifierData: { meristemaReadingMirror: true },
      });
    } catch (error) {
      report(error);
    }
  }
}

async function mirrorAll(): Promise<void> {
  if (unreadable) return;
  fullMirrors++;
  const items = await Zotero.Items.getAll(userLibraryID(), false, false);
  await Zotero.Items.loadDataTypes(items, ["itemData", "tags"]);
  const listed = await listedItemIDs();
  await mirror(items, listed);
  lastListed = listed;
}

/** How many full mirrors have run, for the Zotero suite. */
export function fullMirrorCount(): number {
  return fullMirrors;
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
  mirrorOwed = false;
  syncOverride = null;
  lastListed = null;
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
    const before = stateKey();
    await load();
    if (unreadable) {
      if (stateKey() !== before) emitChange();
      throw new UnreadableStateError(UNREADABLE_MESSAGE);
    }
    const ids = items.map((item) => paperId(paperRefOf(item)));
    const next = applyMark(doc, ids, state, new Date().toISOString());
    if (next === doc) {
      if (stateKey() !== before) emitChange();
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
    const before = stateKey();
    await load();
    const changed = stateKey() !== before;
    if (changed || mirrorOwed) await mirrorAllUnlessSyncing();
    if (changed) emitChange();
  });
}

/** Mirrors every paper, or, while a sync runs, owes it to the sync's end. */
async function mirrorAllUnlessSyncing(): Promise<void> {
  if (syncing()) {
    mirrorOwed = true;
    return;
  }
  mirrorOwed = false;
  await mirrorAll();
}

/** Regular items changed (added, retagged, their DOI edited): mirror them again. */
export function itemsChanged(ids: number[]): Promise<void> {
  return enqueue(async () => {
    if (syncing() || mirrorOwed) {
      await mirrorAllUnlessSyncing();
      return;
    }
    const items = (await Zotero.Items.getAsync(ids)).filter(Boolean);
    await mirror(items);
  });
}

/**
 * A folder's papers or its list note changed: who is listed may have too.
 * Only the papers that joined or left a list are mirrored again; a reason
 * saved or a step moved changes neither, and mirrors nothing.
 */
export function listsChanged(): Promise<void> {
  return enqueue(async () => {
    const before = lastListed;
    if (syncing() || mirrorOwed || before === null) {
      await mirrorAllUnlessSyncing();
      return;
    }
    if (unreadable) return;
    const listed = await listedItemIDs();
    const moved = [
      ...[...listed].filter((id) => !before.has(id)),
      ...[...before].filter((id) => !listed.has(id)),
    ];
    lastListed = listed;
    if (!moved.length) return;
    const items = (await Zotero.Items.getAsync(moved)).filter(Boolean);
    await mirror(items, listed);
  });
}

/** A sync ended: read the notes it brought, and run the mirror it put off. */
export function syncFinished(): Promise<void> {
  return enqueue(async () => {
    if (!mirrorOwed) return;
    const before = stateKey();
    await load();
    await mirrorAllUnlessSyncing();
    if (stateKey() !== before) emitChange();
  });
}
