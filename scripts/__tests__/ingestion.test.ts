import { describe, it, expect } from "vitest";
import { isBot, filterPRs, BOT_LOGINS } from "../lib/analyze.js";
import type { RawPR } from "../lib/types.js";
import samplePRs from "./fixtures/sample-prs.json";

const prs = samplePRs as RawPR[];

describe("isBot", () => {
  it("identifies known bot logins", () => {
    for (const login of BOT_LOGINS) {
      expect(isBot(login)).toBe(true);
    }
  });

  it("identifies [bot] suffix", () => {
    expect(isBot("renovate[bot]")).toBe(true);
    expect(isBot("my-custom[bot]")).toBe(true);
  });

  it("identifies -bot and -app suffixes", () => {
    expect(isBot("some-service-bot")).toBe(true);
    expect(isBot("github-app")).toBe(true);
  });

  it("identifies Bot type", () => {
    expect(isBot("random-user", "Bot")).toBe(true);
  });

  it("passes real humans", () => {
    expect(isBot("alice", "User")).toBe(false);
    expect(isBot("bob")).toBe(false);
    expect(isBot("carol", "User")).toBe(false);
  });

  it("treats empty login as bot", () => {
    expect(isBot("")).toBe(true);
  });
});

describe("filterPRs", () => {
  it("removes bot-authored PRs", () => {
    const { filtered, botsFiltered } = filterPRs(prs);
    const logins = filtered.map((pr) => pr.author.login);
    expect(logins).not.toContain("dependabot");
    expect(botsFiltered).toBeGreaterThan(0);
  });

  it("removes auto-merges (merged in under 60s)", () => {
    const { filtered } = filterPRs(prs);
    // PR 1011 merges in 30 seconds
    const numbers = filtered.map((pr) => pr.number);
    expect(numbers).not.toContain(1011);
  });

  it("keeps legitimate human PRs", () => {
    const { filtered } = filterPRs(prs);
    const numbers = filtered.map((pr) => pr.number);
    expect(numbers).toContain(1001);
    expect(numbers).toContain(1004);
    expect(numbers).toContain(1012);
  });

  it("does not include PRs with zero file changes", () => {
    const prWithZeroFiles: RawPR = {
      ...prs[0],
      number: 9999,
      changedFiles: 0,
      files: [],
    };
    const { filtered } = filterPRs([...prs, prWithZeroFiles]);
    expect(filtered.map((p) => p.number)).not.toContain(9999);
  });

  it("has no duplicate PR numbers after filtering", () => {
    const { filtered } = filterPRs(prs);
    const numbers = filtered.map((pr) => pr.number);
    expect(new Set(numbers).size).toBe(numbers.length);
  });
});

describe("raw PR schema validation", () => {
  it("every PR has required fields", () => {
    for (const pr of prs) {
      expect(pr.number).toBeTypeOf("number");
      expect(pr.createdAt).toBeTypeOf("string");
      expect(pr.mergedAt).toBeTypeOf("string");
      expect(pr.author).toBeDefined();
      expect(pr.author.login).toBeTypeOf("string");
      expect(Array.isArray(pr.files)).toBe(true);
      expect(Array.isArray(pr.reviews)).toBe(true);
    }
  });

  it("mergedAt is after createdAt for all PRs", () => {
    for (const pr of prs) {
      expect(new Date(pr.mergedAt).getTime()).toBeGreaterThanOrEqual(
        new Date(pr.createdAt).getTime()
      );
    }
  });

  it("additions and deletions are non-negative", () => {
    for (const pr of prs) {
      expect(pr.additions).toBeGreaterThanOrEqual(0);
      expect(pr.deletions).toBeGreaterThanOrEqual(0);
    }
  });
});
