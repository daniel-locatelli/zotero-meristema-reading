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
  delay,
  drag,
  dragSession,
  eraseStateNotes,
  idle,
  makeListNote,
  makePaper,
  middleY,
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

  it("marks the selected paper in Zotero's selection blue, in both themes", async function () {
    const themePref = "browser.theme.toolbar-theme";
    const hadTheme = Services.prefs.prefHasUserValue(themePref);
    const oldTheme = Services.prefs.getIntPref(themePref, 2);
    const dark = win.matchMedia("(prefers-color-scheme: dark)");
    const seen: Record<string, unknown> = {};
    try {
      // 1 is Zotero's light appearance, 0 its dark one.
      for (const [name, value] of [
        ["light", 1],
        ["dark", 0],
      ] as const) {
        Services.prefs.setIntPref(themePref, value);
        const switched = await waitFor(
          () => dark.matches === (name === "dark"),
          10_000,
        );
        expect(switched, `the window turns ${name}`).to.equal(true);
        const current = view()!.querySelector(".mr-current") as HTMLElement;
        // Zotero's own variables, resolved in the same place as the row.
        const probe = win.document.createElementNS(
          "http://www.w3.org/1999/xhtml",
          "div",
        ) as HTMLElement;
        probe.style.background = "var(--color-accent)";
        probe.style.color = "var(--accent-white, #fff)";
        current.parentElement!.append(probe);
        const style = (elem: Element) => win.getComputedStyle(elem);
        const parts = [".mr-number", ".mr-handle", ".mr-state", ".mr-title"];
        seen[name] = {
          background: style(current).backgroundColor,
          color: style(current).color,
          parts: parts.map((part) => style(current.querySelector(part)!).color),
          accent: style(probe).backgroundColor,
          white: style(probe).color,
        };
        probe.remove();
      }
    } finally {
      if (hadTheme) Services.prefs.setIntPref(themePref, oldTheme);
      else Services.prefs.clearUserPref(themePref);
    }
    for (const name of ["light", "dark"]) {
      const theme = seen[name] as any;
      expect(
        JSON.stringify({
          background: theme.background,
          color: theme.color,
          parts: theme.parts,
        }),
        `the current row in the ${name} theme: ${JSON.stringify(seen)}`,
      ).to.equal(
        JSON.stringify({
          background: theme.accent,
          color: theme.white,
          parts: [theme.white, theme.white, theme.white, theme.white],
        }),
      );
    }
  });

  it("keeps the section where it was in the pane when another paper of the folder is selected", async function () {
    const paneParent = () =>
      win.document.querySelector(
        "#zotero-item-pane item-details #zotero-view-item",
      ) as HTMLElement;
    const offset = () =>
      Math.round(
        view()!.closest("item-pane-custom-section")!.getBoundingClientRect()
          .top - paneParent().getBoundingClientRect().top,
      );
    const where = () =>
      JSON.stringify({
        scrollTop: Math.round(paneParent().scrollTop),
        offset: offset(),
        scrollHeight: paneParent().scrollHeight,
        clientHeight: paneParent().clientHeight,
      });
    await win.ZoteroPane.selectItem(a.id);
    expect(
      await waitFor(
        () => rowKeys(view(), ".mr-current").join() === a.key,
        10_000,
      ),
      `the section draws for ${a.key}: ${sectionEvidence()}`,
    ).to.equal(true);
    await delay(300);
    // As far as the pane scrolls towards the section's header at its top.
    paneParent().scrollTop += offset();
    await delay(300);
    const before = where();
    expect(paneParent().scrollTop, `the pane scrolled: ${before}`).to.be.above(
      0,
    );
    await win.ZoteroPane.selectItem(b.id);
    expect(
      await waitFor(
        () => rowKeys(view(), ".mr-current").join() === b.key,
        10_000,
      ),
      `the section draws for ${b.key}: ${sectionEvidence()}`,
    ).to.equal(true);
    await delay(800);
    const after = where();
    expect(
      Math.abs(JSON.parse(after).offset - JSON.parse(before).offset),
      `the section stays in place; before ${before}, after ${after}`,
    ).to.be.at.most(2);
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

  it("drags the whole row and opens a slot where the step will land", async function () {
    const source = row(c.key);
    const handle = source.querySelector(".mr-handle")!;
    const list = view()!.querySelector(".mr-steps")!;
    const { fire, dataTransfer } = dragSession(win);
    const images: string[] = [];
    dataTransfer.setDragImage = (image: Element, x: number, y: number) => {
      images.push(
        `${(image as HTMLElement).dataset.key ?? image.className}@${x},${y}`,
      );
    };
    const handleRect = handle.getBoundingClientRect();
    const sourceRect = source.getBoundingClientRect();
    const at = {
      x: Math.round(handleRect.left + 2),
      y: Math.round(handleRect.top + 2),
    };
    fire(handle, "dragstart", at);
    expect(
      images,
      "the drag image is the whole row, held where grabbed",
    ).to.deep.equal([
      `${c.key}@${Math.round(at.x - sourceRect.left)},${Math.round(at.y - sourceRect.top)}`,
    ]);
    expect(
      source.classList.contains("mr-dragging"),
      "the source fades",
    ).to.equal(true);
    // Below the middle of the last step: the slot opens after it.
    const below = middleY(row(b.key), 4);
    const allowed = !fire(row(b.key), "dragover", { y: below });
    const slot = list.querySelector(".mr-drop-slot") as HTMLElement | null;
    // The list as drawn now: a drop redraws it.
    const order = () =>
      Array.from(view()!.querySelector(".mr-steps")!.children).map((node) =>
        node.classList.contains("mr-drop-slot")
          ? "slot"
          : ((node as HTMLElement).dataset.key ?? "?"),
      );
    expect(
      { allowed, order: order() },
      `the slot after the last step; dragover at ${below}`,
    ).to.deep.equal({ allowed: true, order: [c.key, b.key, "slot"] });
    expect(
      Math.abs(slot!.getBoundingClientRect().height - sourceRect.height),
      `the slot is the dragged row's height: ${slot!.getBoundingClientRect().height} vs ${sourceRect.height}`,
    ).to.be.at.most(1);
    fire(slot!, "drop", { y: below });
    fire(handle, "dragend");
    expect(
      list.querySelector(".mr-drop-slot"),
      "the drop removes the slot",
    ).to.equal(null);
    await idle();
    expect(stepsInNote().map((step) => step.key)).to.deep.equal([b.key, c.key]);
    await untilSteps([b.key, c.key]);

    // And back above the first step.
    const back = dragSession(win);
    const again = row(c.key).querySelector(".mr-handle")!;
    back.fire(again, "dragstart");
    const above = Math.round(row(b.key).getBoundingClientRect().top + 2);
    back.fire(row(b.key), "dragover", { y: above });
    expect(
      order(),
      `the slot before the first step; dragover at ${above}`,
    ).to.deep.equal(["slot", b.key, c.key]);
    back.fire(row(b.key), "drop", { y: above });
    back.fire(again, "dragend");
    await idle();
    expect(stepsInNote().map((step) => step.key)).to.deep.equal([c.key, b.key]);
    await untilSteps([c.key, b.key]);
  });

  it("removes the slot when the drag leaves the steps or ends without a drop", async function () {
    const handle = row(c.key).querySelector(".mr-handle")!;
    const list = view()!.querySelector(".mr-steps")!;
    const heading = view()!.querySelector(".mr-unordered-title")!;
    const { fire } = dragSession(win);
    fire(handle, "dragstart");
    fire(row(b.key), "dragover", { y: middleY(row(b.key), 4) });
    expect(list.querySelector(".mr-drop-slot"), "a slot while over the steps")
      .to.exist;
    fire(list, "dragleave", { relatedTarget: heading });
    expect(
      list.querySelector(".mr-drop-slot"),
      "no slot once the drag leaves the steps",
    ).to.equal(null);
    fire(row(b.key), "dragover", { y: middleY(row(b.key), 4) });
    fire(handle, "dragend");
    const left = {
      slots: view()!.querySelectorAll(".mr-drop-slot").length,
      dragging: view()!.querySelectorAll(".mr-dragging").length,
      targets: view()!.querySelectorAll(".mr-drop-target").length,
    };
    expect(left, "nothing of the drag is left after dragend").to.deep.equal({
      slots: 0,
      dragging: 0,
      targets: 0,
    });
    await idle();
    expect(stepsInNote().map((step) => step.key)).to.deep.equal([c.key, b.key]);
  });

  it("takes a step out when it is dropped on the Not in the steps heading", async function () {
    const handle = row(b.key).querySelector(".mr-handle")!;
    const heading = view()!.querySelector(".mr-unordered-title")!;
    const zone = heading.closest(".mr-unordered-zone");
    expect(zone, "the heading sits in the drop zone").to.exist;
    const { fire } = dragSession(win);
    fire(handle, "dragstart");
    const allowed = !fire(heading, "dragover");
    expect(
      { allowed, highlighted: zone!.classList.contains("mr-drop-target") },
      "the heading takes the drop, and the zone lights up",
    ).to.deep.equal({ allowed: true, highlighted: true });
    fire(heading, "drop");
    fire(handle, "dragend");
    expect(
      zone!.classList.contains("mr-drop-target"),
      "the highlight goes with the drop",
    ).to.equal(false);
    await idle();
    expect(stepsInNote().map((step) => step.key)).to.deep.equal([c.key]);
    await untilSteps([c.key]);

    // An unordered paper's row drags back in below the step.
    const back = dragSession(win);
    back.fire(row(b.key), "dragstart");
    const below = middleY(row(c.key), 4);
    back.fire(row(c.key), "dragover", { y: below });
    back.fire(row(c.key), "drop", { y: below });
    back.fire(row(b.key), "dragend");
    await idle();
    expect(stepsInNote()).to.deep.equal([
      { key: c.key, why: "" },
      { key: b.key, why: "" },
    ]);
    await untilSteps([c.key, b.key]);
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
