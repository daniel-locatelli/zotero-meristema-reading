import { config } from "../../package.json";
import { onChange } from "./changes";
import { listFor } from "./listStore";
import { libraryEditable, renderList } from "./listView";
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

/**
 * Where a section's header stood in its item pane, for the paper it is about
 * to show. Zotero scrolls an item pane to its top for every new item unless a
 * section is pinned, so a reader working down a list from this section would
 * lose it on every paper.
 */
const heldOffsets = new WeakMap<HTMLElement, { key: string; offset: number }>();

function paneOf(body: HTMLElement): {
  pane: HTMLElement;
  section: HTMLElement;
  pinned: boolean;
} | null {
  const section = body.closest(
    "item-pane-custom-section",
  ) as HTMLElement | null;
  const pane = section?.parentElement as HTMLElement | null | undefined;
  if (!section || !pane?.classList.contains("zotero-view-item")) return null;
  const details = pane.closest("item-details");
  return {
    pane,
    section,
    pinned: Boolean(details?.getAttribute("pinnedPane")),
  };
}

function offsetIn(pane: HTMLElement, section: HTMLElement): number {
  return section.getBoundingClientRect().top - pane.getBoundingClientRect().top;
}

/** Before the item changes: remember the header's place, if it is in view. */
function holdPlace(body: HTMLElement, item: Zotero.Item): void {
  heldOffsets.delete(body);
  const found = paneOf(body);
  // With a section pinned, Zotero scrolls to that one itself.
  if (!found || found.pinned || found.section.hidden) return;
  const offset = offsetIn(found.pane, found.section);
  if (offset < 0 || offset >= found.pane.clientHeight) return;
  heldOffsets.set(body, { key: item.key, offset });
}

/**
 * After the render: Zotero scrolls the pane to its top once every section has
 * drawn, in the same task, so the place is put back in a microtask behind it.
 */
function restorePlace(body: HTMLElement, item: Zotero.Item): void {
  const held = heldOffsets.get(body);
  heldOffsets.delete(body);
  if (!held || held.key !== item.key) return;
  void Promise.resolve().then(() => {
    const found = paneOf(body);
    if (!found || found.pinned) return;
    found.pane.scrollTop += offsetIn(found.pane, found.section) - held.offset;
  });
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
  openTab: (collectionID: number, win: _ZoteroTypes.MainWindow) => void,
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
      const enabled =
        tabType === "library" && listFolderOf(body, item) !== null;
      if (enabled) holdPlace(body, item);
      setEnabled(enabled);
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
      const collection = Zotero.Collections.get(collectionID);
      restorePlace(body, item);
      renderList(body, collectionID, {
        mode: "sidebar",
        currentKey: item.key,
        editable: Boolean(collection) && libraryEditable(collection.libraryID),
        onOpenTab: () => {
          const win = (body.ownerDocument?.defaultView ??
            Zotero.getMainWindow()) as _ZoteroTypes.MainWindow;
          openTab(collectionID, win);
        },
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
