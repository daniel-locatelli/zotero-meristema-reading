import { cancelChange, emitChange, isChangePending } from "./changes";
import { reconcileLists } from "./listStore";
import { isBusy } from "./queue";
import { report } from "./report";
import {
  itemsChanged,
  listsChanged,
  stateChanged,
  syncFinished,
} from "./stateStore";
import { refreshStepColumn } from "./stepColumn";

const FLUSH_DELAY_MS = 50;
let observerID: string | null = null;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let stateDirty = false;
let listsDirty = false;
/** A folder's papers or list note changed since the last flush. */
let membersDirty = false;
let syncDone = false;
const touched = new Set<number>();
/** Folders an event named, read again even when no view was told of them. */
const touchedFolders = new Set<number>();

/** The item an event names; `item-tag` ids read "itemID-tagID". */
function itemIDOf(type: string, id: number | string): number {
  return type === "item-tag" ? Number(String(id).split("-")[0]) : Number(id);
}

function notify(
  event: string,
  type: string,
  ids: Array<number | string>,
): void {
  if (type === "sync") {
    if (event !== "finish") return;
    syncDone = true;
  } else {
    // Any library event can change a folder's list: a paper renamed, filed,
    // trashed or merged, or a note edited.
    listsDirty = true;
  }
  if (type === "collection") {
    for (const raw of ids) touchedFolders.add(Number(raw));
  }
  // `collection-item` ids read "collectionID-itemID".
  if (type === "collection-item") {
    for (const raw of ids)
      touchedFolders.add(Number(String(raw).split("-")[0]));
  }
  if (type === "item" || type === "item-tag") {
    for (const raw of ids) {
      const item = Zotero.Items.get(itemIDOf(type, raw)) as Zotero.Item | false;
      // A deleted item can no longer say what it was: it may have been a state note.
      if (!item || item.isNote()) stateDirty = true;
      else if (item.isRegularItem()) touched.add(item.id);
      // A note may be, or have been, a folder's list.
      if (item && item.isNote() && item.isTopLevelItem()) {
        for (const id of item.getCollections()) touchedFolders.add(id);
      }
    }
  }
  if (!flushTimer) flushTimer = setTimeout(flush, FLUSH_DELAY_MS);
}

function flush(): void {
  flushTimer = null;
  if (listsDirty) {
    listsDirty = false;
    const folders = [...touchedFolders];
    touchedFolders.clear();
    // A folder's papers or list note changed: who is listed, and so tagged
    // `_unread`, may have too. Checked after the state note is read again;
    // only papers that joined or left a list are mirrored.
    membersDirty = folders.length > 0;
    try {
      // Zotero's column refresh re-queries the item list and restores its
      // selection, and a redraw cancels a drag: each only when needed.
      const changes = reconcileLists(folders);
      if (changes.cells) refreshStepColumn();
      if (changes.lists) emitChange();
    } catch (error) {
      report(error);
    }
  }
  if (stateDirty) {
    stateDirty = false;
    void stateChanged().catch(report);
  }
  if (membersDirty) {
    membersDirty = false;
    void listsChanged().catch(report);
  }
  if (touched.size) {
    const ids = [...touched];
    touched.clear();
    void itemsChanged(ids).catch(report);
  }
  if (syncDone) {
    syncDone = false;
    void syncFinished().catch(report);
  }
}

export function registerNotifier(): void {
  if (observerID) return;
  observerID = Zotero.Notifier.registerObserver(
    { notify } as any,
    ["item", "item-tag", "collection", "collection-item", "sync"],
    "meristema-reading",
  );
}

export function unregisterNotifier(): void {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = null;
  stateDirty = false;
  listsDirty = false;
  membersDirty = false;
  syncDone = false;
  touched.clear();
  touchedFolders.clear();
  cancelChange();
  if (observerID) Zotero.Notifier.unregisterObserver(observerID);
  observerID = null;
}

/**
 * Settles once no event waits to be read, no store work runs and the views
 * have been told of the last change.
 */
export async function whenIdle(): Promise<void> {
  while (flushTimer !== null || isBusy() || isChangePending()) {
    await Zotero.Promise.delay(20);
  }
}
