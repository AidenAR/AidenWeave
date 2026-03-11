import { writeFileSync } from "fs";
import { resolve } from "path";

// ─── Config ───────────────────────────────────────────────────────────────────

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
if (!GITHUB_TOKEN) {
  console.error("GITHUB_TOKEN is required. Set it in your .env file.");
  process.exit(1);
}

const OWNER = "PostHog";
const REPO = "posthog";
const DAYS = 90;
const PRS_PER_PAGE = 100;
const GRAPHQL_URL = "https://api.github.com/graphql";
const REST_BASE = "https://api.github.com";

const BOT_LOGINS = new Set([
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

const windowEnd = new Date();
const windowStart = new Date(windowEnd.getTime() - DAYS * 24 * 60 * 60 * 1000);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isBot(login: string, type?: string): boolean {
  if (!login) return true;
  const l = login.toLowerCase();
  if (BOT_LOGINS.has(l)) return true;
  if (l.includes("[bot]") || l.endsWith("-bot") || l.endsWith("-app")) return true;
  if (type === "Bot") return true;
  return false;
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

let rateLimitRemaining = 5000;
let rateLimitCanFetchComments = true;

async function graphql(query: string, variables: Record<string, unknown> = {}) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(GRAPHQL_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, variables }),
    });

    if (res.status === 403 || res.status === 429) {
      const wait = Math.pow(2, attempt) * 5000;
      console.log(`Rate limited, waiting ${wait / 1000}s...`);
      await sleep(wait);
      continue;
    }

    const json = await res.json();
    if (json.data?.rateLimit) {
      rateLimitRemaining = json.data.rateLimit.remaining;
      if (rateLimitRemaining < 1000) {
        rateLimitCanFetchComments = false;
        console.log(`Rate limit low (${rateLimitRemaining}), skipping comments.`);
      }
    }
    if (json.errors) {
      console.error("GraphQL errors:", JSON.stringify(json.errors, null, 2));
      if (json.errors.some((e: any) => e.type === "RATE_LIMITED")) {
        const wait = Math.pow(2, attempt) * 5000;
        console.log(`Rate limited via error, waiting ${wait / 1000}s...`);
        await sleep(wait);
        continue;
      }
    }
    return json;
  }
  throw new Error("GraphQL request failed after 5 retries");
}

async function restGet(path: string) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`${REST_BASE}${path}`, {
      headers: { Authorization: `Bearer ${GITHUB_TOKEN}` },
    });
    if (res.status === 403 || res.status === 429) {
      const wait = Math.pow(2, attempt) * 3000;
      await sleep(wait);
      continue;
    }
    return res.json();
  }
  return null;
}

// ─── Step 1: Fetch PRs ───────────────────────────────────────────────────────

interface RawPR {
  number: number;
  title: string;
  createdAt: string;
  mergedAt: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  labels: string[];
  author: { login: string; name: string | null; avatarUrl: string; type: string };
  reviews: { login: string; type: string; state: string; submittedAt: string }[];
  files: string[];
}

const PR_QUERY = `
query($owner: String!, $repo: String!, $after: String) {
  rateLimit { remaining resetAt }
  repository(owner: $owner, name: $repo) {
    pullRequests(
      states: MERGED
      first: ${PRS_PER_PAGE}
      after: $after
      orderBy: { field: CREATED_AT, direction: DESC }
    ) {
      pageInfo { hasNextPage endCursor }
      nodes {
        number
        title
        createdAt
        mergedAt
        additions
        deletions
        changedFiles
        labels(first: 10) { nodes { name } }
        author {
          login
          ... on User { name avatarUrl }
          ... on Bot { login avatarUrl }
        }
        reviews(first: 50) {
          nodes {
            author { login ... on User { __typename } ... on Bot { __typename } }
            state
            submittedAt
          }
        }
        files(first: 100) {
          nodes { path }
        }
      }
    }
  }
}`;

async function fetchAllPRs(): Promise<RawPR[]> {
  const prs: RawPR[] = [];
  let cursor: string | null = null;
  let page = 0;

  while (true) {
    page++;
    console.log(`Fetching page ${page}... (${prs.length} PRs so far)`);
    const result = await graphql(PR_QUERY, { owner: OWNER, repo: REPO, after: cursor });
    const connection = result.data?.repository?.pullRequests;
    if (!connection) break;

    for (const node of connection.nodes) {
      const createdAt = new Date(node.createdAt);
      if (createdAt < windowStart) {
        console.log(`Reached PRs before window, stopping. Total: ${prs.length}`);
        return prs;
      }

      const authorLogin = node.author?.login ?? "ghost";
      const authorType =
        node.author?.__typename === "Bot" ? "Bot" : "User";

      let files: string[] = node.files?.nodes?.map((f: any) => f.path) ?? [];
      if (files.length === 0 && node.changedFiles > 0) {
        const restFiles = await restGet(
          `/repos/${OWNER}/${REPO}/pulls/${node.number}/files?per_page=100`
        );
        if (Array.isArray(restFiles)) {
          files = restFiles.map((f: any) => f.filename);
        }
      }

      prs.push({
        number: node.number,
        title: node.title,
        createdAt: node.createdAt,
        mergedAt: node.mergedAt,
        additions: node.additions,
        deletions: node.deletions,
        changedFiles: node.changedFiles,
        labels: node.labels?.nodes?.map((l: any) => l.name) ?? [],
        author: {
          login: authorLogin,
          name: node.author?.name ?? null,
          avatarUrl: node.author?.avatarUrl ?? "",
          type: authorType,
        },
        reviews: (node.reviews?.nodes ?? []).map((r: any) => ({
          login: r.author?.login ?? "ghost",
          type: r.author?.__typename === "Bot" ? "Bot" : "User",
          state: r.state,
          submittedAt: r.submittedAt,
        })),
        files,
      });
    }

    if (!connection.pageInfo.hasNextPage) break;
    cursor = connection.pageInfo.endCursor;
  }

  return prs;
}

// ─── Step 2: Filter ──────────────────────────────────────────────────────────

function filterPRs(prs: RawPR[]) {
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

// ─── Step 3: Compute metrics ─────────────────────────────────────────────────

interface EngineerData {
  login: string;
  name: string;
  avatarUrl: string;
  prs: RawPR[];
  reviewsGivenList: { prNumber: number; authorLogin: string; state: string; submittedAt: string; prCreatedAt: string; prMerged: boolean }[];
}

function getTopDir(path: string): string {
  return path.split("/")[0] || path;
}

function getSecondLevelDir(path: string): string {
  const parts = path.split("/");
  if (parts.length >= 2) return `${parts[0]}/${parts[1]}`;
  return parts[0];
}

function getIsoWeek(date: Date): string {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

function getWeekStartDate(date: Date): string {
  const d = new Date(date);
  const day = d.getUTCDay();
  const diff = d.getUTCDate() - day + (day === 0 ? -6 : 1);
  d.setUTCDate(diff);
  return d.toISOString().slice(0, 10);
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

function p90(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.floor(sorted.length * 0.9);
  return sorted[Math.min(idx, sorted.length - 1)];
}

function shannonEntropy(counts: Map<string, number>): number {
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

function buildEngineerMap(prs: RawPR[]): Map<string, EngineerData> {
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
      if (review.login === pr.author.login) continue; // exclude self-reviews
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

interface ComputedMetrics {
  login: string;
  name: string;
  avatarUrl: string;
  mergedPrCount: number;
  activeWeeks: number;
  totalWeeks: number;
  shippingConsistency: number;
  medianMergeHours: number;
  p90MergeHours: number;
  uniqueTopDirs: number;
  uniqueSecondLevelDirs: number;
  directoryEntropy: number;
  crossAreaPrRatio: number;
  reviewsGiven: number;
  uniqueAuthorsReviewed: number;
  reviewsOnMergedPrs: number;
  medianReviewTurnaroundHours: number;
  uniqueCollaborators: number;
  bidirectionalCollaborators: number;
  commentCount: number;
  avgFilesChangedPerPr: number;
  avgNetLinesPerPr: number;
  multiAreaPrCount: number;
  nonTrivialPrRatio: number;
  weeklyActivity: { week: string; mergedPrs: number; reviewsGiven: number }[];
  topDirectories: { path: string; fileCount: number }[];
}

function computeMetrics(eng: EngineerData): ComputedMetrics {
  const totalWeeks = Math.ceil(DAYS / 7);
  const prs = eng.prs;

  // Shipping
  const mergeHours = prs.map(
    (pr) =>
      (new Date(pr.mergedAt).getTime() - new Date(pr.createdAt).getTime()) /
      3_600_000
  );
  const weekSet = new Set(prs.map((pr) => getIsoWeek(new Date(pr.mergedAt))));

  // Codebase reach
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

  // Reviews
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
    .filter((h) => h >= 0 && h < 720); // Filter unreasonable values

  // Collaboration
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

  // Change significance
  const netLinesPerPr = prs.map((pr) =>
    Math.min(pr.additions + pr.deletions, 2000)
  );
  const filesPerPr = prs.map((pr) => pr.changedFiles);
  const nonTrivialPrs = prs.filter((pr) => pr.changedFiles >= 3).length;

  // Weekly activity
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

  // Top directories
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
    shippingConsistency: weekSet.size / totalWeeks,
    medianMergeHours: median(mergeHours),
    p90MergeHours: p90(mergeHours),
    uniqueTopDirs: topDirCounts.size,
    uniqueSecondLevelDirs: secondDirs.size,
    directoryEntropy: shannonEntropy(topDirCounts),
    crossAreaPrRatio: prs.length > 0 ? crossAreaPrs / prs.length : 0,
    reviewsGiven: reviews.length,
    uniqueAuthorsReviewed: reviewedAuthors.size,
    reviewsOnMergedPrs: reviews.length, // all PRs in our set are merged
    medianReviewTurnaroundHours: median(reviewTurnarounds),
    uniqueCollaborators: collaborators.size,
    bidirectionalCollaborators: bidirectional.size,
    commentCount: 0, // will only populate if we fetch comments
    avgFilesChangedPerPr: prs.length > 0 ? filesPerPr.reduce((a, b) => a + b, 0) / prs.length : 0,
    avgNetLinesPerPr: prs.length > 0 ? netLinesPerPr.reduce((a, b) => a + b, 0) / prs.length : 0,
    multiAreaPrCount: multiAreaPrs,
    nonTrivialPrRatio: prs.length > 0 ? nonTrivialPrs / prs.length : 0,
    weeklyActivity,
    topDirectories,
  };
}

// ─── Step 4: Normalize and score ─────────────────────────────────────────────

function percentileRank(values: number[], value: number): number {
  const lower = values.filter((v) => v < value).length;
  return (lower / values.length) * 100;
}

function percentileRankInverse(
  values: number[],
  value: number,
  maxVal: number
): number {
  return percentileRank(values, maxVal - value + (maxVal - Math.min(...values)));
}

interface ScoredEngineer extends ComputedMetrics {
  dimensions: {
    shipping: number;
    reach: number;
    reviewImpact: number;
    collaboration: number;
    changeSignificance: number;
  };
  compositeScore: number;
}

function scoreEngineers(engineers: ComputedMetrics[]): ScoredEngineer[] {
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
      shipping * 0.3 +
      reach * 0.2 +
      reviewImpact * 0.2 +
      collaboration * 0.15 +
      changeSignificance * 0.15;

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

// ─── Step 5: Generate "why" bullets ──────────────────────────────────────────

function generateWhyBullets(
  eng: ScoredEngineer,
  allEngineers: ScoredEngineer[]
): string[] {
  const bullets: { text: string; score: number }[] = [];

  const rank = (
    key: keyof ComputedMetrics,
    value: number,
    direction: "high" | "low" = "high"
  ) => {
    const sorted =
      direction === "high"
        ? [...allEngineers].sort(
            (a, b) => (b[key] as number) - (a[key] as number)
          )
        : [...allEngineers].sort(
            (a, b) => (a[key] as number) - (b[key] as number)
          );
    return sorted.findIndex((e) => e.login === eng.login) + 1;
  };

  const total = allEngineers.length;

  // Shipping bullets
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

  // Review bullets
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

  // Reach bullets
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

  // Collaboration bullets
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

  // Change significance
  if (eng.nonTrivialPrRatio >= 0.6 && eng.mergedPrCount >= 5) {
    bullets.push({
      text: `${Math.round(eng.nonTrivialPrRatio * 100)}% non-trivial PRs, avg ${eng.avgFilesChangedPerPr.toFixed(0)} files per PR — substantial changes`,
      score: eng.dimensions.changeSignificance,
    });
  }

  // Sort by score and take top 3
  bullets.sort((a, b) => b.score - a.score);
  return bullets.slice(0, 3).map((b) => b.text);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`Fetching merged PRs from ${OWNER}/${REPO} (last ${DAYS} days)...`);
  console.log(`Window: ${windowStart.toISOString().slice(0, 10)} to ${windowEnd.toISOString().slice(0, 10)}`);

  const rawPrs = await fetchAllPRs();
  console.log(`Fetched ${rawPrs.length} merged PRs`);

  const { filtered, botsFiltered } = filterPRs(rawPrs);
  console.log(`After filtering: ${filtered.length} PRs (${botsFiltered} bot PRs removed)`);

  const engineerMap = buildEngineerMap(filtered);
  console.log(`Found ${engineerMap.size} unique engineers`);

  // Qualify engineers
  const qualifying = Array.from(engineerMap.values()).filter(
    (e) => e.prs.length >= 3 || e.reviewsGivenList.length >= 5
  );
  console.log(`${qualifying.length} engineers qualify (≥3 PRs or ≥5 reviews)`);

  const metrics = qualifying.map(computeMetrics);
  const scored = scoreEngineers(metrics);
  scored.sort((a, b) => b.compositeScore - a.compositeScore);

  const top5 = scored.slice(0, 5);
  const reviewsAnalyzed = filtered.reduce(
    (sum, pr) => sum + pr.reviews.length,
    0
  );

  const output = {
    generatedAt: new Date().toISOString(),
    summary: {
      repo: `${OWNER}/${REPO}`,
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
        medianReviewTurnaroundHours:
          Math.round(eng.medianReviewTurnaroundHours * 10) / 10,
        uniqueCollaborators: eng.uniqueCollaborators,
        bidirectionalCollaborators: eng.bidirectionalCollaborators,
        commentCount: eng.commentCount,
        avgFilesChangedPerPr:
          Math.round(eng.avgFilesChangedPerPr * 10) / 10,
        avgNetLinesPerPr: Math.round(eng.avgNetLinesPerPr),
        multiAreaPrCount: eng.multiAreaPrCount,
        nonTrivialPrRatio:
          Math.round(eng.nonTrivialPrRatio * 100) / 100,
      },
      weeklyActivity: eng.weeklyActivity,
      topDirectories: eng.topDirectories,
    })),
    methodology: {
      description:
        "Engineers are ranked by a composite of five dimensions: shipping velocity and consistency (30%), codebase reach and diversity (20%), review impact on teammates (20%), collaboration breadth (15%), and change significance (15%). Each dimension uses percentile-normalized sub-metrics. Bot accounts and trivial auto-merges are excluded.",
      weights: {
        shipping: 0.3,
        reach: 0.2,
        reviewImpact: 0.2,
        collaboration: 0.15,
        changeSignificance: 0.15,
      },
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

  // Also copy to public/ for the dashboard
  const publicPath = resolve(process.cwd(), "public", "analysis.json");
  const { mkdirSync } = await import("fs");
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
