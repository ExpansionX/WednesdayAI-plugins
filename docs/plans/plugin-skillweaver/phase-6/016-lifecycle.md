---
id: "016"
phase: 6
title: Add lifecycle management — clean teardown on plugin unload, backend dispose, index dispose, watcher cleanup
status: ready
depends_on: ["014"]
parallel: false
conflicts_with: []
files:
  - extensions/skillweaver/index.ts
  - extensions/skillweaver/index.test.ts
  - extensions/skillweaver/src/lifecycle.test.ts
irreversible: false
scope_test: "extensions/skillweaver/index.test.ts"
allowed_change: edit
covers_criteria: [SC7]
---
## Failing test (write first)

Add these tests to `extensions/skillweaver/index.test.ts`:

```ts
  // ==== Add to existing describe("plugin register() wiring", () => { ... }) block ====

  it("handles duplicate register() calls without crash", () => {
    const api = createMockApi();
    plugin.register(api);
    expect(() => plugin.register(api)).not.toThrow();
  });

  it("does not register when embedding backend is missing", () => {
    const api = createMockApi({
      pluginConfig: { embedding: { backend: "custom" } }, // custom requires endpoint
    });
    expect(() => plugin.register(api)).toThrow();
  });

  it("handles null pluginConfig gracefully", () => {
    const api = createMockApi({ pluginConfig: null as never });
    expect(() => plugin.register(api)).not.toThrow();
  });
```

Also create `extensions/skillweaver/src/lifecycle.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { EmbeddingBackend } from "./embedding/types.js";

const mockDispose = vi.fn();
const mockBackend: EmbeddingBackend = {
  id: "test",
  dimensions: 4,
  embed: async (t: string[]) => t.map(() => new Float32Array(4)),
  embedSingle: async () => new Float32Array(4),
  dispose: mockDispose,
};

let SkillIndex: { new (b: EmbeddingBackend): { build: Function; dispose: Function; getSkill: Function; watch: Function; unwatch: Function; size: number } };
let Decomposer: { new (...a: unknown[]): { dispose: Function } };
let LocalEmbedding: { new (...a: unknown[]): { id: string; dimensions: number; dispose: Function } };
let CloudEmbedding: { new (...a: unknown[]): { id: string; dimensions: number; dispose: Function } };
let CustomEmbedding: { new (...a: unknown[]): { id: string; dimensions: number; dispose: Function } };

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
```

## Change

**File:** `extensions/skillweaver/index.ts`
**Anchor:** add `api.on("gateway_stop", ...)` cleanup handler inside `register()` — insert after the existing `api.on("context.collect", handler)` line
**Before:**
```ts
    api.on("context.collect", handler);
```
**After:**
```ts
    api.on("context.collect", handler);

    let disposed = false;
    api.on("gateway_stop", async () => {
      if (disposed) return;
      disposed = true;
      decomposer.dispose();
      index.dispose();
      await Promise.resolve(backend.dispose());
    });
```

## Allowed moves

Only modify `extensions/skillweaver/index.ts` (add cleanup handler). Add the lifecycle test file. Do NOT create any new source files.

## STOP triggers

- `gateway_stop` handler throws uncaught error
- `dispose()` called before components are initialized (guard with `disposed` flag for idempotency)
- Backend `dispose()` not awaited (may return `void | Promise<void>`)
- Singleton destroyed on transient `agent_end` event (must use `gateway_stop` for global lifecycle)

## Done when

`WAI_TYPECHECK_CMD="cd extensions/skillweaver && pnpm exec tsc --noEmit" WAI_TEST_CMD="cd extensions/skillweaver && npx vitest run index.test.ts src/lifecycle.test.ts" bash ~/.claude/wai/scripts/task-gate.sh plugin-skillweaver 016` exits 0