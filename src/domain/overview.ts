import { nextUp, type ReadState } from "../format/readState";

export interface OverviewList {
  noteID: number;
  noteKey: string;
  collectionID: number;
  /** Null for My Library; a group's name otherwise. */
  libraryName: string | null;
  folderName: string;
  topic: string;
  /** Item keys in step order; empty for a list that cannot be read. */
  steps: string[];
  readable: boolean;
}
export interface Progress {
  read: number;
  reading: number;
  unread: number;
}
export interface OverviewRow {
  list: OverviewList;
  progress: Progress;
  nextUp: string | null;
}
export type QueueView =
  | { status: "none" }
  | { status: "unreadable"; list: OverviewList }
  | { status: "empty"; list: OverviewList }
  | { status: "all-read"; list: OverviewList }
  | { status: "ok"; list: OverviewList; nextUp: string; after: string[] };
export interface Overview {
  queue: QueueView;
  /** Lists also tagged as the queue that lost the pick. */
  duplicates: OverviewList[];
  /** Every list but the queue, by topic lowercased, then note key. */
  rows: OverviewRow[];
}
export const AFTER_LIMIT = 5;
function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function progressText(progress: Progress): string {
  return `${progress.read} read · ${progress.reading} reading · ${progress.unread} left`;
}

export function buildOverview(input: {
  lists: OverviewList[];
  queue: number | null;
  duplicates: number[];
  stateOf: (list: OverviewList, key: string) => ReadState;
}): Overview {
  const queueList =
    input.queue === null
      ? undefined
      : input.lists.find((l) => l.noteID === input.queue);
  const rows = input.lists
    .filter((l) => l !== queueList)
    .sort(
      (a, b) =>
        byCodeUnit(a.topic.toLowerCase(), b.topic.toLowerCase()) ||
        byCodeUnit(a.noteKey, b.noteKey),
    )
    .map((l) => {
      const state = (key: string) => input.stateOf(l, key);
      const progress: Progress = { read: 0, reading: 0, unread: 0 };
      for (const key of l.steps) progress[state(key)]++;
      return {
        list: l,
        progress,
        nextUp: nextUp(
          l.steps.map((key) => ({ key })),
          state,
        ),
      };
    });
  const duplicates = input.duplicates
    .map((id) => input.lists.find((l) => l.noteID === id))
    .filter((l): l is OverviewList => Boolean(l));
  return { queue: queueView(queueList, input.stateOf), duplicates, rows };
}

function queueView(
  list: OverviewList | undefined,
  stateOf: (list: OverviewList, key: string) => ReadState,
): QueueView {
  if (!list) return { status: "none" };
  if (!list.readable) return { status: "unreadable", list };
  if (!list.steps.length) return { status: "empty", list };
  const state = (key: string) => stateOf(list, key);
  const next = nextUp(
    list.steps.map((key) => ({ key })),
    state,
  );
  if (next === null) return { status: "all-read", list };
  const after = list.steps
    .filter((key) => key !== next && state(key) !== "read")
    .slice(0, AFTER_LIMIT);
  return { status: "ok", list, nextUp: next, after };
}
