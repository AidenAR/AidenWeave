import type { RawPR, FetchConfig } from "./types.js";

const GRAPHQL_URL = "https://api.github.com/graphql";
const REST_BASE = "https://api.github.com";
const PRS_PER_PAGE = 100;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export interface GitHubClient {
  graphql(query: string, variables?: Record<string, unknown>): Promise<any>;
  restGet(path: string): Promise<any>;
  rateLimitRemaining: number;
}

export function createClient(token: string): GitHubClient {
  let rateLimitRemaining = 5000;

  async function graphql(query: string, variables: Record<string, unknown> = {}) {
    for (let attempt = 0; attempt < 7; attempt++) {
      try {
        const res = await fetch(GRAPHQL_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
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
            console.log(`Rate limit low (${rateLimitRemaining}), skipping optional data.`);
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
      } catch (err: any) {
        const wait = Math.pow(2, attempt) * 2000;
        console.log(`Network error (attempt ${attempt + 1}/7): ${err.code || err.message}. Retrying in ${wait / 1000}s...`);
        await sleep(wait);
      }
    }
    throw new Error("GraphQL request failed after 7 retries");
  }

  async function restGet(path: string) {
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const res = await fetch(`${REST_BASE}${path}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.status === 403 || res.status === 429) {
          const wait = Math.pow(2, attempt) * 3000;
          await sleep(wait);
          continue;
        }
        return await res.json();
      } catch (err: any) {
        const wait = Math.pow(2, attempt) * 1000;
        console.log(`REST error (attempt ${attempt + 1}/5): ${err.code || err.message}. Retrying in ${wait / 1000}s...`);
        await sleep(wait);
      }
    }
    return null;
  }

  return {
    graphql,
    restGet,
    get rateLimitRemaining() { return rateLimitRemaining; },
  };
}

function buildPrQuery(prsPerPage: number): string {
  return `
query($owner: String!, $repo: String!, $after: String) {
  rateLimit { remaining resetAt }
  repository(owner: $owner, name: $repo) {
    pullRequests(
      states: MERGED
      first: ${prsPerPage}
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
}

function buildSearchQuery(prsPerPage: number): string {
  return `
query($searchQuery: String!, $after: String) {
  rateLimit { remaining resetAt }
  search(query: $searchQuery, type: ISSUE, first: ${prsPerPage}, after: $after) {
    pageInfo { hasNextPage endCursor }
    nodes {
      ... on PullRequest {
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
}

function parseNode(node: any, client: GitHubClient, config: FetchConfig): RawPR | null {
  if (!node.number) return null;
  const authorLogin = node.author?.login ?? "ghost";
  const authorType = node.author?.__typename === "Bot" ? "Bot" : "User";
  const files: string[] = node.files?.nodes?.map((f: any) => f.path).filter(Boolean) ?? [];

  return {
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
  };
}

export interface FetchResult {
  prs: RawPR[];
  stoppedEarly: boolean;
}

/**
 * Fetch all merged PRs using cursor-based pagination.
 * Stops when PRs fall outside the window.
 * If knownPrNumbers is provided, also stops when a known PR is encountered (incremental mode).
 */
export async function fetchAllPRs(
  client: GitHubClient,
  config: FetchConfig,
  knownPrNumbers?: Set<number>,
): Promise<FetchResult> {
  const query = buildPrQuery(PRS_PER_PAGE);
  const prs: RawPR[] = [];
  let cursor: string | null = null;
  let page = 0;

  while (true) {
    page++;
    console.log(`Fetching page ${page}... (${prs.length} PRs so far)`);
    const result = await client.graphql(query, { owner: config.owner, repo: config.repo, after: cursor });
    const connection = result.data?.repository?.pullRequests;
    if (!connection) break;

    let hitKnown = false;
    for (const node of connection.nodes) {
      const createdAt = new Date(node.createdAt);
      if (createdAt < config.windowStart) {
        console.log(`Reached PRs before window, stopping. Total: ${prs.length}`);
        return { prs, stoppedEarly: false };
      }

      if (knownPrNumbers?.has(node.number)) {
        hitKnown = true;
        continue;
      }

      const pr = parseNode(node, client, config);
      if (!pr) continue;

      if (pr.files.length === 0 && pr.changedFiles > 0) {
        const restFiles = await client.restGet(
          `/repos/${config.owner}/${config.repo}/pulls/${pr.number}/files?per_page=100`
        );
        if (Array.isArray(restFiles)) {
          pr.files = restFiles.map((f: any) => f.filename);
        }
      }

      prs.push(pr);
    }

    if (hitKnown && knownPrNumbers) {
      console.log(`Hit cached PRs, stopping incremental fetch. New: ${prs.length}`);
      return { prs, stoppedEarly: true };
    }

    if (!connection.pageInfo.hasNextPage) break;
    cursor = connection.pageInfo.endCursor;
  }

  return { prs, stoppedEarly: false };
}

/**
 * Fetch PRs for a date range chunk using the search API (for concurrent fetching).
 */
export async function fetchChunkPRs(
  client: GitHubClient,
  config: FetchConfig,
  startDate: string,
  endDate: string,
): Promise<RawPR[]> {
  const query = buildSearchQuery(PRS_PER_PAGE);
  const searchQuery = `is:pr is:merged repo:${config.owner}/${config.repo} merged:${startDate}..${endDate}`;
  const prs: RawPR[] = [];
  let cursor: string | null = null;
  let page = 0;

  while (true) {
    page++;
    console.log(`  Chunk ${startDate}..${endDate} page ${page} (${prs.length} PRs)`);
    const result = await client.graphql(query, { searchQuery, after: cursor });
    const connection = result.data?.search;
    if (!connection) break;

    for (const node of connection.nodes) {
      const pr = parseNode(node, client, config);
      if (!pr) continue;

      if (pr.files.length === 0 && pr.changedFiles > 0) {
        const restFiles = await client.restGet(
          `/repos/${config.owner}/${config.repo}/pulls/${pr.number}/files?per_page=100`
        );
        if (Array.isArray(restFiles)) {
          pr.files = restFiles.map((f: any) => f.filename);
        }
      }

      prs.push(pr);
    }

    if (!connection.pageInfo.hasNextPage) break;
    cursor = connection.pageInfo.endCursor;
  }

  return prs;
}

/**
 * Fetch all PRs using parallel date-range chunks.
 * Splits the window into chunks and fetches them concurrently.
 */
export async function fetchAllPRsParallel(
  client: GitHubClient,
  config: FetchConfig,
  concurrency: number = 2,
  chunkDays: number = 15,
): Promise<RawPR[]> {
  const chunks: { start: string; end: string }[] = [];
  const msPerDay = 24 * 60 * 60 * 1000;
  let current = new Date(config.windowStart);

  while (current < config.windowEnd) {
    const chunkEnd = new Date(Math.min(current.getTime() + chunkDays * msPerDay, config.windowEnd.getTime()));
    chunks.push({
      start: current.toISOString().slice(0, 10),
      end: chunkEnd.toISOString().slice(0, 10),
    });
    current = new Date(chunkEnd.getTime() + msPerDay);
  }

  console.log(`Fetching ${chunks.length} date-range chunks (concurrency: ${concurrency})...`);

  const results: RawPR[][] = [];
  for (let i = 0; i < chunks.length; i += concurrency) {
    const batch = chunks.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map((c) => fetchChunkPRs(client, config, c.start, c.end))
    );
    results.push(...batchResults);
    if (i + concurrency < chunks.length) {
      await sleep(1000);
    }
  }

  const allPrs = results.flat();
  const seen = new Set<number>();
  const deduped = allPrs.filter((pr) => {
    if (seen.has(pr.number)) return false;
    seen.add(pr.number);
    return true;
  });

  console.log(`Fetched ${allPrs.length} PRs total, ${deduped.length} unique after dedup`);
  return deduped;
}
