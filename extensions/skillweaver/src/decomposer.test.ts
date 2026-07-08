import { describe, it, expect, vi, beforeAll } from "vitest";
import type { HintEntry } from "./embedding/types.js";

const mockFetchRaw = vi.fn();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let Decomposer: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let extractJsonArray: any;

describe("Decomposer", () => {
  beforeAll(async () => {
    const mod = await import("./decomposer.js");
    Decomposer = mod.Decomposer;
    extractJsonArray = mod.extractJsonArray;
  });

  describe("extractJsonArray()", () => {
    it("parses { subTasks: [...] } object", () => {
      const result = extractJsonArray('{"subTasks": ["task1", "task2"]}');
      expect(result).toEqual(["task1", "task2"]);
    });

    it("parses raw JSON array (backward compat)", () => {
      const result = extractJsonArray('["task1", "task2"]');
      expect(result).toEqual(["task1", "task2"]);
    });

    it("extracts from markdown code block", () => {
      const result = extractJsonArray('```json\n["task1"]\n```');
      expect(result).toEqual(["task1"]);
    });

    it("returns empty for malformed input", () => {
      const result = extractJsonArray("not json at all");
      expect(result).toEqual([]);
    });
  });

  describe("decompose() — Pass 1 (no hints)", () => {
    it("decomposes a query into sub-tasks", async () => {
      const decomposer = new Decomposer({
        fetchRaw: mockFetchRaw,
        provider: "openrouter",
        model: "qwen/qwen2.5-7b-instruct",
        apiKey: "sk-test",
      });

      mockFetchRaw.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '{"subTasks": ["download CSV from URL", "run statistical analysis"]}' } }],
        }),
      });

      const result = await decomposer.decompose("download this dataset and analyze it");
      expect(result.subTasks).toEqual(["download CSV from URL", "run statistical analysis"]);
      expect(result.pass).toBe(1);
    });

    it("returns empty subTasks for malformed JSON response", async () => {
      mockFetchRaw.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: "not json }" } }],
        }),
      });

      const decomposer = new Decomposer({
        fetchRaw: mockFetchRaw,
        provider: "openrouter",
        model: "test",
        apiKey: "sk-test",
      });

      const result = await decomposer.decompose("query");
      expect(result.subTasks).toEqual([]);
    });

    it("extracts JSON array from markdown-wrapped response", async () => {
      mockFetchRaw.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '```json\n["task one", "task two"]\n```' } }],
        }),
      });

      const decomposer = new Decomposer({
        fetchRaw: mockFetchRaw,
        provider: "openrouter",
        model: "test",
        apiKey: "sk-test",
      });

      const result = await decomposer.decompose("query");
      expect(result.subTasks).toEqual(["task one", "task two"]);
    });

    it("caps sub-tasks at maxSubTasks (default 10)", async () => {
      const tooMany = JSON.stringify({ subTasks: Array.from({ length: 20 }, (_, i) => `task ${i}`) });
      mockFetchRaw.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ choices: [{ message: { content: tooMany } }] }),
      });

      const decomposer = new Decomposer({
        fetchRaw: mockFetchRaw,
        provider: "openrouter",
        model: "test",
        apiKey: "sk-test",
      });

      const result = await decomposer.decompose("query", [], 10);
      expect(result.subTasks.length).toBeLessThanOrEqual(10);
    });
  });

  describe("decompose() — Pass 2 (with hints)", () => {
    it("includes hints in the Pass-2 prompt", async () => {
      const decomposer = new Decomposer({
        fetchRaw: mockFetchRaw,
        provider: "openrouter",
        model: "test",
        apiKey: "sk-test",
      });

      mockFetchRaw.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '{"subTasks": ["fetch data with github", "analyze with slack"]}' } }],
        }),
      });

      const hints: HintEntry[] = [
        { name: "github", description: "Git operations" },
        { name: "slack", description: "Slack messaging" },
      ];

      const result = await decomposer.decompose("query", hints);
      expect(result.subTasks.length).toBeGreaterThan(0);
      expect(mockFetchRaw).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining("github"),
        }),
      );
    });

    it("marks pass as 2 when hints provided", async () => {
      mockFetchRaw.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '{"subTasks": ["task"]}' } }],
        }),
      });

      const decomposer = new Decomposer({
        fetchRaw: mockFetchRaw,
        provider: "test",
        model: "test",
        apiKey: "sk-test",
      });

      const result = await decomposer.decompose("query", [{ name: "github", description: "Git" }]);
      expect(result.pass).toBe(2);
    });
  });

  describe("error handling", () => {
    it("returns empty result on fetch failure", async () => {
      mockFetchRaw.mockRejectedValueOnce(new Error("network error"));

      const decomposer = new Decomposer({
        fetchRaw: mockFetchRaw,
        provider: "test",
        model: "test",
        apiKey: "sk-test",
      });

      const result = await decomposer.decompose("query");
      expect(result.subTasks).toEqual([]);
    });
  });
});
