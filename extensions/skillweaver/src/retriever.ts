import type { SkillIndex } from "./skill-index.js";
import type { SearchResult, HintEntry } from "./embedding/types.js";

export interface RetrieverOptions {
  topK: number;
  hintSize?: number;
  minScore?: number;
  maxResults?: number;
}

export interface Retriever {
  retrieve(subTasks: string[]): Promise<SearchResult[]>;
  buildHintSet(subTasks: string[]): Promise<HintEntry[]>;
}

export function createRetriever(index: SkillIndex, opts: RetrieverOptions): Retriever {
  const topK = opts.topK;
  const hintSize = opts.hintSize ?? topK;
  const minScore = opts.minScore ?? 0.2;
  // Cap the overall number of returned skills to avoid unbounded context bloat.
  // Defaults to hintSize (which is already the budget for Pass-2 hints) so the
  // contribution passed to the LLM stays aligned with the SAD hint budget.
  const maxResults = opts.maxResults ?? hintSize;

  return {
    async retrieve(subTasks: string[]): Promise<SearchResult[]> {
      if (subTasks.length === 0) return [];
      const seen = new Set<string>();
      const allResults: SearchResult[] = [];

      for (const task of subTasks) {
        const results = await index.search(task, topK);
        for (const result of results) {
          if (!seen.has(result.name) && result.score >= minScore) {
            seen.add(result.name);
            allResults.push(result);
          }
        }
      }

      allResults.sort((a, b) => b.score - a.score);
      const cap = Math.max(topK, maxResults);
      return allResults.slice(0, cap);
    },

    async buildHintSet(subTasks: string[]): Promise<HintEntry[]> {
      if (subTasks.length === 0) return [];
      const seen = new Set<string>();
      const scored: Array<HintEntry & { score: number }> = [];

      for (const task of subTasks) {
        const results = await index.search(task, Math.min(topK, Math.ceil(hintSize / subTasks.length)));
        for (const result of results) {
          if (!seen.has(result.name) && result.score >= minScore) {
            seen.add(result.name);
            scored.push({ name: result.name, description: result.description, score: result.score });
          }
        }
      }

      scored.sort((a, b) => b.score - a.score);
      return scored.slice(0, hintSize).map(({ name, description }) => ({ name, description }));
    },
  };
}
