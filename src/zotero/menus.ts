import { config } from "../../package.json";
import type { ReadState } from "../format/readState";
import { report } from "./report";
import { markItems, UnreadableStateError } from "./stateStore";

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

function failed(error: unknown): void {
  if (error instanceof UnreadableStateError) {
    Zotero.alert(Zotero.getMainWindow(), "Meristema Reading", error.message);
    return;
  }
  report(error);
}

/** The items the Mark as submenu was opened on, read when its parent showed. */
let markTargets: Zotero.Item[] = [];

function markEntry(state: ReadState): MenuData {
  return {
    menuType: "menuitem",
    l10nID: `${config.addonRef}-mark-${state}`,
    onCommand: () => {
      void markItems(markTargets, state).catch(failed);
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

export function registerMenus(): void {
  if (registered.length) return;
  register({
    menuID: "meristema-reading-item-menu",
    pluginID: config.addonID,
    target: "main/library/item",
    menus: itemMenus(),
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
