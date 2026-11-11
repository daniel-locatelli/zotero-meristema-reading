import { config } from "../../package.json";
import { labelStyleOf, type LabelStyle } from "../domain/listNotes";
import { emitChange } from "./changes";

const PAPER_LABEL_PREF = `${config.prefsPrefix}.paperLabel`;

let observerID: symbol | null = null;

/** How the views label papers, as the settings pane last stored it. */
export function currentStyle(): LabelStyle {
  return labelStyleOf(Zotero.Prefs.get(PAPER_LABEL_PREF, true));
}

/**
 * Adds Meristema Reading's settings pane, and redraws the open views when the
 * reader picks another paper label. Zotero drops the pane with the plugin.
 */
export async function registerPreferences(): Promise<void> {
  if (!observerID) {
    observerID = Zotero.Prefs.registerObserver(
      PAPER_LABEL_PREF,
      () => emitChange(),
      true,
    );
  }
  await Zotero.PreferencePanes.register({
    pluginID: config.addonID,
    id: `${config.addonRef}-preferences`,
    src: rootURI + "content/preferences.xhtml",
    label: "Meristema Reading",
    image: `chrome://${config.addonRef}/content/icons/reading.svg`,
  });
}

export function unregisterPreferences(): void {
  if (observerID) Zotero.Prefs.unregisterObserver(observerID);
  observerID = null;
}
