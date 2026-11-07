import { describe, it } from "node:test";
import { expect } from "chai";
import { stepCells, stepText } from "../../src/domain/stepColumn";

describe("stepCells", () => {
  const cells = stepCells({
    steps: [
      { step: 1, key: "BBBB2222", why: "" },
      { step: 2, key: "AAAA2222", why: "then this" },
    ],
    unordered: ["CCCC3333", "DDDD4444"],
  });

  it("gives every paper its place, unordered ones marked", () => {
    expect([...cells]).to.deep.equal([
      ["BBBB2222", "00001"],
      ["AAAA2222", "00002"],
      ["CCCC3333", "00003u"],
      ["DDDD4444", "00004u"],
    ]);
  });

  it("sorts as a plain string into reading order", () => {
    const values = [...cells.values()];
    expect([...values].reverse().sort()).to.deep.equal(values);
  });
});

describe("stepText", () => {
  it("shows a step's number and nothing for an unordered paper", () => {
    expect(stepText("00002")).to.equal("2");
    expect(stepText("00003u")).to.equal("");
    expect(stepText("")).to.equal("");
  });
});
