import { report } from "./report";

const listeners = new Set<() => void>();

/** Calls `listener` after the stores change; returns the unsubscribe. */
export function onChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function emitChange(): void {
  for (const listener of listeners) {
    try {
      listener();
    } catch (error) {
      report(error);
    }
  }
}
