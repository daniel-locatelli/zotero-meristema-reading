import {
  buildOverview,
  type Overview,
  type OverviewList,
} from "../domain/overview";
import { READING_LIST_TAG } from "../format/readingList";
import { pickQueue, sourceLists } from "../format/readingQueue";
import { libraryLinkOf, taggedNotes } from "./items";
import { listFor } from "./listStore";
import { stateOfItem } from "./stateStore";

export interface OverviewData {
  overview: Overview;
  /** Per queue step key, the lists whose folder holds the paper. */
  sources: Map<string, OverviewList[]>;
}

/** Every folder list in every library, read through the list store. */
async function gatherLists(): Promise<OverviewList[]> {
  const out: OverviewList[] = [];
  for (const library of Zotero.Libraries.getAll() as any[]) {
    if (library.libraryType !== "user" && library.libraryType !== "group")
      continue;
    for (const note of await taggedNotes(library.libraryID, READING_LIST_TAG)) {
      for (const collectionID of note.getCollections()) {
        const collection = Zotero.Collections.get(collectionID);
        const list = listFor(collectionID);
        if (
          !collection ||
          collection.deleted ||
          !list ||
          list.noteID !== note.id
        )
          continue;
        out.push({
          noteID: note.id,
          noteKey: note.key,
          collectionID,
          libraryName:
            library.libraryType === "user" ? null : String(library.name),
          folderName: collection.name,
          topic: list.doc?.topic || collection.name,
          steps: list.resolved?.steps.map((step) => step.key) ?? [],
          readable: Boolean(list.resolved),
        });
      }
    }
  }
  return out;
}

/** The Overview as the stores hold it now: the queue, the duplicates, every list. */
export async function readOverview(): Promise<OverviewData> {
  const lists = await gatherLists();
  const mine = lists.filter((l) => l.libraryName === null);
  const pick = pickQueue(
    mine.map((l) => {
      const note = Zotero.Items.get(l.noteID) as Zotero.Item;
      return {
        key: l.noteKey,
        dateAdded: note.dateAdded,
        library: libraryLinkOf(note.libraryID),
        tags: note.getTags().map((tag: { tag: string }) => tag.tag),
      };
    }),
  );
  const byKey = (key: string | null) => mine.find((l) => l.noteKey === key);
  const queue = byKey(pick.queue) ?? null;
  const stateOf = (list: OverviewList, key: string) => {
    const collection = Zotero.Collections.get(list.collectionID);
    const item =
      collection && Zotero.Items.getByLibraryAndKey(collection.libraryID, key);
    return item ? stateOfItem(item) : "unread";
  };
  const overview = buildOverview({
    // A list in two folders is one list here: its first folder.
    lists: lists.filter(
      (l, i) => lists.findIndex((o) => o.noteID === l.noteID) === i,
    ),
    queue: queue?.noteID ?? null,
    duplicates: pick.duplicates.map((key) => byKey(key)!.noteID),
    stateOf,
  });
  const sources = new Map<string, OverviewList[]>();
  if (queue) {
    const papers = (l: OverviewList): string[] => {
      const r = listFor(l.collectionID)?.resolved;
      return r ? [...r.steps.map((s) => s.key), ...r.unordered] : [];
    };
    const found = sourceLists(
      queue.noteKey,
      queue.steps,
      mine.map((l) => ({ note: l.noteKey, topic: l.topic, papers: papers(l) })),
    );
    for (const [key, notes] of Object.entries(found)) {
      sources.set(
        key,
        notes.map((note) => byKey(note)!),
      );
    }
  }
  return { overview, sources };
}
