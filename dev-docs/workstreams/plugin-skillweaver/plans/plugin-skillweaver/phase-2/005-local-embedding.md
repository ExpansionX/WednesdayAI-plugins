---
id: "005"
phase: 2
title: Create LocalEmbedding backend using @xenova/transformers (all-MiniLM-L6-v2)
status: ready
depends_on: ["004"]
parallel: false
conflicts_with: []
files:
  - extensions/skillweaver/src/embedding/local.ts
  - extensions/skillweaver/src/embedding/local.test.ts
irreversible: false
scope_test: "extensions/skillweaver/src/embedding/local.test.ts"
allowed_change: create
covers_criteria: [SC6]
---
## Failing test (write first)

Create `extensions/skillweaver/src/embedding/local.test.ts`:

```ts
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";

const mockPipeline = vi.fn();
const mockPipe = vi.fn().mockResolvedValue(mockPipeline);

vi.mock("@xenova/transformers", () => ({
  pipeline: (...args: unknown[]) => mockPipe(...args),
}));

let LocalEmbedding: { new (...args: unknown[]): { id: string; dimensions: number; embed: Function; embedSingle: Function; dispose: Function } };

describe("LocalEmbedding", () => {
  beforeAll(async () => {
    const mod = await import("./local.js");
    LocalEmbedding = mod.LocalEmbedding;
  });

  it("has id 'local' and dimensions 384", () => {
    const backend = new LocalEmbedding();
    expect(backend.id).toBe("local");
    expect(backend.dimensions).toBe(384);
  });

  it("creates feature-extraction pipeline with Xenova", () => {
    new LocalEmbedding();
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

  it("normalizes model name from config", () => {
    const backend = new LocalEmbedding("sentence-transformers/all-MiniLM-L6-v2");
    expect(mockPipe).toHaveBeenCalledWith(
      "feature-extraction",
      "Xenova/sentence-transformers/all-MiniLM-L6-v2",
    );
  });
});
```

## Change

**File:** `extensions/skillweaver/src/embedding/local.ts`
**Anchor:** new file — create at this path
**Before:** file does not exist
**After:**
```ts
import type { EmbeddingBackend } from "./types.js";

const DEFAULT_MODEL = "all-MiniLM-L6-v2";
const DIMENSIONS = 384;

export class LocalEmbedding implements EmbeddingBackend {
  readonly id = "local";
  readonly dimensions = DIMENSIONS;

  private pipeline: Promise<{
    (text: string | string[], options?: { pooling: string; normalize: boolean }): Promise<{
      data: Float32Array | number[];
      dims: number[];
      type: string;
    }>;
  }>;
  private disposed = false;

  constructor(modelName: string = DEFAULT_MODEL) {
    this.pipeline = this.loadPipeline(modelName);
  }

  private async loadPipeline(modelName: string) {
    const { pipeline } = await import("@xenova/transformers");
    const xenovaModel = modelName.startsWith("Xenova/") ? modelName : `Xenova/${modelName}`;
    return pipeline("feature-extraction", xenovaModel) as Promise<ReturnType<typeof this.loadPipeline>>;
  }

  async embed(texts: string[]): Promise<Float32Array[]> {
    if (this.disposed) throw new Error("LocalEmbedding: already disposed");
    const pipe = await this.pipeline;
    const results: Float32Array[] = [];
    for (const text of texts) {
      const output = await pipe(text, { pooling: "mean", normalize: true });
      const data = output.data instanceof Float32Array ? output.data : new Float32Array(output.data);
      results.push(data);
    }
    return results;
  }

  async embedSingle(text: string): Promise<Float32Array> {
    const results = await this.embed([text]);
    return results[0];
  }

  dispose(): void {
    this.disposed = true;
  }
}
```

## Allowed moves

Create exactly `extensions/skillweaver/src/embedding/local.ts` and `extensions/skillweaver/src/embedding/local.test.ts`. No other files. Add `@xenova/transformers` to `dependencies` in package.json ONLY if the test requires it and the dependency resolution fails.

## STOP triggers

- `embed()` returns anything other than `Promise<Float32Array[]>`
- `dimensions` is not exactly 384
- Model load error from `@xenova/transformers` (this is expected in CI without model files — test mocks at the import level)
- Constructor parameter type doesn't match interface contract

## Done when

`WAI_TYPECHECK_CMD="cd extensions/skillweaver && pnpm exec tsc --noEmit" WAI_TEST_CMD="cd extensions/skillweaver && npx vitest run src/embedding/local.test.ts" bash ~/.claude/wai/scripts/task-gate.sh plugin-skillweaver 005` exits 0