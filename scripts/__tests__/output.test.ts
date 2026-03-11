import { describe, it, expect } from "vitest";
import {
  filterPRs,
  buildEngineerMap,
  computeMetrics,
  scoreEngineers,
  generateWhyBullets,
  runAnalysis,
} from "../lib/analyze.js";
import type { RawPR } from "../lib/types.js";
import samplePRs from "./fixtures/sample-prs.json";

const prs = samplePRs as RawPR[];
const days = 90;
const { filtered, botsFiltered, qualifying, scored } = runAnalysis(prs, days);

describe("runAnalysis pipeline", () => {
  it("returns filtered PRs without bots", () => {
    const logins = filtered.map((p) => p.author.login);
    expect(logins).not.toContain("dependabot");
  });

  it("counts bots filtered", () => {
    expect(botsFiltered).toBeGreaterThan(0);
  });

  it("qualifying engineers meet threshold", () => {
    for (const eng of qualifying) {
      expect(eng.prs.length >= 3 || eng.reviewsGivenList.length >= 5).toBe(true);
    }
  });

  it("scored engineers are sorted by compositeScore descending", () => {
    for (let i = 1; i < scored.length; i++) {
      expect(scored[i - 1].compositeScore).toBeGreaterThanOrEqual(
        scored[i].compositeScore
      );
    }
  });
});

describe("generateWhyBullets", () => {
  it("returns 1-3 bullets for each scored engineer", () => {
    for (const eng of scored) {
      const bullets = generateWhyBullets(eng, scored);
      expect(bullets.length).toBeGreaterThanOrEqual(1);
      expect(bullets.length).toBeLessThanOrEqual(3);
    }
  });

  it("bullets are non-empty strings", () => {
    for (const eng of scored) {
      const bullets = generateWhyBullets(eng, scored);
      for (const b of bullets) {
        expect(b.length).toBeGreaterThan(0);
        expect(b).toBeTypeOf("string");
      }
    }
  });

  it("bullets don't contain undefined or null text", () => {
    for (const eng of scored) {
      const bullets = generateWhyBullets(eng, scored);
      for (const b of bullets) {
        expect(b).not.toContain("undefined");
        expect(b).not.toContain("null");
        expect(b).not.toContain("NaN");
      }
    }
  });
});

describe("output structure validation", () => {
  const top5 = scored.slice(0, 5);

  it("top engineers have all required fields", () => {
    for (const eng of top5) {
      expect(eng.login).toBeTypeOf("string");
      expect(eng.login.length).toBeGreaterThan(0);
      expect(eng.name).toBeTypeOf("string");
      expect(eng.compositeScore).toBeTypeOf("number");
      expect(eng.dimensions).toBeDefined();
      expect(eng.dimensions.shipping).toBeTypeOf("number");
      expect(eng.dimensions.reach).toBeTypeOf("number");
      expect(eng.dimensions.reviewImpact).toBeTypeOf("number");
      expect(eng.dimensions.collaboration).toBeTypeOf("number");
      expect(eng.dimensions.changeSignificance).toBeTypeOf("number");
    }
  });

  it("weeklyActivity has valid entries", () => {
    for (const eng of top5) {
      expect(Array.isArray(eng.weeklyActivity)).toBe(true);
      for (const w of eng.weeklyActivity) {
        expect(w.week).toBeTypeOf("string");
        expect(w.mergedPrs).toBeGreaterThanOrEqual(0);
        expect(w.reviewsGiven).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("topDirectories has valid entries", () => {
    for (const eng of top5) {
      expect(Array.isArray(eng.topDirectories)).toBe(true);
      for (const d of eng.topDirectories) {
        expect(d.path).toBeTypeOf("string");
        expect(d.path.length).toBeGreaterThan(0);
        expect(d.fileCount).toBeGreaterThan(0);
      }
    }
  });

  it("topDirectories are sorted by fileCount descending", () => {
    for (const eng of top5) {
      for (let i = 1; i < eng.topDirectories.length; i++) {
        expect(eng.topDirectories[i - 1].fileCount).toBeGreaterThanOrEqual(
          eng.topDirectories[i].fileCount
        );
      }
    }
  });

  it("raw metrics have no NaN values", () => {
    for (const eng of top5) {
      expect(isNaN(eng.mergedPrCount)).toBe(false);
      expect(isNaN(eng.medianMergeHours)).toBe(false);
      expect(isNaN(eng.directoryEntropy)).toBe(false);
      expect(isNaN(eng.shippingConsistency)).toBe(false);
      expect(isNaN(eng.avgFilesChangedPerPr)).toBe(false);
      expect(isNaN(eng.avgNetLinesPerPr)).toBe(false);
      expect(isNaN(eng.nonTrivialPrRatio)).toBe(false);
      expect(isNaN(eng.crossAreaPrRatio)).toBe(false);
    }
  });
});

describe("cross-reference: metrics consistency", () => {
  it("engineer with more PRs has higher or equal mergedPrCount", () => {
    for (const eng of qualifying) {
      const totalWeeks = Math.ceil(days / 7);
      const m = computeMetrics(eng, totalWeeks);
      expect(m.mergedPrCount).toBe(eng.prs.length);
    }
  });

  it("scoring is deterministic (same input = same output)", () => {
    const { scored: scored2 } = runAnalysis(prs, days);
    for (let i = 0; i < scored.length; i++) {
      expect(scored[i].login).toBe(scored2[i].login);
      expect(scored[i].compositeScore).toBe(scored2[i].compositeScore);
    }
  });
});
