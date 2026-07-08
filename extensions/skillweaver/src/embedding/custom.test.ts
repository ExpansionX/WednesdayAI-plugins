import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let CustomEmbedding: any;

describe("CustomEmbedding", () => {
  beforeAll(async () => {
    const mod = await import("./custom.js");
    CustomEmbedding = mod.CustomEmbedding;
  });

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubGlobal("fetch", mockFetch);
    mockFetch.mockReset();
  });

  it("has id 'custom' and configurable dimensions", () => {
    const backend = new CustomEmbedding({ endpoint: "http://localhost:8080/v1/embeddings", dimensions: 768 });
    expect(backend.id).toBe("custom");
    expect(backend.dimensions).toBe(768);
  });

  it("defaults to 384 dimensions", () => {
    const backend = new CustomEmbedding({ endpoint: "http://localhost:8080/v1/embeddings" });
    expect(backend.dimensions).toBe(384);
  });

  it("sends correct request to custom endpoint", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [{ embedding: Array(384).fill(0.1), index: 0 }],
      }),
    });

    const backend = new CustomEmbedding({ endpoint: "http://localhost:8080/v1/embeddings" });
    await backend.embed(["hello"]);

    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:8080/v1/embeddings",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "Content-Type": "application/json" }),
        body: expect.stringContaining("hello"),
      }),
    );
  });

  it("includes API key in headers when provided", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [{ embedding: Array(384).fill(0.1), index: 0 }],
      }),
    });

    const backend = new CustomEmbedding({ endpoint: "http://localhost:8080/v1/embeddings", apiKey: "custom-key" });
    await backend.embed(["test"]);

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer custom-key" }),
      }),
    );
  });

  it("throws on non-ok response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => "Internal error",
    });

    const backend = new CustomEmbedding({ endpoint: "http://localhost:8080/v1/embeddings" });
    await expect(backend.embed(["test"])).rejects.toThrow(/500/);
  });

  it("throws if endpoint is missing", () => {
    expect(() => new CustomEmbedding({})).toThrow(/endpoint/);
  });

  it("throws descriptive error when response has no data array", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ error: "bad request" }),
    });

    const backend = new CustomEmbedding({ endpoint: "http://localhost:8080/v1/embeddings" });
    await expect(backend.embed(["test"])).rejects.toThrow(/missing 'data'/);
  });

  it("throws descriptive error when embedding is missing", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [{ index: 0 }] }),
    });

    const backend = new CustomEmbedding({ endpoint: "http://localhost:8080/v1/embeddings" });
    await expect(backend.embed(["test"])).rejects.toThrow(/missing embedding array/);
  });

  it("throws on dimension mismatch", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [{ embedding: Array(256).fill(0.1), index: 0 }],
      }),
    });

    const backend = new CustomEmbedding({ endpoint: "http://localhost:8080/v1/embeddings", dimensions: 768 });
    await expect(backend.embed(["test"])).rejects.toThrow(/dimension mismatch/);
  });

  it("embedSingle throws when embed returns empty data", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [] }),
    });

    const backend = new CustomEmbedding({ endpoint: "http://localhost:8080/v1/embeddings" });
    await expect(backend.embedSingle("test")).rejects.toThrow(/empty/);
  });

  it("passes an AbortSignal to fetch for timeout", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [{ embedding: Array(384).fill(0.1), index: 0 }],
      }),
    });

    const backend = new CustomEmbedding({ endpoint: "http://localhost:8080/v1/embeddings", timeoutMs: 5000 });
    await backend.embed(["test"]);

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("sends custom model name in request body", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [{ embedding: Array(384).fill(0.1), index: 0 }],
      }),
    });

    const backend = new CustomEmbedding({ endpoint: "http://localhost:8080/v1/embeddings", model: "my-model" });
    await backend.embed(["test"]);

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ body: expect.stringContaining("my-model") }),
    );
  });

  it("embedSingle delegates to embed", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [{ embedding: Array(384).fill(0.5), index: 0 }],
      }),
    });

    const backend = new CustomEmbedding({ endpoint: "http://localhost:8080/v1/embeddings" });
    const result = await backend.embedSingle("hello");
    expect(result).toBeInstanceOf(Float32Array);
  });
});
