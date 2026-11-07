import { config } from "../../package.json";
import { report } from "./report";

/** A store refusing a change for a reason the reader can act on: its message is theirs. */
export class Refusal extends Error {}

/** An alert over `win`, else over Zotero's main window. */
export function alertUser(message: string, win?: Window | null): void {
  Zotero.alert(
    (win ?? Zotero.getMainWindow()) as any,
    config.addonName,
    message,
  );
}

/**
 * What a failed menu or view action does: a refusal says its own message,
 * anything else is logged and the reader told `fallback`.
 */
export function failedWith(
  fallback: string,
  win?: Window | null,
): (error: unknown) => void {
  return (error) => {
    if (error instanceof Refusal) {
      alertUser(error.message, win);
      return;
    }
    report(error);
    alertUser(fallback, win);
  };
}
