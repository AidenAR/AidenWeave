import type { RawPR, EngineerData, ComputedMetrics, ScoredEngineer } from "./types.js";

// ─── Bot filtering ────────────────────────────────────────────────────────────

export const BOT_LOGINS = new Set([
  "dependabot",
  "github-actions",
  "posthog-bot",
  "codecov",
  "netlify",
  "vercel",
  "renovate",
  "snyk-bot",
  "imgbot",
  "stale",
  "greenkeeper",
  "mergify",
  "kodiakhq",
  "allcontributors",
]);

export function isBot(login: string, type?: string): boolean {
  if (!login) return true;
  const l = login.toLowerCase();
  if (BOT_LOGINS.has(l)) return true;
  if (l.includes("[bot]") || l.endsWith("-bot") || l.endsWith("-app")) return true;
  if (type === "Bot") return true;
  return false;
}

export function filterPRs(prs: RawPR[]) {
  let botsFiltered = 0;
  const filtered = prs.filter((pr) => {
    if (isBot(pr.author.login, pr.author.type)) {
      botsFiltered++;
      return false;
    }
    if (pr.changedFiles === 0) return false;
    const mergeMs =
      new Date(pr.mergedAt).getTime() - new Date(pr.createdAt).getTime();
    if (mergeMs < 60_000) return false;
    return true;
  });
  return { filtered, botsFiltered };
}

// ─── Math helpers ─────────────────────────────────────────────────────────────

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function p90(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.floor(sorted.length * 0.9);
  return sorted[Math.min(idx, sorted.length - 1)];
}

export function shannonEntropy(counts: Map<string, number>): number {
  const total = Array.from(counts.values()).reduce((s, v) => s + v, 0);
  if (total === 0) return 0;
  let entropy = 0;
  for (const count of counts.values()) {
    if (count === 0) continue;
    const p = count / total;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

// ─── Directory helpers ────────────────────────────────────────────────────────

export function getTopDir(path: string): string {
  return path.split("/")[0] || path;
}

export function getSecondLevelDir(path: string): string {
  const parts = path.split("/");
  if (parts.length >= 2) return `${parts[0]}/${parts[1]}`;
  return parts[0];
}

// ─── Week helpers ─────────────────────────────────────────────────────────────

export function getIsoWeek(date: Date): string {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

export function getWeekStartDate(date: Date): string {
  const d = new Date(date);
  const day = d.getUTCDay();
  const diff = d.getUTCDate() - day + (day === 0 ? -6 : 1);
  d.setUTCDate(diff);
  return d.toISOString().slice(0, 10);
}

// ─── Engineer grouping ────────────────────────────────────────────────────────

export function buildEngineerMap(prs: RawPR[]): Map<string, EngineerData> {
  const map = new Map<string, EngineerData>();

  for (const pr of prs) {
    const login = pr.author.login;
    if (!map.has(login)) {
      map.set(login, {
        login,
        name: pr.author.name ?? login,
        avatarUrl: pr.author.avatarUrl,
        prs: [],
        reviewsGivenList: [],
      });
    }
    map.get(login)!.prs.push(pr);
  }

  for (const pr of prs) {
    for (const review of pr.reviews) {
      if (isBot(review.login, review.type)) continue;
      if (review.login === pr.author.login) continue;
      if (!map.has(review.login)) {
        map.set(review.login, {
          login: review.login,
          name: review.login,
          avatarUrl: "",
          prs: [],
          reviewsGivenList: [],
        });
      }
      map.get(review.login)!.reviewsGivenList.push({
        prNumber: pr.number,
        authorLogin: pr.author.login,
        state: review.state,
        submittedAt: review.submittedAt,
        prCreatedAt: pr.createdAt,
        prMerged: true,
      });
    }
  }

  return map;
}

// ─── Metric computation ───────────────────────────────────────────────────────

export function computeMetrics(eng: EngineerData, totalWeeks: number): ComputedMetrics {
  const prs = eng.prs;

  const mergeHours = prs.map(
    (pr) =>
      (new Date(pr.mergedAt).getTime() - new Date(pr.createdAt).getTime()) /
      3_600_000
  );
  const weekSet = new Set(prs.map((pr) => getIsoWeek(new Date(pr.mergedAt))));

  const topDirCounts = new Map<string, number>();
  const secondDirs = new Set<string>();
  const prTopDirs: Set<string>[] = [];
  for (const pr of prs) {
    const prDirs = new Set<string>();
    for (const f of pr.files) {
      const top = getTopDir(f);
      prDirs.add(top);
      topDirCounts.set(top, (topDirCounts.get(top) || 0) + 1);
      secondDirs.add(getSecondLevelDir(f));
    }
    prTopDirs.push(prDirs);
  }
  const crossAreaPrs = prTopDirs.filter((d) => d.size >= 2).length;
  const multiAreaPrs = prTopDirs.filter((d) => d.size >= 3).length;

  const reviews = eng.reviewsGivenList;
  const reviewedAuthors = new Set(reviews.map((r) => r.authorLogin));
  const reviewTurnarounds = reviews
    .filter((r) => r.submittedAt && r.prCreatedAt)
    .map(
      (r) =>
        (new Date(r.submittedAt).getTime() -
          new Date(r.prCreatedAt).getTime()) /
        3_600_000
    )
    .filter((h) => h >= 0 && h < 720);

  const collaborators = new Set<string>();
  const reviewedByMe = new Set(reviews.map((r) => r.authorLogin));
  const reviewedMe = new Set<string>();
  for (const pr of prs) {
    for (const r of pr.reviews) {
      if (r.login !== eng.login && !isBot(r.login, r.type)) {
        collaborators.add(r.login);
        reviewedMe.add(r.login);
      }
    }
  }
  for (const author of reviewedByMe) {
    collaborators.add(author);
  }
  const bidirectional = new Set(
    [...reviewedByMe].filter((a) => reviewedMe.has(a))
  );

  const netLinesPerPr = prs.map((pr) =>
    Math.min(pr.additions + pr.deletions, 2000)
  );
  const filesPerPr = prs.map((pr) => pr.changedFiles);
  const nonTrivialPrs = prs.filter((pr) => pr.changedFiles >= 3).length;

  const weeklyMap = new Map<string, { mergedPrs: number; reviewsGiven: number }>();
  for (const pr of prs) {
    const w = getWeekStartDate(new Date(pr.mergedAt));
    const entry = weeklyMap.get(w) ?? { mergedPrs: 0, reviewsGiven: 0 };
    entry.mergedPrs++;
    weeklyMap.set(w, entry);
  }
  for (const r of reviews) {
    if (r.submittedAt) {
      const w = getWeekStartDate(new Date(r.submittedAt));
      const entry = weeklyMap.get(w) ?? { mergedPrs: 0, reviewsGiven: 0 };
      entry.reviewsGiven++;
      weeklyMap.set(w, entry);
    }
  }
  const weeklyActivity = Array.from(weeklyMap.entries())
    .map(([week, data]) => ({ week, ...data }))
    .sort((a, b) => a.week.localeCompare(b.week));

  const dirFileCount = new Map<string, number>();
  for (const pr of prs) {
    for (const f of pr.files) {
      const d = getSecondLevelDir(f);
      dirFileCount.set(d, (dirFileCount.get(d) || 0) + 1);
    }
  }
  const topDirectories = Array.from(dirFileCount.entries())
    .map(([path, fileCount]) => ({ path, fileCount }))
    .sort((a, b) => b.fileCount - a.fileCount)
    .slice(0, 8);

  return {
    login: eng.login,
    name: eng.name,
    avatarUrl: eng.avatarUrl,
    mergedPrCount: prs.length,
    activeWeeks: weekSet.size,
    totalWeeks,
    shippingConsistency: totalWeeks > 0 ? weekSet.size / totalWeeks : 0,
    medianMergeHours: median(mergeHours),
    p90MergeHours: p90(mergeHours),
    uniqueTopDirs: topDirCounts.size,
    uniqueSecondLevelDirs: secondDirs.size,
    directoryEntropy: shannonEntropy(topDirCounts),
    crossAreaPrRatio: prs.length > 0 ? crossAreaPrs / prs.length : 0,
    reviewsGiven: reviews.length,
    uniqueAuthorsReviewed: reviewedAuthors.size,
    reviewsOnMergedPrs: reviews.length,
    medianReviewTurnaroundHours: median(reviewTurnarounds),
    uniqueCollaborators: collaborators.size,
    bidirectionalCollaborators: bidirectional.size,
    commentCount: 0,
    avgFilesChangedPerPr: prs.length > 0 ? filesPerPr.reduce((a, b) => a + b, 0) / prs.length : 0,
    avgNetLinesPerPr: prs.length > 0 ? netLinesPerPr.reduce((a, b) => a + b, 0) / prs.length : 0,
    multiAreaPrCount: multiAreaPrs,
    nonTrivialPrRatio: prs.length > 0 ? nonTrivialPrs / prs.length : 0,
    weeklyActivity,
    topDirectories,
  };
}

// ─── Scoring ──────────────────────────────────────────────────────────────────

export function percentileRank(values: number[], value: number): number {
  const lower = values.filter((v) => v < value).length;
  return (lower / values.length) * 100;
}

export function percentileRankInverse(
  values: number[],
  value: number,
  maxVal: number
): number {
  return percentileRank(values, maxVal - value + (maxVal - Math.min(...values)));
}

export const DIMENSION_WEIGHTS = {
  shipping: 0.3,
  reach: 0.2,
  reviewImpact: 0.2,
  collaboration: 0.15,
  changeSignificance: 0.15,
} as const;

export function scoreEngineers(engineers: ComputedMetrics[]): ScoredEngineer[] {
  const vals = (key: keyof ComputedMetrics) =>
    engineers.map((e) => e[key] as number);

  const mergedPrCounts = vals("mergedPrCount");
  const consistencies = vals("shippingConsistency");
  const medianMerges = vals("medianMergeHours");
  const secondLevelDirs = vals("uniqueSecondLevelDirs");
  const entropies = vals("directoryEntropy");
  const crossAreaRatios = vals("crossAreaPrRatio");
  const reviewsGivens = vals("reviewsGiven");
  const uniqueAuthors = vals("uniqueAuthorsReviewed");
  const reviewsMerged = vals("reviewsOnMergedPrs");
  const collabs = vals("uniqueCollaborators");
  const biCollabs = vals("bidirectionalCollaborators");
  const comments = vals("commentCount");
  const avgFiles = vals("avgFilesChangedPerPr");
  const multiAreas = vals("multiAreaPrCount");
  const nonTrivials = vals("nonTrivialPrRatio");

  const maxMerge = Math.max(...medianMerges);

  return engineers.map((e) => {
    const shipping =
      (percentileRank(mergedPrCounts, e.mergedPrCount) +
        percentileRank(consistencies, e.shippingConsistency) +
        percentileRankInverse(medianMerges, e.medianMergeHours, maxMerge)) /
      3;

    const reach =
      (percentileRank(secondLevelDirs, e.uniqueSecondLevelDirs) +
        percentileRank(entropies, e.directoryEntropy) +
        percentileRank(crossAreaRatios, e.crossAreaPrRatio)) /
      3;

    const reviewImpact =
      (percentileRank(reviewsGivens, e.reviewsGiven) +
        percentileRank(uniqueAuthors, e.uniqueAuthorsReviewed) +
        percentileRank(reviewsMerged, e.reviewsOnMergedPrs)) /
      3;

    const collaboration =
      (percentileRank(collabs, e.uniqueCollaborators) +
        percentileRank(biCollabs, e.bidirectionalCollaborators) +
        percentileRank(comments, e.commentCount)) /
      3;

    const changeSignificance =
      (percentileRank(avgFiles, e.avgFilesChangedPerPr) +
        percentileRank(multiAreas, e.multiAreaPrCount) +
        percentileRank(nonTrivials, e.nonTrivialPrRatio)) /
      3;

    const compositeScore =
      shipping * DIMENSION_WEIGHTS.shipping +
      reach * DIMENSION_WEIGHTS.reach +
      reviewImpact * DIMENSION_WEIGHTS.reviewImpact +
      collaboration * DIMENSION_WEIGHTS.collaboration +
      changeSignificance * DIMENSION_WEIGHTS.changeSignificance;

    return {
      ...e,
      dimensions: {
        shipping: Math.round(shipping * 10) / 10,
        reach: Math.round(reach * 10) / 10,
        reviewImpact: Math.round(reviewImpact * 10) / 10,
        collaboration: Math.round(collaboration * 10) / 10,
        changeSignificance: Math.round(changeSignificance * 10) / 10,
      },
      compositeScore: Math.round(compositeScore * 10) / 10,
    };
  });
}

// ─── "Why" bullets ────────────────────────────────────────────────────────────

export function generateWhyBullets(
  eng: ScoredEngineer,
  allEngineers: ScoredEngineer[]
): string[] {
  const bullets: { text: string; score: number }[] = [];

  const rank = (
    key: keyof ComputedMetrics,
    _value: number,
    direction: "high" | "low" = "high"
  ) => {
    const sorted =
      direction === "high"
        ? [...allEngineers].sort((a, b) => (b[key] as number) - (a[key] as number))
        : [...allEngineers].sort((a, b) => (a[key] as number) - (b[key] as number));
    return sorted.findIndex((e) => e.login === eng.login) + 1;
  };

  const total = allEngineers.length;

  if (eng.mergedPrCount > 0) {
    const r = rank("mergedPrCount", eng.mergedPrCount);
    const label =
      r === 1
        ? "most prolific shipper"
        : r <= 3
        ? `top ${r} shipper`
        : `top ${Math.round((r / total) * 100)}%`;
    bullets.push({
      text: `Shipped ${eng.mergedPrCount} PRs across ${eng.activeWeeks} of ${eng.totalWeeks} weeks — ${label}`,
      score: eng.dimensions.shipping,
    });
  }

  if (eng.shippingConsistency >= 0.7) {
    bullets.push({
      text: `Active ${eng.activeWeeks} of ${eng.totalWeeks} weeks (${Math.round(eng.shippingConsistency * 100)}% consistency) — steady cadence`,
      score: eng.dimensions.shipping * 0.8,
    });
  }

  if (eng.medianMergeHours < 24 && eng.mergedPrCount >= 5) {
    const r = rank("medianMergeHours", eng.medianMergeHours, "low");
    const label = r <= 3 ? `${r === 1 ? "fastest" : `#${r} fastest`} merge cycles` : "fast merge cycles";
    bullets.push({
      text: `Median merge time of ${eng.medianMergeHours.toFixed(1)}h — ${label}`,
      score: eng.dimensions.shipping * 0.7,
    });
  }

  if (eng.reviewsGiven > 0) {
    const r = rank("reviewsGiven", eng.reviewsGiven);
    const label =
      r === 1
        ? "top reviewer on the team"
        : r <= 3
        ? `#${r} most active reviewer`
        : `reviewed widely`;
    bullets.push({
      text: `Reviewed ${eng.reviewsGiven} PRs from ${eng.uniqueAuthorsReviewed} authors — ${label}`,
      score: eng.dimensions.reviewImpact,
    });
  }

  if (eng.uniqueSecondLevelDirs >= 5) {
    const r = rank("uniqueSecondLevelDirs", eng.uniqueSecondLevelDirs);
    const label =
      r === 1
        ? "broadest codebase reach"
        : r <= 3
        ? `top ${r} broadest reach`
        : "wide reach";
    bullets.push({
      text: `Touched ${eng.uniqueSecondLevelDirs} codebase areas — ${label}`,
      score: eng.dimensions.reach,
    });
  }

  if (eng.crossAreaPrRatio >= 0.3) {
    bullets.push({
      text: `${Math.round(eng.crossAreaPrRatio * 100)}% of PRs span multiple areas — cross-cutting contributor`,
      score: eng.dimensions.reach * 0.8,
    });
  }

  if (eng.uniqueCollaborators >= 5) {
    const r = rank("uniqueCollaborators", eng.uniqueCollaborators);
    const label =
      r === 1
        ? "most connected engineer"
        : r <= 3
        ? `top ${r} most connected`
        : "strong collaborator";
    bullets.push({
      text: `Collaborated with ${eng.uniqueCollaborators} teammates (${eng.bidirectionalCollaborators} bidirectional) — ${label}`,
      score: eng.dimensions.collaboration,
    });
  }

  if (eng.nonTrivialPrRatio >= 0.6 && eng.mergedPrCount >= 5) {
    bullets.push({
      text: `${Math.round(eng.nonTrivialPrRatio * 100)}% non-trivial PRs, avg ${eng.avgFilesChangedPerPr.toFixed(0)} files per PR — substantial changes`,
      score: eng.dimensions.changeSignificance,
    });
  }

  bullets.sort((a, b) => b.score - a.score);
  return bullets.slice(0, 3).map((b) => b.text);
}

// ─── Full analysis pipeline ───────────────────────────────────────────────────

export function runAnalysis(prs: RawPR[], days: number) {
  const { filtered, botsFiltered } = filterPRs(prs);
  const engineerMap = buildEngineerMap(filtered);
  const totalWeeks = Math.ceil(days / 7);

  const qualifying = Array.from(engineerMap.values()).filter(
    (e) => e.prs.length >= 3 || e.reviewsGivenList.length >= 5
  );

  const metrics = qualifying.map((e) => computeMetrics(e, totalWeeks));
  const scored = scoreEngineers(metrics);
  scored.sort((a, b) => b.compositeScore - a.compositeScore);

  return { filtered, botsFiltered, qualifying, scored };
}
