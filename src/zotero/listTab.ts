import { config } from "../../package.json";
import {
  parseOpenTabs,
  withoutTab,
  withTab,
  type OpenTab,
} from "../domain/openTabs";
import { onChange } from "./changes";
import { listFor } from "./listStore";
import { libraryEditable, renderList } from "./listView";
import { report } from "./report";

const TAB_TYPE = `${config.addonRef}-list`;
const HOOK_MARKER = "__meristemaReadingTabHooks";
/** The tab bar draws this as the plugin's logo (`addon/content/tabIcon.css`). */
const TAB_ICON = "meristema-reading-list";
const OPEN_TABS_PREF = `${config.prefsPrefix}.openTabs`;
const views = new Map<
  string,
  {
    container: HTMLElement;
    collectionID: number;
    win: _ZoteroTypes.MainWindow;
  }
>();
let unsubscribe: (() => void) | null = null;
/**
 * While frozen, opening and closing tabs leaves the open-tab record alone:
 * Zotero quitting or the plugin shutting down closes every tab, and the
 * record must outlive that.
 */
let recordFrozen = false;

function readRecord(): OpenTab[] {
  return parseOpenTabs(String(Zotero.Prefs.get(OPEN_TABS_PREF, true) ?? ""));
}

function writeRecord(list: OpenTab[]): void {
  if (recordFrozen) return;
  Zotero.Prefs.set(OPEN_TABS_PREF, JSON.stringify(list), true);
}

/** Stops the open-tab record changing until the plugin starts again. */
export function freezeOpenTabs(): void {
  recordFrozen = true;
}

/**
 * Keeps list tabs out of Zotero's saved session: a restored tab would come
 * back with no view, so the plugin keeps its own record of them and reopens
 * them itself (`reopenListTabs`).
 */
export function installTabHooks(win: _ZoteroTypes.MainWindow): void {
  const manager = win.Zotero_Tabs;
  if (!manager || manager[HOOK_MARKER]) return;
  const getState = manager.getState.bind(manager);
  manager.getState = (): any[] =>
    getState().filter(
      (tab: any) =>
        String(tab?.type ?? "").replace(/-unloaded$/, "") !== TAB_TYPE,
    );
  manager[HOOK_MARKER] = true;
}

/**
 * Shuts Zotero's context pane over a list tab. Zotero opens it only for
 * reader and note tabs, but its layout pass still shows the splitter over any
 * other tab, and a pane left open by a reader tab stays open (as Meristema's
 * graph tab found).
 */
function hideContextPane(
  win: _ZoteroTypes.MainWindow,
  container: HTMLElement,
): void {
  const controller = (win as any).ZoteroContextPane;
  controller?.splitter?.setAttribute?.("hidden", "true");
  win.document
    .getElementById("zotero-context-pane")
    ?.setAttribute("collapsed", "true");
  if (controller?.sidenav) controller.sidenav.hidden = true;
  const content = container as HTMLElement & {
    setBottomPlaceholderHeight?: (height: number) => void;
    setContextPaneOpen?: (open: boolean) => void;
  };
  content.setBottomPlaceholderHeight?.(0);
  content.setContextPaneOpen?.(false);
}

/** A list tab's title: the list's topic, else its folder's name. */
function titleOf(collectionID: number): string {
  const collection = Zotero.Collections.get(collectionID);
  return (
    listFor(collectionID)?.doc?.topic ||
    (collection ? collection.name : "Reading list")
  );
}

function render(tabID: string): void {
  const view = views.get(tabID);
  if (!view) return;
  const collection = Zotero.Collections.get(view.collectionID);
  renderList(view.container, view.collectionID, {
    mode: "tab",
    currentKey: null,
    editable: Boolean(collection) && libraryEditable(collection.libraryID),
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
    ? { libraryID: collection.libraryID, collectionKey: collection.key }
    : null;
  const { container } = manager.add({
    id: tabID,
    type: TAB_TYPE,
    title: titleOf(collectionID),
    data: { collectionID, icon: TAB_ICON },
    select,
    onClose: () => {
      views.delete(tabID);
      // The reader closed it, so its record goes; quitting or shutting down
      // has frozen the record first, and this writes nothing.
      if (record) writeRecord(withoutTab(readRecord(), record));
    },
  });
  if (record) writeRecord(withTab(readRecord(), record));
  container.classList.add("mr-tab-content");
  container.addEventListener("tab-selection-change", (event: Event) => {
    if ((event as CustomEvent<{ selected?: boolean }>).detail?.selected) {
      hideContextPane(win, container);
    }
  });
  // The tab was selected inside add(), before the listener was there.
  if (manager.selectedID === tabID) hideContextPane(win, container);
  const scroll = container.ownerDocument.createElementNS(
    "http://www.w3.org/1999/xhtml",
    "div",
  ) as HTMLElement;
  scroll.className = "mr-tab-scroll";
  const body = container.ownerDocument.createElementNS(
    "http://www.w3.org/1999/xhtml",
    "div",
  ) as HTMLElement;
  scroll.append(body);
  container.append(scroll);
  views.set(tabID, { container: body, collectionID, win });
  render(tabID);
}

export function startListTabs(): void {
  if (unsubscribe) return;
  unsubscribe = onChange(() => {
    for (const tabID of views.keys()) render(tabID);
  });
}

/**
 * Reopens, behind the selected tab, the list tabs open when Zotero quit or
 * the plugin shut down, and forgets those whose folder or list is gone.
 */
export function reopenListTabs(
  win: _ZoteroTypes.MainWindow = Zotero.getMainWindow(),
): void {
  if (!win) return;
  const kept: OpenTab[] = [];
  recordFrozen = true;
  try {
    for (const tab of readRecord()) {
      const collection = Zotero.Collections.getByLibraryAndKey(
        tab.libraryID,
        tab.collectionKey,
      );
      if (!collection || !listFor(collection.id)) continue;
      try {
        openListTab(collection.id, win, { select: false });
        kept.push(tab);
      } catch (error) {
        report(error);
      }
    }
  } finally {
    recordFrozen = false;
  }
  writeRecord(kept);
}

export function closeListTabs(): void {
  // Before the tabs close, so closing them keeps their record for next time.
  freezeOpenTabs();
  unsubscribe?.();
  unsubscribe = null;
  for (const [tabID, view] of [...views]) {
    try {
      view.win.Zotero_Tabs.close(tabID);
    } catch (error) {
      report(error);
    }
  }
  views.clear();
}
