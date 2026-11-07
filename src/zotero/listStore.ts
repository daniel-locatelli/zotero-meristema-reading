import { newListOrder, pickListNote, stepLabel } from "../domain/listNotes";
import { stepCells } from "../domain/stepColumn";
import type { ParseFailure } from "../format/common";
import {
  READING_LIST_TAG,
  resolveReadingList,
  writeReadingList,
  type ReadingListDoc,
  type ResolvedList,
} from "../format/readingList";
import { isTaggedNote, libraryLinkOf } from "./items";
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
}

const cache = new Map<number, FolderList | null>();

export function clearLists(): void {
  cache.clear();
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
  if (!pick.parsed.ok) {
    return {
      noteID: pick.id,
      doc: null,
      failure: pick.parsed.reason,
      resolved: null,
      cells: new Map(),
      ignoredNoteIDs: pick.ignored,
    };
  }
  const folder = children
    .filter((item) => item.isRegularItem())
    .map((item) => ({ key: item.key, title: String(item.getField("title")) }));
  const resolved = resolveReadingList(pick.parsed.value, folder);
  return {
    noteID: pick.id,
    doc: pick.parsed.value,
    failure: null,
    resolved,
    cells: stepCells(resolved),
    ignoredNoteIDs: pick.ignored,
  };
}

/** The reading list a folder holds, or null when it holds none. Cached until the next library event. */
export function listFor(collectionID: number): FolderList | null {
  if (!cache.has(collectionID)) cache.set(collectionID, readList(collectionID));
  return cache.get(collectionID) ?? null;
}

function labelOf(item: Zotero.Item): string {
  return stepLabel({
    creator: String(item.getField("firstCreator")),
    year: String(item.getField("date", true, true)).slice(0, 4),
    title: String(item.getField("title")),
  });
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
    cache.delete(collectionID);
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
    cache.delete(collectionID);
  });
}
