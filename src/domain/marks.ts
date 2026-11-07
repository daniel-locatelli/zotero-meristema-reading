import {
  setState,
  stateOf,
  type ReadState,
  type ReadStateDoc,
} from "../format/readState";

/**
 * `doc` with each paper set to `state` at `at`. A paper already in that state
 * keeps its entry and its date. Unread is written only over a stored entry, as
 * the tombstone that stops a merge bringing back an older mark. Returns `doc`
 * itself when nothing changes, so the caller can skip the write.
 */
export function applyMark(
  doc: ReadStateDoc,
  ids: readonly string[],
  state: ReadState,
  at: string,
): ReadStateDoc {
  let next = doc;
  for (const id of new Set(ids)) {
    if (stateOf(next, id) === state) continue;
    next = setState(next, id, state, at);
  }
  return next;
}
