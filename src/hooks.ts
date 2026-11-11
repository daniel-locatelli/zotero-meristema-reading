import { config } from "../package.json";
import {
  registerListSection,
  unregisterListSection,
} from "./zotero/listSection";
import { clearLists } from "./zotero/listStore";
import {
  closeListTabs,
  freezeOpenTabs,
  installTabHooks,
  openListTab,
  reopenListTabs,
  startListTabs,
} from "./zotero/listTab";
import { registerMenus, unregisterMenus } from "./zotero/menus";
import { registerNotifier, unregisterNotifier } from "./zotero/notifier";
import { stopQueue } from "./zotero/queue";
import { report } from "./zotero/report";
import { resetStateStore, startStateStore } from "./zotero/stateStore";
import { registerStepColumn, unregisterStepColumn } from "./zotero/stepColumn";

const STYLESHEETS: Array<[id: string, file: string]> = [
  [`${config.addonRef}-stylesheet`, "reading.css"],
  [`${config.addonRef}-tab-icon-stylesheet`, "tabIcon.css"],
];

function installStyles(win: _ZoteroTypes.MainWindow): void {
  const doc = win.document;
  for (const [id, file] of STYLESHEETS) {
    if (doc.getElementById(id)) continue;
    const link = doc.createElementNS("http://www.w3.org/1999/xhtml", "link");
    link.id = id;
    link.setAttribute("rel", "stylesheet");
    link.setAttribute("href", `chrome://${config.addonRef}/content/${file}`);
    (doc.head ?? doc.documentElement).appendChild(link);
  }
}

function removeStyles(win: _ZoteroTypes.MainWindow): void {
  for (const [id] of STYLESHEETS) win.document.getElementById(id)?.remove();
}

/** Zotero quitting closes the list tabs; their record must stay for next time. */
const quitObserver = {
  observe: (): void => {
    try {
      freezeOpenTabs();
    } catch (error) {
      report(error);
    }
  },
};
let quitObserverInstalled = false;

async function onStartup(): Promise<void> {
  await Promise.all([
    Zotero.initializationPromise,
    Zotero.unlockPromise,
    Zotero.uiReadyPromise,
  ]);
  for (const win of Zotero.getMainWindows()) await onMainWindowLoad(win);
  if (!quitObserverInstalled) {
    Services.obs.addObserver(quitObserver, "quit-application-granted");
    quitObserverInstalled = true;
  }
  registerNotifier();
  // A failed first load leaves the store empty; the next state event or mark
  // reads the notes again, so the menus are offered either way.
  try {
    await startStateStore();
  } catch (error) {
    report(error);
  }
  // A column that fails to register leaves the menus and marking working.
  try {
    await registerStepColumn();
  } catch (error) {
    report(error);
  }
  // Likewise a section that fails to register.
  try {
    registerListSection((collectionID, win) => openListTab(collectionID, win));
    startListTabs();
  } catch (error) {
    report(error);
  }
  // The list tabs open when Zotero quit come back, behind the library tab.
  try {
    reopenListTabs();
  } catch (error) {
    report(error);
  }
  registerMenus();
  addon.data.initialized = true;
}

async function onMainWindowLoad(win: _ZoteroTypes.MainWindow): Promise<void> {
  win.MozXULElement.insertFTLIfNeeded(`${config.addonRef}-mainWindow.ftl`);
  installStyles(win);
  installTabHooks(win);
}

async function onMainWindowUnload(
  _win: _ZoteroTypes.MainWindow,
): Promise<void> {}

async function onShutdown(_appShutdown: boolean): Promise<void> {
  if (quitObserverInstalled) {
    Services.obs.removeObserver(quitObserver, "quit-application-granted");
    quitObserverInstalled = false;
  }
  closeListTabs();
  unregisterListSection();
  unregisterMenus();
  unregisterStepColumn();
  unregisterNotifier();
  for (const win of Zotero.getMainWindows()) removeStyles(win);
  delete (Zotero as any)[config.addonInstance];
  // Work already queued (a mark the reader just made) finishes first, so
  // resetting the store cannot make it write a second state note.
  void stopQueue()
    .then(() => {
      clearLists();
      resetStateStore();
    })
    .catch(report);
}

export default { onStartup, onMainWindowLoad, onMainWindowUnload, onShutdown };
