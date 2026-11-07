import { config } from "../../package.json";
import { onChange } from "./changes";
import { listFor } from "./listStore";
import { renderList } from "./listView";
import { report } from "./report";

const ICON = `chrome://${config.addonRef}/content/icons/reading.svg`;
let paneKey: string | false = false;
let unsubscribe: (() => void) | null = null;

/** What a drawn section needs to decide again, after a store change, whether it shows. */
interface SectionState {
  refresh: () => Promise<void>;
  setEnabled: (enabled: boolean) => void;
  item: Zotero.Item | null;
  tabType: string;
}
const sections = new Map<HTMLElement, SectionState>();

/**
 * The selected folder in the section's own window, when it holds a list and
 * `item` is a paper in it.
 */
function listFolderOf(
  body: HTMLElement,
  item: Zotero.Item | null,
): number | null {
  if (!item?.isRegularItem?.()) return null;
  const pane = (body.ownerDocument?.defaultView as any)?.ZoteroPane as
    _ZoteroTypes.ZoteroPane | undefined;
  const collectionID = (
    pane ?? Zotero.getActiveZoteroPane()
  )?.getSelectedCollection(true);
  if (!collectionID) return null;
  const collection = Zotero.Collections.get(collectionID);
  if (!collection || !collection.hasItem(item.id)) return null;
  return listFor(collectionID) ? collectionID : null;
}

function shows(body: HTMLElement, state: SectionState): boolean {
  return state.tabType === "library" && listFolderOf(body, state.item) !== null;
}

/**
 * Zotero's `refresh()` re-runs only the render hook, and not at all while the
 * section is hidden, so a list made or removed for the paper on show would
 * leave the section as it was until the next selection. Each store change
 * decides again, for every drawn section, whether it shows, then redraws it.
 */
function onStoresChanged(): void {
  for (const [body, state] of sections) {
    const enabled = shows(body, state);
    state.setEnabled(enabled);
    if (enabled) void state.refresh().catch(report);
  }
}

export function registerListSection(
  openTab: (collectionID: number) => void,
): void {
  if (paneKey) return;
  paneKey = Zotero.ItemPaneManager.registerSection({
    paneID: "reading-list",
    pluginID: config.addonID,
    header: { l10nID: `${config.addonRef}-section-header`, icon: ICON },
    sidenav: { l10nID: `${config.addonRef}-section-sidenav`, icon: ICON },
    onInit: ({
      body,
      refresh,
      setEnabled,
      item,
      tabType,
    }: {
      body: HTMLElement;
      refresh: () => Promise<void>;
      setEnabled: (enabled: boolean) => void;
      item: Zotero.Item | null;
      tabType: string;
    }) => {
      sections.set(body, { refresh, setEnabled, item, tabType });
    },
    onDestroy: ({ body }: { body: HTMLElement }) => {
      sections.delete(body);
    },
    onItemChange: ({
      body,
      item,
      tabType,
      setEnabled,
    }: {
      body: HTMLElement;
      item: Zotero.Item;
      tabType: string;
      setEnabled: (enabled: boolean) => void;
    }) => {
      const state = sections.get(body);
      if (state) {
        state.item = item;
        state.tabType = tabType;
      }
      setEnabled(tabType === "library" && listFolderOf(body, item) !== null);
    },
    onRender: ({
      body,
      item,
      setEnabled,
    }: {
      body: HTMLElement;
      item: Zotero.Item;
      setEnabled: (enabled: boolean) => void;
    }) => {
      const collectionID = listFolderOf(body, item);
      if (collectionID === null) {
        body.replaceChildren();
        setEnabled(false);
        return;
      }
      renderList(body, collectionID, {
        mode: "sidebar",
        currentKey: item.key,
        onOpenTab: () => openTab(collectionID),
      });
    },
  } as any);
  unsubscribe = onChange(onStoresChanged);
}

export function unregisterListSection(): void {
  unsubscribe?.();
  unsubscribe = null;
  sections.clear();
  if (!paneKey) return;
  try {
    Zotero.ItemPaneManager.unregisterSection(paneKey);
  } catch (error) {
    report(error);
  }
  paneKey = false;
}
