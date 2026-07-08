import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

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

  it("throws after dispose when embed is called", async () => {
    const backend = new LocalEmbedding();
    backend.dispose();
    await expect(backend.embed(["test"])).rejects.toThrow(/disposed/);
  });

  it("dispose nulls the pipeline reference", () => {
    const backend = new LocalEmbedding();
    backend.dispose();
    expect((backend as unknown as { pipeline: unknown }).pipeline).toBeNull();
  });

  it("normalizes model name from config", async () => {
    const backend = new LocalEmbedding("sentence-transformers/all-MiniLM-L6-v2");
    await (backend as unknown as { pipeline: Promise<unknown> }).pipeline;
    expect(mockPipe).toHaveBeenCalledWith(
      "feature-extraction",
      "Xenova/sentence-transformers/all-MiniLM-L6-v2",
    );
  });

  it("throws when dispose() is called while pipeline is loading", async () => {
    let resolvePipeline: (v: unknown) => void;
    mockPipe.mockReturnValueOnce(new Promise((r) => { resolvePipeline = r; }));

    const backend = new LocalEmbedding();
    backend.dispose();

    // Now resolve the pipeline — embed should still throw
    resolvePipeline!(vi.fn());

    await expect(backend.embed(["test"])).rejects.toThrow(/disposed/);
  });

  it("embed throws if disposed after pipeline resolved but before embed runs", async () => {
    let pipelineFn: (text: string, opts: unknown) => Promise<unknown>;
    mockPipe.mockReturnValueOnce(new Promise((resolve) => {
      pipelineFn = vi.fn().mockResolvedValue({ data: new Float32Array(384) });
      resolve(pipelineFn);
    }));

    const backend = new LocalEmbedding();
    // Wait for pipeline to resolve
    await (backend as unknown as { pipeline: Promise<unknown> }).pipeline;

    // Now dispose
    backend.dispose();

    await expect(backend.embed(["test"])).rejects.toThrow(/disposed/);
  });

  it("preserves Xenova/ prefix in model name", async () => {
    const backend = new LocalEmbedding("Xenova/all-MiniLM-L6-v2");
    await (backend as unknown as { pipeline: Promise<unknown> }).pipeline;
    expect(mockPipe).toHaveBeenCalledWith(
      "feature-extraction",
      "Xenova/all-MiniLM-L6-v2",
    );
  });

  it("stores pipeline error and throws on embed without unhandled rejection", async () => {
    const loadError = new Error("module not found");
    mockPipe.mockReturnValueOnce(Promise.reject(loadError));

    const backend = new LocalEmbedding();

    // Wait a tick for the .catch() handler to run
    await new Promise((r) => setTimeout(r, 10));

    // The pipeline error should be stored, not unhandled
    expect((backend as unknown as { pipelineError: Error | null }).pipelineError).toBe(loadError);
    expect((backend as unknown as { pipeline: unknown }).pipeline).toBeNull();

    // embed() should throw the stored error
    await expect(backend.embed(["test"])).rejects.toThrow("module not found");
  });

  it("embedSingle throws stored pipeline error", async () => {
    const loadError = new Error("transformers not installed");
    mockPipe.mockReturnValueOnce(Promise.reject(loadError));

    const backend = new LocalEmbedding();
    await new Promise((r) => setTimeout(r, 10));

    await expect(backend.embedSingle("test")).rejects.toThrow("transformers not installed");
  });
});
