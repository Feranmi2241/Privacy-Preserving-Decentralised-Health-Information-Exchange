import { describe, it, expect } from "vitest";
import simulateConsensus from "./consensusSimulation";

describe("simulateConsensus (frontend)", () => {
  // n=5, f=1 throughout — matching the HIE system's configured parameters.
  // k = n - 3f = 2, threshold = f + 1 = 2.
  // These cases mirror test/consensusSimulation.test.ts exactly —
  // the whole point is proving the ported copy behaves identically to the original.

  it("all values identical → returns that one value", () => {
    const values = ["abc", "abc", "abc", "abc", "abc"];
    const result = simulateConsensus(values, 5, 1);
    expect(result).toEqual(["abc"]);
  });

  it("one Byzantine outlier out of 5 → majority value returned, outlier excluded", () => {
    const values = ["abc", "abc", "abc", "abc", "TAMPERED"];
    const result = simulateConsensus(values, 5, 1);
    expect(result).toContain("abc");
    expect(result).not.toContain("TAMPERED");
  });

  it("perfect split with no majority meeting threshold → returns [] (consensus failure)", () => {
    // 2 values each appear once — neither meets threshold of 2
    const values = ["aaa", "bbb"];
    const result = simulateConsensus(values, 5, 1);
    expect(result).toEqual([]);
  });

  it("exactly at threshold boundary (f + 1 = 2 agreements) → still counts as agreement", () => {
    // "abc" appears exactly 2 times — exactly at the threshold, must be accepted
    const values = ["abc", "abc", "xyz"];
    const result = simulateConsensus(values, 5, 1);
    expect(result).toContain("abc");
  });

  it("empty input array → returns [] without throwing", () => {
    const result = simulateConsensus([], 5, 1);
    expect(result).toEqual([]);
  });
});
