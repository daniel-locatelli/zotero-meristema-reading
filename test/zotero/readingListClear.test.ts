/// <reference types="mocha" />
import { expect } from "chai";
import { config } from "../../package.json";
import {
  parseReadingList,
  READING_LIST_TAG,
  writeReadingList,
} from "../../src/format/readingList";
import {
  collectionMenuEntry,
  command,
  idle,
  makeListNote,
  makePaper,
  markThroughMenu,
  plugin,
  stateNotes,
} from "./helpers";

const CLEAR = `${config.addonRef}-clear-reading-list`;

describe("Clearing a reading list", function () {
  this.timeout(60_000);
  let win: any;
  let collection: any;
  let papers: Zotero.Item[];
  let bare: any;

  const note = (c: any): Zotero.Item =>
    c
      .getChildItems(false, false)
      .find((i: Zotero.Item) => i.isNote() && i.hasTag(READING_LIST_TAG));
  const stepKeys = (): string[] => {
    const parsed = parseReadingList(note(collection).getNote()) as any;
    return parsed.ok
      ? parsed.value.steps.map((s: any) => s.key)
      : ["unreadable"];
  };
  const stateHtml = async (): Promise<string> =>
    (await stateNotes()).map((n) => n.getNote()).join("|");

  /** Runs the menu command with Services.prompt answering `button`. */
  async function clearWith(button: number): Promise<string[]> {
    const asked: string[] = [];
    const services = Services as any;
    const own = Object.getOwnPropertyDescriptor(services, "prompt");
    Object.defineProperty(services, "prompt", {
      configurable: true,
      value: {
        STD_OK_CANCEL_BUTTONS: 513,
        confirmEx(_w: unknown, title: string, text: string) {
          asked.push(`${title}: ${text}`);
          return button;
        },
        alert() {},
      },
    });
    try {
      const { popup, entry } = await collectionMenuEntry(
        win,
        collection.id,
        CLEAR,
      );
      expect(Boolean(entry) && !entry.hidden, "Clear offered").to.equal(true);
      const reached = command(entry);
      popup.hidePopup();
      await reached;
      await idle();
    } finally {
      await idle();
      if (own) Object.defineProperty(services, "prompt", own);
      else delete services.prompt;
    }
    return asked;
  }

  before(async function () {
    win = Zotero.getMainWindows()[0];
    collection = new Zotero.Collection();
    collection.libraryID = Zotero.Libraries.userLibraryID;
    collection.name = "Clear fixture";
    await collection.saveTx();
    bare = new Zotero.Collection();
    bare.libraryID = Zotero.Libraries.userLibraryID;
    bare.name = "Clear fixture without list";
    await bare.saveTx();
    papers = [];
    for (const t of ["Clear one", "Clear two", "Clear three"]) {
      papers.push(await makePaper(t, undefined, collection.id));
    }
    const n = await makeListNote(
      collection.id,
      writeReadingList(
        {
          version: 1,
          topic: "Clear fixture",
          steps: papers.map((p) => ({ key: p.key, why: "" })),
        },
        (k) => k,
        { kind: "user" },
      ),
    );
    void n;
    await idle();
    await markThroughMenu(win, [papers[0].id], "read");
    await markThroughMenu(win, [papers[1].id], "reading");
  });

  after(async function () {
    await win.ZoteroPane.collectionsView.selectLibrary(
      Zotero.Libraries.userLibraryID,
    );
    await Zotero.Items.erase([note(collection).id, ...papers.map((p) => p.id)]);
    await collection.eraseTx();
    await bare.eraseTx();
    await idle();
  });

  it("changes nothing when cancelled, after asking", async function () {
    const states = await stateHtml();
    const asked = await clearWith(1);
    expect(asked, "one warning").to.have.length(1);
    expect(asked[0]).to.contain(
      "Clear the steps of “Clear fixture”? Its 3 papers",
    );
    expect(stepKeys(), "steps kept").to.deep.equal(papers.map((p) => p.key));
    expect(await stateHtml(), "read states kept").to.equal(states);
  });

  it("is hidden for a folder with no list", async function () {
    const { popup, entry } = await collectionMenuEntry(win, bare.id, CLEAR);
    popup.hidePopup();
    expect(Boolean(entry) && !entry.hidden, "Clear offered").to.equal(false);
  });

  it("is hidden in a read-only library", async function () {
    const library: any = Zotero.Libraries.get(Zotero.Libraries.userLibraryID);
    Object.defineProperty(library, "editable", {
      configurable: true,
      get: () => false,
    });
    try {
      const { popup, entry } = await collectionMenuEntry(
        win,
        collection.id,
        CLEAR,
      );
      popup.hidePopup();
      expect(Boolean(entry) && !entry.hidden, "Clear offered").to.equal(false);
    } finally {
      delete library.editable;
    }
  });

  it("empties the steps when confirmed, keeping papers, note and read states", async function () {
    const states = await stateHtml();
    await clearWith(0);
    expect(stepKeys(), "no steps").to.deep.equal([]);
    expect(
      collection
        .getChildItems(false, false)
        .filter((i: Zotero.Item) => i.isRegularItem()).length,
      "papers in the folder",
    ).to.equal(3);
    expect(
      papers.map((p) =>
        /^\d{5}u$/.test(plugin().api.stepCell(p.id, collection.id)),
      ),
      "all under Not in the steps",
    ).to.deep.equal([true, true, true]);
    expect(await stateHtml(), "read states kept").to.equal(states);
  });

  it("does nothing, and asks nothing, for a list with no steps", async function () {
    const asked = await clearWith(0);
    expect(asked, "no warning").to.have.length(0);
    expect(stepKeys()).to.deep.equal([]);
  });
});
