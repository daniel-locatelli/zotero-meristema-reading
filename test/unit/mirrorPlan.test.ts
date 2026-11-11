import { describe, it } from "node:test";
import { expect } from "chai";
import { planMirror } from "../../src/domain/mirrorPlan";
import { emptyReadState, setState } from "../../src/format/readState";

const AT = "2026-11-01T00:00:00Z";
const DOI = "doi:10.1000/abc";
const READING = "user:ABCD2345";
const TOMBSTONE = "user:BCDE3456";
const doc = [
  [DOI, "read"],
  [READING, "reading"],
  [TOMBSTONE, "unread"],
].reduce(
  (current, [id, state]) =>
    setState(current, id, state as "read" | "reading" | "unread", AT),
  emptyReadState(),
);

describe("planMirror", () => {
  it("adds the tag of a marked paper", () => {
    expect(
      planMirror(doc, [
        { id: 1, paperId: DOI, tags: ["topic"], listed: false },
      ]),
    ).to.deep.equal([{ id: 1, add: ["_read"], remove: [] }]);
  });

  it("swaps a stale tag for the state's own", () => {
    expect(
      planMirror(doc, [
        { id: 2, paperId: READING, tags: ["_read"], listed: false },
      ]),
    ).to.deep.equal([{ id: 2, add: ["_reading"], remove: ["_read"] }]);
  });

  it("takes the other tags off an Unread paper, stored or absent", () => {
    expect(
      planMirror(doc, [
        { id: 3, paperId: TOMBSTONE, tags: ["_read"], listed: false },
        {
          id: 4,
          paperId: "user:CDEF4567",
          tags: ["_reading", "_read"],
          listed: true,
        },
      ]),
    ).to.deep.equal([
      { id: 3, add: [], remove: ["_read"] },
      { id: 4, add: ["_unread"], remove: ["_reading", "_read"] },
    ]);
  });

  it("tags an Unread paper in a reading list", () => {
    expect(
      planMirror(doc, [{ id: 9, paperId: TOMBSTONE, tags: [], listed: true }]),
    ).to.deep.equal([{ id: 9, add: ["_unread"], remove: [] }]);
  });

  it("untags an Unread paper in no reading list", () => {
    expect(
      planMirror(doc, [
        { id: 10, paperId: TOMBSTONE, tags: ["_unread"], listed: false },
      ]),
    ).to.deep.equal([{ id: 10, add: [], remove: ["_unread"] }]);
  });

  it("swaps _unread for _read, listed or not", () => {
    expect(
      planMirror(doc, [
        { id: 11, paperId: DOI, tags: ["_unread"], listed: true },
        { id: 12, paperId: DOI, tags: ["_unread"], listed: false },
      ]),
    ).to.deep.equal([
      { id: 11, add: ["_read"], remove: ["_unread"] },
      { id: 12, add: ["_read"], remove: ["_unread"] },
    ]);
  });

  it("never touches a reader's own tags", () => {
    expect(
      planMirror(doc, [
        {
          id: 6,
          paperId: READING,
          tags: ["my-topic", "_read", "_reading2"],
          listed: false,
        },
      ]),
    ).to.deep.equal([{ id: 6, add: ["_reading"], remove: ["_read"] }]);
  });

  it("tags every item that shares a paper id", () => {
    expect(
      planMirror(doc, [
        { id: 7, paperId: DOI, tags: [], listed: false },
        { id: 8, paperId: DOI, tags: ["my-topic"], listed: false },
      ]),
    ).to.deep.equal([
      { id: 7, add: ["_read"], remove: [] },
      { id: 8, add: ["_read"], remove: [] },
    ]);
  });

  it("plans nothing for items already right", () => {
    expect(
      planMirror(doc, [
        { id: 1, paperId: DOI, tags: ["_read", "topic"], listed: false },
        { id: 5, paperId: "user:DEFG5678", tags: [], listed: false },
      ]),
    ).to.deep.equal([]);
  });
});
