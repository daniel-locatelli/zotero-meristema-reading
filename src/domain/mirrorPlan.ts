import {
  MIRROR_TAGS,
  mirrorTag,
  stateOf,
  type ReadStateDoc,
} from "../format/readState";

export interface MirrorItem {
  id: number;
  paperId: string;
  tags: readonly string[];
}

export interface MirrorChange {
  id: number;
  add: string[];
  remove: string[];
}

/**
 * The tag changes that make each item's mirror tag match its read state; an
 * item already right is left out. Callers pass only items in the user's own
 * library: a tag on a group item is every member's, so group items get none.
 */
export function planMirror(
  doc: ReadStateDoc,
  items: readonly MirrorItem[],
): MirrorChange[] {
  const changes: MirrorChange[] = [];
  for (const item of items) {
    const wanted = mirrorTag(stateOf(doc, item.paperId));
    const add = wanted && !item.tags.includes(wanted) ? [wanted] : [];
    const remove = Object.values(MIRROR_TAGS).filter(
      (tag) => tag !== wanted && item.tags.includes(tag),
    );
    if (add.length || remove.length) changes.push({ id: item.id, add, remove });
  }
  return changes;
}
