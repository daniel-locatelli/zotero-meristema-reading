import { config } from "../../package.json";
import { stepText } from "../domain/stepColumn";
import { listFor } from "./listStore";
import { report } from "./report";

let dataKey: string | null = null;
let refreshes = 0;
/** The pane whose item tree is being sorted again, while it is. */
let sortingPane: _ZoteroTypes.ZoteroPane | null = null;
/** The windows' sorts, one after another, so `sortingPane` names each in turn. */
let sorts: Promise<void> = Promise.resolve();

/** A paper's cell data in a folder's list; empty when the folder has none. */
export function stepCell(itemKey: string, collectionID: number): string {
  return listFor(collectionID)?.cells.get(itemKey) ?? "";
}

export function stepColumnKey(): string | null {
  return dataKey;
}

/** The Step column: a paper's step in the selected folder's reading list. */
export async function registerStepColumn(): Promise<void> {
  if (dataKey) return;
  const key = await Zotero.ItemTreeManager.registerColumn({
    dataKey: "step",
    label: "Step",
    pluginID: config.addonID,
    enabledTreeIDs: ["main"],
    width: "48",
    flex: 0,
    showInColumnPicker: true,
    zoteroPersist: ["width", "ordinal", "hidden", "sortDirection"],
    // Zotero passes the provider only the item and the column's key, not the
    // tree or its window. The data is what a sort compares, so it comes from
    // the pane being sorted again, else the active pane: the one whose column
    // header was clicked. The cell is drawn from its own window instead.
    dataProvider: (item: Zotero.Item) => {
      const pane = sortingPane ?? Zotero.getActiveZoteroPane();
      return cellIn(pane, item.key) ?? "";
    },
    renderCell: (
      index: number,
      data: string,
      column: { className: string },
      _isFirstColumn: boolean,
      document: Document,
    ) => {
      const pane = (document.defaultView as any)?.ZoteroPane as
        _ZoteroTypes.ZoteroPane | undefined;
      const item = (pane?.itemsView as any)?.getRow(index)?.ref as
        Zotero.Item | undefined;
      const cell = document.createElement("span");
      cell.className = `cell ${column.className}`;
      cell.textContent = stepText(
        (item?.key && cellIn(pane, item.key)) ?? data,
      );
      return cell;
    },
  } as any);
  dataKey = typeof key === "string" ? key : null;
}

/** A paper's cell data in the collection `pane` shows; null without a pane. */
function cellIn(
  pane: _ZoteroTypes.ZoteroPane | null | undefined,
  itemKey: string,
): string | null {
  if (!pane) return null;
  const collectionID = pane.getSelectedCollection(true);
  return collectionID ? stepCell(itemKey, collectionID) : "";
}

/**
 * Draws the column again. Zotero re-queries the item list and restores its
 * selection for this, so callers ask only when a cell changed. A list sorted
 * by Step is sorted again: the item tree's `sort()` keeps the selection.
 */
export function refreshStepColumn(): void {
  refreshes++;
  try {
    Zotero.ItemTreeManager.refreshColumns();
  } catch (error) {
    report(error);
  }
  for (const win of Zotero.getMainWindows()) {
    // One window's item tree failing, even before it is built, must not
    // skip the other windows or the caller's own redraws.
    try {
      const pane = (win as any).ZoteroPane as _ZoteroTypes.ZoteroPane;
      const view = pane?.itemsView as any;
      if (!dataKey || !view || view.getSortField?.() !== dataKey) continue;
      sorts = sorts
        .then(async () => {
          sortingPane = pane;
          try {
            await view.sort();
          } finally {
            sortingPane = null;
          }
        })
        .catch(report);
    } catch (error) {
      report(error);
    }
  }
}

export function unregisterStepColumn(): void {
  if (!dataKey) return;
  try {
    Zotero.ItemTreeManager.unregisterColumn(dataKey);
  } catch (error) {
    report(error);
  }
  dataKey = null;
}

/** How many times the column was drawn again, for the Zotero suite. */
export function stepColumnRefreshes(): number {
  return refreshes;
}
