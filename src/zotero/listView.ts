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
import { enqueue } from "./queue";
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

/** A redraw held back while the reader types a reason, with its latest arguments. */
const deferred = new WeakMap<
  HTMLElement,
  { collectionID: number; options: ListViewOptions }
>();
/** The step a keyboard move asked to keep focused through the next redraw. */
const refocus = new WeakMap<HTMLElement, string>();

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

/**
 * A reason the reader is in or has typed into and not yet handed over: a
 * redraw would destroy it, since its `change` comes only on blur.
 */
function holdsTyping(container: HTMLElement, doc: Document): boolean {
  const fields = Array.from(
    container.querySelectorAll(".mr-why"),
  ) as HTMLTextAreaElement[];
  for (const why of fields) {
    if (doc.activeElement === why || why.value !== why.dataset.saved) {
      return true;
    }
  }
  return false;
}

/** Draws a redraw held back for typing, once the typing is handed over. */
function redrawDeferred(container: HTMLElement): void {
  const held = deferred.get(container);
  if (!held) return;
  deferred.delete(container);
  renderList(container, held.collectionID, held.options);
}

/** The key of the row, or of the row whose state toggle, has the focus. */
function focusedKey(
  container: HTMLElement,
  doc: Document,
): { key: string; part: "row" | "state" } | null {
  const active = doc.activeElement as HTMLElement | null;
  if (!active || !container.contains(active)) return null;
  if (active.matches(".mr-step, .mr-paper") && active.dataset.key) {
    return { key: active.dataset.key, part: "row" };
  }
  const row = active.closest(".mr-step, .mr-paper") as HTMLElement | null;
  if (active.matches(".mr-state") && row?.dataset.key) {
    return { key: row.dataset.key, part: "state" };
  }
  return null;
}

function restoreFocus(
  container: HTMLElement,
  wanted: { key: string; part: "row" | "state" } | null,
): void {
  if (!wanted) return;
  const rows = Array.from(
    container.querySelectorAll(".mr-step, .mr-paper"),
  ) as HTMLElement[];
  const row = rows.find((node) => node.dataset.key === wanted.key);
  const target =
    wanted.part === "state"
      ? (row?.querySelector(".mr-state") as HTMLElement | null | undefined)
      : row;
  target?.focus();
}

function allowDrop(event: DragEvent): void {
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
}

/**
 * Draws a folder's reading list into `container`, wiring every edit to the
 * stores. While the reader types a reason, the redraw waits for the blur.
 */
export function renderList(
  container: HTMLElement,
  collectionID: number,
  options: ListViewOptions,
): void {
  const owner = container.ownerDocument;
  if (!owner) return;
  const doc: Document = owner;
  if (holdsTyping(container, doc)) {
    deferred.set(container, { collectionID, options });
    return;
  }
  deferred.delete(container);
  // A drag whose source row is redrawn away gets no dragend.
  dragged = null;
  const keyToFocus = refocus.has(container)
    ? { key: refocus.get(container)!, part: "row" as const }
    : focusedKey(container, doc);
  refocus.delete(container);
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
  const edit = (
    change: (steps: ReadingListStep[]) => ReadingListStep[],
  ): Promise<void> => editList(collectionID, change).catch(failed);
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
      // Only the handle or an unordered paper's row: text dragged out of a
      // reason bubbles here too.
      const source = event.target as Element | null;
      const fromHandle = Boolean(source?.classList?.contains("mr-handle"));
      const fromPaper = source === row && row.classList.contains("mr-paper");
      if (!fromHandle && !fromPaper) return;
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
    // As the field reads it back, so line endings never look like typing.
    why.dataset.saved = why.value;
    why.rows = options.mode === "tab" ? 3 : 1;
    why.placeholder = "Why read it";
    why.addEventListener("change", () => {
      why.dataset.saved = why.value;
      const text = why.value;
      void edit((steps) => setWhy(steps, step.key, text)).finally(() =>
        redrawDeferred(container),
      );
    });
    why.addEventListener("blur", () => {
      // Behind the change handler's save, which the queue runs first.
      void enqueue(() => Promise.resolve()).finally(() =>
        redrawDeferred(container),
      );
    });
    why.addEventListener("keydown", (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        why.value = why.dataset.saved ?? "";
        why.blur();
      }
    });
    row.append(why);
    row.addEventListener("keydown", (event: KeyboardEvent) => {
      if (event.target === why || !event.altKey) return;
      if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
      event.preventDefault();
      refocus.set(container, step.key);
      void edit((steps) =>
        shiftStep(steps, step.key, event.key === "ArrowUp" ? -1 : 1),
      );
    });
    row.addEventListener("dragover", allowDrop);
    row.addEventListener("drop", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const moving = dragged;
      dragged = null;
      if (moving) void edit((steps) => placeStep(steps, moving, step.key));
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
    if (moving) void edit((current) => placeStep(current, moving, null));
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
    if (moving) void edit((current) => unplaceStep(current, moving));
  });
  container.append(unordered);
  restoreFocus(container, keyToFocus);
}
