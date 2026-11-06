import { config } from "../package.json";

async function onStartup(): Promise<void> {
  await Promise.all([
    Zotero.initializationPromise,
    Zotero.unlockPromise,
    Zotero.uiReadyPromise,
  ]);
  for (const win of Zotero.getMainWindows()) await onMainWindowLoad(win);
  addon.data.initialized = true;
}

async function onMainWindowLoad(win: _ZoteroTypes.MainWindow): Promise<void> {
  win.MozXULElement.insertFTLIfNeeded(`${config.addonRef}-mainWindow.ftl`);
}

async function onMainWindowUnload(
  _win: _ZoteroTypes.MainWindow,
): Promise<void> {}

async function onShutdown(_appShutdown: boolean): Promise<void> {
  addon.data.alive = false;
  delete (Zotero as any)[config.addonInstance];
}

export default { onStartup, onMainWindowLoad, onMainWindowUnload, onShutdown };
