import { describe, it } from "node:test";
import { expect } from "chai";
import { parseOpenTabs, withoutTab, withTab } from "../../src/domain/openTabs";

const a = { libraryID: 1, collectionKey: "AAAA1111" };
const b = { libraryID: 1, collectionKey: "BBBB2222" };
const c = { libraryID: 2, collectionKey: "AAAA1111" };

describe("the open-tab record", () => {
  it("reads the tabs it wrote", () => {
    expect(parseOpenTabs(JSON.stringify([a, c]))).to.deep.equal([a, c]);
  });

  it("reads bad JSON, or JSON that is not a list, as no tabs", () => {
    expect(parseOpenTabs("")).to.deep.equal([]);
    expect(parseOpenTabs("{not json")).to.deep.equal([]);
    expect(parseOpenTabs('{"libraryID":1}')).to.deep.equal([]);
    expect(parseOpenTabs("null")).to.deep.equal([]);
  });

  it("drops bad entries and keeps the good ones", () => {
    const json = JSON.stringify([
      a,
      null,
      "BBBB2222",
      { libraryID: "1", collectionKey: "BBBB2222" },
      { libraryID: 1.5, collectionKey: "BBBB2222" },
      { libraryID: 1, collectionKey: "" },
      { libraryID: 1 },
      { libraryID: 1, collectionKey: "BBBB2222", extra: true },
    ]);
    expect(parseOpenTabs(json)).to.deep.equal([a, b]);
  });

  it("reads a tab listed twice once", () => {
    expect(parseOpenTabs(JSON.stringify([a, b, a]))).to.deep.equal([a, b]);
  });

  it("appends a tab, once", () => {
    expect(withTab([a], b)).to.deep.equal([a, b]);
    expect(withTab([a, b], { ...a })).to.deep.equal([a, b]);
    expect(withTab([a], c), "the same key in another library").to.deep.equal([
      a,
      c,
    ]);
  });

  it("removes a tab, and leaves a list without it alone", () => {
    expect(withoutTab([a, b, c], { ...b })).to.deep.equal([a, c]);
    expect(withoutTab([a], b)).to.deep.equal([a]);
  });

  it("leaves the list it was given unchanged", () => {
    const list = [a];
    withTab(list, b);
    withoutTab(list, a);
    expect(list).to.deep.equal([a]);
  });
});
