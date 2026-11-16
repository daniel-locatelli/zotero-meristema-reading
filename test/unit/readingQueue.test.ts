import { describe, it } from "node:test";
import { expect } from "chai";
import {
  READING_QUEUE_TAG,
  pickQueue,
  sourceLists,
} from "../../src/format/readingQueue";

describe("reading queue", () => {
  it("names the tag", () => {
    expect(READING_QUEUE_TAG).to.equal("meristema-reading-queue");
  });
  it("picks nothing from nothing", () => {
    expect(pickQueue([])).to.deep.equal({ queue: null, duplicates: [] });
  });
  it("gives every queue key an entry, even with no lists", () => {
    expect(sourceLists("NQAAAAAA", ["PAPRAAAA"], [])).to.deep.equal({
      PAPRAAAA: [],
    });
  });
});
