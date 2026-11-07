import { config } from "../../package.json";
import { onChange } from "./changes";
import { listFor } from "./listStore";
import { libraryEditable, renderList } from "./listView";
import { report } from "./report";

const TAB_TYPE = `${config.addonRef}-list`;
const HOOK_MARKER = "__meristemaReadingTabHooks";
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
 * Keeps list tabs out of Zotero's saved session: a restored tab would come
 * back with no view, so the reader reopens it from the folder instead.
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

/** Opens a folder's list as a tab, or selects the tab already showing it. */
export function openListTab(
  collectionID: number,
  win: _ZoteroTypes.MainWindow = Zotero.getMainWindow(),
): void {
  const manager = win.Zotero_Tabs;
  const tabID = `${TAB_TYPE}-${collectionID}`;
  if ((manager._tabs as any[]).some((tab) => tab.id === tabID)) {
    manager.select(tabID);
    return;
  }
  if (!listFor(collectionID)) return;
  const { container } = manager.add({
    id: tabID,
    type: TAB_TYPE,
    title: titleOf(collectionID),
    data: { collectionID },
    select: true,
    onClose: () => {
      views.delete(tabID);
    },
  });
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

export function closeListTabs(): void {
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
