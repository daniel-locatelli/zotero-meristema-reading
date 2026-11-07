import { expect } from "chai";
import { config } from "../../package.json";
import { READ_STATE_TAG } from "../../src/format/readState";

/** The running plugin: the test bundle's own copy of `src/` never started. */
export function plugin(): any {
  return (Zotero as any)[config.addonInstance];
}

/** Settles once the plugin has read every event and finished its work. */
export function idle(): Promise<void> {
  return plugin().api.whenIdle();
}

export function delay(ms: number): Promise<void> {
  return Zotero.Promise.delay(ms) as unknown as Promise<void>;
}

export async function waitFor<T>(
  probe: () => T | null | undefined | false,
  timeoutMs: number,
): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = probe();
    if (value) return value;
    if (Date.now() > deadline) return null;
    await delay(50);
  }
}

export function shown(popup: Element): Promise<void> {
  return new Promise((resolve) => {
    if ((popup as any).state === "open") return resolve();
    popup.addEventListener("popupshown", () => resolve(), { once: true });
  });
}

/**
 * Fires a command at `element`; settles once a command event has reached it.
 * Gecko stops a menuitem's dispatched command in capture and fires it again,
 * trusted, after the popups close: only that second event runs the plugin's
 * `onCommand`, whose listener was added before this one.
 */
export function command(element: Element, timeoutMs = 10_000): Promise<void> {
  const win = element.ownerDocument?.defaultView as any;
  const reached = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new Error(
          `no command event reached ${element.getAttribute("data-l10n-id")} within ${timeoutMs} ms`,
        ),
      );
    }, timeoutMs);
    element.addEventListener(
      "command",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
  element.dispatchEvent(new win.Event("command", { bubbles: true }));
  return reached;
}

/** An element under `root` by l10n id; the failure lists what was there. */
export function byL10n(root: Element, l10nID: string): any {
  const found = root.querySelector(`[data-l10n-id="${l10nID}"]`);
  expect(
    found,
    `${l10nID}; found ${Array.from(root.querySelectorAll("[data-l10n-id]"))
      .map((node) => (node as Element).getAttribute("data-l10n-id"))
      .join(", ")}`,
  ).not.to.equal(null);
  return found;
}

export async function makePaper(
  title: string,
  doi?: string,
  collectionID?: number,
): Promise<Zotero.Item> {
  const item = new Zotero.Item("journalArticle");
  item.libraryID = Zotero.Libraries.userLibraryID;
  item.setField("title", title);
  if (doi) item.setField("DOI", doi);
  if (collectionID) item.setCollections([collectionID]);
  await item.saveTx();
  return item;
}

/** Every note carrying the state tag in My Library, trashed ones included. */
async function allStateNoteIDs(): Promise<number[]> {
  const tagID = Zotero.Tags.getID(READ_STATE_TAG);
  if (!tagID) return [];
  return Zotero.Tags.getTagItems(Zotero.Libraries.userLibraryID, tagID);
}

/** Every note carrying the state tag in My Library, trashed ones included. */
export async function allStateNotes(): Promise<Zotero.Item[]> {
  const items = await Zotero.Items.getAsync(await allStateNoteIDs());
  return items.filter(Boolean);
}

/** The state notes the plugin reads: standalone and not in the trash. */
export async function stateNotes(): Promise<Zotero.Item[]> {
  const items = await Zotero.Items.getAsync(await allStateNoteIDs());
  return items.filter(
    (item: Zotero.Item) =>
      item && item.isNote() && item.isTopLevelItem() && !item.deleted,
  );
}

export async function eraseStateNotes(): Promise<void> {
  const ids = await allStateNoteIDs();
  if (ids.length) await Zotero.Items.erase(ids);
}

/** Marks items through the item menu's Mark as submenu, as a reader would. */
export async function markThroughMenu(
  win: any,
  itemIDs: number[],
  state: "unread" | "reading" | "read",
): Promise<void> {
  await win.ZoteroPane.collectionsView.selectLibrary(
    Zotero.Libraries.userLibraryID,
  );
  await win.ZoteroPane.itemsView.selectItems(itemIDs, true);
  const menu = win.document.getElementById("zotero-itemmenu");
  // Plugin entries are built into the menu only by Zotero's own builder.
  await win.ZoteroPane.buildItemContextMenu();
  let showing = shown(menu);
  menu.openPopup(null, "after_start", 0, 0, true, false);
  await showing;
  const submenu = byL10n(menu, `${config.addonRef}-mark-submenu`);
  const popup = submenu.querySelector("menupopup");
  showing = shown(popup);
  submenu.openMenu(true);
  await showing;
  const reached = command(byL10n(popup, `${config.addonRef}-mark-${state}`));
  menu.hidePopup();
  await reached;
  await idle();
}

/** Opens the folder menu on a folder and returns the entry, if offered. */
export async function collectionMenuEntry(
  win: any,
  collectionID: number,
  l10nID: string,
): Promise<{ popup: any; entry: any }> {
  await win.ZoteroPane.collectionsView.selectCollection(collectionID);
  const popup = win.document.getElementById("zotero-collectionmenu");
  // A right-click runs this first, and it is what adds plugin entries.
  await win.ZoteroPane.buildCollectionContextMenu();
  const showing = shown(popup);
  popup.openPopup(null, "after_start", 0, 0, false, false);
  await showing;
  return { popup, entry: popup.querySelector(`[data-l10n-id="${l10nID}"]`) };
}

export interface Alert {
  title: string;
  text: string;
}

/**
 * Runs `body` with `Services.prompt` stubbed, so the plugin's
 * `Zotero.alert(...)` is recorded rather than opening a modal that would
 * block the suite. The stub stays until the plugin is idle, since a menu
 * command runs after `body` has returned.
 */
export async function withAlerts<T>(
  body: (alerts: Alert[]) => Promise<T>,
): Promise<T> {
  const alerts: Alert[] = [];
  const services = Services as any;
  const own = Object.getOwnPropertyDescriptor(services, "prompt");
  const stub = {
    alert(_win: unknown, title: string, text: string): void {
      alerts.push({ title, text });
    },
  };
  Object.defineProperty(services, "prompt", {
    configurable: true,
    value: stub,
  });
  try {
    // Zotero.alert reads Services in its own global: make sure it is this one.
    const theirs = (Cu as any).getGlobalForObject(Zotero.alert).Services;
    expect(
      theirs.prompt === stub,
      `Zotero.alert's Services is the stubbed one (same object: ${theirs === Services})`,
    ).to.equal(true);
    return await body(alerts);
  } finally {
    await idle();
    if (own) Object.defineProperty(services, "prompt", own);
    else delete services.prompt;
  }
}

/** Runs `body` with `Zotero.logError` recording what the plugin reports. */
export async function withLoggedErrors<T>(
  body: (errors: string[]) => Promise<T>,
): Promise<T> {
  const errors: string[] = [];
  const zotero = Zotero as any;
  const real = zotero.logError;
  zotero.logError = (error: unknown) => {
    errors.push(String((error as Error)?.message ?? error));
  };
  try {
    return await body(errors);
  } finally {
    await idle();
    zotero.logError = real;
  }
}
