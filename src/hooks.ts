import { config } from "../package.json";
import { clearLists } from "./zotero/listStore";
import { registerMenus, unregisterMenus } from "./zotero/menus";
import { registerNotifier, unregisterNotifier } from "./zotero/notifier";
import { report } from "./zotero/report";
import { resetStateStore, startStateStore } from "./zotero/stateStore";
import { registerStepColumn, unregisterStepColumn } from "./zotero/stepColumn";

async function onStartup(): Promise<void> {
  await Promise.all([
    Zotero.initializationPromise,
    Zotero.unlockPromise,
    Zotero.uiReadyPromise,
  ]);
  for (const win of Zotero.getMainWindows()) await onMainWindowLoad(win);
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
  registerMenus();
  addon.data.initialized = true;
}

async function onMainWindowLoad(win: _ZoteroTypes.MainWindow): Promise<void> {
  win.MozXULElement.insertFTLIfNeeded(`${config.addonRef}-mainWindow.ftl`);
}

async function onMainWindowUnload(
  _win: _ZoteroTypes.MainWindow,
): Promise<void> {}

async function onShutdown(_appShutdown: boolean): Promise<void> {
  unregisterMenus();
  unregisterStepColumn();
  clearLists();
  unregisterNotifier();
  resetStateStore();
  addon.data.alive = false;
  delete (Zotero as any)[config.addonInstance];
}

export default { onStartup, onMainWindowLoad, onMainWindowUnload, onShutdown };
