/// <reference types="mocha" />
import { expect } from "chai";
import {
  parseReadingList,
  writeReadingList,
  type ReadingListDoc,
  type ReadingListStep,
} from "../../src/format/readingList";
import { parseReadState, type ReadStateDoc } from "../../src/format/readState";
import {
  altArrow,
  drag,
  eraseStateNotes,
  idle,
  makeListNote,
  makePaper,
  plugin,
  rowKeys,
  stateNotes,
  waitFor,
} from "./helpers";

const TOPIC = "Section fixture";

describe("The Reading list section", function () {
  this.timeout(60_000);
  let win: any;
  let collection: any;
  let a: Zotero.Item;
  let b: Zotero.Item;
  let c: Zotero.Item;
  let note: Zotero.Item;
  const extraNotes: number[] = [];

  const view = () =>
    win.document.querySelector(".mr-list.mr-sidebar") as HTMLElement | null;
  const row = (key: string) =>
    view()!.querySelector(`[data-key="${key}"]`) as HTMLElement;
  const stepsInNote = (): ReadingListStep[] => {
    const parsed = parseReadingList(note.getNote());
    expect(parsed.ok, `the list note parses: ${note.getNote()}`).to.equal(true);
    return (parsed as { ok: true; value: ReadingListDoc }).value.steps;
  };
  /** Where the section stands, for a wait that timed out. */
  const sectionEvidence = (): string => {
    const elem = view()?.closest("item-pane-custom-section") as any;
    return JSON.stringify({
      view: Boolean(view()),
      hidden: elem?.hidden,
      text: view()?.textContent?.slice(0, 200),
      paneItem: win.document.querySelector("#zotero-item-pane item-details")
        ?.item?.id,
      selected: win.ZoteroPane.getSelectedItems().map(
        (item: Zotero.Item) => item.id,
      ),
      folder: win.ZoteroPane.getSelectedCollection(true),
      collection: collection.id,
      tab: win.Zotero_Tabs.selectedID,
    });
  };
  async function untilSteps(keys: string[]): Promise<void> {
    const ok = await waitFor(
      () => rowKeys(view(), ".mr-step").join() === keys.join(),
      10_000,
    );
    expect(
      ok,
      `the section shows ${keys}; it shows ${rowKeys(view(), ".mr-step")}`,
    ).to.equal(true);
  }

  before(async function () {
    win = Zotero.getMainWindows()[0];
    await eraseStateNotes();
    collection = new Zotero.Collection();
    collection.libraryID = Zotero.Libraries.userLibraryID;
    collection.name = TOPIC;
    await collection.saveTx();
    a = await makePaper("Paper A", undefined, collection.id);
    b = await makePaper("Paper B", undefined, collection.id);
    c = await makePaper("Paper C", undefined, collection.id);
    note = await makeListNote(
      collection.id,
      writeReadingList(
        {
          version: 1,
          topic: TOPIC,
          steps: [
            { key: a.key, why: "first" },
            { key: b.key, why: "" },
          ],
        },
        (key) => key,
        { kind: "user" },
      ),
    );
    await idle();
  });

  after(async function () {
    win.Zotero_Tabs.select("zotero-pane");
    await win.ZoteroPane.collectionsView.selectLibrary(
      Zotero.Libraries.userLibraryID,
    );
    await Zotero.Items.erase([note.id, ...extraNotes, a.id, b.id, c.id]);
    await collection.eraseTx();
    await eraseStateNotes();
    await idle();
  });

  it("shows the steps, the unordered papers and next up for a paper in the folder", async function () {
    await win.ZoteroPane.collectionsView.selectCollection(collection.id);
    await win.ZoteroPane.selectItem(b.id);
    await untilSteps([a.key, b.key]);
    expect(rowKeys(view(), ".mr-paper"), "unordered papers").to.deep.equal([
      c.key,
    ]);
    expect(rowKeys(view(), ".mr-next"), "next up").to.deep.equal([a.key]);
    // The section draws once per selected paper; wait for the one picked here.
    const current = await waitFor(
      () => rowKeys(view(), ".mr-current").join() === b.key,
      10_000,
    );
    expect(
      current,
      `the selected paper ${b.key} is marked; marked ${rowKeys(view(), ".mr-current")}, a ${a.key}, c ${c.key}, selected ${win.ZoteroPane.getSelectedItems().map((item: Zotero.Item) => item.key)}`,
    ).to.equal(true);
    expect(view()!.querySelector(".mr-topic")?.textContent).to.equal(TOPIC);
    expect(
      (row(a.key).querySelector(".mr-why") as HTMLTextAreaElement).value,
    ).to.equal("first");
  });

  it("moves a step with Alt+Down and rewrites the note", async function () {
    altArrow(win, row(a.key), "ArrowDown");
    await idle();
    expect(stepsInNote()).to.deep.equal([
      { key: b.key, why: "" },
      { key: a.key, why: "first" },
    ]);
    const html = note.getNote();
    expect(
      html.indexOf(`items/${b.key}`),
      "readable part rebuilt in the new order",
    ).to.be.lessThan(html.indexOf(`items/${a.key}`));
    await untilSteps([b.key, a.key]);
    // The redraw keeps the moved step focused, so the keys keep moving it.
    const focusedKey = () =>
      (win.document.activeElement as HTMLElement | null)?.dataset?.key;
    expect(focusedKey(), "the moved step keeps the focus").to.equal(a.key);
    altArrow(win, win.document.activeElement, "ArrowUp");
    await idle();
    await untilSteps([a.key, b.key]);
    expect(focusedKey(), "focus after the second press").to.equal(a.key);
    altArrow(win, win.document.activeElement, "ArrowDown");
    await idle();
    await untilSteps([b.key, a.key]);
    expect(focusedKey(), "focus after the third press").to.equal(a.key);
    expect(stepsInNote().map((step) => step.key)).to.deep.equal([b.key, a.key]);
  });

  it("drops an unordered paper into the steps before the step it lands on", async function () {
    drag(win, row(c.key), row(b.key));
    await idle();
    expect(stepsInNote().map((step) => step.key)).to.deep.equal([
      c.key,
      b.key,
      a.key,
    ]);
    await untilSteps([c.key, b.key, a.key]);
  });

  it("takes a step out when it is dropped on the unordered papers", async function () {
    drag(
      win,
      row(a.key).querySelector(".mr-handle")!,
      view()!.querySelector(".mr-unordered")!,
    );
    await idle();
    expect(stepsInNote().map((step) => step.key)).to.deep.equal([c.key, b.key]);
    await untilSteps([c.key, b.key]);
    expect(rowKeys(view(), ".mr-paper")).to.deep.equal([a.key]);
  });

  it("starts no drag from a reason's text", async function () {
    const why = row(b.key).querySelector(".mr-why")!;
    drag(win, why, view()!.querySelector(".mr-unordered")!);
    await idle();
    expect(
      stepsInNote().map((step) => step.key),
      "dragging text out of a reason moves no step",
    ).to.deep.equal([c.key, b.key]);
  });

  it("saves an edited reason", async function () {
    const why = row(b.key).querySelector(".mr-why") as HTMLTextAreaElement;
    why.value = 'Read <this> & "that"';
    why.dispatchEvent(new win.Event("change", { bubbles: true }));
    await idle();
    expect(stepsInNote()).to.deep.equal([
      { key: c.key, why: "" },
      { key: b.key, why: 'Read <this> & "that"' },
    ]);
  });

  it("keeps a reason being typed through a redraw, then saves it", async function () {
    const why = row(c.key).querySelector(".mr-why") as HTMLTextAreaElement;
    why.focus();
    why.value = "typed here";
    why.dispatchEvent(new win.Event("input", { bubbles: true }));
    // A store change from elsewhere: the note rewritten through the API.
    const parsed = parseReadingList(note.getNote());
    const doc = (parsed as { ok: true; value: ReadingListDoc }).value;
    note.setNote(
      writeReadingList(
        {
          ...doc,
          steps: doc.steps.map((step) =>
            step.key === b.key ? { ...step, why: "from elsewhere" } : step,
          ),
        },
        (key) => key,
        { kind: "user" },
      ),
    );
    await note.saveTx();
    await idle();
    const seen = () =>
      JSON.stringify({
        same: row(c.key)?.querySelector(".mr-why") === why,
        value: why.value,
        focused: win.document.activeElement === why,
        bWhy: (row(b.key)?.querySelector(".mr-why") as HTMLTextAreaElement)
          ?.value,
      });
    expect(
      row(c.key).querySelector(".mr-why") === why && why.value === "typed here",
      `the reason being typed survives the change: ${seen()}`,
    ).to.equal(true);

    why.dispatchEvent(new win.Event("change", { bubbles: true }));
    why.blur();
    await idle();
    expect(stepsInNote(), "the typed reason saved").to.deep.equal([
      { key: c.key, why: "typed here" },
      { key: b.key, why: "from elsewhere" },
    ]);
    const redrawn = await waitFor(
      () =>
        (row(b.key)?.querySelector(".mr-why") as HTMLTextAreaElement)?.value ===
        "from elsewhere",
      10_000,
    );
    expect(redrawn, `the view redraws after the blur: ${seen()}`).to.equal(
      true,
    );
  });

  it("toggles a step's read state, and next up follows", async function () {
    (row(b.key).querySelector(".mr-state") as HTMLElement).click();
    await idle();
    const [stateNote] = await stateNotes();
    const parsed = parseReadState(stateNote.getNote());
    expect(
      (parsed as { ok: true; value: ReadStateDoc }).value.states[
        `user:${b.key}`
      ]?.state,
    ).to.equal("reading");
    expect(b.hasTag("_reading"), "the mirror tag").to.equal(true);
    const moved = await waitFor(
      () => rowKeys(view(), ".mr-next")[0] === b.key,
      10_000,
    );
    expect(
      moved,
      `next up is the Reading step; it is ${rowKeys(view(), ".mr-next")}`,
    ).to.equal(true);
  });

  it("draws a list read-only when its library cannot be edited", async function () {
    // No group library in the test profile: draw this list as one would be,
    // through the running plugin's view, with editing off.
    const container = win.document.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "div",
    ) as HTMLElement;
    win.document.documentElement.append(container);
    try {
      plugin().api.renderList(container, collection.id, {
        mode: "tab",
        currentKey: null,
        editable: false,
      });
      const rowIn = (key: string) =>
        container.querySelector(`[data-key="${key}"]`) as HTMLElement;
      const before = stepsInNote();
      expect(rowKeys(container, ".mr-step"), "the steps").to.deep.equal([
        c.key,
        b.key,
      ]);
      const drawn = JSON.stringify({
        handles: container.querySelectorAll(".mr-handle").length,
        draggable: container.querySelectorAll("[draggable=true]").length,
        writable: Array.from(container.querySelectorAll(".mr-why")).filter(
          (why) => !(why as HTMLTextAreaElement).readOnly,
        ).length,
        readOnly: container.classList.contains("mr-readonly"),
      });
      expect(drawn, "no handles, no drags, reasons read-only").to.equal(
        JSON.stringify({
          handles: 0,
          draggable: 0,
          writable: 0,
          readOnly: true,
        }),
      );
      altArrow(win, rowIn(c.key), "ArrowDown");
      drag(win, rowIn(a.key), rowIn(b.key));
      await idle();
      expect(stepsInNote(), "no key or drop changes the list").to.deep.equal(
        before,
      );
      // The read state lives in My Library, so the toggle still works.
      (rowIn(a.key).querySelector(".mr-state") as HTMLElement).click();
      await idle();
      const [stateNote] = await stateNotes();
      const parsed = parseReadState(stateNote.getNote());
      expect(
        (parsed as { ok: true; value: ReadStateDoc }).value.states[
          `user:${a.key}`
        ]?.state,
        "the toggle marks the paper",
      ).to.equal("reading");
    } finally {
      container.remove();
    }
  });

  it("names a second list note it ignores", async function () {
    const second = await makeListNote(
      collection.id,
      writeReadingList(
        { version: 1, topic: "Second list", steps: [] },
        (key) => key,
        {
          kind: "user",
        },
      ),
    );
    extraNotes.push(second.id);
    await idle();
    const named = await waitFor(
      () =>
        view()
          ?.querySelector(".mr-ignored")
          ?.textContent?.includes("Second list"),
      10_000,
    );
    expect(named, `the ignored note is named: ${sectionEvidence()}`).to.equal(
      true,
    );
  });

  it("says a list it cannot read and offers no editing", async function () {
    const broken = '<pre data-meristema-reading-list="1">{"version":2}</pre>';
    note.setNote(broken);
    await note.saveTx();
    await idle();
    const said = await waitFor(
      () =>
        view()
          ?.querySelector(".mr-failure")
          ?.textContent?.includes("unknown-version"),
      10_000,
    );
    expect(
      said,
      `the section says the list cannot be read: ${sectionEvidence()}`,
    ).to.equal(true);
    expect(view()!.querySelectorAll(".mr-step, .mr-why").length).to.equal(0);
    expect(note.getNote(), "the note is left as it was").to.equal(broken);
  });
});
