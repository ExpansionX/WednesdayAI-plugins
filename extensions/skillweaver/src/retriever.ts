import type { SkillIndex } from "./skill-index.js";
import type { SearchResult, HintEntry } from "./embedding/types.js";

export interface RetrieverOptions {
  topK: number;
  hintSize?: number;
}

export interface Retriever {
  retrieve(subTasks: string[]): Promise<SearchResult[]>;
  buildHintSet(subTasks: string[]): Promise<HintEntry[]>;
}

export function createRetriever(index: SkillIndex, opts: RetrieverOptions): Retriever {
  const topK = opts.topK;
  const hintSize = opts.hintSize ?? topK;

  return {
    async retrieve(subTasks: string[]): Promise<SearchResult[]> {
      if (subTasks.length === 0) return [];
      const seen = new Set<string>();
      const allResults: SearchResult[] = [];

      for (const task of subTasks) {
        const results = await index.search(task, topK);
        for (const result of results) {
          if (!seen.has(result.name)) {
            seen.add(result.name);
            allResults.push(result);
          }
        }
      }

      return allResults;
    },

    async buildHintSet(subTasks: string[]): Promise<HintEntry[]> {
      if (subTasks.length === 0) return [];
      const seen = new Set<string>();
      const hints: HintEntry[] = [];

      for (const task of subTasks) {
        const results = await index.search(task, Math.min(topK, Math.ceil(hintSize / subTasks.length)));
        for (const result of results) {
          if (!seen.has(result.name)) {
            seen.add(result.name);
            hints.push({ name: result.name, description: result.description });
          }
        }
      }

      return hints.slice(0, hintSize);
    },
  };
}
