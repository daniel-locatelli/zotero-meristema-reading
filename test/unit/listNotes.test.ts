import { describe, it } from "node:test";
import { expect } from "chai";
import {
  newListOrder,
  pickListNote,
  stepLabel,
} from "../../src/domain/listNotes";
import { writeReadingList } from "../../src/format/readingList";

function listHtml(topic: string): string {
  return writeReadingList({ version: 1, topic, steps: [] }, (key) => key, {
    kind: "user",
  });
}

describe("pickListNote", () => {
  it("is null for a folder with no list note", () => {
    expect(pickListNote([])).to.equal(null);
  });

  it("picks the oldest note, by date added then key, and ignores the rest", () => {
    const pick = pickListNote([
      {
        id: 3,
        key: "CCCC3333",
        dateAdded: "2026-11-02 10:00:00",
        html: listHtml("third"),
      },
      {
        id: 1,
        key: "DDDD4444",
        dateAdded: "2026-11-01 10:00:00",
        html: listHtml("tied, larger key"),
      },
      {
        id: 2,
        key: "BBBB2222",
        dateAdded: "2026-11-01 10:00:00",
        html: listHtml("chosen"),
      },
    ]);
    expect(pick).to.deep.equal({
      id: 2,
      parsed: { ok: true, value: { version: 1, topic: "chosen", steps: [] } },
      ignored: [1, 3],
    });
  });

  it("returns the chosen note even when it cannot be read", () => {
    expect(
      pickListNote([
        {
          id: 1,
          key: "AAAA2222",
          dateAdded: "2026-11-01 10:00:00",
          html: "<p>x</p>",
        },
      ]),
    ).to.deep.equal({
      id: 1,
      parsed: { ok: false, reason: "no-data" },
      ignored: [],
    });
  });
});

describe("newListOrder", () => {
  const folder = [
    { key: "AAAA2222", title: "beta" },
    { key: "BBBB2222", title: "Alpha" },
    { key: "CCCC3333", title: "gamma" },
  ];

  it("follows the item list, then sorts by title the papers it did not show", () => {
    expect(
      newListOrder(folder, ["CCCC3333", "ZZZZ9999", "AAAA2222", "CCCC3333"]),
    ).to.deep.equal(["CCCC3333", "AAAA2222", "BBBB2222"]);
  });

  it("sorts by title when the item list shows another folder", () => {
    expect(newListOrder(folder, null)).to.deep.equal([
      "BBBB2222",
      "AAAA2222",
      "CCCC3333",
    ]);
  });
});

describe("stepLabel", () => {
  it("joins author, year and title", () => {
    expect(
      stepLabel({ creator: "Lovelace", year: "1843", title: "Notes" }),
    ).to.equal("Lovelace, 1843, Notes");
  });

  it("leaves out what is missing, and names an untitled paper", () => {
    expect(stepLabel({ creator: "", year: "0000", title: " " })).to.equal(
      "Untitled",
    );
    expect(
      stepLabel({
        creator: "Babbage and Lovelace",
        year: "",
        title: "Engines",
      }),
    ).to.equal("Babbage and Lovelace, Engines");
    expect(stepLabel({ creator: "Ada", year: "c.19", title: "T" })).to.equal(
      "Ada, T",
    );
  });
});
