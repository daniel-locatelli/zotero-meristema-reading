import { describe, it } from "node:test";
import { expect } from "chai";
import { enqueue, isBusy, stopQueue } from "../../src/zotero/queue";

describe("the store queue", () => {
  it("lets queued work finish on stop, then takes no more", async () => {
    const ran: string[] = [];
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = enqueue(async () => {
      await held;
      ran.push("first");
    });
    const second = enqueue(async () => {
      ran.push("second");
    });
    const drained = stopQueue();
    const late = enqueue(async () => {
      ran.push("late");
    });
    release();
    await Promise.all([first, second, late, drained]);
    expect(ran, "the queued work ran, the late work did not").to.deep.equal([
      "first",
      "second",
    ]);
    expect(isBusy(), "nothing left running").to.equal(false);
  });
});
