import { nextState } from "../domain/listEdits";
import { paperLabel } from "../domain/listNotes";
import { progressText, type OverviewList } from "../domain/overview";
import { READING_QUEUE_TAG } from "../format/readingQueue";
import { failedWith } from "./alerts";
import { listFor, partsOf } from "./listStore";
import { element, showInLibrary, STATE_LABEL } from "./listView";
import type { OverviewData } from "./overviewStore";
import { currentStyle } from "./preferences";
import { report } from "./report";
import { markItems, stateOfItem } from "./stateStore";

export interface OverviewActions {
  openList(collectionID: number): void;
}

/** A folder's name, after its library's for a group's list. */
function folderText(list: OverviewList): string {
  return list.libraryName === null
    ? list.folderName
    : `${list.libraryName} › ${list.folderName}`;
}

/** Draws the Overview into `container`: the queue on top, every other list below. */
export function renderOverview(
  container: HTMLElement,
  data: OverviewData,
  actions: OverviewActions,
): void {
  const owner = container.ownerDocument;
  if (!owner) return;
  const doc: Document = owner;
  const failed = failedWith(
    "Meristema Reading could not mark the paper. See the error console.",
    doc.defaultView,
  );
  const style = currentStyle();
  const { queue, duplicates, rows } = data.overview;
  container.replaceChildren();
  container.classList.add("mr-list", "mr-tab", "mr-overview");

  const itemIn = (list: OverviewList, key: string): Zotero.Item | false => {
    const collection = Zotero.Collections.get(list.collectionID);
    return collection
      ? Zotero.Items.getByLibraryAndKey(collection.libraryID, key)
      : false;
  };
  const labelOf = (list: OverviewList, key: string): string => {
    const item = itemIn(list, key);
    return item ? paperLabel(partsOf(item), style) : key;
  };

  /** A step's state toggle and title, as the list tab draws them. */
  function paperParts(row: HTMLElement, list: OverviewList, key: string): void {
    const item = itemIn(list, key);
    const state = item ? stateOfItem(item) : "unread";
    const toggle = element(doc, "button", "mr-state", STATE_LABEL[state]);
    toggle.dataset.state = state;
    toggle.title = `Mark ${STATE_LABEL[nextState(state)]}`;
    toggle.addEventListener("click", (event) => {
      event.stopPropagation();
      if (item) void markItems([item], nextState(state)).catch(failed);
    });
    const title = element(doc, "span", "mr-title", labelOf(list, key));
    title.addEventListener("click", () => {
      if (item) {
        void showInLibrary(doc, list.collectionID, item.id).catch(report);
      }
    });
    row.dataset.key = key;
    row.append(toggle, title);
  }

  function openButton(className: string, text: string, collectionID: number) {
    const button = element(doc, "button", className, text);
    button.dataset.collectionId = String(collectionID);
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      actions.openList(collectionID);
    });
    return button;
  }

  const section = element(doc, "section", "mr-queue");
  section.append(element(doc, "h2", "mr-overview-heading", "Reading queue"));
  for (const duplicate of duplicates) {
    section.append(
      element(
        doc,
        "p",
        "mr-queue-duplicate",
        `Also tagged as the queue: “${duplicate.topic}” (${duplicate.folderName}). Remove its ${READING_QUEUE_TAG} tag to keep one queue.`,
      ),
    );
  }
  switch (queue.status) {
    case "none":
      section.append(
        element(doc, "p", "mr-queue-none", "No reading queue yet."),
        element(
          doc,
          "p",
          "mr-queue-hint",
          "Ask Claude to write one with zot.py reading-list --queue.",
        ),
      );
      break;
    case "unreadable":
      section.append(
        element(
          doc,
          "p",
          "mr-failure",
          "The reading queue cannot be read. Meristema Reading leaves it as it is.",
        ),
      );
      break;
    case "empty":
      section.append(
        element(doc, "p", "mr-queue-empty", "The queue is empty."),
      );
      break;
    case "all-read":
      section.append(element(doc, "p", "mr-queue-done", "All read."));
      break;
    case "ok": {
      const next = element(doc, "div", "mr-queue-next");
      paperParts(next, queue.list, queue.nextUp);
      const why = listFor(queue.list.collectionID)?.resolved?.steps.find(
        (step) => step.key === queue.nextUp,
      )?.why;
      if (why) next.append(element(doc, "p", "mr-why", why));
      const sources = data.sources.get(queue.nextUp) ?? [];
      if (sources.length) {
        const from = element(doc, "div", "mr-sources");
        from.append(element(doc, "span", "mr-sources-label", "From"));
        for (const source of sources) {
          from.append(
            openButton("mr-source", source.topic, source.collectionID),
          );
        }
        next.append(from);
      }
      section.append(next);
      const after = element(doc, "ol", "mr-queue-after");
      for (const key of queue.after) {
        const step = element(doc, "li", "mr-queue-step");
        paperParts(step, queue.list, key);
        after.append(step);
      }
      section.append(after);
      break;
    }
  }
  if (queue.status !== "none") {
    section.append(
      openButton("mr-open-queue", "Open queue", queue.list.collectionID),
    );
  }
  container.append(section);

  container.append(element(doc, "h2", "mr-overview-heading", "Lists"));
  if (!rows.length && queue.status === "none") {
    container.append(
      element(
        doc,
        "p",
        "mr-empty",
        "No reading lists yet. Right-click a folder and choose Make Reading List.",
      ),
    );
    return;
  }
  const lists = element(doc, "ol", "mr-overview-lists");
  for (const row of rows) {
    const { list } = row;
    const node = element(doc, "li", "mr-overview-row");
    node.dataset.collectionId = String(list.collectionID);
    node.addEventListener("click", () => actions.openList(list.collectionID));
    // A list that cannot be read has no steps: it is not All read.
    const nextText = !list.readable
      ? ""
      : row.nextUp === null
        ? "All read"
        : labelOf(list, row.nextUp);
    node.append(
      element(doc, "span", "mr-row-topic", list.topic),
      element(doc, "span", "mr-row-folder", folderText(list)),
      element(
        doc,
        "span",
        "mr-row-progress",
        list.readable ? progressText(row.progress) : "Cannot be read",
      ),
      element(doc, "span", "mr-row-next", nextText),
    );
    if (!list.readable) node.classList.add("mr-row-unreadable");
    lists.append(node);
  }
  container.append(lists);
}
