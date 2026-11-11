import { liveSteps, sameSteps } from "../domain/listEdits";
import {
  newListOrder,
  paperLabel,
  pickListNote,
  stepLabel,
  type LabelParts,
} from "../domain/listNotes";
import { stepCells } from "../domain/stepColumn";
import type { ParseFailure } from "../format/common";
import { paperId } from "../format/readState";
import {
  READING_LIST_TAG,
  resolveReadingList,
  writeReadingList,
  type ReadingListDoc,
  type ReadingListStep,
  type ResolvedList,
} from "../format/readingList";
import { Refusal } from "./alerts";
import { isTaggedNote, libraryLinkOf, paperRefOf } from "./items";
import { currentStyle } from "./preferences";
import { enqueue } from "./queue";

export interface FolderList {
  noteID: number;
  /** Null when the list note cannot be read; `failure` says why. */
  doc: ReadingListDoc | null;
  failure: ParseFailure | null;
  resolved: ResolvedList | null;
  cells: Map<string, string>;
  /** Further list notes in the folder, which readers ignore. */
  ignoredNoteIDs: number[];
  /** Everything a view draws of the list, to tell whether it changed. */
  signature: string;
}

/** What the views and the Step column were last told of a folder's list. */
interface Seen {
  cells: Map<string, string>;
  signature: string;
}

const cache = new Map<number, FolderList | null>();
/**
 * Per folder, the list as the views last read it; null for none. A folder
 * absent here had no list when last read, or was never read.
 */
const seen = new Map<number, Seen | null>();

function seenOf(list: FolderList | null): Seen | null {
  return list ? { cells: list.cells, signature: list.signature } : null;
}

/** Drops everything, for shutdown. */
export function clearLists(): void {
  cache.clear();
  seen.clear();
}

/**
 * Drops a folder's cached list before the store rewrites it, keeping what the
 * views were told: a view reading the new list before the next reconcile
 * would otherwise leave the change unseen.
 */
function forget(collectionID: number): void {
  if (!seen.has(collectionID)) {
    seen.set(collectionID, seenOf(cache.get(collectionID) ?? null));
  }
  cache.delete(collectionID);
}

function sameCells(
  a: Map<string, string> | undefined,
  b: Map<string, string> | undefined,
): boolean {
  const left = a ?? new Map<string, string>();
  const right = b ?? new Map<string, string>();
  if (left.size !== right.size) return false;
  for (const [key, value] of left) if (right.get(key) !== value) return false;
  return true;
}

export interface ListChanges {
  /** A Step cell changed. */
  cells: boolean;
  /** Something a view draws of a list changed, or a list came or went. */
  lists: boolean;
}

/**
 * After library events: reads again the folders the views were told of, and
 * `touched` (folders an event named), and says what changed since.
 */
export function reconcileLists(touched: Iterable<number>): ListChanges {
  const ids = new Set([...seen.keys(), ...touched]);
  const before = new Map([...ids].map((id) => [id, seen.get(id) ?? null]));
  cache.clear();
  const changes: ListChanges = { cells: false, lists: false };
  for (const id of ids) {
    const was = before.get(id) ?? null;
    const now = seenOf(listFor(id));
    if (!sameCells(was?.cells, now?.cells)) changes.cells = true;
    if ((was?.signature ?? null) !== (now?.signature ?? null)) {
      changes.lists = true;
    }
    if (now) seen.set(id, now);
    else seen.delete(id);
  }
  return changes;
}

function readList(collectionID: number): FolderList | null {
  const collection = Zotero.Collections.get(collectionID);
  if (!collection) return null;
  const children: Zotero.Item[] = collection.getChildItems(false, false);
  const pick = pickListNote(
    children
      .filter((item) => isTaggedNote(item, READING_LIST_TAG))
      .map((note) => ({
        id: note.id,
        key: note.key,
        dateAdded: note.dateAdded,
        html: note.getNote(),
      })),
  );
  if (!pick) return null;
  const ignored = pick.ignored.map((id) => {
    const other = Zotero.Items.get(id) as Zotero.Item | false;
    return [id, other ? other.getNoteTitle() : ""];
  });
  if (!pick.parsed.ok) {
    return {
      noteID: pick.id,
      doc: null,
      failure: pick.parsed.reason,
      resolved: null,
      cells: new Map(),
      ignoredNoteIDs: pick.ignored,
      signature: JSON.stringify([pick.id, pick.parsed.reason, ignored]),
    };
  }
  const papers = children.filter((item) => item.isRegularItem());
  const folder = papers.map((item) => ({
    key: item.key,
    title: String(item.getField("title")),
  }));
  const resolved = resolveReadingList(pick.parsed.value, folder);
  // A paper's label, in the style the reader chose, and its read-state id,
  // which picks the state it shows.
  const style = currentStyle();
  const drawn = papers.map((item) => [
    item.key,
    paperLabel(partsOf(item), style),
    paperId(paperRefOf(item)),
  ]);
  return {
    noteID: pick.id,
    doc: pick.parsed.value,
    failure: null,
    resolved,
    cells: stepCells(resolved),
    ignoredNoteIDs: pick.ignored,
    signature: JSON.stringify([
      pick.id,
      pick.parsed.value,
      resolved,
      ignored,
      style,
      drawn,
    ]),
  };
}

/** The reading list a folder holds, or null when it holds none. Cached until the next library event. */
export function listFor(collectionID: number): FolderList | null {
  if (!cache.has(collectionID)) {
    const list = readList(collectionID);
    cache.set(collectionID, list);
    // The first read of a folder is what its views are told.
    if (list && !seen.has(collectionID)) seen.set(collectionID, seenOf(list));
  }
  return cache.get(collectionID) ?? null;
}

/** What a paper's labels are made of. */
export function partsOf(item: Zotero.Item): LabelParts {
  return {
    creator: String(item.getField("firstCreator")),
    year: String(item.getField("date", true, true)).slice(0, 4),
    title: String(item.getField("title")),
  };
}

/** A paper's label in the list note, which the format fixes. */
function labelOf(item: Zotero.Item): string {
  return stepLabel(partsOf(item));
}

/**
 * Make reading list: a new list note in the folder holding its papers, in the
 * order the item list shows them when it shows this folder (`shownKeys`). A
 * folder that already holds a list is left as it is.
 */
export function makeReadingList(
  collectionID: number,
  shownKeys: string[] | null,
): Promise<void> {
  return enqueue(async () => {
    forget(collectionID);
    if (listFor(collectionID)) return;
    const collection = Zotero.Collections.get(collectionID);
    if (!collection) return;
    const papers = (
      collection.getChildItems(false, false) as Zotero.Item[]
    ).filter((item) => item.isRegularItem());
    const byKey = new Map(papers.map((paper) => [paper.key, paper]));
    const order = newListOrder(
      papers.map((paper) => ({
        key: paper.key,
        title: String(paper.getField("title")),
      })),
      shownKeys,
    );
    const doc: ReadingListDoc = {
      version: 1,
      topic: collection.name,
      steps: order.map((key) => ({ key, why: "" })),
    };
    const note = new Zotero.Item("note");
    note.libraryID = collection.libraryID;
    note.setNote(
      writeReadingList(
        doc,
        (key) => labelOf(byKey.get(key)!),
        libraryLinkOf(collection.libraryID),
      ),
    );
    note.addTag(READING_LIST_TAG);
    note.setCollections([collectionID]);
    // Unselected, so the note editor does not open it and save it back rewritten.
    await note.saveTx({ skipSelect: true });
    forget(collectionID);
  });
}

export class UnreadableListError extends Refusal {}

/**
 * Edits a folder's steps and rewrites its list note, the readable part rebuilt
 * from the JSON. `edit` gets the live steps, as readers resolve them. A list
 * that cannot be read is never rewritten.
 */
export function editList(
  collectionID: number,
  edit: (steps: ReadingListStep[]) => ReadingListStep[],
): Promise<void> {
  return enqueue(async () => {
    forget(collectionID);
    const list = listFor(collectionID);
    const collection = Zotero.Collections.get(collectionID);
    const note = list ? Zotero.Items.get(list.noteID) : false;
    if (!list || !collection || !note) {
      throw new UnreadableListError("This folder's reading list is gone.");
    }
    if (!list.doc || !list.resolved) {
      throw new UnreadableListError(
        "This folder's reading list cannot be read, so it was not changed.",
      );
    }
    const steps = liveSteps(list.resolved);
    const next = edit(steps);
    if (sameSteps(steps, next)) return;
    const doc: ReadingListDoc = {
      version: 1,
      topic: list.doc.topic,
      steps: next,
    };
    note.setNote(
      writeReadingList(
        doc,
        (key) => {
          const item = Zotero.Items.getByLibraryAndKey(
            collection.libraryID,
            key,
          );
          return item ? labelOf(item) : key;
        },
        libraryLinkOf(collection.libraryID),
      ),
    );
    await note.saveTx();
    forget(collectionID);
  });
}
