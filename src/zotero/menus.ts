import { config } from "../../package.json";
import type { ReadState } from "../format/readState";
import { failedWith } from "./alerts";
import { listFor, makeReadingList } from "./listStore";
import { openListTab } from "./listTab";
import { report } from "./report";
import { markItems } from "./stateStore";

const ICON = `chrome://${config.addonRef}/content/icons/reading.svg`;
const registered: string[] = [];
type MenuData = Record<string, unknown>;

function register(definition: MenuData): void {
  const id = Zotero.MenuManager.registerMenu(definition);
  if (id) registered.push(id);
}

function contextValue(context: any, key: string): any {
  try {
    return context?.[key];
  } catch {
    return null;
  }
}

/** The regular, untrashed items the user right-clicked. */
function contextRegularItems(context: any): Zotero.Item[] {
  const items = contextValue(context, "items");
  if (!Array.isArray(items)) return [];
  return items.filter(
    (item: Zotero.Item) => item?.isRegularItem?.() && !item.deleted,
  );
}

/** The items the Mark as submenu was opened on, read when its parent showed. */
let markTargets: Zotero.Item[] = [];

function markEntry(state: ReadState): MenuData {
  return {
    menuType: "menuitem",
    l10nID: `${config.addonRef}-mark-${state}`,
    onCommand: () => {
      void markItems(markTargets, state).catch(
        failedWith(
          "Meristema Reading could not mark the papers. See the error console.",
        ),
      );
    },
  };
}

function itemMenus(): MenuData[] {
  return [
    {
      menuType: "submenu",
      l10nID: `${config.addonRef}-mark-submenu`,
      icon: ICON,
      onShowing: (_event: Event, context: any) => {
        markTargets = contextRegularItems(context);
        const available = markTargets.length > 0;
        context.setVisible(available);
        context.setEnabled(available);
      },
      menus: (["unread", "reading", "read"] as const).map(markEntry),
    },
  ];
}

/** The one folder the user right-clicked, or null for anything else. */
function contextCollectionID(context: any): number | null {
  const rows = contextValue(context, "collectionTreeRows");
  const selected = Array.isArray(rows)
    ? rows
    : [contextValue(context, "collectionTreeRow")];
  if (selected.length !== 1 || selected[0]?.isCollection?.() !== true) {
    return null;
  }
  const id = Number(contextValue(selected[0], "ref")?.id);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function canMakeList(collectionID: number): boolean {
  const collection = Zotero.Collections.get(collectionID);
  if (!collection) return false;
  const library = Zotero.Libraries.get(collection.libraryID) as any;
  return Boolean(library?.editable) && !listFor(collectionID);
}

/** The item list's order, when it shows this folder. */
function shownKeys(collectionID: number): string[] | null {
  const pane = Zotero.getActiveZoteroPane();
  if (pane?.getSelectedCollection(true) !== collectionID) return null;
  return (pane.getSortedItems() as Zotero.Item[]).map((item) => item.key);
}

function collectionMenus(): MenuData[] {
  return [
    {
      menuType: "menuitem",
      l10nID: `${config.addonRef}-make-reading-list`,
      icon: ICON,
      onShowing: (_event: Event, context: any) => {
        const id = contextCollectionID(context);
        const available = id !== null && canMakeList(id);
        context.setVisible(available);
        context.setEnabled(available);
      },
      onCommand: (_event: Event, context: any) => {
        const id = contextCollectionID(context);
        if (id === null) return;
        void makeReadingList(id, shownKeys(id)).catch(
          failedWith(
            "Meristema Reading could not make the reading list. See the error console.",
          ),
        );
      },
    },
    {
      menuType: "menuitem",
      l10nID: `${config.addonRef}-open-reading-list`,
      icon: ICON,
      onShowing: (_event: Event, context: any) => {
        const id = contextCollectionID(context);
        const available = id !== null && listFor(id) !== null;
        context.setVisible(available);
        context.setEnabled(available);
      },
      onCommand: (_event: Event, context: any) => {
        const id = contextCollectionID(context);
        if (id !== null) openListTab(id);
      },
    },
  ];
}

export function registerMenus(): void {
  if (registered.length) return;
  register({
    menuID: "meristema-reading-item-menu",
    pluginID: config.addonID,
    target: "main/library/item",
    menus: itemMenus(),
  });
  register({
    menuID: "meristema-reading-collection-menu",
    pluginID: config.addonID,
    target: "main/library/collection",
    menus: collectionMenus(),
  });
}

export function unregisterMenus(): void {
  for (const id of registered.splice(0)) {
    try {
      Zotero.MenuManager.unregisterMenu(id);
    } catch (error) {
      report(error);
    }
  }
}
