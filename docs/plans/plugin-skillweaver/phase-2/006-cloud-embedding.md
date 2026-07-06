---
id: "006"
phase: 2
title: Create CloudEmbedding backend using OpenAI embeddings API
status: ready
depends_on: ["004"]
parallel: false
conflicts_with: []
files:
  - extensions/skillweaver/src/embedding/cloud.ts
irreversible: false
scope_test: "extensions/skillweaver/src/embedding/cloud.test.ts"
allowed_change: create
covers_criteria: [SC6]
---
## Failing test (write first)

Create `extensions/skillweaver/src/embedding/cloud.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

let CloudEmbedding: { new (...args: unknown[]): { id: string; dimensions: number; embed: Function; embedSingle: Function; dispose: Function } };

describe("CloudEmbedding", () => {
  beforeAll(async () => {
    const mod = await import("./cloud.js");
    CloudEmbedding = mod.CloudEmbedding;
  });

  beforeEach(() => {
    vi.clearAllMocks();
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
});
```

## Change

**File:** `extensions/skillweaver/src/embedding/cloud.ts`
**Anchor:** new file — create at this path
**Before:** file does not exist
**After:**
```ts
import type { EmbeddingBackend } from "./types.js";

const DEFAULT_MODEL = "text-embedding-3-small";
const DEFAULT_ENDPOINT = "https://api.openai.com/v1/embeddings";
const DIMENSIONS = 1536;

export interface CloudEmbeddingOptions {
  apiKey?: string | null;
  model?: string;
  endpoint?: string;
}

export class CloudEmbedding implements EmbeddingBackend {
  readonly id = "cloud";
  readonly dimensions = DIMENSIONS;

  private apiKey: string | null;
  private model: string;
  private endpoint: string;
  private disposed = false;

  constructor(opts: CloudEmbeddingOptions = {}) {
    this.apiKey = opts.apiKey ?? process.env.OPENAI_API_KEY ?? null;
    this.model = opts.model ?? DEFAULT_MODEL;
    this.endpoint = opts.endpoint ?? DEFAULT_ENDPOINT;
  }

  async embed(texts: string[]): Promise<Float32Array[]> {
    if (this.disposed) throw new Error("CloudEmbedding: already disposed");
    const body = JSON.stringify({
      model: this.model,
      input: texts,
      encoding_format: "float",
    });

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;

    const response = await fetch(this.endpoint, { method: "POST", headers, body });
    if (!response.ok) {
      throw new Error(`CloudEmbedding: request failed ${response.status}: ${await response.text()}`);
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

Create exactly `extensions/skillweaver/src/embedding/cloud.ts` and its test. No other files.

## STOP triggers

- API key leaked to console/log in implementation
- Request body does not include `encoding_format: "float"` (required for Float32Array)
- Results not sorted by index (OpenAI returns parallel results)

## Done when

`WAI_TYPECHECK_CMD="cd extensions/skillweaver && pnpm exec tsc --noEmit" WAI_TEST_CMD="cd extensions/skillweaver && npx vitest run src/embedding/cloud.test.ts" bash ~/.claude/wai/scripts/task-gate.sh plugin-skillweaver 006` exits 0