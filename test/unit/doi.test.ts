import { describe, it } from "node:test";
import { expect } from "chai";

import { normalizeDOI } from "../../src/format/doi";

describe("normalizeDOI", () => {
  it("strips the resolver, the prefix and trailing punctuation, and lowercases", () => {
    expect(normalizeDOI("https://doi.org/10.1000/ABC.")).to.equal(
      "10.1000/abc",
    );
    expect(normalizeDOI("doi: 10.1000/Xyz")).to.equal("10.1000/xyz");
  });

  it("returns null for anything that is not a DOI", () => {
    expect(normalizeDOI("")).to.equal(null);
    expect(normalizeDOI(null)).to.equal(null);
    expect(normalizeDOI("not a doi")).to.equal(null);
  });
});
