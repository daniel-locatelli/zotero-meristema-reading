import { config } from "../../package.json";
import {
  nextState,
  placeStep,
  setWhy,
  shiftStep,
  unplaceStep,
} from "../domain/listEdits";
import type { ReadingListStep, ResolvedStep } from "../format/readingList";
import { nextUp, type ReadState } from "../format/readState";
import { editList, labelOf, listFor, UnreadableListError } from "./listStore";
import { report } from "./report";
import { markItems, stateOfItem, UnreadableStateError } from "./stateStore";

const HTML = "http://www.w3.org/1999/xhtml";
const STATE_LABEL: Record<ReadState, string> = {
  unread: "Unread",
  reading: "Reading",
  read: "Read",
};

/** The key being dragged, shared by every view so a drag can cross rows. */
let dragged: string | null = null;

export interface ListViewOptions {
  mode: "sidebar" | "tab";
  /** The paper selected in the item list, marked in the sidebar. */
  currentKey: string | null;
  onOpenTab?: () => void;
}

function failed(error: unknown): void {
  if (
    error instanceof UnreadableStateError ||
    error instanceof UnreadableListError
  ) {
    Zotero.alert(Zotero.getMainWindow(), config.addonName, error.message);
    return;
  }
  report(error);
  Zotero.alert(
    Zotero.getMainWindow(),
    config.addonName,
    "Meristema Reading could not change the reading list. See the error console.",
  );
}

function element<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = doc.createElementNS(HTML, tag) as HTMLElementTagNameMap[K];
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function allowDrop(event: DragEvent): void {
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
}

/** Draws a folder's reading list into `container`, wiring every edit to the stores. */
export function renderList(
  container: HTMLElement,
  collectionID: number,
  options: ListViewOptions,
): void {
  const owner = container.ownerDocument;
  if (!owner) return;
  const doc: Document = owner;
  container.replaceChildren();
  container.classList.add("mr-list", `mr-${options.mode}`);
  const list = listFor(collectionID);
  if (!list) {
    container.append(
      element(doc, "p", "mr-empty", "This folder holds no reading list."),
    );
    return;
  }
  for (const id of list.ignoredNoteIDs) {
    const other = Zotero.Items.get(id) as Zotero.Item | false;
    const title = other ? other.getNoteTitle() : String(id);
    container.append(
      element(
        doc,
        "p",
        "mr-ignored",
        `Ignored: a second list note, “${title}”. A folder keeps one list.`,
      ),
    );
  }
  if (!list.doc || !list.resolved) {
    container.append(
      element(
        doc,
        "p",
        "mr-failure",
        `This folder's reading list cannot be read (${list.failure}). Meristema Reading leaves it as it is.`,
      ),
    );
    return;
  }

  const collection = Zotero.Collections.get(collectionID);
  if (!collection) return;
  const itemOf = (key: string): Zotero.Item | false =>
    Zotero.Items.getByLibraryAndKey(collection.libraryID, key);
  const stateOfKey = (key: string): ReadState => {
    const item = itemOf(key);
    return item ? stateOfItem(item) : "unread";
  };
  const edit = (change: (steps: ReadingListStep[]) => ReadingListStep[]) => {
    void editList(collectionID, change).catch(failed);
  };
  const next = nextUp(list.resolved.steps, stateOfKey);

  container.append(element(doc, "div", "mr-topic", list.doc.topic));
  if (options.onOpenTab) {
    const open = element(doc, "button", "mr-open-tab", "Open as Tab");
    open.addEventListener("click", () => options.onOpenTab?.());
    container.append(open);
  }

  function paperParts(row: HTMLElement, key: string): void {
    const item = itemOf(key);
    const state = stateOfKey(key);
    const toggle = element(doc, "button", "mr-state", STATE_LABEL[state]);
    toggle.dataset.state = state;
    toggle.title = `Mark ${STATE_LABEL[nextState(state)]}`;
    toggle.addEventListener("click", (event) => {
      event.stopPropagation();
      if (item) void markItems([item], nextState(state)).catch(failed);
    });
    const title = element(doc, "span", "mr-title", item ? labelOf(item) : key);
    title.addEventListener("click", () => {
      if (item) void Zotero.getActiveZoteroPane()?.selectItem(item.id);
    });
    row.append(toggle, title);
    row.dataset.key = key;
    if (key === next) row.classList.add("mr-next");
    if (key === options.currentKey) row.classList.add("mr-current");
    row.addEventListener("dragstart", (event: DragEvent) => {
      dragged = key;
      event.dataTransfer?.setData("text/plain", key);
      if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
    });
    row.addEventListener("dragend", () => {
      dragged = null;
    });
  }

  function stepRow(step: ResolvedStep): HTMLElement {
    const row = element(doc, "li", "mr-step");
    row.tabIndex = 0;
    const handle = element(doc, "span", "mr-handle", "⠿");
    handle.draggable = true;
    handle.title = "Drag to reorder, or Alt+Up and Alt+Down";
    row.append(handle, element(doc, "span", "mr-number", String(step.step)));
    paperParts(row, step.key);
    const why = element(doc, "textarea", "mr-why");
    why.value = step.why;
    why.rows = options.mode === "tab" ? 3 : 1;
    why.placeholder = "Why read it";
    why.addEventListener("change", () =>
      edit((steps) => setWhy(steps, step.key, why.value)),
    );
    why.addEventListener("keydown", (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        why.value = step.why;
        why.blur();
      }
    });
    row.append(why);
    row.addEventListener("keydown", (event: KeyboardEvent) => {
      if (event.target === why || !event.altKey) return;
      if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
      event.preventDefault();
      edit((steps) =>
        shiftStep(steps, step.key, event.key === "ArrowUp" ? -1 : 1),
      );
    });
    row.addEventListener("dragover", allowDrop);
    row.addEventListener("drop", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const moving = dragged;
      dragged = null;
      if (moving) edit((steps) => placeStep(steps, moving, step.key));
    });
    return row;
  }

  const steps = element(doc, "ol", "mr-steps");
  for (const step of list.resolved.steps) steps.append(stepRow(step));
  steps.addEventListener("dragover", allowDrop);
  steps.addEventListener("drop", (event) => {
    event.preventDefault();
    const moving = dragged;
    dragged = null;
    if (moving) edit((current) => placeStep(current, moving, null));
  });
  container.append(steps);

  container.append(
    element(doc, "div", "mr-unordered-title", "Not in the steps"),
  );
  const unordered = element(doc, "ul", "mr-unordered");
  for (const key of list.resolved.unordered) {
    const row = element(doc, "li", "mr-paper");
    row.draggable = true;
    paperParts(row, key);
    unordered.append(row);
  }
  unordered.addEventListener("dragover", allowDrop);
  unordered.addEventListener("drop", (event) => {
    event.preventDefault();
    const moving = dragged;
    dragged = null;
    if (moving) edit((current) => unplaceStep(current, moving));
  });
  container.append(unordered);
}
