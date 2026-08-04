import { expect } from "chai";
import simulateConsensus from "../shared/consensusSimulation.js";

describe("simulateConsensus (backend)", function () {
  // n=5, f=1 throughout — matching the HIE system's configured parameters.
  // k = n - 3f = 2, threshold = f + 1 = 2.

  it("all values identical → returns that one value", function () {
    const values = ["abc", "abc", "abc", "abc", "abc"];
    const result = simulateConsensus(values, 5, 1);
    expect(result).to.deep.equal(["abc"]);
  });

  it("one Byzantine outlier out of 5 → majority value returned, outlier excluded", function () {
    const values = ["abc", "abc", "abc", "abc", "TAMPERED"];
    const result = simulateConsensus(values, 5, 1);
    expect(result).to.include("abc");
    expect(result).to.not.include("TAMPERED");
  });

  it("perfect split with no majority meeting threshold → returns [] (consensus failure)", function () {
    // 2 values each appear once — neither meets threshold of 2
    const values = ["aaa", "bbb"];
    const result = simulateConsensus(values, 5, 1);
    expect(result).to.deep.equal([]);
  });

  it("exactly at threshold boundary (f + 1 = 2 agreements) → still counts as agreement", function () {
    // "abc" appears exactly 2 times — exactly at the threshold, must be accepted
    const values = ["abc", "abc", "xyz"];
    const result = simulateConsensus(values, 5, 1);
    expect(result).to.include("abc");
  });

  it("empty input array → returns [] without throwing", function () {
    const result = simulateConsensus([], 5, 1);
    expect(result).to.deep.equal([]);
  });
});
