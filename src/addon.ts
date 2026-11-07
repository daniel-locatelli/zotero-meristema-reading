import { config } from "../package.json";
import hooks from "./hooks";
import { whenIdle } from "./zotero/notifier";

/** What the Zotero suite reads: its bundle is a second copy of the plugin. */
export interface ReadingAPI {
  whenIdle(): Promise<void>;
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
    this.api = Object.freeze({ whenIdle });
  }
}

export default Addon;
