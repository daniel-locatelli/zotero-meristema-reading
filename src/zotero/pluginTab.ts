import { config } from "../../package.json";
import { parseOpenTabs, type OpenTab } from "../domain/openTabs";

const HOOK_MARKER = "__meristemaReadingTabHooks";
const OPEN_TABS_PREF = `${config.prefsPrefix}.openTabs`;
/**
 * While frozen, opening and closing tabs leaves the open-tab record alone:
 * Zotero quitting or the plugin shutting down closes every tab, and the
 * record must outlive that.
 */
let recordFrozen = false;

export function readRecord(): OpenTab[] {
  return parseOpenTabs(String(Zotero.Prefs.get(OPEN_TABS_PREF, true) ?? ""));
}

export function writeRecord(list: OpenTab[]): void {
  if (recordFrozen) return;
  Zotero.Prefs.set(OPEN_TABS_PREF, JSON.stringify(list), true);
}

/** Stops the open-tab record changing until the plugin starts again. */
export function freezeOpenTabs(): void {
  recordFrozen = true;
}

/** Runs `reopen` with the record frozen, then writes back what it kept. */
export function reopenRecorded(reopen: (tabs: OpenTab[]) => OpenTab[]): void {
  let kept: OpenTab[];
  recordFrozen = true;
  try {
    kept = reopen(readRecord());
  } finally {
    recordFrozen = false;
  }
  writeRecord(kept);
}

/**
 * Keeps plugin tabs out of Zotero's saved session: a restored tab would come
 * back with no view, so the plugin keeps its own record of them and reopens
 * them itself (`reopenRecorded`).
 */
export function installTabHooks(
  win: _ZoteroTypes.MainWindow,
  types: readonly string[],
): void {
  const manager = win.Zotero_Tabs;
  if (!manager || manager[HOOK_MARKER]) return;
  const getState = manager.getState.bind(manager);
  manager.getState = (): any[] =>
    getState().filter(
      (tab: any) =>
        !types.includes(String(tab?.type ?? "").replace(/-unloaded$/, "")),
    );
  manager[HOOK_MARKER] = true;
}

/**
 * Shuts Zotero's context pane over a plugin tab. Zotero opens it only for
 * reader and note tabs, but its layout pass still shows the splitter over any
 * other tab, and a pane left open by a reader tab stays open (as Meristema's
 * graph tab found).
 */
const SPLITTER_IDS = [
  "zotero-context-splitter",
  "zotero-context-splitter-stacked",
];

function hideContextPane(
  win: _ZoteroTypes.MainWindow,
  container: HTMLElement,
): void {
  const controller = (win as any).ZoteroContextPane;
  controller?.splitter?.setAttribute?.("hidden", "true");
  for (const id of SPLITTER_IDS) {
    win.document.getElementById(id)?.setAttribute("hidden", "true");
  }
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

/** Opens a plugin tab with the shell every plugin tab shares; returns the body to draw into. */
export function openPluginTab(
  win: _ZoteroTypes.MainWindow,
  spec: {
    id: string;
    type: string;
    title: string;
    icon: string;
    data?: Record<string, unknown>;
    select: boolean;
    onClose: () => void;
  },
): HTMLElement {
  const manager = win.Zotero_Tabs;
  const tabID = spec.id;
  let splitterWatch: MutationObserver | null = null;
  const { container } = manager.add({
    id: tabID,
    type: spec.type,
    title: spec.title,
    data: { ...spec.data, icon: spec.icon },
    select: spec.select,
    onClose: () => {
      splitterWatch?.disconnect();
      spec.onClose();
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
  // Zotero lays the context pane out again on a window resize, and when its
  // tab-select notifier reaches the pane after the tab's own selection event;
  // either shows the splitter over any tab but the library's. It is hidden
  // again whenever that happens over this tab.
  splitterWatch = new win.MutationObserver(() => {
    if (manager.selectedID !== tabID) return;
    const shown = SPLITTER_IDS.some(
      (id) =>
        win.document.getElementById(id)?.getAttribute("hidden") !== "true",
    );
    if (shown) hideContextPane(win, container);
  });
  for (const id of SPLITTER_IDS) {
    const splitter = win.document.getElementById(id);
    if (splitter) {
      splitterWatch!.observe(splitter, {
        attributes: true,
        attributeFilter: ["hidden"],
      });
    }
  }
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
  return body;
}
