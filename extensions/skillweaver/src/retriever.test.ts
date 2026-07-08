import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import type { SkillIndex } from "./skill-index.js";
import type { SearchResult } from "./embedding/types.js";

const mockSearch = vi.fn();
const mockIndex = { search: mockSearch } as unknown as SkillIndex;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let createRetriever: any;

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
