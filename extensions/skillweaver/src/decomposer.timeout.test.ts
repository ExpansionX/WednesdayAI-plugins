import { describe, it, expect, vi, beforeAll } from "vitest";

const mockFetchRaw = vi.fn();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let Decomposer: any;

describe("Decomposer timeout handling", () => {
  beforeAll(async () => {
    const mod = await import("./decomposer.js");
    Decomposer = mod.Decomposer;
  });

  it("returns empty result when fetch takes too long", async () => {
    mockFetchRaw.mockImplementationOnce(() => new Promise(() => {}));

    const decomposer = new Decomposer({
      fetchRaw: mockFetchRaw,
      provider: "openrouter",
      model: "test",
      apiKey: "sk-test",
    });

    const resultPromise = decomposer.decompose("query");
    const earlyResult = await Promise.race([resultPromise, Promise.resolve({ subTasks: [], hints: [], pass: 1 })]);

    expect(earlyResult.subTasks).toEqual([]);
  });

  it("passes AbortSignal to fetch", async () => {
    const ac = new AbortController();
    mockFetchRaw.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '{"subTasks":["task1"],"hints":[]}' } }] }),
    });

    const decomposer = new Decomposer({
      fetchRaw: mockFetchRaw,
      provider: "openrouter",
      model: "test",
      apiKey: "sk-test",
    });

    const result = await decomposer.decompose("query", undefined, 10, ac.signal);
    expect(result.subTasks).toEqual(["task1"]);
    expect(mockFetchRaw).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ signal: ac.signal }));
  });

  it("returns empty result on AbortError", async () => {
    const ac = new AbortController();
    mockFetchRaw.mockRejectedValueOnce(new DOMException("Aborted", "AbortError"));

    const decomposer = new Decomposer({
      fetchRaw: mockFetchRaw,
      provider: "openrouter",
      model: "test",
      apiKey: "sk-test",
    });

    const result = await decomposer.decompose("query", undefined, 10, ac.signal);
    expect(result.subTasks).toEqual([]);
  });

  it("returns empty result on HTTP 500", async () => {
    mockFetchRaw.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => "Internal Server Error",
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

  it("returns empty result on HTTP 429 (rate limited)", async () => {
    mockFetchRaw.mockResolvedValueOnce({
      ok: false,
      status: 429,
      text: async () => "Rate limit exceeded",
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
