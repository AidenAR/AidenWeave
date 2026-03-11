import { describe, it, expect } from "vitest";
import {
  median,
  p90,
  shannonEntropy,
  getTopDir,
  getSecondLevelDir,
  percentileRank,
  percentileRankInverse,
  computeMetrics,
  scoreEngineers,
  buildEngineerMap,
  filterPRs,
  DIMENSION_WEIGHTS,
} from "../lib/analyze.js";
import type { RawPR, EngineerData } from "../lib/types.js";
import samplePRs from "./fixtures/sample-prs.json";

const prs = samplePRs as RawPR[];
const { filtered } = filterPRs(prs);
const engineerMap = buildEngineerMap(filtered);
const totalWeeks = 13;

describe("math helpers", () => {
  it("median of empty is 0", () => {
    expect(median([])).toBe(0);
  });

  it("median of odd-length array", () => {
    expect(median([1, 3, 5])).toBe(3);
  });

  it("median of even-length array", () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  it("p90 of empty is 0", () => {
    expect(p90([])).toBe(0);
  });

  it("p90 returns high percentile", () => {
    const vals = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(p90(vals)).toBe(91);
  });

  it("shannonEntropy of single value is 0", () => {
    const m = new Map([["a", 10]]);
    expect(shannonEntropy(m)).toBe(0);
  });

  it("shannonEntropy of uniform distribution is maximized", () => {
    const m2 = new Map([["a", 5], ["b", 5]]);
    const m3 = new Map([["a", 5], ["b", 5], ["c", 5]]);
    expect(shannonEntropy(m3)).toBeGreaterThan(shannonEntropy(m2));
  });

  it("shannonEntropy of empty map is 0", () => {
    expect(shannonEntropy(new Map())).toBe(0);
  });
});

describe("directory helpers", () => {
  it("getTopDir extracts first path segment", () => {
    expect(getTopDir("frontend/src/App.tsx")).toBe("frontend");
    expect(getTopDir("README.md")).toBe("README.md");
  });

  it("getSecondLevelDir extracts first two segments", () => {
    expect(getSecondLevelDir("frontend/src/App.tsx")).toBe("frontend/src");
    expect(getSecondLevelDir("README.md")).toBe("README.md");
  });
});

describe("percentileRank", () => {
  it("returns 0 for the lowest value", () => {
    expect(percentileRank([1, 2, 3, 4, 5], 1)).toBe(0);
  });

  it("returns near 100 for the highest value", () => {
    expect(percentileRank([1, 2, 3, 4, 5], 5)).toBe(80);
  });

  it("is monotonically non-decreasing", () => {
    const values = [10, 20, 30, 40, 50];
    let prev = -1;
    for (const v of values) {
      const r = percentileRank(values, v);
      expect(r).toBeGreaterThanOrEqual(prev);
      prev = r;
    }
  });

  it("inverse: lower values get higher rank", () => {
    const values = [5, 10, 20, 50, 100];
    const maxVal = Math.max(...values);
    const low = percentileRankInverse(values, 5, maxVal);
    const high = percentileRankInverse(values, 100, maxVal);
    expect(low).toBeGreaterThan(high);
  });
});

describe("computeMetrics", () => {
  it("computes shippingConsistency in [0, 1]", () => {
    for (const eng of engineerMap.values()) {
      const m = computeMetrics(eng, totalWeeks);
      expect(m.shippingConsistency).toBeGreaterThanOrEqual(0);
      expect(m.shippingConsistency).toBeLessThanOrEqual(1);
    }
  });

  it("mergedPrCount matches actual PR count", () => {
    const alice = engineerMap.get("alice")!;
    const m = computeMetrics(alice, totalWeeks);
    expect(m.mergedPrCount).toBe(alice.prs.length);
  });

  it("reviewsGiven excludes self-reviews", () => {
    // Alice reviewed Bob's PR 1004 and Carol's PRs, but never her own
    const alice = engineerMap.get("alice")!;
    const m = computeMetrics(alice, totalWeeks);
    expect(m.reviewsGiven).toBe(alice.reviewsGivenList.length);
    // No review in the list should be for alice's own PR
    for (const r of alice.reviewsGivenList) {
      expect(r.authorLogin).not.toBe("alice");
    }
  });

  it("medianMergeHours is non-negative", () => {
    for (const eng of engineerMap.values()) {
      const m = computeMetrics(eng, totalWeeks);
      expect(m.medianMergeHours).toBeGreaterThanOrEqual(0);
    }
  });

  it("directoryEntropy is non-negative", () => {
    for (const eng of engineerMap.values()) {
      const m = computeMetrics(eng, totalWeeks);
      expect(m.directoryEntropy).toBeGreaterThanOrEqual(0);
    }
  });

  it("nonTrivialPrRatio is in [0, 1]", () => {
    for (const eng of engineerMap.values()) {
      const m = computeMetrics(eng, totalWeeks);
      expect(m.nonTrivialPrRatio).toBeGreaterThanOrEqual(0);
      expect(m.nonTrivialPrRatio).toBeLessThanOrEqual(1);
    }
  });

  it("crossAreaPrRatio is in [0, 1]", () => {
    for (const eng of engineerMap.values()) {
      const m = computeMetrics(eng, totalWeeks);
      expect(m.crossAreaPrRatio).toBeGreaterThanOrEqual(0);
      expect(m.crossAreaPrRatio).toBeLessThanOrEqual(1);
    }
  });
});

describe("scoreEngineers", () => {
  const qualifying = Array.from(engineerMap.values()).filter(
    (e) => e.prs.length >= 3 || e.reviewsGivenList.length >= 5
  );
  const metrics = qualifying.map((e) => computeMetrics(e, totalWeeks));
  const scored = scoreEngineers(metrics);

  it("all dimension scores are in [0, 100]", () => {
    for (const eng of scored) {
      for (const [key, val] of Object.entries(eng.dimensions)) {
        expect(val, `${eng.login}.${key}`).toBeGreaterThanOrEqual(0);
        expect(val, `${eng.login}.${key}`).toBeLessThanOrEqual(100);
      }
    }
  });

  it("compositeScore is in [0, 100]", () => {
    for (const eng of scored) {
      expect(eng.compositeScore).toBeGreaterThanOrEqual(0);
      expect(eng.compositeScore).toBeLessThanOrEqual(100);
    }
  });

  it("dimension weights sum to 1.0", () => {
    const sum = Object.values(DIMENSION_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1.0);
  });

  it("compositeScore is a weighted average of dimensions", () => {
    for (const eng of scored) {
      const expected =
        eng.dimensions.shipping * DIMENSION_WEIGHTS.shipping +
        eng.dimensions.reach * DIMENSION_WEIGHTS.reach +
        eng.dimensions.reviewImpact * DIMENSION_WEIGHTS.reviewImpact +
        eng.dimensions.collaboration * DIMENSION_WEIGHTS.collaboration +
        eng.dimensions.changeSignificance * DIMENSION_WEIGHTS.changeSignificance;
      expect(eng.compositeScore).toBeCloseTo(Math.round(expected * 10) / 10, 0);
    }
  });
});

describe("DIMENSION_WEIGHTS", () => {
  it("has exactly 5 dimensions", () => {
    expect(Object.keys(DIMENSION_WEIGHTS)).toHaveLength(5);
  });

  it("all weights are positive", () => {
    for (const w of Object.values(DIMENSION_WEIGHTS)) {
      expect(w).toBeGreaterThan(0);
    }
  });
});
