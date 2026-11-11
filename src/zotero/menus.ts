import { config } from "../../package.json";
import type { ReadState } from "../format/readState";
import { failedWith } from "./alerts";
import { editList, listFor, makeReadingList } from "./listStore";
import { openListTab } from "./listTab";
import { libraryEditable } from "./listView";
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

/** The main window a menu was opened in. */
function contextWindow(context: any): _ZoteroTypes.MainWindow {
  const menu = contextValue(context, "menuElem") as Element | undefined;
  return (menu?.ownerDocument?.defaultView ??
    Zotero.getMainWindow()) as _ZoteroTypes.MainWindow;
}

/** The regular, untrashed items the user right-clicked. */
function contextRegularItems(context: any): Zotero.Item[] {
  const items = contextValue(context, "items");
  if (!Array.isArray(items)) return [];
  return items.filter(
    (item: Zotero.Item) => item?.isRegularItem?.() && !item.deleted,
  );
}

/**
 * A Mark as entry. Zotero hands the submenu's entries the context the item
 * menu was built with, so the command reads the right-clicked items from it.
 */
function markEntry(state: ReadState): MenuData {
  return {
    menuType: "menuitem",
    l10nID: `${config.addonRef}-mark-${state}`,
    onCommand: (_event: Event, context: any) => {
      void markItems(contextRegularItems(context), state).catch(
        failedWith(
          "Meristema Reading could not mark the papers. See the error console.",
          contextWindow(context),
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
        const available = contextRegularItems(context).length > 0;
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
  return libraryEditable(collection.libraryID) && !listFor(collectionID);
}

/** The item list's order, when the menu's window shows this folder. */
function shownKeys(
  collectionID: number,
  win: _ZoteroTypes.MainWindow,
): string[] | null {
  const pane = win.ZoteroPane;
  if (pane?.getSelectedCollection(true) !== collectionID) return null;
  return (pane.getSortedItems() as Zotero.Item[]).map((item) => item.key);
}

/** The steps the folder's list has, when it can be read in an editable library. */
function clearableSteps(collectionID: number): number | null {
  const collection = Zotero.Collections.get(collectionID);
  const list = listFor(collectionID);
  if (!collection || !list?.resolved) return null;
  if (!libraryEditable(collection.libraryID)) return null;
  return list.resolved.steps.length;
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
        const win = contextWindow(context);
        void makeReadingList(id, shownKeys(id, win)).catch(
          failedWith(
            "Meristema Reading could not make the reading list. See the error console.",
            win,
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
        if (id !== null) openListTab(id, contextWindow(context));
      },
    },
    {
      menuType: "menuitem",
      l10nID: `${config.addonRef}-clear-reading-list`,
      icon: ICON,
      onShowing: (_event: Event, context: any) => {
        const id = contextCollectionID(context);
        const available = id !== null && clearableSteps(id) !== null;
        context.setVisible(available);
        context.setEnabled(available);
      },
      onCommand: (_event: Event, context: any) => {
        const id = contextCollectionID(context);
        if (id === null) return;
        const count = clearableSteps(id);
        if (!count) return;
        const win = contextWindow(context);
        const topic = listFor(id)?.doc?.topic ?? "";
        const ok =
          Services.prompt.confirmEx(
            win as any,
            "Clear Reading List",
            `Clear the steps of “${topic}”? Its ${count} papers stay in the folder, under Not in the steps, and keep their read states. This cannot be undone.`,
            Services.prompt.STD_OK_CANCEL_BUTTONS as number,
            null as any,
            null as any,
            null as any,
            null as any,
            { value: false },
          ) === 0;
        if (ok) {
          void editList(id, () => []).catch(
            failedWith(
              "Meristema Reading could not clear the reading list. See the error console.",
              win,
            ),
          );
        }
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
