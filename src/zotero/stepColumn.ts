import { config } from "../../package.json";
import { stepText } from "../domain/stepColumn";
import { listFor } from "./listStore";
import { report } from "./report";

let dataKey: string | null = null;

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
    dataProvider: (item: Zotero.Item) => {
      const collectionID =
        Zotero.getActiveZoteroPane()?.getSelectedCollection(true);
      return collectionID ? stepCell(item.key, collectionID) : "";
    },
    renderCell: (
      _index: number,
      data: string,
      column: { className: string },
      _isFirstColumn: boolean,
      document: Document,
    ) => {
      const cell = document.createElement("span");
      cell.className = `cell ${column.className}`;
      cell.textContent = stepText(data);
      return cell;
    },
  } as any);
  dataKey = typeof key === "string" ? key : null;
}

export function refreshStepColumn(): void {
  try {
    Zotero.ItemTreeManager.refreshColumns();
  } catch (error) {
    report(error);
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
