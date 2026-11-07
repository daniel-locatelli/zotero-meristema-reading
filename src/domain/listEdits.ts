import type { ReadingListStep, ResolvedList } from "../format/readingList";
import type { ReadState } from "../format/readState";

/** The steps a reader sees, with their reasons: a step whose paper left the folder is gone. */
export function liveSteps(resolved: ResolvedList): ReadingListStep[] {
  return resolved.steps.map((step) => ({ key: step.key, why: step.why }));
}

/**
 * `steps` with `key` placed just before `beforeKey`, or last when `beforeKey`
 * is null. A step keeps its reason when it moves; a paper new to the steps
 * gets none. Placing a step before itself, or before a key not in the steps,
 * returns `steps` unchanged.
 */
export function placeStep(
  steps: readonly ReadingListStep[],
  key: string,
  beforeKey: string | null,
): ReadingListStep[] {
  if (key === beforeKey) return steps as ReadingListStep[];
  const moving = steps.find((step) => step.key === key) ?? { key, why: "" };
  const rest = steps.filter((step) => step.key !== key);
  const at =
    beforeKey === null
      ? rest.length
      : rest.findIndex((step) => step.key === beforeKey);
  if (at < 0) return steps as ReadingListStep[];
  return [...rest.slice(0, at), moving, ...rest.slice(at)];
}

/** `steps` without `key`: its paper goes back among the unordered. */
export function unplaceStep(
  steps: readonly ReadingListStep[],
  key: string,
): ReadingListStep[] {
  return steps.filter((step) => step.key !== key);
}

/** `steps` with `key` one place earlier (-1) or later (1); at an end, unchanged. */
export function shiftStep(
  steps: readonly ReadingListStep[],
  key: string,
  delta: -1 | 1,
): ReadingListStep[] {
  const index = steps.findIndex((step) => step.key === key);
  const target = index + delta;
  if (index < 0 || target < 0 || target >= steps.length) {
    return steps as ReadingListStep[];
  }
  const before =
    delta < 0 ? steps[target].key : (steps[target + 1]?.key ?? null);
  return placeStep(steps, key, before);
}

export function setWhy(
  steps: readonly ReadingListStep[],
  key: string,
  why: string,
): ReadingListStep[] {
  return steps.map((step) => (step.key === key ? { key, why } : step));
}

export function sameSteps(
  a: readonly ReadingListStep[],
  b: readonly ReadingListStep[],
): boolean {
  return (
    a.length === b.length &&
    a.every(
      (step, index) => step.key === b[index].key && step.why === b[index].why,
    )
  );
}

/** Where a step's toggle goes next: Unread, then Reading, then Read, then Unread. */
export function nextState(state: ReadState): ReadState {
  return state === "unread"
    ? "reading"
    : state === "reading"
      ? "read"
      : "unread";
}
