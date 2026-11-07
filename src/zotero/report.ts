export function report(error: unknown): void {
  Zotero.logError(error instanceof Error ? error : new Error(String(error)));
}
