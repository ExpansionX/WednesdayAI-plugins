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

    it("returns correct pass number on error during pass 2", async () => {
      mockFetchRaw.mockRejectedValueOnce(new Error("rate limited"));

      const decomposer = new Decomposer({
        fetchRaw: mockFetchRaw,
        provider: "test",
        model: "test",
        apiKey: "sk-test",
      });

      const result = await decomposer.decompose("query", [{ name: "github", description: "Git" }]);
      expect(result.subTasks).toEqual([]);
      expect(result.pass).toBe(2);
    });

    it("throws when disposed", async () => {
      const decomposer = new Decomposer({
        fetchRaw: mockFetchRaw,
        provider: "test",
        model: "test",
        apiKey: "sk-test",
      });
      decomposer.dispose();
      await expect(decomposer.decompose("query")).rejects.toThrow(/disposed/);
    });
  });

  describe("Anthropic provider", () => {
    it("sends correct headers and body format", async () => {
      const decomposer = new Decomposer({
        fetchRaw: mockFetchRaw,
        provider: "anthropic",
        model: "claude-haiku",
        apiKey: "sk-ant-test",
      });

      mockFetchRaw.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          content: [{ text: '{"subTasks": ["task1"]}' }],
        }),
      });

      const result = await decomposer.decompose("query");
      expect(result.subTasks).toEqual(["task1"]);
      expect(result.pass).toBe(1);

      const call = mockFetchRaw.mock.calls[mockFetchRaw.mock.calls.length - 1];
      expect(call[1].headers["x-api-key"]).toBe("sk-ant-test");
      expect(call[1].headers["anthropic-version"]).toBe("2023-06-01");
      expect(call[1].headers.Authorization).toBeUndefined();
    });

    it("omits x-api-key header when no apiKey", async () => {
      const decomposer = new Decomposer({
        fetchRaw: mockFetchRaw,
        provider: "anthropic",
        model: "claude-haiku",
      });

      mockFetchRaw.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          content: [{ text: '{"subTasks": ["task1"]}' }],
        }),
      });

      await decomposer.decompose("query");
      const call = mockFetchRaw.mock.calls[mockFetchRaw.mock.calls.length - 1];
      expect(call[1].headers["x-api-key"]).toBeUndefined();
    });

    it("handles empty content array", async () => {
      mockFetchRaw.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ content: [] }),
      });

      const decomposer = new Decomposer({
        fetchRaw: mockFetchRaw,
        provider: "anthropic",
        model: "claude-haiku",
        apiKey: "sk-ant-test",
      });

      const result = await decomposer.decompose("query");
      expect(result.subTasks).toEqual([]);
    });
  });

  describe("HTTP error responses", () => {
    it("returns empty on 401", async () => {
      mockFetchRaw.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => "Unauthorized",
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

    it("returns empty on 429", async () => {
      mockFetchRaw.mockResolvedValueOnce({
        ok: false,
        status: 429,
        text: async () => "Rate limited",
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
  });

  describe("endpoint resolution", () => {
    it("uses OpenAI endpoint for openai provider", async () => {
      const decomposer = new Decomposer({
        fetchRaw: mockFetchRaw,
        provider: "openai",
        model: "gpt-4o-mini",
        apiKey: "sk-test",
      });

      mockFetchRaw.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '{"subTasks": ["task"]}' } }],
        }),
      });

      await decomposer.decompose("query");
      const call = mockFetchRaw.mock.calls[mockFetchRaw.mock.calls.length - 1];
      expect(call[0]).toContain("api.openai.com");
    });

    it("uses custom baseUrl for openai-compatible", async () => {
      const decomposer = new Decomposer({
        fetchRaw: mockFetchRaw,
        provider: "openai-compatible",
        model: "test",
        baseUrl: "http://localhost:8080/v1/chat/completions",
        apiKey: "sk-test",
      });

      mockFetchRaw.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '{"subTasks": ["task"]}' } }],
        }),
      });

      await decomposer.decompose("query");
      const call = mockFetchRaw.mock.calls[mockFetchRaw.mock.calls.length - 1];
      expect(call[0]).toBe("http://localhost:8080/v1/chat/completions");
    });

    it("returns empty for openai-compatible without baseUrl", async () => {
      const decomposer = new Decomposer({
        fetchRaw: mockFetchRaw,
        provider: "openai-compatible",
        model: "test",
      });

      const result = await decomposer.decompose("query");
      expect(result.subTasks).toEqual([]);
    });
  });
});
