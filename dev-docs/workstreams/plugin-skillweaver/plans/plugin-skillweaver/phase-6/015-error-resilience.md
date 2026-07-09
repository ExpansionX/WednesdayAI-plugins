---
id: "015"
phase: 6
title: Add error resilience — embedding timeout guard, decomposer grace period, graceful fallback for all failure modes
status: ready
depends_on: ["013", "014"]
parallel: false
conflicts_with: []
files:
  - extensions/skillweaver/src/handler.ts
  - extensions/skillweaver/src/handler.test.ts
  - extensions/skillweaver/src/decomposer.ts
  - extensions/skillweaver/src/decomposer.timeout.test.ts
irreversible: false
scope_test: "extensions/skillweaver/src/handler.test.ts"
allowed_change: edit
covers_criteria: [SC7]
---
## Failing test (write first)

Add these tests to `extensions/skillweaver/src/handler.test.ts`:

```ts
  // ==== Add to existing describe("createCollectHandler", () => { ... }) block ====

  it("handles decomposer timeout via AbortSignal", async () => {
    mockDecomposer.decompose.mockImplementationOnce(async (_query, _hints, _max, signal) => {
      // Wait for the signal to be aborted
      await new Promise((_, reject) => {
        if (signal?.aborted) reject(new DOMException("Aborted", "AbortError"));
        signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      });
    });

    const handler = createCollectHandler({
      decomposer: mockDecomposer as never,
      retriever: mockRetriever as never,
      sadEnabled: false,
      minQueryLength: 20,
      decomposerModel: "test",
      decomposerTimeoutMs: 50,
    });

    const result = await handler(baseEvent);
    expect(result).toEqual({});
  });

  it("handles retriever search failure gracefully", async () => {
    mockDecomposer.decompose.mockResolvedValueOnce({
      subTasks: ["task1"], hints: [], pass: 1,
    });
    mockRetriever.retrieve.mockRejectedValueOnce(new Error("index corrupt"));
    mockFormatSkillContext.mockReturnValueOnce({});

    const handler = createCollectHandler({
      decomposer: mockDecomposer as never,
      retriever: mockRetriever as never,
      sadEnabled: false,
      minQueryLength: 20,
      decomposerModel: "test",
    });

    const result = await handler(baseEvent);
    expect(result).toEqual({});
  });

  it("handles null/undefined cleanUserMessage", async () => {
    const handler = createCollectHandler({
      decomposer: mockDecomposer as never,
      retriever: mockRetriever as never,
      sadEnabled: true,
      minQueryLength: 20,
      decomposerModel: "test",
    });

    const result = await handler({ ...baseEvent, cleanUserMessage: undefined as never });
    expect(result).toEqual({});
  });

  it("does not crash on malformed envelope", async () => {
    const handler = createCollectHandler({
      decomposer: mockDecomposer as never,
      retriever: mockRetriever as never,
      sadEnabled: true,
      minQueryLength: 20,
      decomposerModel: "test",
    });

    const result = await handler({ ...baseEvent, envelope: null as never });
    expect(result).toEqual({});
  });
```

Also create `extensions/skillweaver/src/decomposer.timeout.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";

const mockFetchRaw = vi.fn();

let Decomposer: { new (...args: unknown[]): { decompose: Function; dispose: Function } };

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
```

## Change

**File:** `extensions/skillweaver/src/handler.ts`
**Anchor:** `createCollectHandler` — improve error guards around `cleanUserMessage` and `envelope`
**Before:** (in the handler body, lines 2-4 after opening the async function)
```ts
    const text = event.cleanUserMessage?.text ?? "";
    if (text.length < opts.minQueryLength) return {};

    if (event.envelope?.["isSubAgent"]) return {};
```
**After:**
```ts
    const text = event.cleanUserMessage?.text ?? "";
    if (!text || text.length < opts.minQueryLength) return {};

    if (event.envelope && typeof event.envelope === "object" && (event.envelope as Record<string, unknown>)["isSubAgent"]) return {};

    const abortController = new AbortController();
    const timeoutMs = opts.decomposerTimeoutMs ?? 30000;
    const timer = setTimeout(() => abortController.abort(), timeoutMs);
    try {
      const result = await opts.decomposer.decompose(text, undefined, undefined, abortController.signal);
      clearTimeout(timer);
      // ... rest of handler
    } catch {
      clearTimeout(timer);
      return {};
    }
```

The handler receives a new `decomposerTimeoutMs` opt (default 30000). It creates an `AbortController`, starts a timeout, passes the signal to `decomposer.decompose()`, and cleans up the timer on both success and error paths.

**File:** `extensions/skillweaver/src/decomposer.ts`
**Anchor:** `decompose()` method — add AbortSignal-based timeout support as an optional parameter. No Before/After change needed if the existing `try/catch` already handles fetch errors — verify it catches all HTTP error statuses and network failures.

Add optional `signal` parameter to `decompose()`:

**Before:**
```ts
  async decompose(query: string, hints?: HintEntry[], maxSubTasks = 10): Promise<DecompositionResult> {
```
**After:**
```ts
  async decompose(query: string, hints?: HintEntry[], maxSubTasks = 10, signal?: AbortSignal): Promise<DecompositionResult> {
```
And wrap the fetch call in the try block:
```ts
      const response = await this.config.fetchRaw(endpoint, { method: "POST", headers, body, ...(signal ? { signal } : {}) });
```

## Allowed moves

Only modify the two files listed in `files:`. Add the new timeout test file. Do NOT change any other file.

## STOP triggers

- Error handler logs API keys
- `cleanUserMessage` guard unintentionally blocks valid messages with `text: ""` that have other content
- AbortSignal not passed through to fetch in decomposer

## Done when

`WAI_TYPECHECK_CMD="cd extensions/skillweaver && pnpm exec tsc --noEmit" WAI_TEST_CMD="cd extensions/skillweaver && npx vitest run src/handler.test.ts src/decomposer.timeout.test.ts" bash ~/.claude/wai/scripts/task-gate.sh plugin-skillweaver 015` exits 0