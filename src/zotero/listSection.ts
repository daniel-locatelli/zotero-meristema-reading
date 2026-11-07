import { config } from "../../package.json";
import { onChange } from "./changes";
import { listFor } from "./listStore";
import { renderList } from "./listView";
import { report } from "./report";

const ICON = `chrome://${config.addonRef}/content/icons/reading.svg`;
let paneKey: string | false = false;
let unsubscribe: (() => void) | null = null;
const refreshers = new Map<HTMLElement, () => Promise<void>>();

/** The selected folder, when it holds a list and `item` is a paper in it. */
function listFolderOf(item: Zotero.Item | null): number | null {
  if (!item?.isRegularItem?.()) return null;
  const collectionID =
    Zotero.getActiveZoteroPane()?.getSelectedCollection(true);
  if (!collectionID) return null;
  const collection = Zotero.Collections.get(collectionID);
  if (!collection || !collection.hasItem(item.id)) return null;
  return listFor(collectionID) ? collectionID : null;
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
    }: {
      body: HTMLElement;
      refresh: () => Promise<void>;
    }) => {
      refreshers.set(body, refresh);
    },
    onDestroy: ({ body }: { body: HTMLElement }) => {
      refreshers.delete(body);
    },
    onItemChange: ({
      item,
      tabType,
      setEnabled,
    }: {
      item: Zotero.Item;
      tabType: string;
      setEnabled: (enabled: boolean) => void;
    }) => {
      setEnabled(tabType === "library" && listFolderOf(item) !== null);
    },
    onRender: ({ body, item }: { body: HTMLElement; item: Zotero.Item }) => {
      const collectionID = listFolderOf(item);
      if (collectionID === null) {
        body.replaceChildren();
        return;
      }
      renderList(body, collectionID, {
        mode: "sidebar",
        currentKey: item.key,
        onOpenTab: () => openTab(collectionID),
      });
    },
  } as any);
  unsubscribe = onChange(() => {
    for (const refresh of refreshers.values()) void refresh().catch(report);
  });
}

export function unregisterListSection(): void {
  unsubscribe?.();
  unsubscribe = null;
  refreshers.clear();
  if (!paneKey) return;
  try {
    Zotero.ItemPaneManager.unregisterSection(paneKey);
  } catch (error) {
    report(error);
  }
  paneKey = false;
}
