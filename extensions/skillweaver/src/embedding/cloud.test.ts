import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let CloudEmbedding: any;

describe("CloudEmbedding", () => {
  beforeAll(async () => {
    const mod = await import("./cloud.js");
    CloudEmbedding = mod.CloudEmbedding;
  });

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubGlobal("fetch", mockFetch);
    mockFetch.mockReset();
  });

  it("has id 'cloud' and dimensions 1536", () => {
    const backend = new CloudEmbedding({ apiKey: "sk-test" });
    expect(backend.id).toBe("cloud");
    expect(backend.dimensions).toBe(1536);
  });

  it("sends correct OpenAI embeddings request", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [
          { embedding: Array(1536).fill(0.1), index: 0 },
          { embedding: Array(1536).fill(0.2), index: 1 },
        ],
      }),
    });

    const backend = new CloudEmbedding({ apiKey: "sk-test" });
    const results = await backend.embed(["hello", "world"]);

    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.openai.com/v1/embeddings",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer sk-test",
          "Content-Type": "application/json",
        }),
        body: expect.stringContaining("text-embedding-3-small"),
      }),
    );
    expect(results).toHaveLength(2);
    expect(results[0]).toBeInstanceOf(Float32Array);
    expect(results[1]).toBeInstanceOf(Float32Array);
  });

  it("respects custom model parameter", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [{ embedding: Array(1536).fill(0.1), index: 0 }],
      }),
    });

    const backend = new CloudEmbedding({ apiKey: "sk-test", model: "text-embedding-ada-002" });
    await backend.embed(["test"]);

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        body: expect.stringContaining("text-embedding-ada-002"),
      }),
    );
  });

  it("embedSingle delegates to embed", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [{ embedding: Array(1536).fill(0.5), index: 0 }],
      }),
    });

    const backend = new CloudEmbedding({ apiKey: "sk-test" });
    const result = await backend.embedSingle("hello");
    expect(result).toBeInstanceOf(Float32Array);
  });

  it("dispose clears state", () => {
    const backend = new CloudEmbedding();
    expect(() => backend.dispose()).not.toThrow();
  });

  it("throws on non-ok response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => "Unauthorized",
    });

    const backend = new CloudEmbedding({ apiKey: "bad-key" });
    await expect(backend.embed(["test"])).rejects.toThrow(/401/);
  });

  it("throws descriptive error when response has no data array", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ error: "something went wrong" }),
    });

    const backend = new CloudEmbedding({ apiKey: "sk-test" });
    await expect(backend.embed(["test"])).rejects.toThrow(/missing 'data'/);
  });

  it("passes an AbortSignal to fetch for timeout", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [{ embedding: Array(1536).fill(0.1), index: 0 }],
      }),
    });

    const backend = new CloudEmbedding({ apiKey: "sk-test", timeoutMs: 5000 });
    await backend.embed(["test"]);

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });
});
