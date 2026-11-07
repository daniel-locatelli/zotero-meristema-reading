import { report } from "./report";

/** How long a burst of store changes may run before the views redraw once. */
const EMIT_DELAY_MS = 20;
const listeners = new Set<() => void>();
let emitTimer: ReturnType<typeof setTimeout> | null = null;

/** Calls `listener` after the stores change; returns the unsubscribe. */
export function onChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emitNow(): void {
  emitTimer = null;
  for (const listener of listeners) {
    try {
      listener();
    } catch (error) {
      report(error);
    }
  }
}

/**
 * Tells the views the stores changed. A burst of changes (a mark, the mirror
 * tags' events, the state note read again) reaches each listener once.
 */
export function emitChange(): void {
  if (!emitTimer) emitTimer = setTimeout(emitNow, EMIT_DELAY_MS);
}

export function isChangePending(): boolean {
  return emitTimer !== null;
}

/** Drops a change not yet told, for shutdown. */
export function cancelChange(): void {
  if (emitTimer) clearTimeout(emitTimer);
  emitTimer = null;
}
