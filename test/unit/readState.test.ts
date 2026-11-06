import { describe, it } from "node:test";
import { expect } from "chai";

import {
  emptyReadState,
  isPaperId,
  mergeReadStates,
  mirrorTag,
  nextUp,
  paperId,
  parseReadState,
  setState,
  stateOf,
  writeReadState,
  type ReadState,
  type ReadStateDoc,
} from "../../src/format/readState";
import { dataBlock } from "../../src/format/html";

describe("paperId", () => {
  it("prefers the DOI, else the library and key", () => {
    expect(
      paperId({
        doi: "https://doi.org/10.1000/ABC",
        library: { kind: "user" },
        key: "ABCD2345",
      }),
    ).to.equal("doi:10.1000/abc");
    expect(
      paperId({ doi: null, library: { kind: "user" }, key: "ABCD2345" }),
    ).to.equal("user:ABCD2345");
    expect(
      paperId({
        doi: "",
        library: { kind: "group", id: 123 },
        key: "BCDE3456",
      }),
    ).to.equal("group-123:BCDE3456");
  });

  it("recognises only the three id forms", () => {
    expect(isPaperId("doi:10.1000/abc")).to.equal(true);
    expect(isPaperId("user:ABCD2345")).to.equal(true);
    expect(isPaperId("group-1:ABCD2345")).to.equal(true);
    expect(isPaperId("__proto__")).to.equal(false);
    expect(isPaperId("user:abcd2345")).to.equal(false);
  });
});

describe("setState and stateOf", () => {
  it("leaves the old document alone and keeps Unread as a tombstone", () => {
    const empty = emptyReadState();
    const read = setState(
      empty,
      "user:ABCD2345",
      "read",
      "2026-11-01T00:00:00Z",
    );
    const unread = setState(
      read,
      "user:ABCD2345",
      "unread",
      "2026-11-02T00:00:00Z",
    );
    expect(stateOf(empty, "user:ABCD2345")).to.equal("unread");
    expect(stateOf(read, "user:ABCD2345")).to.equal("read");
    expect(unread.states["user:ABCD2345"]).to.deep.equal({
      state: "unread",
      at: "2026-11-02T00:00:00Z",
    });
  });
});

describe("mergeReadStates", () => {
  it("keeps the later change, and Read on a tie", () => {
    const a = setState(
      setState(
        emptyReadState(),
        "user:ABCD2345",
        "read",
        "2026-11-01T00:00:00Z",
      ),
      "user:BCDE3456",
      "reading",
      "2026-11-04T00:00:00Z",
    );
    const b = setState(
      setState(
        emptyReadState(),
        "user:ABCD2345",
        "unread",
        "2026-11-03T00:00:00Z",
      ),
      "user:BCDE3456",
      "read",
      "2026-11-04T00:00:00Z",
    );
    const merged = mergeReadStates(a, b);
    expect(stateOf(merged, "user:ABCD2345")).to.equal("unread");
    expect(stateOf(merged, "user:BCDE3456")).to.equal("read");
    expect(mergeReadStates(b, a)).to.deep.equal(merged);
  });
});

describe("merge determinism and dates", () => {
  const id = "user:ABCD2345";

  it("refuses to stamp a state with an unparsable date", () => {
    expect(() => setState(emptyReadState(), id, "read", "not a date")).to.throw(
      RangeError,
    );
  });

  it("lets the valid side win over an unparsable date, in either order", () => {
    const valid = setState(
      emptyReadState(),
      id,
      "unread",
      "2020-01-01T00:00:00Z",
    );
    const bad: ReadStateDoc = {
      version: 1,
      states: { [id]: { state: "read", at: "not a date" } },
    };
    expect(mergeReadStates(valid, bad).states[id]).to.deep.equal(
      valid.states[id],
    );
    expect(mergeReadStates(bad, valid).states[id]).to.deep.equal(
      valid.states[id],
    );
  });

  it("writes the same bytes for equal instants in either order", () => {
    const a = setState(emptyReadState(), id, "read", "2026-01-01T00:00:00Z");
    const b = setState(
      emptyReadState(),
      id,
      "read",
      "2026-01-01T00:00:00.000Z",
    );
    expect(writeReadState(mergeReadStates(a, b))).to.equal(
      writeReadState(mergeReadStates(b, a)),
    );
  });
});

describe("nextUp", () => {
  const steps = [{ key: "A" }, { key: "B" }, { key: "C" }];
  const states = (map: Record<string, ReadState>) => (key: string) =>
    map[key] ?? "unread";

  it("is the first Reading step, else the first Unread one", () => {
    expect(nextUp(steps, states({ A: "read", C: "reading" }))).to.equal("C");
    expect(nextUp(steps, states({ A: "read" }))).to.equal("B");
    expect(nextUp(steps, states({ A: "read", B: "read", C: "read" }))).to.equal(
      null,
    );
  });
});

describe("mirrorTag", () => {
  it("tags Reading and Read, and leaves Unread bare", () => {
    expect(mirrorTag("reading")).to.equal("_reading");
    expect(mirrorTag("read")).to.equal("_read");
    expect(mirrorTag("unread")).to.equal(null);
  });
});

describe("the state note", () => {
  it("reads back what it wrote, whatever order the states were set in", () => {
    const one = setState(
      setState(
        emptyReadState(),
        "user:BCDE3456",
        "read",
        "2026-11-02T00:00:00Z",
      ),
      "doi:10.1000/abc",
      "reading",
      "2026-11-01T00:00:00Z",
    );
    const two = setState(
      setState(
        emptyReadState(),
        "doi:10.1000/abc",
        "reading",
        "2026-11-01T00:00:00Z",
      ),
      "user:BCDE3456",
      "read",
      "2026-11-02T00:00:00Z",
    );
    expect(writeReadState(one)).to.equal(writeReadState(two));
    expect(parseReadState(writeReadState(one))).to.deep.equal({
      ok: true,
      value: one,
    });
    expect(writeReadState(one)).to.contain("<p>1 reading, 1 read.");
  });

  it("drops damaged entries and keeps the rest", () => {
    const html = dataBlock(
      "meristema-reading-state",
      JSON.stringify({
        version: 1,
        states: {
          "user:ABCD2345": { state: "read", at: "2026-11-01T00:00:00Z" },
          "user:BCDE3456": { state: "done", at: "2026-11-01T00:00:00Z" },
          "user:CDEF4567": { state: "read", at: "yesterday" },
          nonsense: { state: "read", at: "2026-11-01T00:00:00Z" },
        },
      }),
    );
    expect(parseReadState(html)).to.deep.equal({
      ok: true,
      value: {
        version: 1,
        states: {
          "user:ABCD2345": { state: "read", at: "2026-11-01T00:00:00Z" },
        },
      },
    });
  });
});
