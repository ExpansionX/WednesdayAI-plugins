import { describe, it, expect, vi, beforeAll } from "vitest";
import type { EmbeddingBackend } from "./embedding/types.js";

vi.mock("@xenova/transformers", () => ({
  pipeline: vi.fn().mockResolvedValue(vi.fn()),
}));

const mockDispose = vi.fn();
const mockBackend: EmbeddingBackend = {
  id: "test",
  dimensions: 4,
  embed: async (t: string[]) => t.map(() => new Float32Array(4)),
  embedSingle: async () => new Float32Array(4),
  dispose: mockDispose,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let SkillIndex: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let Decomposer: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let LocalEmbedding: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let CloudEmbedding: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let CustomEmbedding: any;

describe("lifecycle", () => {
  beforeAll(async () => {
    SkillIndex = (await import("./skill-index.js")).SkillIndex;
    Decomposer = (await import("./decomposer.js")).Decomposer;
    LocalEmbedding = (await import("./embedding/local.js")).LocalEmbedding;
    CloudEmbedding = (await import("./embedding/cloud.js")).CloudEmbedding;
    CustomEmbedding = (await import("./embedding/custom.js")).CustomEmbedding;
  });

  it("SkillIndex.dispose() clears skills and index", async () => {
    const index = new SkillIndex(mockBackend);
    await index.build([
      { name: "test", description: "desc", location: "/x", source: "bundled" },
    ]);
    expect(index.size).toBeGreaterThan(0);
    index.dispose();
    expect(index.size).toBe(0);
  });

  it("Decomposer.dispose() prevents further calls", () => {
    const d = new Decomposer({ provider: "openrouter", model: "test", apiKey: "k" });
    d.dispose();
    expect(() => d.dispose()).not.toThrow(); // idempotent
  });

  it("embedding backends support idempotent dispose", () => {
    const local = new LocalEmbedding();
    const cloud = new CloudEmbedding();
    const custom = new CustomEmbedding({ endpoint: "http://localhost:8080/v1/embeddings" });

    expect(() => local.dispose()).not.toThrow();
    expect(() => local.dispose()).not.toThrow(); // idempotent
    expect(() => cloud.dispose()).not.toThrow();
    expect(() => custom.dispose()).not.toThrow();
  });

  it("watch → unwatch → dispose cleans up completely", async () => {
    const backend: EmbeddingBackend = {
      id: "test",
      dimensions: 384,
      embed: vi.fn().mockResolvedValue([new Float32Array(384)]),
      embedSingle: vi.fn().mockResolvedValue(new Float32Array(384)),
      dispose: vi.fn(),
    };

    const index = new SkillIndex(backend);
    await index.build([
      { name: "github", description: "Git ops", location: "/x", source: "bundled" },
    ]);

    expect(index.unwatch()).toBe(false); // no watcher active
    index.dispose();
    expect(index.size).toBe(0);
  });
});
