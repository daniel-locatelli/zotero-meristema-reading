import type { LibraryLink } from "./common";
import { READING_LIST_TAG } from "./readingList";

export const READING_QUEUE_TAG = "meristema-reading-queue";

/** A folder's list note (R1's oldest-note rule), as the queue rule sees it. */
export interface QueueCandidate {
  key: string;
  dateAdded: string;
  library: LibraryLink;
  tags: readonly string[];
}

export interface QueuePick {
  /** The queue's note key, or null when My Library has none. */
  queue: string | null;
  /** Further tagged notes, oldest first: read as ordinary lists. */
  duplicates: string[];
}

/** A list, as source lists see it: its note, topic and folder's papers. */
export interface SourceList {
  note: string;
  topic: string;
  papers: readonly string[];
}

function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * The queue: of the My Library list notes carrying both tags, the oldest by
 * date added, then key. A note named twice (in two folders) counts once.
 */
export function pickQueue(notes: readonly QueueCandidate[]): QueuePick {
  const seen = new Set<string>();
  const tagged = notes
    .filter(
      (note) =>
        note.library.kind === "user" &&
        note.tags.includes(READING_LIST_TAG) &&
        note.tags.includes(READING_QUEUE_TAG),
    )
    .filter((note) => !seen.has(note.key) && Boolean(seen.add(note.key)))
    .sort(
      (a, b) =>
        byCodeUnit(a.dateAdded, b.dateAdded) || byCodeUnit(a.key, b.key),
    );
  return {
    queue: tagged[0]?.key ?? null,
    duplicates: tagged.slice(1).map((note) => note.key),
  };
}

/**
 * For each queue step, the other lists whose folder holds its paper, by topic
 * lowercased, then note key. Computed on read, never stored.
 */
export function sourceLists(
  queueNote: string,
  queueKeys: readonly string[],
  lists: readonly SourceList[],
): Record<string, string[]> {
  const others = lists
    .filter((list) => list.note !== queueNote)
    .sort(
      (a, b) =>
        byCodeUnit(a.topic.toLowerCase(), b.topic.toLowerCase()) ||
        byCodeUnit(a.note, b.note),
    );
  const out: Record<string, string[]> = {};
  for (const key of queueKeys) {
    out[key] = [
      ...new Set(
        others.filter((list) => list.papers.includes(key)).map((l) => l.note),
      ),
    ];
  }
  return out;
}
