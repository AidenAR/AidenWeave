import { resolve } from "path";
import type { FetchConfig } from "./types.js";

export function parseArgs(argv: string[]): FetchConfig {
  const args = argv.slice(2);
  let days = 90;
  let repoFull = "PostHog/posthog";
  let full = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--days" && args[i + 1]) {
      days = parseInt(args[i + 1], 10);
      if (isNaN(days) || days < 1) {
        console.error("--days must be a positive integer");
        process.exit(1);
      }
      i++;
    } else if (args[i] === "--repo" && args[i + 1]) {
      repoFull = args[i + 1];
      i++;
    } else if (args[i] === "--full") {
      full = true;
    }
  }

  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.error("GITHUB_TOKEN is required. Set it in your .env file.");
    process.exit(1);
  }

  const [owner, repo] = repoFull.split("/");
  if (!owner || !repo) {
    console.error("--repo must be in owner/repo format (e.g. PostHog/posthog)");
    process.exit(1);
  }

  const windowEnd = new Date();
  const windowStart = new Date(windowEnd.getTime() - days * 24 * 60 * 60 * 1000);

  return {
    owner,
    repo,
    days,
    token,
    windowStart,
    windowEnd,
    full,
    cachePath: resolve(process.cwd(), "data", "raw-prs.json"),
  };
}
