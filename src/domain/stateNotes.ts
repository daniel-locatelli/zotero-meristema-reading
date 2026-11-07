import {
  mergeReadStates,
  parseReadState,
  type ReadStateDoc,
} from "../format/readState";

export interface StateNote {
  key: string;
  html: string;
}

export type StatePick =
  | { kind: "none" }
  | { kind: "unreadable"; keys: string[] }
  | { kind: "ok"; keeper: string; doc: ReadStateDoc; trash: string[] };

/**
 * Which of the user's state notes holds the read state. The readable notes
 * are merged. The one with the smallest key keeps the merge and the others go
 * to the trash: the smallest key rather than the newest note, so two computers
 * that merge the same pair before they sync keep the same note. A note that
 * cannot be read is never rewritten or trashed, and when no note can be read
 * nothing may be written until the user fixes or removes it.
 */
export function pickStateNotes(notes: readonly StateNote[]): StatePick {
  const readable = notes
    .flatMap((note) => {
      const parsed = parseReadState(note.html);
      return parsed.ok ? [{ key: note.key, doc: parsed.value }] : [];
    })
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  if (!readable.length) {
    return notes.length
      ? { kind: "unreadable", keys: notes.map((note) => note.key) }
      : { kind: "none" };
  }
  const [keeper, ...others] = readable;
  return {
    kind: "ok",
    keeper: keeper.key,
    doc: others.reduce(
      (doc, other) => mergeReadStates(doc, other.doc),
      keeper.doc,
    ),
    trash: others.map((other) => other.key),
  };
}
