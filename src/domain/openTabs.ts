/** A tab the plugin reopens after a restart: a folder's list, or the Overview. */
export type OpenTab =
  | { kind: "list"; libraryID: number; collectionKey: string }
  | { kind: "overview" };

function same(a: OpenTab, b: OpenTab): boolean {
  if (a.kind === "overview" || b.kind === "overview") return a.kind === b.kind;
  return a.libraryID === b.libraryID && a.collectionKey === b.collectionKey;
}

function copy(tab: OpenTab): OpenTab {
  return tab.kind === "overview"
    ? { kind: "overview" }
    : {
        kind: "list",
        libraryID: tab.libraryID,
        collectionKey: tab.collectionKey,
      };
}

/**
 * Reads the record of open tabs. Bad JSON reads as no tabs. An entry without
 * a kind is a list tab, from before the Overview. A list entry without a whole
 * library ID and a folder key is dropped, and so are an unknown kind and a
 * repeat.
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
    const { kind, libraryID, collectionKey } = entry as Record<string, unknown>;
    if (kind === "overview") {
      tabs = withTab(tabs, { kind: "overview" });
      continue;
    }
    if (kind !== undefined && kind !== "list") continue;
    if (!Number.isInteger(libraryID)) continue;
    if (typeof collectionKey !== "string" || !collectionKey) continue;
    tabs = withTab(tabs, {
      kind: "list",
      libraryID: libraryID as number,
      collectionKey,
    });
  }
  return tabs;
}

/** The record with `tab` appended, unless it is there already. */
export function withTab(list: OpenTab[], tab: OpenTab): OpenTab[] {
  if (list.some((open) => same(open, tab))) return list.map(copy);
  return [...list.map(copy), copy(tab)];
}

/** The record without `tab`. */
export function withoutTab(list: OpenTab[], tab: OpenTab): OpenTab[] {
  return list.filter((open) => !same(open, tab));
}
