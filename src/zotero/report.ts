/**
 * Logs an error to Zotero's console. An error made in another global (Zotero's
 * own) fails `instanceof Error` here, so anything with a message is passed on
 * as it is, keeping its stack.
 */
export function report(error: unknown): void {
  const isError =
    typeof error === "object" && error !== null && "message" in error;
  Zotero.logError(isError ? error : new Error(String(error)));
}
