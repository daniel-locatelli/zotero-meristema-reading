import { config } from "../../package.json";
import { withoutTab, withTab, type OpenTab } from "../domain/openTabs";
import { onChange } from "./changes";
import { listFor } from "./listStore";
import { libraryEditable, renderList } from "./listView";
import {
  freezeOpenTabs,
  openPluginTab,
  readRecord,
  writeRecord,
} from "./pluginTab";
import { report } from "./report";

export { freezeOpenTabs };

const TAB_TYPE = `${config.addonRef}-list`;
export const LIST_TAB_TYPE = TAB_TYPE;
/** The tab bar draws this as the plugin's logo (`addon/content/tabIcon.css`). */
const TAB_ICON = "meristema-reading-list";

interface ListTabView {
  tabID: string;
  container: HTMLElement;
  collectionID: number;
  win: _ZoteroTypes.MainWindow;
}

/**
 * Every open list tab, by its body. A tab's id is the same in each window
 * that shows the folder's list, so the id alone cannot tell them apart.
 */
const views = new Map<HTMLElement, ListTabView>();
let unsubscribe: (() => void) | null = null;

/** A list tab's title: the list's topic, else its folder's name. */
function titleOf(collectionID: number): string {
  const collection = Zotero.Collections.get(collectionID);
  return (
    listFor(collectionID)?.doc?.topic ||
    (collection ? collection.name : "Reading list")
  );
}

/** Opens the Overview; handed in by hooks so the two tabs do not import each other. */
let openOverview: ((win: _ZoteroTypes.MainWindow) => void) | undefined;

function render(view: ListTabView): void {
  const { tabID } = view;
  const collection = Zotero.Collections.get(view.collectionID);
  const open = openOverview;
  renderList(view.container, view.collectionID, {
    mode: "tab",
    currentKey: null,
    editable: Boolean(collection) && libraryEditable(collection.libraryID),
    onOpenOverview: open ? () => open(view.win) : undefined,
  });
  // A list that is gone keeps its last title; the view says it is gone.
  if (!listFor(view.collectionID)) return;
  const title = titleOf(view.collectionID);
  const tab = (view.win.Zotero_Tabs._tabs as any[]).find(
    (open) => open.id === tabID,
  );
  if (tab && tab.title !== title) {
    void view.win.Zotero_Tabs.rename(tabID, title);
  }
}

/**
 * Opens a folder's list as a tab, or selects the tab already showing it.
 * With `select: false` the tab opens behind the selected one.
 */
export function openListTab(
  collectionID: number,
  win: _ZoteroTypes.MainWindow = Zotero.getMainWindow(),
  { select = true }: { select?: boolean } = {},
): void {
  const manager = win.Zotero_Tabs;
  const tabID = `${TAB_TYPE}-${collectionID}`;
  if ((manager._tabs as any[]).some((tab) => tab.id === tabID)) {
    if (select) manager.select(tabID);
    return;
  }
  if (!listFor(collectionID)) return;
  const collection = Zotero.Collections.get(collectionID);
  // Kept from the start: the folder may be gone by the time the tab closes.
  const record: OpenTab | null = collection
    ? {
        kind: "list",
        libraryID: collection.libraryID,
        collectionKey: collection.key,
      }
    : null;
  const body = openPluginTab(win, {
    id: tabID,
    type: TAB_TYPE,
    title: titleOf(collectionID),
    icon: TAB_ICON,
    data: { collectionID },
    select,
    onClose: () => {
      views.delete(body);
      // Another window still shows the list: its tab keeps the record.
      const shown = [...views.values()].some(
        (other) => other.collectionID === collectionID,
      );
      // The reader closed it, so its record goes; quitting or shutting down
      // has frozen the record first, and this writes nothing.
      if (record && !shown) writeRecord(withoutTab(readRecord(), record));
    },
  });
  if (record) writeRecord(withTab(readRecord(), record));
  const view: ListTabView = { tabID, container: body, collectionID, win };
  views.set(body, view);
  render(view);
}

export function startListTabs(
  hooks: { openOverview?: (win: _ZoteroTypes.MainWindow) => void } = {},
): void {
  if (unsubscribe) return;
  openOverview = hooks.openOverview;
  unsubscribe = onChange(() => {
    for (const view of views.values()) render(view);
  });
}

/**
 * Reopens one recorded list tab behind the selected tab. Says whether it is
 * kept: false when its folder or list is gone, or opening it threw.
 */
export function reopenListTab(
  tab: OpenTab & { kind: "list" },
  win: _ZoteroTypes.MainWindow = Zotero.getMainWindow(),
): boolean {
  // Each lookup inside the guard: one that throws drops this tab, not the rest.
  try {
    const collection = Zotero.Collections.getByLibraryAndKey(
      tab.libraryID,
      tab.collectionKey,
    );
    if (!collection || !listFor(collection.id)) return false;
    openListTab(collection.id, win, { select: false });
    return true;
  } catch (error) {
    report(error);
    return false;
  }
}

export function closeListTabs(): void {
  // Before the tabs close, so closing them keeps their record for next time.
  freezeOpenTabs();
  unsubscribe?.();
  unsubscribe = null;
  for (const view of [...views.values()]) {
    try {
      view.win.Zotero_Tabs.close(view.tabID);
    } catch (error) {
      report(error);
    }
  }
  views.clear();
}
