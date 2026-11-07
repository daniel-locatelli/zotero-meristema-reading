import { config } from "../package.json";
import hooks from "./hooks";
import { whenIdle } from "./zotero/notifier";
import { stepCell, stepColumnKey } from "./zotero/stepColumn";

/** What the Zotero suite reads: its bundle is a second copy of the plugin. */
export interface ReadingAPI {
  whenIdle(): Promise<void>;
  stepCell(itemID: number, collectionID: number): string;
  stepColumnKey(): string | null;
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
    });
  }
}

export default Addon;
