import { config } from "../package.json";
import hooks from "./hooks";
import { changesEmitted } from "./zotero/changes";
import { renderList, type ListViewOptions } from "./zotero/listView";
import { whenIdle } from "./zotero/notifier";
import { simulateSync } from "./zotero/stateStore";
import {
  stepCell,
  stepColumnKey,
  stepColumnRefreshes,
} from "./zotero/stepColumn";

/** What the Zotero suite reads: its bundle is a second copy of the plugin. */
export interface ReadingAPI {
  whenIdle(): Promise<void>;
  stepCell(itemID: number, collectionID: number): string;
  stepColumnKey(): string | null;
  /** How many times the Step column was drawn again. */
  columnRefreshes(): number;
  /** How many times the views were told the stores changed. */
  changesEmitted(): number;
  /** Stands in for a sync running (true or false), or the real one (null). */
  simulateSync(inProgress: boolean | null): void;
  /** Draws a list into `container`, as the section and the tab do. */
  renderList(
    container: HTMLElement,
    collectionID: number,
    options: ListViewOptions,
  ): void;
}

class Addon {
  public data: {
    alive: boolean;
    config: typeof config;
    env: "development" | "production";
    initialized: boolean;
  };

  public hooks: typeof hooks;
  public api: ReadingAPI;

  constructor() {
    this.data = { alive: true, config, env: __env__, initialized: false };
    this.hooks = hooks;
    this.api = Object.freeze({
      whenIdle,
      stepCell: (itemID: number, collectionID: number) => {
        const item = Zotero.Items.get(itemID) as Zotero.Item | false;
        return item ? stepCell(item.key, collectionID) : "";
      },
      stepColumnKey,
      columnRefreshes: stepColumnRefreshes,
      changesEmitted,
      simulateSync,
      renderList,
    });
  }
}

export default Addon;
