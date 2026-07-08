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
  }).catch((err) => {
    console.error("benchmark failed:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
