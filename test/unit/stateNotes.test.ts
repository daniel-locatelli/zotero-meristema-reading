import { describe, it } from "node:test";
import { expect } from "chai";
import { pickStateNotes } from "../../src/domain/stateNotes";
import {
  emptyReadState,
  setState,
  writeReadState,
  type ReadState,
} from "../../src/format/readState";

const A = "user:ABCD2345";
const X = "doi:10.1000/x";

function note(key: string, ...entries: [string, ReadState, string][]) {
  const doc = entries.reduce(
    (current, [id, state, at]) => setState(current, id, state, at),
    emptyReadState(),
  );
  return { key, html: writeReadState(doc) };
}

describe("pickStateNotes", () => {
  it("finds nothing in no notes", () => {
    expect(pickStateNotes([])).to.deep.equal({ kind: "none" });
  });

  it("keeps a single readable note as it is", () => {
    const pick = pickStateNotes([
      note("BBBB2222", [A, "read", "2026-11-01T00:00:00Z"]),
    ]);
    expect(pick).to.deep.equal({
      kind: "ok",
      keeper: "BBBB2222",
      doc: {
        version: 1,
        states: { [A]: { state: "read", at: "2026-11-01T00:00:00Z" } },
      },
      trash: [],
    });
  });

  it("merges into the note with the smaller key and trashes the other", () => {
    const pick = pickStateNotes([
      note("ZZZZ9999", [A, "reading", "2026-11-02T00:00:00Z"]),
      note(
        "BBBB2222",
        [A, "read", "2026-11-01T00:00:00Z"],
        [X, "read", "2026-11-01T00:00:00Z"],
      ),
    ]);
    expect(pick).to.deep.equal({
      kind: "ok",
      keeper: "BBBB2222",
      doc: {
        version: 1,
        states: {
          [A]: { state: "reading", at: "2026-11-02T00:00:00Z" },
          [X]: { state: "read", at: "2026-11-01T00:00:00Z" },
        },
      },
      trash: ["ZZZZ9999"],
    });
  });

  it("leaves a note it cannot read alone beside a readable one", () => {
    const pick = pickStateNotes([
      { key: "AAAA2222", html: "<p>not a state note</p>" },
      note("CCCC3333"),
    ]);
    expect(pick).to.deep.equal({
      kind: "ok",
      keeper: "CCCC3333",
      doc: { version: 1, states: {} },
      trash: [],
    });
  });

  it("is unreadable when no note can be read", () => {
    const html =
      '<pre data-meristema-reading-state="1">{"version":2,"states":{}}</pre>';
    expect(pickStateNotes([{ key: "AAAA2222", html }])).to.deep.equal({
      kind: "unreadable",
      keys: ["AAAA2222"],
    });
  });
});
