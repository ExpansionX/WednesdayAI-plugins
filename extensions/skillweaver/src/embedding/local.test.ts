import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";

const mockPipeline = vi.fn();
const mockPipe = vi.fn().mockResolvedValue(mockPipeline);

vi.mock("@xenova/transformers", () => ({
  pipeline: (...args: unknown[]) => mockPipe(...args),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let LocalEmbedding: any;

describe("LocalEmbedding", () => {
  beforeAll(async () => {
    const mod = await import("./local.js");
    LocalEmbedding = mod.LocalEmbedding;
  });

  beforeEach(() => {
    mockPipe.mockClear();
    mockPipeline.mockClear();
  });

  it("has id 'local' and dimensions 384", () => {
    const backend = new LocalEmbedding();
    expect(backend.id).toBe("local");
    expect(backend.dimensions).toBe(384);
  });

  it("creates feature-extraction pipeline with Xenova", async () => {
    const backend = new LocalEmbedding();
    await (backend as unknown as { pipeline: Promise<unknown> }).pipeline;
    expect(mockPipe).toHaveBeenCalledWith(
      "feature-extraction",
      "Xenova/all-MiniLM-L6-v2",
    );
  });

  it("embed() returns Float32Array per text", async () => {
    mockPipeline.mockResolvedValueOnce({
      data: Array(384).fill(0.1),
      dims: [384],
      type: "float32",
    });
    mockPipeline.mockResolvedValueOnce({
      data: Array(384).fill(0.2),
      dims: [384],
      type: "float32",
    });

    const backend = new LocalEmbedding();
    const results = await backend.embed(["hello", "world"]);
    expect(results).toHaveLength(2);
    expect(results[0]).toBeInstanceOf(Float32Array);
    expect(results[1]).toBeInstanceOf(Float32Array);
    expect(results[0].length).toBe(384);
  });

  it("embedSingle delegates to embed", async () => {
    mockPipeline.mockResolvedValueOnce({
      data: Array(384).fill(0.5),
      dims: [384],
      type: "float32",
    });
    const backend = new LocalEmbedding();
    const result = await backend.embedSingle("hello");
    expect(result).toBeInstanceOf(Float32Array);
    expect(result.length).toBe(384);
  });

  it("dispose is a no-op", () => {
    const backend = new LocalEmbedding();
    expect(() => backend.dispose()).not.toThrow();
  });

  it("normalizes model name from config", async () => {
    const backend = new LocalEmbedding("sentence-transformers/all-MiniLM-L6-v2");
    await (backend as unknown as { pipeline: Promise<unknown> }).pipeline;
    expect(mockPipe).toHaveBeenCalledWith(
      "feature-extraction",
      "Xenova/sentence-transformers/all-MiniLM-L6-v2",
    );
  });
});
