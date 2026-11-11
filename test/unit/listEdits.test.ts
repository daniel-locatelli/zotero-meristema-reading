import { describe, it } from "node:test";
import { expect } from "chai";
import {
  liveSteps,
  nextState,
  placeStep,
  placeStepAt,
  sameSteps,
  setWhy,
  shiftStep,
  unplaceStep,
} from "../../src/domain/listEdits";

const A = { key: "AAAA2222", why: "first" };
const B = { key: "BBBB2222", why: "" };
const C = { key: "CCCC3333", why: "third" };
const keys = (steps: { key: string }[]) => steps.map((step) => step.key);

describe("liveSteps", () => {
  it("keeps the resolved steps and their reasons", () => {
    expect(
      liveSteps({
        steps: [
          { step: 1, key: A.key, why: A.why },
          { step: 2, key: C.key, why: C.why },
        ],
        unordered: [B.key],
      }),
    ).to.deep.equal([A, C]);
  });
});

describe("placeStep", () => {
  it("moves a step before another, keeping its reason", () => {
    expect(placeStep([A, B, C], C.key, A.key)).to.deep.equal([C, A, B]);
  });

  it("moves a step to the end", () => {
    expect(placeStep([A, B, C], A.key, null)).to.deep.equal([B, C, A]);
  });

  it("adds an unordered paper with no reason", () => {
    expect(placeStep([A, C], "DDDD4444", C.key)).to.deep.equal([
      A,
      { key: "DDDD4444", why: "" },
      C,
    ]);
  });

  it("changes nothing for a step placed before itself or before a stranger", () => {
    const steps = [A, B];
    expect(placeStep(steps, A.key, A.key)).to.equal(steps);
    expect(placeStep(steps, A.key, "ZZZZ9999")).to.equal(steps);
  });
});

describe("placeStepAt", () => {
  it("moves a step up to an index among the other steps, keeping its reason", () => {
    expect(placeStepAt([A, B, C], C.key, 0)).to.deep.equal([C, A, B]);
  });

  it("moves a step down to an index among the other steps", () => {
    expect(placeStepAt([A, B, C], A.key, 1)).to.deep.equal([B, A, C]);
    expect(placeStepAt([A, B, C], A.key, 2)).to.deep.equal([B, C, A]);
  });

  it("adds an unordered paper at the index with no reason", () => {
    expect(placeStepAt([A, C], "DDDD4444", 1)).to.deep.equal([
      A,
      { key: "DDDD4444", why: "" },
      C,
    ]);
  });

  it("places a step last for an index past the end, first for one below zero", () => {
    expect(placeStepAt([A, B, C], A.key, 9)).to.deep.equal([B, C, A]);
    expect(placeStepAt([A, C], "DDDD4444", 9)).to.deep.equal([
      A,
      C,
      { key: "DDDD4444", why: "" },
    ]);
    expect(placeStepAt([A, B, C], C.key, -1)).to.deep.equal([C, A, B]);
  });
});

describe("unplaceStep", () => {
  it("takes a step out", () => {
    expect(unplaceStep([A, B, C], B.key)).to.deep.equal([A, C]);
  });
});

describe("shiftStep", () => {
  it("moves a step one place either way", () => {
    expect(keys(shiftStep([A, B, C], A.key, 1))).to.deep.equal([
      B.key,
      A.key,
      C.key,
    ]);
    expect(keys(shiftStep([A, B, C], B.key, 1))).to.deep.equal([
      A.key,
      C.key,
      B.key,
    ]);
    expect(keys(shiftStep([A, B, C], C.key, -1))).to.deep.equal([
      A.key,
      C.key,
      B.key,
    ]);
  });

  it("leaves a step at an end where it is", () => {
    const steps = [A, B];
    expect(shiftStep(steps, A.key, -1)).to.equal(steps);
    expect(shiftStep(steps, B.key, 1)).to.equal(steps);
    expect(shiftStep(steps, "ZZZZ9999", 1)).to.equal(steps);
  });
});

describe("setWhy and sameSteps", () => {
  it("replaces one step's reason", () => {
    expect(setWhy([A, B], B.key, "because")).to.deep.equal([
      A,
      { key: B.key, why: "because" },
    ]);
  });

  it("compares keys and reasons in order", () => {
    expect(sameSteps([A, B], [{ ...A }, { ...B }])).to.equal(true);
    expect(sameSteps([A, B], [B, A])).to.equal(false);
    expect(sameSteps([A, B], [A, { key: B.key, why: "x" }])).to.equal(false);
    expect(sameSteps([A], [A, B])).to.equal(false);
  });
});

describe("nextState", () => {
  it("cycles Unread, Reading, Read", () => {
    expect(nextState("unread")).to.equal("reading");
    expect(nextState("reading")).to.equal("read");
    expect(nextState("read")).to.equal("unread");
  });
});
