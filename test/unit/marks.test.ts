import { describe, it } from "node:test";
import { expect } from "chai";
import { applyMark } from "../../src/domain/marks";
import { emptyReadState, setState } from "../../src/format/readState";

const DOI = "doi:10.1000/abc";
const KEY = "user:ABCD2345";
const T1 = "2026-11-01T10:00:00.000Z";
const T2 = "2026-11-02T10:00:00.000Z";

describe("applyMark", () => {
  it("stores a mark for a paper with no entry", () => {
    const next = applyMark(emptyReadState(), [DOI, KEY], "read", T1);
    expect(next.states).to.deep.equal({
      [DOI]: { state: "read", at: T1 },
      [KEY]: { state: "read", at: T1 },
    });
  });

  it("writes Unread only over a stored entry, as a tombstone", () => {
    const doc = setState(emptyReadState(), DOI, "read", T1);
    const next = applyMark(doc, [DOI, KEY], "unread", T2);
    expect(next.states).to.deep.equal({ [DOI]: { state: "unread", at: T2 } });
  });

  it("returns the same document when nothing changes", () => {
    const empty = emptyReadState();
    expect(applyMark(empty, [KEY], "unread", T1)).to.equal(empty);
    const doc = setState(emptyReadState(), DOI, "reading", T1);
    expect(applyMark(doc, [DOI], "reading", T2)).to.equal(doc);
  });

  it("keeps the date of a paper already in the state", () => {
    const doc = setState(emptyReadState(), DOI, "read", T1);
    const next = applyMark(doc, [DOI, KEY, KEY], "read", T2);
    expect(next.states).to.deep.equal({
      [DOI]: { state: "read", at: T1 },
      [KEY]: { state: "read", at: T2 },
    });
  });

  it("refuses an id that is not a paper id", () => {
    expect(() =>
      applyMark(emptyReadState(), ["__proto__"], "read", T1),
    ).to.throw(RangeError);
  });
});
