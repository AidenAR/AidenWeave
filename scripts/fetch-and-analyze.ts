import { writeFileSync, readFileSync, mkdirSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { parseArgs } from "./lib/config.js";
import { createClient, fetchAllPRs, fetchAllPRsParallel } from "./lib/github.js";
import { runAnalysis, generateWhyBullets, DIMENSION_WEIGHTS } from "./lib/analyze.js";
import type { RawPR } from "./lib/types.js";

// ─── Cache helpers ────────────────────────────────────────────────────────────

function loadCache(cachePath: string): RawPR[] {
  try {
    if (!existsSync(cachePath)) return [];
    const raw = readFileSync(cachePath, "utf-8");
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    console.log(`Loaded ${data.length} cached PRs from ${cachePath}`);
    return data;
  } catch (err) {
    console.warn(`Cache read failed, starting fresh: ${err}`);
    return [];
  }
}

function saveCache(cachePath: string, prs: RawPR[]) {
  mkdirSync(dirname(cachePath), { recursive: true });
  writeFileSync(cachePath, JSON.stringify(prs));
  console.log(`Saved ${prs.length} PRs to cache`);
}

function mergePRs(cached: RawPR[], fresh: RawPR[]): RawPR[] {
  const map = new Map<number, RawPR>();
  for (const pr of cached) map.set(pr.number, pr);
  for (const pr of fresh) map.set(pr.number, pr);
  return Array.from(map.values());
}

function prunePRs(prs: RawPR[], windowStart: Date): RawPR[] {
  return prs.filter((pr) => new Date(pr.mergedAt) >= windowStart);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const config = parseArgs(process.argv);
  const { owner, repo, days, windowStart, windowEnd } = config;

  console.log(`Fetching merged PRs from ${owner}/${repo} (last ${days} days)...`);
  console.log(`Window: ${windowStart.toISOString().slice(0, 10)} to ${windowEnd.toISOString().slice(0, 10)}`);

  const client = createClient(config.token);

  let allPrs: RawPR[];

  if (config.full) {
    console.log("Full fetch mode (--full)");
    allPrs = await fetchAllPRsParallel(client, config);
  } else {
    const cached = loadCache(config.cachePath);
    if (cached.length === 0) {
      console.log("No cache found, doing full parallel fetch...");
      allPrs = await fetchAllPRsParallel(client, config);
    } else {
      const knownNumbers = new Set(cached.map((pr) => pr.number));
      console.log(`Incremental fetch (${knownNumbers.size} PRs in cache)...`);
      const { prs: freshPrs } = await fetchAllPRs(client, config, knownNumbers);
      console.log(`Fetched ${freshPrs.length} new PRs`);
      allPrs = mergePRs(cached, freshPrs);
    }
  }

  allPrs = prunePRs(allPrs, windowStart);
  saveCache(config.cachePath, allPrs);

  console.log(`Total PRs in window: ${allPrs.length}`);

  const { filtered, botsFiltered, qualifying, scored } = runAnalysis(allPrs, days);

  console.log(`After filtering: ${filtered.length} PRs (${botsFiltered} bot PRs removed)`);
  console.log(`${qualifying.length} engineers qualify (≥3 PRs or ≥5 reviews)`);

  const top5 = scored.slice(0, 5);
  const reviewsAnalyzed = filtered.reduce((sum, pr) => sum + pr.reviews.length, 0);

  const output = {
    generatedAt: new Date().toISOString(),
    summary: {
      repo: `${owner}/${repo}`,
      windowStart: windowStart.toISOString().slice(0, 10),
      windowEnd: windowEnd.toISOString().slice(0, 10),
      prsAnalyzed: filtered.length,
      reviewsAnalyzed,
      engineersAnalyzed: qualifying.length,
      botsFiltered,
    },
    topEngineers: top5.map((eng, idx) => ({
      login: eng.login,
      name: eng.name || eng.login,
      avatarUrl: eng.avatarUrl,
      rank: idx + 1,
      compositeScore: eng.compositeScore,
      why: generateWhyBullets(eng, scored),
      dimensions: eng.dimensions,
      raw: {
        mergedPrCount: eng.mergedPrCount,
        activeWeeks: eng.activeWeeks,
        totalWeeks: eng.totalWeeks,
        shippingConsistency: eng.shippingConsistency,
        medianMergeHours: Math.round(eng.medianMergeHours * 10) / 10,
        p90MergeHours: Math.round(eng.p90MergeHours * 10) / 10,
        uniqueTopDirs: eng.uniqueTopDirs,
        uniqueSecondLevelDirs: eng.uniqueSecondLevelDirs,
        directoryEntropy: Math.round(eng.directoryEntropy * 100) / 100,
        crossAreaPrRatio: Math.round(eng.crossAreaPrRatio * 100) / 100,
        reviewsGiven: eng.reviewsGiven,
        uniqueAuthorsReviewed: eng.uniqueAuthorsReviewed,
        reviewsOnMergedPrs: eng.reviewsOnMergedPrs,
        medianReviewTurnaroundHours: Math.round(eng.medianReviewTurnaroundHours * 10) / 10,
        uniqueCollaborators: eng.uniqueCollaborators,
        bidirectionalCollaborators: eng.bidirectionalCollaborators,
        commentCount: eng.commentCount,
        avgFilesChangedPerPr: Math.round(eng.avgFilesChangedPerPr * 10) / 10,
        avgNetLinesPerPr: Math.round(eng.avgNetLinesPerPr),
        multiAreaPrCount: eng.multiAreaPrCount,
        nonTrivialPrRatio: Math.round(eng.nonTrivialPrRatio * 100) / 100,
      },
      weeklyActivity: eng.weeklyActivity,
      topDirectories: eng.topDirectories,
    })),
    methodology: {
      description:
        "Engineers are ranked by a composite of five dimensions: shipping velocity and consistency (30%), codebase reach and diversity (20%), review impact on teammates (20%), collaboration breadth (15%), and change significance (15%). Each dimension uses percentile-normalized sub-metrics. Bot accounts and trivial auto-merges are excluded.",
      weights: { ...DIMENSION_WEIGHTS },
      filters: {
        minimumMergedPrs: 3,
        minimumReviews: 5,
        botsExcluded: true,
        autoMergesExcluded: true,
        locCapPerPr: 2000,
      },
    },
  };

  const outPath = resolve(process.cwd(), "analysis.json");
  writeFileSync(outPath, JSON.stringify(output, null, 2));

  const publicPath = resolve(process.cwd(), "public", "analysis.json");
  mkdirSync(resolve(process.cwd(), "public"), { recursive: true });
  writeFileSync(publicPath, JSON.stringify(output, null, 2));

  console.log(`\nDone.`);
  console.log(`${filtered.length} PRs analyzed`);
  console.log(`${qualifying.length} engineers scored`);
  console.log(`${botsFiltered} bots filtered`);
  console.log(`Top 5 written to analysis.json and public/analysis.json`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
