import type { ResolvedList } from "../format/readingList";

/**
 * The Step column's cell data per item key. Every paper in the folder gets its
 * place in reading order, so sorting by the column gives the list's order with
 * the unordered papers after the last step, in the resolver's order. The place
 * is zero-padded so a plain string sort agrees with it, and an unordered
 * paper's ends in "u" so it shows blank.
 */
export function stepCells(list: ResolvedList): Map<string, string> {
  const cells = new Map<string, string>();
  const keys = [...list.steps.map((step) => step.key), ...list.unordered];
  keys.forEach((key, index) => {
    const place = String(index + 1).padStart(5, "0");
    cells.set(key, index < list.steps.length ? place : `${place}u`);
  });
  return cells;
}

/** What a cell shows: the step's number, or nothing for an unordered paper. */
export function stepText(data: string): string {
  return /^\d+$/.test(data) ? String(Number(data)) : "";
}
