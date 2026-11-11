/** A list tab the plugin reopens after a restart, by its folder. */
export type OpenTab = { libraryID: number; collectionKey: string };

function same(a: OpenTab, b: OpenTab): boolean {
  return a.libraryID === b.libraryID && a.collectionKey === b.collectionKey;
}

/**
 * Reads the record of open list tabs. Bad JSON reads as no tabs; an entry
 * without a whole library ID and a folder key is dropped, and so is a repeat.
 */
export function parseOpenTabs(json: string): OpenTab[] {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  let tabs: OpenTab[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) continue;
    const { libraryID, collectionKey } = entry as Record<string, unknown>;
    if (!Number.isInteger(libraryID)) continue;
    if (typeof collectionKey !== "string" || !collectionKey) continue;
    tabs = withTab(tabs, { libraryID: libraryID as number, collectionKey });
  }
  return tabs;
}

/** The record with `tab` appended, unless it is there already. */
export function withTab(list: OpenTab[], tab: OpenTab): OpenTab[] {
  if (list.some((open) => same(open, tab))) return [...list];
  return [
    ...list,
    { libraryID: tab.libraryID, collectionKey: tab.collectionKey },
  ];
}

/** The record without `tab`. */
export function withoutTab(list: OpenTab[], tab: OpenTab): OpenTab[] {
  return list.filter((open) => !same(open, tab));
}
