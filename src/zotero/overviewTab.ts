import { config } from "../../package.json";
import { withoutTab, withTab } from "../domain/openTabs";
import { onChange } from "./changes";
import { openListTab } from "./listTab";
import { element } from "./listView";
import { readOverview } from "./overviewStore";
import { renderOverview } from "./overviewView";
import { openPluginTab, readRecord, writeRecord } from "./pluginTab";
import { report } from "./report";

export const OVERVIEW_TAB_TYPE = `${config.addonRef}-overview`;
/** One Overview per window, so its type is its id. */
const TAB_ID = OVERVIEW_TAB_TYPE;
/** The tab bar draws this as the plugin's logo (`addon/content/tabIcon.css`). */
const TAB_ICON = "meristema-reading-list";

interface OverviewView {
  body: HTMLElement;
  /** Bumped by each redraw; a read that finishes behind a newer one is dropped. */
  generation: number;
}

const views = new Map<_ZoteroTypes.MainWindow, OverviewView>();
let unsubscribe: (() => void) | null = null;

async function redraw(win: _ZoteroTypes.MainWindow): Promise<void> {
  const view = views.get(win);
  if (!view) return;
  const mine = ++view.generation;
  let data: Awaited<ReturnType<typeof readOverview>>;
  try {
    data = await readOverview();
  } catch (error) {
    // A later redraw started while this one read, or the tab closed: it draws instead.
    if (mine !== view.generation || views.get(win) !== view) return;
    drawFailure(view.body);
    throw error;
  }
  if (mine !== view.generation || views.get(win) !== view) return;
  renderOverview(view.body, data, {
    openList: (collectionID) => openListTab(collectionID, win),
  });
}

/** A read that threw leaves one line, not a blank tab; the caller reports the error. */
function drawFailure(body: HTMLElement): void {
  const doc = body.ownerDocument;
  if (!doc) return;
  body.replaceChildren(
    element(
      doc,
      "p",
      "mr-failure",
      "The Reading Overview could not be read. See the error console.",
    ),
  );
}

/**
 * Opens the Overview in `win`, or selects the one already open there. With
 * `select: false` the tab opens behind the selected one.
 */
export function openOverviewTab(
  win: _ZoteroTypes.MainWindow = Zotero.getMainWindow(),
  { select = true }: { select?: boolean } = {},
): void {
  const manager = win.Zotero_Tabs;
  if ((manager._tabs as any[]).some((tab) => tab.id === TAB_ID)) {
    if (select) manager.select(TAB_ID);
    return;
  }
  const body = openPluginTab(win, {
    id: TAB_ID,
    type: OVERVIEW_TAB_TYPE,
    title: "Reading Overview",
    icon: TAB_ICON,
    select,
    onClose: () => {
      views.delete(win);
      // Quitting or shutting down has frozen the record: this writes nothing.
      writeRecord(withoutTab(readRecord(), { kind: "overview" }));
    },
  });
  writeRecord(withTab(readRecord(), { kind: "overview" }));
  views.set(win, { body, generation: 0 });
  void redraw(win).catch(report);
}

/**
 * Reopens the recorded Overview behind the selected tab. Says whether it is
 * kept: false when opening it threw.
 */
export function reopenOverviewTab(win: _ZoteroTypes.MainWindow): boolean {
  try {
    openOverviewTab(win, { select: false });
    return true;
  } catch (error) {
    report(error);
    return false;
  }
}

export function startOverviewTabs(): void {
  if (unsubscribe) return;
  unsubscribe = onChange(() => {
    for (const win of views.keys()) void redraw(win).catch(report);
  });
}

/** Closes every Overview; the list tabs' shutdown has frozen the record first. */
export function closeOverviewTabs(): void {
  unsubscribe?.();
  unsubscribe = null;
  for (const win of [...views.keys()]) {
    try {
      win.Zotero_Tabs.close(TAB_ID);
    } catch (error) {
      report(error);
    }
  }
  views.clear();
}
