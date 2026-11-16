import { describe, it } from "node:test";
import { expect } from "chai";
import {
  buildOverview,
  progressText,
  type OverviewList,
} from "../../src/domain/overview";
import type { ReadState } from "../../src/format/readState";

const list = (
  noteID: number,
  topic: string,
  steps: string[],
  extra: Partial<OverviewList> = {},
): OverviewList => ({
  noteID,
  noteKey: `NOTE${noteID}AAA`.slice(0, 8),
  collectionID: noteID * 10,
  libraryName: null,
  folderName: topic,
  topic,
  steps,
  readable: true,
  ...extra,
});

const states =
  (map: Record<string, ReadState>) =>
  (_list: OverviewList, key: string): ReadState =>
    map[key] ?? "unread";

describe("overview", () => {
  it("says there is no queue", () => {
    const o = buildOverview({
      lists: [list(1, "A", ["K1"])],
      queue: null,
      duplicates: [],
      stateOf: states({}),
    });
    expect(o.queue).to.deep.equal({ status: "none" });
    expect(o.rows.map((r) => r.list.noteID)).to.deep.equal([1]);
  });

  it("puts next up large and the other open steps after it, in order", () => {
    const q = list(9, "Reading queue", ["K1", "K2", "K3", "K4"]);
    const o = buildOverview({
      lists: [q],
      queue: 9,
      duplicates: [],
      stateOf: states({ K2: "reading", K4: "read" }),
    });
    expect(o.queue).to.deep.equal({
      status: "ok",
      list: q,
      nextUp: "K2",
      after: ["K1", "K3"],
    });
    expect(o.rows, "the queue is not a row").to.deep.equal([]);
  });

  it("shows at most five after next up", () => {
    const keys = ["K1", "K2", "K3", "K4", "K5", "K6", "K7", "K8"];
    const o = buildOverview({
      lists: [list(9, "Q", keys)],
      queue: 9,
      duplicates: [],
      stateOf: states({}),
    });
    expect(o.queue.status === "ok" && o.queue.after).to.deep.equal([
      "K2",
      "K3",
      "K4",
      "K5",
      "K6",
    ]);
  });

  it("tells an empty queue from an all-read one and an unreadable one", () => {
    const empty = buildOverview({
      lists: [list(9, "Q", [])],
      queue: 9,
      duplicates: [],
      stateOf: states({}),
    });
    expect(empty.queue.status).to.equal("empty");
    const done = buildOverview({
      lists: [list(9, "Q", ["K1"])],
      queue: 9,
      duplicates: [],
      stateOf: states({ K1: "read" }),
    });
    expect(done.queue.status).to.equal("all-read");
    const broken = buildOverview({
      lists: [list(9, "Q", [], { readable: false })],
      queue: 9,
      duplicates: [],
      stateOf: states({}),
    });
    expect(broken.queue.status).to.equal("unreadable");
  });

  it("orders rows by topic, counts progress, and keeps duplicates as rows", () => {
    const o = buildOverview({
      lists: [
        list(2, "beta", ["K1", "K2", "K3"]),
        list(3, "Alpha", ["K4"]),
        list(9, "Q", ["K1"]),
        list(4, "Q2", ["K5"]),
      ],
      queue: 9,
      duplicates: [4],
      stateOf: states({ K1: "read", K2: "reading", K4: "read" }),
    });
    expect(o.rows.map((r) => r.list.noteID)).to.deep.equal([3, 2, 4]);
    expect(o.rows[1].progress).to.deep.equal({
      read: 1,
      reading: 1,
      unread: 1,
    });
    expect(o.rows[1].nextUp).to.equal("K2");
    expect(o.rows[0].nextUp, "every step read").to.equal(null);
    expect(o.duplicates.map((l) => l.noteID)).to.deep.equal([4]);
  });

  it("writes progress with middle dots", () => {
    expect(progressText({ read: 3, reading: 1, unread: 4 })).to.equal(
      "3 read · 1 reading · 4 left",
    );
  });
});
