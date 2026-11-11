import {
  nextState,
  placeStepAt,
  setWhy,
  shiftStep,
  unplaceStep,
} from "../domain/listEdits";
import { paperLabel } from "../domain/listNotes";
import type { ReadingListStep, ResolvedStep } from "../format/readingList";
import { nextUp, type ReadState } from "../format/readState";
import { failedWith } from "./alerts";
import { editList, listFor, partsOf } from "./listStore";
import { currentStyle } from "./preferences";
import { enqueue } from "./queue";
import { report } from "./report";
import { markItems, stateOfItem } from "./stateStore";

const HTML = "http://www.w3.org/1999/xhtml";
const STATE_LABEL: Record<ReadState, string> = {
  unread: "Unread",
  reading: "Reading",
  read: "Read",
};

/** The key being dragged, shared by every view so a drag can cross rows. */
let dragged: string | null = null;
/** The folder whose list the drag started in: a drop takes only its own steps. */
let draggedFrom: number | null = null;
/** The height of the dragged row, which the slot it opens takes. */
let draggedHeight = 0;

/** A redraw held back while the reader types a reason, with its latest arguments. */
const deferred = new WeakMap<
  HTMLElement,
  { collectionID: number; options: ListViewOptions }
>();
/** Where focus goes back to after a redraw: a row, its state toggle or its reason. */
interface FocusSpot {
  key: string;
  part: "row" | "state" | "why";
  /** The caret in a reason, put back where it was. */
  caret?: { start: number; end: number };
}

/** The step a keyboard move asked to keep focused through the next redraw. */
const refocus = new WeakMap<HTMLElement, FocusSpot>();

export interface ListViewOptions {
  mode: "sidebar" | "tab";
  /** The paper selected in the item list, marked in the sidebar. */
  currentKey: string | null;
  /**
   * False for a list in a library the reader cannot edit (a read-only
   * group): no drags, keys or reasons to edit, though the read state, kept
   * in My Library, still toggles.
   */
  editable: boolean;
  onOpenTab?: () => void;
}

/** Whether the reader may change what a library holds. */
export function libraryEditable(libraryID: number): boolean {
  return Boolean((Zotero.Libraries.get(libraryID) as any)?.editable);
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
  const moving = refocus.get(container);
  for (const why of fields) {
    if (why.readOnly) continue;
    // A reason saved and moved with its step: the redraw carries it over.
    const key = (why.closest(".mr-step") as HTMLElement | null)?.dataset.key;
    if (
      moving?.part === "why" &&
      moving.key === key &&
      why.value === why.dataset.saved
    ) {
      continue;
    }
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
function focusedKey(container: HTMLElement, doc: Document): FocusSpot | null {
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

function restoreFocus(container: HTMLElement, wanted: FocusSpot | null): void {
  if (!wanted) return;
  const rows = Array.from(
    container.querySelectorAll(".mr-step, .mr-paper"),
  ) as HTMLElement[];
  const row = rows.find((node) => node.dataset.key === wanted.key);
  const target =
    wanted.part === "row"
      ? row
      : (row?.querySelector(
          wanted.part === "state" ? ".mr-state" : ".mr-why",
        ) as HTMLElement | null | undefined);
  target?.focus();
  if (wanted.caret && target?.matches(".mr-why")) {
    (target as HTMLTextAreaElement).setSelectionRange(
      wanted.caret.start,
      wanted.caret.end,
    );
  }
}

/** Shows a paper in its folder in the library tab, from the sidebar or a list tab. */
async function showInLibrary(
  doc: Document,
  collectionID: number,
  itemID: number,
): Promise<void> {
  const win = doc.defaultView as any;
  win?.Zotero_Tabs?.select("zotero-pane");
  const pane = (win?.ZoteroPane ?? Zotero.getActiveZoteroPane()) as any;
  if (!pane) return;
  if (pane.getSelectedCollection(true) !== collectionID) {
    await pane.collectionsView.selectCollection(collectionID);
  }
  await pane.selectItem(itemID);
}

/** Alt+Up or Alt+Down, the keys that move a step. */
function moveKey(event: KeyboardEvent): boolean {
  return event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown");
}

function allowDrop(event: DragEvent): void {
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
}

/** Whether `related`, where a drag went on leaving `zone`, lies outside it. */
function leftZone(zone: Element, related: EventTarget | null): boolean {
  // A drag event's related target is a node or null; the plugin's scope
  // may share no `Node` with the window, so no instanceof.
  return !related || !zone.contains(related as Node);
}

/** Every trace of a drag in the document: slots, the faded row, a lit zone. */
function clearDragMarks(doc: Document): void {
  for (const slot of Array.from(
    doc.querySelectorAll(".mr-list .mr-drop-slot"),
  ) as Element[]) {
    slot.remove();
  }
  for (const node of Array.from(
    doc.querySelectorAll(".mr-list .mr-dragging, .mr-list .mr-drop-target"),
  ) as Element[]) {
    node.classList.remove("mr-dragging", "mr-drop-target");
  }
}

/** The step rows of `list` a drop lands among: all but the dragged one. */
function landingRows(list: HTMLElement): HTMLElement[] {
  return (Array.from(list.children) as HTMLElement[]).filter(
    (node) =>
      node.classList.contains("mr-step") && node.dataset.key !== dragged,
  );
}

/** Where among the landing rows a pointer at `clientY` drops: past each row whose middle it passed. */
function landingIndex(list: HTMLElement, clientY: number): number {
  let index = 0;
  for (const row of landingRows(list)) {
    const rect = row.getBoundingClientRect();
    if (clientY > rect.top + rect.height / 2) index++;
  }
  return index;
}

/**
 * Opens the slot in `list` at `index` among the landing rows, as tall as the
 * dragged row, and slides the rows it pushes or pulls into place (FLIP).
 */
function openSlot(doc: Document, list: HTMLElement, index: number): void {
  let slot = list.querySelector(".mr-drop-slot") as HTMLElement | null;
  if (slot && Number(slot.dataset.index) === index) return;
  const rows = Array.from(list.querySelectorAll(".mr-step")) as HTMLElement[];
  const before = new Map(
    rows.map((row) => [row, row.getBoundingClientRect().top]),
  );
  if (!slot) {
    slot = doc.createElementNS(HTML, "li") as HTMLElement;
    slot.className = "mr-drop-slot";
  }
  slot.dataset.index = String(index);
  slot.style.height = `${draggedHeight}px`;
  list.insertBefore(slot, landingRows(list)[index] ?? null);
  for (const row of rows) {
    const shift = before.get(row)! - row.getBoundingClientRect().top;
    if (!shift) continue;
    row.style.transition = "none";
    row.style.transform = `translateY(${shift}px)`;
    // Lay the inverse out, so the next frame slides it back to zero.
    void row.offsetHeight;
    doc.defaultView?.requestAnimationFrame(() => {
      row.style.transition = "";
      row.style.transform = "";
    });
  }
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
  const failed = failedWith(
    "Meristema Reading could not change the reading list. See the error console.",
    doc.defaultView,
  );
  const editable = options.editable;
  if (holdsTyping(container, doc)) {
    deferred.set(container, { collectionID, options });
    return;
  }
  deferred.delete(container);
  // A drag whose source row is redrawn away gets no dragend.
  dragged = null;
  draggedFrom = null;
  const keyToFocus = refocus.get(container) ?? focusedKey(container, doc);
  refocus.delete(container);
  container.replaceChildren();
  container.classList.add("mr-list", `mr-${options.mode}`);
  container.classList.toggle("mr-readonly", !editable);
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
  /** The key dragged from this folder's list, in any view of it; else null. */
  const draggedHere = (): string | null =>
    draggedFrom === collectionID ? dragged : null;
  const edit = (
    change: (steps: ReadingListStep[]) => ReadingListStep[],
  ): Promise<void> => editList(collectionID, change).catch(failed);
  const next = nextUp(list.resolved.steps, stateOfKey);
  const style = currentStyle();

  container.append(element(doc, "div", "mr-topic", list.doc.topic));
  if (!editable) {
    container.append(
      element(
        doc,
        "p",
        "mr-readonly-note",
        "This list is in a library you cannot edit, so it is shown as it is.",
      ),
    );
  }
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
    const title = element(
      doc,
      "span",
      "mr-title",
      item ? paperLabel(partsOf(item), style) : key,
    );
    title.addEventListener("click", () => {
      if (item) void showInLibrary(doc, collectionID, item.id).catch(report);
    });
    row.append(toggle, title);
    row.dataset.key = key;
    if (key === next) row.classList.add("mr-next");
    if (key === options.currentKey) row.classList.add("mr-current");
    if (!editable) return;
    row.addEventListener("dragstart", (event: DragEvent) => {
      // Only the handle or an unordered paper's row: text dragged out of a
      // reason bubbles here too.
      const source = event.target as Element | null;
      const fromHandle = Boolean(source?.classList?.contains("mr-handle"));
      const fromPaper = source === row && row.classList.contains("mr-paper");
      if (!fromHandle && !fromPaper) return;
      dragged = key;
      draggedFrom = collectionID;
      const rect = row.getBoundingClientRect();
      draggedHeight = rect.height;
      const transfer = event.dataTransfer;
      if (transfer) {
        transfer.setData("text/plain", key);
        transfer.effectAllowed = "move";
        // The whole row follows the pointer, held where it was grabbed.
        transfer.setDragImage(
          row,
          Math.round(event.clientX - rect.left),
          Math.round(event.clientY - rect.top),
        );
      }
      row.classList.add("mr-dragging");
    });
    row.addEventListener("dragend", () => {
      dragged = null;
      draggedFrom = null;
      clearDragMarks(doc);
    });
  }

  function stepRow(step: ResolvedStep): HTMLElement {
    const row = element(doc, "li", "mr-step");
    row.tabIndex = 0;
    if (editable) {
      const handle = element(doc, "span", "mr-handle", "⠿");
      handle.draggable = true;
      handle.title = "Drag to reorder, or Alt+Up and Alt+Down";
      row.append(handle);
    }
    row.append(element(doc, "span", "mr-number", String(step.step)));
    paperParts(row, step.key);
    const why = element(doc, "textarea", "mr-why");
    why.value = step.why;
    // As the field reads it back, so line endings never look like typing.
    why.dataset.saved = why.value;
    why.rows = options.mode === "tab" ? 3 : 1;
    row.append(why);
    if (!editable) {
      why.readOnly = true;
      return row;
    }
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
      if (!moveKey(event)) return;
      // Saves the reason as its change would, then moves the step with it.
      event.preventDefault();
      const text = why.value;
      const previous = why.dataset.saved;
      why.dataset.saved = text;
      const caret = {
        start: why.selectionStart ?? text.length,
        end: why.selectionEnd ?? text.length,
      };
      const by = event.key === "ArrowUp" ? -1 : 1;
      void editList(collectionID, (steps) =>
        shiftStep(setWhy(steps, step.key, text), step.key, by),
      ).then(
        () => {
          // Another folder or a newer redraw took the view while it saved:
          // drawing this one again would bring the old folder back.
          if (!why.isConnected) return;
          // Typed on while it saved: the redraw waits for the blur, as ever.
          if (why.value !== text) return;
          refocus.set(container, { key: step.key, part: "why", caret });
          const held = deferred.get(container) ?? { collectionID, options };
          renderList(container, held.collectionID, held.options);
        },
        (error: unknown) => {
          // Not saved: the field keeps the typing, held from redraws again.
          why.dataset.saved = previous;
          failed(error);
        },
      );
    });
    row.addEventListener("keydown", (event: KeyboardEvent) => {
      if (event.target === why || !moveKey(event)) return;
      event.preventDefault();
      refocus.set(container, { key: step.key, part: "row" });
      void edit((steps) =>
        shiftStep(steps, step.key, event.key === "ArrowUp" ? -1 : 1),
      );
    });
    return row;
  }

  const steps = element(doc, "ol", "mr-steps");
  for (const step of list.resolved.steps) steps.append(stepRow(step));
  if (editable) {
    steps.addEventListener("dragover", (event: DragEvent) => {
      if (!draggedHere()) return;
      allowDrop(event);
      openSlot(doc, steps, landingIndex(steps, event.clientY));
    });
    steps.addEventListener("dragleave", (event: DragEvent) => {
      if (!leftZone(steps, event.relatedTarget)) return;
      steps.querySelector(".mr-drop-slot")?.remove();
    });
    steps.addEventListener("drop", (event: DragEvent) => {
      const moving = draggedHere();
      if (!moving) return;
      event.preventDefault();
      const slot = steps.querySelector(".mr-drop-slot") as HTMLElement | null;
      const index = slot
        ? Number(slot.dataset.index)
        : landingIndex(steps, event.clientY);
      dragged = null;
      draggedFrom = null;
      clearDragMarks(doc);
      void edit((current) => placeStepAt(current, moving, index));
    });
  }
  container.append(steps);

  // The heading and its papers take a drop as one zone.
  const zone = element(doc, "section", "mr-unordered-zone");
  zone.append(element(doc, "div", "mr-unordered-title", "Not in the steps"));
  const unordered = element(doc, "ul", "mr-unordered");
  for (const key of list.resolved.unordered) {
    const row = element(doc, "li", "mr-paper");
    row.draggable = editable;
    paperParts(row, key);
    unordered.append(row);
  }
  if (editable) {
    zone.addEventListener("dragover", (event: DragEvent) => {
      if (!draggedHere()) return;
      allowDrop(event);
      zone.classList.add("mr-drop-target");
    });
    zone.addEventListener("dragleave", (event: DragEvent) => {
      if (leftZone(zone, event.relatedTarget)) {
        zone.classList.remove("mr-drop-target");
      }
    });
    zone.addEventListener("drop", (event: DragEvent) => {
      const moving = draggedHere();
      if (!moving) return;
      event.preventDefault();
      dragged = null;
      draggedFrom = null;
      clearDragMarks(doc);
      void edit((current) => unplaceStep(current, moving));
    });
  }
  zone.append(unordered);
  container.append(zone);
  restoreFocus(container, keyToFocus);
}
