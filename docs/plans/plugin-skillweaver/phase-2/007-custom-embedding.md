---
id: "007"
phase: 2
title: Create CustomEmbedding backend for OpenAI-compatible endpoints
status: ready
depends_on: ["004"]
parallel: false
conflicts_with: []
files:
  - extensions/skillweaver/src/embedding/custom.ts
  - extensions/skillweaver/src/embedding/custom.test.ts
irreversible: false
scope_test: "extensions/skillweaver/src/embedding/custom.test.ts"
allowed_change: create
covers_criteria: [SC6]
---
## Failing test (write first)

Create `extensions/skillweaver/src/embedding/custom.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

let CustomEmbedding: { new (...args: unknown[]): { id: string; dimensions: number; embed: Function; embedSingle: Function; dispose: Function } };

describe("CustomEmbedding", () => {
  beforeAll(async () => {
    const mod = await import("./custom.js");
    CustomEmbedding = mod.CustomEmbedding;
  });

  beforeEach(() => {
    vi.clearAllMocks();
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
```

## Change

**File:** `extensions/skillweaver/src/embedding/custom.ts`
**Anchor:** new file — create at this path
**Before:** file does not exist
**After:**
```ts
import type { EmbeddingBackend } from "./types.js";

export interface CustomEmbeddingOptions {
  endpoint?: string | null;
  apiKey?: string | null;
  dimensions?: number;
  model?: string;
}

export class CustomEmbedding implements EmbeddingBackend {
  readonly id = "custom";
  readonly dimensions: number;

  private endpoint: string;
  private apiKey: string | null;
  private model: string;
  private disposed = false;

  constructor(opts: CustomEmbeddingOptions) {
    if (!opts.endpoint) {
      throw new Error("CustomEmbedding: endpoint is required");
    }
    this.endpoint = opts.endpoint;
    this.apiKey = opts.apiKey ?? null;
    this.dimensions = opts.dimensions ?? 384;
    this.model = opts.model ?? "custom";
  }

  async embed(texts: string[]): Promise<Float32Array[]> {
    if (this.disposed) throw new Error("CustomEmbedding: already disposed");
    const body = JSON.stringify({
      model: this.model,
      input: texts,
    });

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;

    const response = await fetch(this.endpoint, { method: "POST", headers, body });
    if (!response.ok) {
      throw new Error(`CustomEmbedding: request failed ${response.status}: ${await response.text()}`);
    }

    const json = await response.json() as { data: Array<{ embedding: number[]; index: number }> };
    return json.data
      .sort((a, b) => a.index - b.index)
      .map((item) => new Float32Array(item.embedding));
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

Create exactly `extensions/skillweaver/src/embedding/custom.ts` and its test. No other files.

## STOP triggers

- Constructor creates backend without endpoint (undefined)
- API key echoed to stdout/stderr in implementation
- Response not sorted by index

## Done when

`WAI_TYPECHECK_CMD="cd extensions/skillweaver && pnpm exec tsc --noEmit" WAI_TEST_CMD="cd extensions/skillweaver && npx vitest run src/embedding/custom.test.ts" bash ~/.claude/wai/scripts/task-gate.sh plugin-skillweaver 007` exits 0