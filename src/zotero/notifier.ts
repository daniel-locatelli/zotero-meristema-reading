import { emitChange } from "./changes";
import { clearLists } from "./listStore";
import { isBusy } from "./queue";
import { report } from "./report";
import { itemsChanged, stateChanged } from "./stateStore";
import { refreshStepColumn } from "./stepColumn";

const FLUSH_DELAY_MS = 50;
let observerID: string | null = null;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let stateDirty = false;
let listsDirty = false;
const touched = new Set<number>();

/** The item an event names; `item-tag` ids read "itemID-tagID". */
function itemIDOf(type: string, id: number | string): number {
  return type === "item-tag" ? Number(String(id).split("-")[0]) : Number(id);
}

function notify(
  _event: string,
  type: string,
  ids: Array<number | string>,
): void {
  // Any library event can change a folder's list: a paper renamed, filed,
  // trashed or merged, or a note edited.
  listsDirty = true;
  if (type === "item" || type === "item-tag") {
    for (const raw of ids) {
      const item = Zotero.Items.get(itemIDOf(type, raw)) as Zotero.Item | false;
      // A deleted item can no longer say what it was: it may have been a state note.
      if (!item || item.isNote()) stateDirty = true;
      else if (item.isRegularItem()) touched.add(item.id);
    }
  }
  if (!flushTimer) flushTimer = setTimeout(flush, FLUSH_DELAY_MS);
}

function flush(): void {
  flushTimer = null;
  if (listsDirty) {
    listsDirty = false;
    clearLists();
    refreshStepColumn();
    emitChange();
  }
  if (stateDirty) {
    stateDirty = false;
    void stateChanged().catch(report);
  }
  if (touched.size) {
    const ids = [...touched];
    touched.clear();
    void itemsChanged(ids).catch(report);
  }
}

export function registerNotifier(): void {
  if (observerID) return;
  observerID = Zotero.Notifier.registerObserver(
    { notify } as any,
    ["item", "item-tag", "collection", "collection-item"],
    "meristema-reading",
  );
}

export function unregisterNotifier(): void {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = null;
  stateDirty = false;
  listsDirty = false;
  touched.clear();
  if (observerID) Zotero.Notifier.unregisterObserver(observerID);
  observerID = null;
}

/** Settles once no event waits to be read and no store work runs. */
export async function whenIdle(): Promise<void> {
  while (flushTimer !== null || isBusy()) await Zotero.Promise.delay(20);
}
