import type { Parsed } from "../format/common";
import {
  parseReadingList,
  resolveReadingList,
  type FolderItem,
  type ReadingListDoc,
} from "../format/readingList";

export interface ListNote {
  id: number;
  key: string;
  dateAdded: string;
  html: string;
}

export interface ListPick {
  id: number;
  parsed: Parsed<ReadingListDoc>;
  ignored: number[];
}

/**
 * A folder's list note: the oldest of its tagged notes, by date added, then
 * key. The others are ignored, and returned so the sidebar can name them. The
 * chosen note is returned even when it cannot be read, so readers can say so
 * rather than treat the folder as having no list.
 */
export function pickListNote(notes: readonly ListNote[]): ListPick | null {
  const sorted = [...notes].sort((a, b) =>
    a.dateAdded !== b.dateAdded
      ? a.dateAdded < b.dateAdded
        ? -1
        : 1
      : a.key < b.key
        ? -1
        : a.key > b.key
          ? 1
          : 0,
  );
  if (!sorted.length) return null;
  const [chosen, ...ignored] = sorted;
  return {
    id: chosen.id,
    parsed: parseReadingList(chosen.html),
    ignored: ignored.map((note) => note.id),
  };
}

/**
 * The steps of a new list: the folder's papers in the order the item list
 * shows them, when it shows this folder (`shown`), and otherwise by title,
 * as unordered papers sort. Papers the item list did not show, because a
 * search hid them, follow by title.
 */
export function newListOrder(
  folder: readonly FolderItem[],
  shown: readonly string[] | null,
): string[] {
  const inFolder = new Set(folder.map((item) => item.key));
  const first = [...new Set((shown ?? []).filter((key) => inFolder.has(key)))];
  const placed = new Set(first);
  const rest = resolveReadingList(
    { version: 1, topic: "", steps: [] },
    folder.filter((item) => !placed.has(item.key)),
  ).unordered;
  return [...first, ...rest];
}

export interface LabelParts {
  creator: string;
  year: string;
  title: string;
}

function yearOf(parts: LabelParts): string {
  return /^\d{4}$/.test(parts.year) && parts.year !== "0000" ? parts.year : "";
}

function titleOf(parts: LabelParts): string {
  return parts.title.trim() || "Untitled";
}

/** A step's link text in the note's readable part: author, year, title. */
export function stepLabel(parts: LabelParts): string {
  return [parts.creator.trim(), yearOf(parts), titleOf(parts)]
    .filter(Boolean)
    .join(", ");
}

/** How the views label a paper, as the reader chose in the settings. */
export type LabelStyle = "author-year" | "title" | "author-year-title";

export const DEFAULT_LABEL_STYLE: LabelStyle = "author-year-title";

const LABEL_STYLES: readonly LabelStyle[] = [
  "author-year",
  "title",
  "author-year-title",
];

/** The label style a stored pref names; anything else is the default. */
export function labelStyleOf(value: unknown): LabelStyle {
  return LABEL_STYLES.find((style) => style === value) ?? DEFAULT_LABEL_STYLE;
}

/**
 * A paper's label in the views. Author and year falls back to the title when
 * the paper has neither; the note's readable part keeps `stepLabel`.
 */
export function paperLabel(parts: LabelParts, style: LabelStyle): string {
  if (style === "title") return titleOf(parts);
  if (style === "author-year") {
    const label = [parts.creator.trim(), yearOf(parts)]
      .filter(Boolean)
      .join(", ");
    return label || titleOf(parts);
  }
  return stepLabel(parts);
}
