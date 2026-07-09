---
id: "017"
phase: 7
title: Create benchmark harness — 50 compositional queries, CatR@10 measurement, DA measurement, latency tracking
status: ready
depends_on: ["011"]
parallel: false
conflicts_with: []
files:
  - extensions/skillweaver/src/__tests__/benchmark.ts
  - extensions/skillweaver/src/__tests__/fixtures/benchmark-queries.json
irreversible: false
scope_test: "extensions/skillweaver/src/__tests__/benchmark.ts"
allowed_change: create
covers_criteria: [SC1, SC2, SC7]
---
## Failing test (write first)

Create `extensions/skillweaver/src/__tests__/fixtures/benchmark-queries.json`:

```json
{
  "description": "50 compositional queries for SkillWeaver benchmark — 25 easy (2 skills, 2 categories), 15 medium (3 skills, 3 categories), 10 hard (4-5 skills, 4-5 categories)",
  "queries": [
    {
      "id": "E01",
      "difficulty": "easy",
      "query": "Create a GitHub pull request and notify the team on Slack",
      "expectedSkills": ["github", "slack"],
      "expectedSubtasks": 2
    },
    {
      "id": "E02",
      "difficulty": "easy",
      "query": "Check the weather in Tokyo and save it to a file",
      "expectedSkills": ["weather", "read-write"],
      "expectedSubtasks": 2
    },
    {
      "id": "E03",
      "difficulty": "easy",
      "query": "Search the web for TypeScript best practices and create a markdown summary",
      "expectedSkills": ["web-search", "read-write"],
      "expectedSubtasks": 2
    },
    {
      "id": "E04",
      "difficulty": "easy",
      "query": "Read a CSV file and generate a chart image",
      "expectedSkills": ["read-write", "image-gen"],
      "expectedSubtasks": 2
    },
    {
      "id": "E05",
      "difficulty": "easy",
      "query": "Clone a git repo and run its test suite",
      "expectedSkills": ["github", "exec"],
      "expectedSubtasks": 2
    },
    {
      "id": "E06",
      "difficulty": "easy",
      "query": "Send an email with today's weather forecast attached",
      "expectedSkills": ["email", "weather"],
      "expectedSubtasks": 2
    },
    {
      "id": "E07",
      "difficulty": "easy",
      "query": "Download a file from a URL and extract its contents",
      "expectedSkills": ["web-fetch", "read-write"],
      "expectedSubtasks": 2
    },
    {
      "id": "E08",
      "difficulty": "easy",
      "query": "Look up a GitHub issue and post a summary to Discord",
      "expectedSkills": ["github", "discord"],
      "expectedSubtasks": 2
    },
    {
      "id": "E09",
      "difficulty": "easy",
      "query": "Generate an image description and save it as a text file",
      "expectedSkills": ["image", "read-write"],
      "expectedSubtasks": 2
    },
    {
      "id": "E10",
      "difficulty": "easy",
      "query": "Execute a shell command and log the output",
      "expectedSkills": ["exec", "read-write"],
      "expectedSubtasks": 2
    },
    {
      "id": "E11",
      "difficulty": "easy",
      "query": "Schedule a cron job and send confirmation via Telegram",
      "expectedSkills": ["cron", "telegram"],
      "expectedSubtasks": 2
    },
    {
      "id": "E12",
      "difficulty": "easy",
      "query": "Search memory for previous conversation and reply via Signal",
      "expectedSkills": ["memory", "signal"],
      "expectedSubtasks": 2
    },
    {
      "id": "E13",
      "difficulty": "easy",
      "query": "Create a new agent session and install a plugin",
      "expectedSkills": ["sessions", "plugins"],
      "expectedSubtasks": 2
    },
    {
      "id": "E14",
      "difficulty": "easy",
      "query": "Read the iMessage history and check for unread Slack messages",
      "expectedSkills": ["imessage", "slack"],
      "expectedSubtasks": 2
    },
    {
      "id": "E15",
      "difficulty": "easy",
      "query": "Browse a web page and capture a screenshot",
      "expectedSkills": ["browser", "image"],
      "expectedSubtasks": 2
    },
    {
      "id": "E16",
      "difficulty": "easy",
      "query": "Translate text to Japanese and save the result",
      "expectedSkills": ["translate", "read-write"],
      "expectedSubtasks": 2
    },
    {
      "id": "E17",
      "difficulty": "easy",
      "query": "Get current time across time zones and format as a table",
      "expectedSkills": ["time", "read-write"],
      "expectedSubtasks": 2
    },
    {
      "id": "E18",
      "difficulty": "easy",
      "query": "Calculate hash of a file and verify it against a known value",
      "expectedSkills": ["exec", "math"],
      "expectedSubtasks": 2
    },
    {
      "id": "E19",
      "difficulty": "easy",
      "query": "List running Docker containers and save the output to a log",
      "expectedSkills": ["docker", "read-write"],
      "expectedSubtasks": 2
    },
    {
      "id": "E20",
      "difficulty": "easy",
      "query": "Query a PostgreSQL database and export results as CSV",
      "expectedSkills": ["database", "read-write"],
      "expectedSubtasks": 2
    },
    {
      "id": "E21",
      "difficulty": "easy",
      "query": "Download a YouTube transcript and summarize it",
      "expectedSkills": ["web-fetch", "read-write"],
      "expectedSubtasks": 2
    },
    {
      "id": "E22",
      "difficulty": "easy",
      "query": "Generate TTS from text and check if WhatsApp is connected",
      "expectedSkills": ["tts", "whatsapp"],
      "expectedSubtasks": 2
    },
    {
      "id": "E23",
      "difficulty": "easy",
      "query": "Read a PDF file and add its metadata to Notion",
      "expectedSkills": ["pdf", "notion"],
      "expectedSubtasks": 2
    },
    {
      "id": "E24",
      "difficulty": "easy",
      "query": "Fetch RSS feed headlines and post the latest to Twitter",
      "expectedSkills": ["web-fetch", "twitter"],
      "expectedSubtasks": 2
    },
    {
      "id": "E25",
      "difficulty": "easy",
      "query": "Check git diff and create a commit message summary",
      "expectedSkills": ["github", "read-write"],
      "expectedSubtasks": 2
    },
    {
      "id": "M01",
      "difficulty": "medium",
      "query": "Download a dataset from GitHub, analyze the trends with Python, and email the report",
      "expectedSkills": ["github", "exec", "email"],
      "expectedSubtasks": 3
    },
    {
      "id": "M02",
      "difficulty": "medium",
      "query": "Search for recent AI papers, summarize the top 3, and post findings to Slack and Discord",
      "expectedSkills": ["web-search", "read-write", "slack", "discord"],
      "expectedSubtasks": 3
    },
    {
      "id": "M03",
      "difficulty": "medium",
      "query": "Take a screenshot of a website, run OCR on it, and save the extracted text",
      "expectedSkills": ["browser", "image", "read-write"],
      "expectedSubtasks": 3
    },
    {
      "id": "M04",
      "difficulty": "medium",
      "query": "Clone three repos, run their benchmarks, and create a comparison chart",
      "expectedSkills": ["github", "exec", "image-gen"],
      "expectedSubtasks": 3
    },
    {
      "id": "M05",
      "difficulty": "medium",
      "query": "Check CI status on GitHub, collect failed test logs, and send them to a Telegram channel",
      "expectedSkills": ["github", "read-write", "telegram"],
      "expectedSubtasks": 3
    },
    {
      "id": "M06",
      "difficulty": "medium",
      "query": "Search memory for project context, read the design spec, write an implementation plan",
      "expectedSkills": ["memory", "read-write", "read-write"],
      "expectedSubtasks": 3
    },
    {
      "id": "M07",
      "difficulty": "medium",
      "query": "Fetch stock prices from an API, compute moving averages, and create a chart",
      "expectedSkills": ["web-fetch", "math", "image-gen"],
      "expectedSubtasks": 3
    },
    {
      "id": "M08",
      "difficulty": "medium",
      "query": "Read all unread iMessages, extract action items, create GitHub issues for each",
      "expectedSkills": ["imessage", "read-write", "github"],
      "expectedSubtasks": 3
    },
    {
      "id": "M09",
      "difficulty": "medium",
      "query": "Browse a documentation site, extract API endpoints, and update a Postman collection",
      "expectedSkills": ["browser", "web-fetch", "read-write"],
      "expectedSubtasks": 3
    },
    {
      "id": "M10",
      "difficulty": "medium",
      "query": "Check the weather, calculate travel time, and send a summary via WhatsApp",
      "expectedSkills": ["weather", "math", "whatsapp"],
      "expectedSubtasks": 3
    },
    {
      "id": "M11",
      "difficulty": "medium",
      "query": "Query a database, transform the results, and schedule a daily export cron job",
      "expectedSkills": ["database", "read-write", "cron"],
      "expectedSubtasks": 3
    },
    {
      "id": "M12",
      "difficulty": "medium",
      "query": "Download a video, extract audio, transcribe it, and save the transcript",
      "expectedSkills": ["web-fetch", "media", "tts", "read-write"],
      "expectedSubtasks": 3
    },
    {
      "id": "M13",
      "difficulty": "medium",
      "query": "Find duplicate files, report sizes, and archive them",
      "expectedSkills": ["exec", "read-write", "exec"],
      "expectedSubtasks": 3
    },
    {
      "id": "M14",
      "difficulty": "medium",
      "query": "Read a blog post, extract key quotes, search for related papers, and compile a reading list",
      "expectedSkills": ["web-fetch", "web-search", "read-write"],
      "expectedSubtasks": 3
    },
    {
      "id": "M15",
      "difficulty": "medium",
      "query": "Export Slack channel history, analyze sentiment, and generate a report chart",
      "expectedSkills": ["slack", "read-write", "image-gen"],
      "expectedSubtasks": 3
    },
    {
      "id": "H01",
      "difficulty": "hard",
      "query": "Collect data from 3 different APIs, merge and clean the datasets, run statistical analysis, visualize trends, and publish results to a GitHub wiki page",
      "expectedSkills": ["web-fetch", "read-write", "math", "image-gen", "github"],
      "expectedSubtasks": 5
    },
    {
      "id": "H02",
      "difficulty": "hard",
      "query": "Clone a repo, check out a feature branch, run all linters, fix auto-fixable issues, create a PR, and notify the team on Slack and Discord",
      "expectedSkills": ["github", "exec", "github", "slack", "discord"],
      "expectedSubtasks": 4
    },
    {
      "id": "H03",
      "difficulty": "hard",
      "query": "Download a dataset, train a simple model, evaluate it, save the model and metrics, and send an email with the results",
      "expectedSkills": ["web-fetch", "exec", "read-write", "email"],
      "expectedSubtasks": 5
    },
    {
      "id": "H04",
      "difficulty": "hard",
      "query": "Check all connected channels, collect unread message counts, aggregate by platform, format a dashboard image, and post it to Telegram",
      "expectedSkills": ["telegram", "discord", "slack", "image-gen", "telegram"],
      "expectedSubtasks": 4
    },
    {
      "id": "H05",
      "difficulty": "hard",
      "query": "Read a technical paper PDF, extract methodology section, reproduce the experiment setup in code, run the benchmark, compare results with the paper's claims, and write a replication report",
      "expectedSkills": ["pdf", "read-write", "exec", "math", "read-write"],
      "expectedSubtasks": 5
    },
    {
      "id": "H06",
      "difficulty": "hard",
      "query": "Query the database for user activity, find top users, check GitHub contribution graphs, cross-reference with Slack messages, and generate a comprehensive activity report",
      "expectedSkills": ["database", "github", "slack", "read-write"],
      "expectedSubtasks": 4
    },
    {
      "id": "H07",
      "difficulty": "hard",
      "query": "Monitor running Docker containers, collect resource metrics, identify anomalies, restart unhealthy containers, log the incident, and notify via email and Telegram",
      "expectedSkills": ["docker", "exec", "read-write", "email", "telegram"],
      "expectedSubtasks": 4
    },
    {
      "id": "H08",
      "difficulty": "hard",
      "query": "Set up a new project: init git repo, create directory structure, write config files, add CI pipeline, install dependencies, scaffold tests, and push to GitHub with a Slack announcement",
      "expectedSkills": ["github", "read-write", "exec", "slack"],
      "expectedSubtasks": 5
    },
    {
      "id": "H09",
      "difficulty": "hard",
      "query": "Scrape a competitor website, extract pricing data, compare with our pricing, generate a summary table, and save as PDF for review",
      "expectedSkills": ["web-fetch", "browser", "read-write", "pdf"],
      "expectedSubtasks": 4
    },
    {
      "id": "H10",
      "difficulty": "hard",
      "query": "Ingest iMessage history, identify contacts with most messages, filter by date range, compute reply time distributions, generate charts, and export as a markdown report",
      "expectedSkills": ["imessage", "read-write", "math", "image-gen", "read-write"],
      "expectedSubtasks": 5
    }
  ]
}
```

## Change

**File:** `extensions/skillweaver/src/__tests__/benchmark.ts`
**Anchor:** new file — create at this path
**Before:** file does not exist
**After:**
```ts
import type { SearchResult, HintEntry } from "../embedding/types.js";

interface BenchmarkQuery {
  id: string;
  difficulty: "easy" | "medium" | "hard";
  query: string;
  expectedSkills: string[];
  expectedSubtasks: number;
}

interface BenchmarkResult {
  id: string;
  difficulty: string;
  query: string;
  catR10: number;
  catR1: number;
  daExact: boolean;
  daPlusMinus1: boolean;
  latencyMs: number;
  subTaskCount: number;
  retrievedCount: number;
  pass: number;
}

interface BenchmarkSummary {
  totalQueries: number;
  catR10Rate: number;
  catR1Rate: number;
  daExactRate: number;
  daPlusMinus1Rate: number;
  avgLatencyMs: number;
  byDifficulty: Record<string, Omit<BenchmarkSummary, "byDifficulty" | "totalQueries">>;
}

export function benchmarkMain(opts: {
  decomposer: { decompose: (query: string, hints?: HintEntry[]) => Promise<{ subTasks: string[]; pass: number }> };
  retriever: { retrieve: (subTasks: string[]) => Promise<SearchResult[]> };
  queries: BenchmarkQuery[];
  name?: string;
}): void {
  runBenchmark(opts).then(({ summary }) => {
    console.log(JSON.stringify(summary, null, 2));
    const pass = summary.catR10Rate >= 0.65 && summary.daPlusMinus1Rate >= 0.60;
    process.exit(pass ? 0 : 1);
  });
}

function computeCatR(retrieved: SearchResult[], expectedSkills: string[], k: number): number {
  const topK = retrieved.slice(0, k).map((s) => s.name);
  const hits = expectedSkills.filter((skill) => topK.includes(skill)).length;
  return expectedSkills.length > 0 ? hits / expectedSkills.length : 0;
}

function computeDA(actualSubTasks: number, expectedSubTasks: number): { exact: boolean; plusMinus1: boolean } {
  return {
    exact: actualSubTasks === expectedSubTasks,
    plusMinus1: Math.abs(actualSubTasks - expectedSubTasks) <= 1,
  };
}

export async function runBenchmark(opts: {
  decomposer: { decompose: (query: string, hints?: HintEntry[]) => Promise<{ subTasks: string[]; pass: number }> };
  retriever: { retrieve: (subTasks: string[]) => Promise<SearchResult[]> };
  queries: BenchmarkQuery[];
  name?: string;
}): Promise<{ results: BenchmarkResult[]; summary: BenchmarkSummary }> {
  const results: BenchmarkResult[] = [];
  let totalLatency = 0;

  for (const q of opts.queries) {
    const start = Date.now();

    const pass1Result = await opts.decomposer.decompose(q.query);
    const retrieved = await opts.retriever.retrieve(pass1Result.subTasks);
    const latencyMs = Date.now() - start;
    totalLatency += latencyMs;

    const da = computeDA(pass1Result.subTasks.length, q.expectedSubtasks);

    results.push({
      id: q.id,
      difficulty: q.difficulty,
      query: q.query,
      catR10: computeCatR(retrieved, q.expectedSkills, 10),
      catR1: computeCatR(retrieved, q.expectedSkills, 1),
      daExact: da.exact,
      daPlusMinus1: da.plusMinus1,
      latencyMs,
      subTaskCount: pass1Result.subTasks.length,
      retrievedCount: retrieved.length,
      pass: pass1Result.pass,
    });
  }

  const computeRates = (subset: BenchmarkResult[]) => {
    const n = subset.length;
    if (n === 0) return { catR10Rate: 0, catR1Rate: 0, daExactRate: 0, daPlusMinus1Rate: 0, avgLatencyMs: 0 };
    return {
      catR10Rate: subset.reduce((s, r) => s + r.catR10, 0) / n,
      catR1Rate: subset.reduce((s, r) => s + r.catR1, 0) / n,
      daExactRate: subset.filter((r) => r.daExact).length / n,
      daPlusMinus1Rate: subset.filter((r) => r.daPlusMinus1).length / n,
      avgLatencyMs: subset.reduce((s, r) => s + r.latencyMs, 0) / n,
    };
  };

  const byDifficulty: Record<string, Omit<BenchmarkSummary, "byDifficulty" | "totalQueries">> = {};
  for (const diff of ["easy", "medium", "hard"]) {
    byDifficulty[diff] = computeRates(results.filter((r) => r.difficulty === diff));
  }

  return {
    results,
    summary: {
      totalQueries: results.length,
      ...computeRates(results),
      byDifficulty,
    },
  };
}
```

## Allowed moves

Create exactly the benchmark file, the fixtures JSON, and add them to `files:`. No other changes. The benchmark is run manually (`npx tsx src/__tests__/benchmark.ts`) — it is not a vitest test. It requires a real decomposer and retriever (or mocks configured for the specific benchmark fixture).

## STOP triggers

- `expectedSkills` references a skill name not in WednesdayAI's bundled skill list (verify against the actual skill names)
- CatR calculation is inverted (should be: expected ∩ retrieved, not retrieved ∩ expected)

## Manual verification (record in decisions-ledger)

Run `npx tsx src/__tests__/benchmark.ts` with mocks or real components. Verify: `summary.catR10Rate >= 0.65` and `summary.daExactRate >= 0.60` from the output. Record actual rates in decisions-ledger.

## Done when

`WAI_TYPECHECK_CMD="cd extensions/skillweaver && pnpm exec tsc --noEmit" WAI_TEST_CMD="cd extensions/skillweaver && npx tsx src/__tests__/benchmark.ts" bash ~/.claude/wai/scripts/task-gate.sh plugin-skillweaver 017` exits 0