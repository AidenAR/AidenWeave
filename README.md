# PostHog Engineering Impact Dashboard

**Live:** [posthog-impact-dashboard-production.up.railway.app](https://posthog-impact-dashboard-production.up.railway.app/)

Identifies the top 5 most impactful engineers at PostHog by analyzing 90 days of merged pull requests from the [PostHog/posthog](https://github.com/PostHog/posthog) repository.

## Approach

Engineers are scored across 5 percentile-ranked dimensions:

| Dimension | Weight | What it captures |
|---|---|---|
| **Shipping** | 30% | PR count, consistency across weeks, merge speed |
| **Codebase Reach** | 20% | Directory diversity, Shannon entropy, cross-area PRs |
| **Review Impact** | 20% | Reviews given, unique authors reviewed |
| **Collaboration** | 15% | Unique collaborators, bidirectional review relationships |
| **Change Significance** | 15% | Files per PR, multi-area PRs, non-trivial PR ratio |

Each sub-metric is percentile-normalized among qualifying engineers (3+ PRs or 5+ reviews). The composite score is a weighted sum. Bot accounts, auto-merges (<60s), and zero-change PRs are excluded.

Every top engineer gets 2-3 plain-English "why" bullets that explain their ranking with real numbers and relative context (e.g., "Reviewed 275 PRs from 49 authors — top reviewer on the team").

## Tech Stack

- **Data pipeline:** TypeScript + GitHub GraphQL API
- **Frontend:** React 18 + Vite + Tailwind CSS + Recharts
- **Hosting:** Railway (static site via `serve`)
- **Testing:** Vitest (55 tests)

## Project Structure

```
scripts/
  fetch-and-analyze.ts       # Main entry point (thin orchestrator)
  daily-update.sh            # Shell script for cron jobs
  lib/
    types.ts                 # Shared TypeScript interfaces
    config.ts                # CLI argument parsing
    github.ts                # GitHub API client + parallel fetching
    analyze.ts               # All pure analysis: filtering, metrics, scoring, bullets
  __tests__/
    ingestion.test.ts        # Bot filtering, schema validation, dedup
    scoring.test.ts          # Math helpers, metric bounds, percentile properties
    output.test.ts           # Pipeline end-to-end, "why" bullet quality, sorted output
    fixtures/
      sample-prs.json        # 12 hand-crafted test PRs
src/
  App.tsx                    # Main layout + state
  components/
    EngineerCard.tsx         # Left panel ranked cards
    DetailPanel.tsx          # Right panel detail view
    DimensionBars.tsx        # Horizontal bar breakdown with raw context
    WeeklyChart.tsx          # Activity over time (Recharts)
    DirectoryList.tsx        # Top codebase areas
    Methodology.tsx          # Footer methodology section
  types.ts                   # Frontend TypeScript types
```

## Quick Start

```bash
# 1. Clone and install
git clone https://github.com/AidenAR/AidenWeave.git
cd AidenWeave
npm install

# 2. Set your GitHub token
echo "GITHUB_TOKEN=ghp_your_token_here" > .env

# 3. Fetch data and analyze
source .env && export GITHUB_TOKEN
npx tsx scripts/fetch-and-analyze.ts

# 4. Run the dashboard
npm run dev
# Open http://localhost:5173
```

## CLI Options

```bash
# Default: 90 days, PostHog/posthog
npx tsx scripts/fetch-and-analyze.ts

# Custom time window
npx tsx scripts/fetch-and-analyze.ts --days 30

# Different repository
npx tsx scripts/fetch-and-analyze.ts --repo facebook/react

# Force full re-fetch (ignore cache)
npx tsx scripts/fetch-and-analyze.ts --full

# Combine options
npx tsx scripts/fetch-and-analyze.ts --days 60 --repo vercel/next.js --full
```

## Caching & Incremental Fetching

The script caches raw PR data in `data/raw-prs.json`. On subsequent runs:

1. Loads the cache
2. Fetches only PRs newer than what's cached (stops at the first known PR)
3. Merges new PRs into the cache
4. Prunes PRs outside the rolling window

**First run:** ~3-4 minutes (parallel fetch across 6 date-range chunks)
**Incremental run:** ~5 seconds (1 API call)

Use `--full` to bypass the cache entirely.

## Concurrent Fetching

The 90-day window is split into 15-day chunks and fetched 2 at a time via the GitHub Search API. This provides ~2x speedup over sequential cursor pagination, with automatic retry on network errors and rate limits.

## Testing

```bash
# Run all 55 tests
npm test

# Watch mode
npm run test:watch
```

Tests cover three layers:

- **Ingestion:** Bot detection accuracy, PR filtering rules, schema validation, dedup
- **Scoring:** Math helpers (median, p90, entropy), percentile rank monotonicity, metric bounds, dimension weight sum, composite score correctness
- **Output:** Pipeline determinism, "why" bullet quality (no undefined/NaN), sorted output, weekly activity + directory structure

## Daily Updates

### GitHub Actions (recommended)

The included workflow (`.github/workflows/daily-update.yml`) runs at 6 AM UTC daily:

1. Restores the PR cache from GitHub Actions cache
2. Runs an incremental fetch
3. Rebuilds the dashboard
4. Commits updated `analysis.json` if changed

Add a `GH_PAT` secret to your repo with a GitHub personal access token.

### Local cron

```bash
./scripts/daily-update.sh
```

## Design Decisions & Trade-offs

**Why percentile ranking instead of raw scores?**
Raw metrics vary wildly across repos. Percentile ranking makes scores comparable regardless of absolute scale and is resilient to outliers.

**Why 5 dimensions instead of a single metric?**
Impact is multidimensional. A prolific shipper who never reviews is different from a review backbone who ships less. The weighted composite captures this while still producing a single ranking.

**Why cap LOC at 2000 per PR?**
Large auto-generated changes (migrations, lock files) would dominate raw LOC counts. The cap normalizes for this.

**Why filter PRs merged in <60 seconds?**
These are typically CI artifacts or auto-merge bot actions, not meaningful engineering work.

**Why `merged:` date range instead of `created:` date?**
We care about when work shipped, not when it started. A PR created 3 months ago but merged last week should count in the current window.

## Build & Deploy

```bash
# Production build
npm run build

# Preview production build locally
npm run preview

# Deploy to Railway
railway up
```

The dashboard reads from `/analysis.json` at runtime (static file served alongside the app). No backend or runtime API calls required.
