---
id: "011"
phase: 4
title: Create Retriever — NN search per sub-task, hint set construction, dedup across sub-tasks
status: ready
depends_on: ["008", "010"]
parallel: false
conflicts_with: []
files:
  - extensions/skillweaver/src/retriever.ts
irreversible: false
scope_test: "extensions/skillweaver/src/retriever.test.ts"
allowed_change: create
covers_criteria: [SC1, SC2]
---
## Failing test (write first)

Create `extensions/skillweaver/src/retriever.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SkillIndex } from "./skill-index.js";
import type { SearchResult, HintEntry } from "./embedding/types.js";

const mockSearch = vi.fn();
const mockIndex = { search: mockSearch } as unknown as SkillIndex;

let createRetriever: Function;

describe("createRetriever", () => {
  beforeAll(async () => {
    const mod = await import("./retriever.js");
    createRetriever = mod.createRetriever;
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("retrieve()", () => {
    it("returns skills for each sub-task", async () => {
      mockSearch
        .mockResolvedValueOnce([{ name: "github", description: "Git ops", location: "/x", source: "bundled", score: 0.95 }])
        .mockResolvedValueOnce([{ name: "slack", description: "Slack ops", location: "/x", source: "bundled", score: 0.88 }]);

      const retriever = createRetriever(mockIndex, { topK: 3 });
      const results = await retriever.retrieve(["fetch data", "send message"]);

      expect(results).toHaveLength(2);
      expect(results[0].name).toBe("github");
      expect(results[1].name).toBe("slack");
    });

    it("deduplicates identical skills across sub-tasks", async () => {
      const sharedResult: SearchResult = { name: "github", description: "Git", location: "/x", source: "bundled", score: 0.9 };
      mockSearch.mockResolvedValue([sharedResult]);
      mockSearch.mockResolvedValue([sharedResult]);

      const retriever = createRetriever(mockIndex, { topK: 3 });
      const results = await retriever.retrieve(["task a", "task b"]);
      expect(results.length).toBeLessThanOrEqual(1);
    });

    it("returns empty array for empty sub-tasks", async () => {
      const retriever = createRetriever(mockIndex, { topK: 3 });
      const results = await retriever.retrieve([]);
      expect(results).toEqual([]);
    });
  });

  describe("buildHintSet()", () => {
    it("builds hints from search results, deduplicated by name", async () => {
      mockSearch
        .mockResolvedValueOnce([{ name: "github", description: "Git ops", location: "/x", source: "bundled", score: 0.95 }])
        .mockResolvedValueOnce([{ name: "github", description: "Git ops", location: "/x", source: "bundled", score: 0.88 }]);

      const retriever = createRetriever(mockIndex, { topK: 3, hintSize: 15 });
      const hints = await retriever.buildHintSet(["task a", "task b"]);

      expect(hints.length).toBeLessThanOrEqual(1);
      if (hints.length > 0) {
        expect(hints[0].name).toBe("github");
      }
    });

    it("caps hints at hintSize", async () => {
      const results: SearchResult[] = Array.from({ length: 20 }, (_, i) => ({
        name: `skill-${i}`,
        description: `desc ${i}`,
        location: `/x/${i}`,
        source: "bundled",
        score: 1 - i * 0.01,
      }));
      mockSearch.mockResolvedValue(results);

      const retriever = createRetriever(mockIndex, { topK: 20, hintSize: 5 });
      const hints = await retriever.buildHintSet(["task"]);
      expect(hints.length).toBeLessThanOrEqual(5);
    });
  });
});
```

## Change

**File:** `extensions/skillweaver/src/retriever.ts`
**Anchor:** new file — create at this path
**Before:** file does not exist
**After:**
```ts
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
```

## Allowed moves

Create exactly `extensions/skillweaver/src/retriever.ts` and its test. No other files. The `createRetriever` factory function is the public API — the `Retriever` object it returns has `retrieve` and `buildHintSet`.

## STOP triggers

- `retrieve()` or `buildHintSet()` mutate the input subTasks array
- Results not deduplicated by name (same skill appearing twice from different sub-tasks)
- `buildHintSet` returns more than `hintSize` entries

## Done when

`WAI_TYPECHECK_CMD="cd extensions/skillweaver && pnpm exec tsc --noEmit" WAI_TEST_CMD="cd extensions/skillweaver && npx vitest run src/retriever.test.ts" bash ~/.claude/wai/scripts/task-gate.sh plugin-skillweaver 011` exits 0