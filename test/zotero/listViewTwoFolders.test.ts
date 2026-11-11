/// <reference types="mocha" />
import { expect } from "chai";
import {
  parseReadingList,
  writeReadingList,
  type ReadingListDoc,
  type ReadingListStep,
} from "../../src/format/readingList";
import {
  altArrow,
  drag,
  delay,
  dragSession,
  idle,
  makeListNote,
  makePaper,
  plugin,
  rowKeys,
  waitFor,
} from "./helpers";

const HTML = "http://www.w3.org/1999/xhtml";

interface Fixture {
  collection: any;
  papers: Zotero.Item[];
  note: Zotero.Item;
}

/** A folder holding two papers and a list of both, each with a reason. */
async function fixture(topic: string): Promise<Fixture> {
  const collection = new Zotero.Collection();
  collection.libraryID = Zotero.Libraries.userLibraryID;
  collection.name = topic;
  await collection.saveTx();
  const papers = [
    await makePaper(`${topic} paper one`, undefined, collection.id),
    await makePaper(`${topic} paper two`, undefined, collection.id),
  ];
  const note = await makeListNote(
    collection.id,
    writeReadingList(
      {
        version: 1,
        topic,
        steps: papers.map((paper) => ({ key: paper.key, why: "a reason" })),
      },
      (key) => key,
      { kind: "user" },
    ),
  );
  return { collection, papers, note };
}

function stepsOf(note: Zotero.Item): ReadingListStep[] {
  const parsed = parseReadingList(note.getNote());
  expect(parsed.ok, `the list note parses: ${note.getNote()}`).to.equal(true);
  return (parsed as { ok: true; value: ReadingListDoc }).value.steps;
}

describe("Two folders' reading lists", function () {
  this.timeout(60_000);
  let win: any;
  let first: Fixture;
  let second: Fixture;

  before(async function () {
    win = Zotero.getMainWindows()[0];
    first = await fixture("First folder");
    second = await fixture("Second folder");
    await idle();
  });

  after(async function () {
    win.Zotero_Tabs.select("zotero-pane");
    await win.ZoteroPane.collectionsView.selectLibrary(
      Zotero.Libraries.userLibraryID,
    );
    for (const { collection, papers, note } of [first, second]) {
      await Zotero.Items.erase([note.id, ...papers.map((paper) => paper.id)]);
      await collection.eraseTx();
    }
    await idle();
  });

  it("keeps the folder selected since when a step moved from a reason saves", async function () {
    const view = () =>
      win.document.querySelector(".mr-list.mr-sidebar") as HTMLElement | null;
    const topic = () => view()?.querySelector(".mr-topic")?.textContent ?? null;
    const [one] = first.papers;
    const [other] = second.papers;
    win.Zotero_Tabs.select("zotero-pane");
    await win.ZoteroPane.collectionsView.selectCollection(first.collection.id);
    await win.ZoteroPane.selectItem(one.id);
    expect(
      await waitFor(
        () => rowKeys(view(), ".mr-current").join() === one.key,
        10_000,
      ),
      `the section draws the first folder; it shows ${topic()}`,
    ).to.equal(true);

    // Hold the plugin's queue: a note event reads the state notes, which
    // waits here until released, so the move's save stays queued behind it.
    const tags = Zotero.Tags as any;
    const real = tags.getTagItems;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let held = 0;
    tags.getTagItems = function (...args: unknown[]) {
      held++;
      return gate.then(() => real.apply(this, args));
    };
    const blocker = new Zotero.Item("note");
    blocker.libraryID = Zotero.Libraries.userLibraryID;
    blocker.setNote("<p>Holds the queue</p>");
    blocker.setCollections([first.collection.id]);
    const drawn: Array<string | null> = [];
    const observer = new win.MutationObserver(() => drawn.push(topic()));
    try {
      await blocker.saveTx({ skipSelect: true });
      expect(
        await waitFor(() => held > 0, 10_000),
        "the queue is held",
      ).to.equal(true);

      const row = view()!.querySelector(
        `[data-key="${one.key}"]`,
      ) as HTMLElement;
      const why = row.querySelector(".mr-why") as HTMLTextAreaElement;
      why.focus();
      why.value = "moved with its reason";
      why.dispatchEvent(new win.Event("input", { bubbles: true }));
      altArrow(win, why, "ArrowDown");
      // The reader clicks another paper: the reason loses the focus.
      why.blur();

      // Another folder's paper, selected while the move waits to save.
      await win.ZoteroPane.collectionsView.selectCollection(
        second.collection.id,
      );
      await win.ZoteroPane.selectItem(other.id);
      expect(
        await waitFor(
          () => rowKeys(view(), ".mr-current").join() === other.key,
          10_000,
        ),
        `the section draws the second folder; it shows ${topic()}`,
      ).to.equal(true);
      const body = view()!;
      observer.observe(body, { childList: true });
    } finally {
      tags.getTagItems = real;
      release();
    }
    await idle();
    await delay(300);
    await idle();
    observer.disconnect();
    await Zotero.Items.erase([blocker.id]);
    await idle();

    expect(
      stepsOf(first.note).map((step) => [step.key, step.why]),
      "the move saved",
    ).to.deep.equal([
      [first.papers[1].key, "a reason"],
      [one.key, "moved with its reason"],
    ]);
    const active = win.document.activeElement as HTMLElement | null;
    expect(
      {
        drawn: drawn.filter((text) => text !== "Second folder"),
        topic: topic(),
        current: rowKeys(view(), ".mr-current"),
        focusInFirst: Boolean(
          active?.closest?.(`[data-key="${one.key}"]`) ||
          active?.closest?.(`[data-key="${first.papers[1].key}"]`),
        ),
      },
      `after the save; redraws showed ${JSON.stringify(drawn)}`,
    ).to.deep.equal({
      drawn: [],
      topic: "Second folder",
      current: [other.key],
      focusInFirst: false,
    });
  });

  it("takes no step dragged from another folder's list", async function () {
    const container = (collectionID: number) => {
      const node = win.document.createElementNS(HTML, "div") as HTMLElement;
      win.document.documentElement.append(node);
      plugin().api.renderList(node, collectionID, {
        mode: "tab",
        currentKey: null,
        editable: true,
      });
      return node;
    };
    const from = container(first.collection.id);
    const to = container(second.collection.id);
    try {
      const firstSteps = stepsOf(first.note);
      const secondSteps = stepsOf(second.note);
      const handle = from.querySelector(
        `[data-key="${first.papers[0].key}"] .mr-handle`,
      )!;
      const target = to.querySelector(`[data-key="${second.papers[0].key}"]`)!;
      const { fire } = dragSession(win);
      fire(handle, "dragstart");
      const allowed = {
        steps: !fire(target, "dragover"),
        unordered: !fire(to.querySelector(".mr-unordered-zone")!, "dragover"),
      };
      fire(handle, "dragend");
      drag(win, handle, target);
      drag(win, handle, to.querySelector(".mr-unordered")!);
      await idle();
      expect(
        {
          allowed,
          first: stepsOf(first.note),
          second: stepsOf(second.note),
        },
        "a drop from another list is refused",
      ).to.deep.equal({
        allowed: { steps: false, unordered: false },
        first: firstSteps,
        second: secondSteps,
      });
    } finally {
      from.remove();
      to.remove();
    }
  });
});
