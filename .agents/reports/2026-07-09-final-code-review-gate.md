# Final Code Review Gate — SkillWeaver Plugin

**Reviewer:** MiMo (openrouter/xiaomi/mimo-v2.5-pro)
**Date:** 2026-07-09
**Scope:** All 12 production source files (~1,100 LOC), 16 test files (~2,600 LOC), manifest, configs
**Baseline:** 254 tests passing, 1 skipped (platform-specific)

## Review Methodology

Read every production and test file end-to-end. Checked for:
- Logic errors, race conditions, null/undefined
- Error handling gaps
- Resource leaks
- Security issues
- Type safety problems

Cross-referenced against 6 prior rounds of adversarial review (7 AI models, 75+ issues fixed).

## Findings

### #1 [SHOULD-FIX] `engines.node` should be `>=24.0.0`

**File:** `package.json:29-31`

```json
"engines": {
  "node": ">=20.0.0"
}
```

WednesdayAI-core requires Node.js `>=24.0.0` (AGENTS.md §2). The plugin's `engines` field declares `>=20.0.0`, creating a contract divergence. While `AbortSignal.any()` and other APIs used work on Node 20+, the host project's runtime floor should be reflected.

**Fix:** Change to `"node": ">=24.0.0"`.

Already identified in Kimi Round 6 #4.

---

### #2 [INFO] Potential watcher leak from `watchChildDirs` race (Linux only)

**File:** `src/skill-index.ts:179-198`

Two rapid parent `fs.watch` events can race: both `readdir` concurrently, both see `subDir` not in `this.watchers`, both create watchers, second `set` overwrites the first. The overwritten watcher leaks (not in the map, not closed by `unwatch()`).

**Impact:** Benign. The leaked watcher has `{ persistent: false }` (won't prevent process exit), and `scheduleRebuild()` is debounced so duplicate calls are coalesced. The child error handler cascading cleanup is slightly off (deletes the replacement entry), but this only matters if the directory is deleted, at which point cleanup happens anyway.

Already identified in Kimi Round 6 #1. Not a blocker.

---

### Correctness — no issues found

- **Race conditions:** `buildGeneration` counter in `SkillIndex.build()` correctly discards stale async embed results. `search()` captures `this.index`/`this.skills` in locals before `embedSingle` await — even if `dispose()` clears the Map in-place, the captured reference handles it gracefully (empty iteration, `get()` returns undefined → `continue`). `pendingRebuild` flag correctly coalesces changes during in-flight rebuilds.
- **Resource leaks:** `gateway_stop` disposes decomposer → index → backend in correct order with SEPARATE try/catch blocks (each disposal is independently error-isolated, contrary to Kimi R6 #3 which incorrectly claimed a cascade failure). `withTimeout` clears timer in `finally`. `SkillIndex.unwatch()` clears `rebuildTimer`, resets `rebuilding`/`pendingRebuild`, closes all watchers. Handler's `AbortController` + `setTimeout` both cleaned in `finally`.
- **Abort signal propagation:** All async paths (`decompose`, `buildHintSet`, `retrieve`, `search`, `embed`, `embedSingle`) accept and check `AbortSignal` before and after awaits. Shared timeout budget across SAD passes via single `ac.signal`. Separate `retrievalAc` for retrieval steps.
- **Input sanitization:** `sanitizeQueryForPrompt` strips `<user_query>` and `</user_query>` tags (prevents prompt injection). `formatHints` strips markdown special chars + backslashes. `sanitizeMarkdown` escapes `#*_[\]`<>` and newlines with 200-char truncation.
- **Error handling:** `Decomposer.decompose()` catches all error types (network, auth, rate_limit, parse, timeout, unknown) with structured `DecompositionError[]`. `createCollectHandler` wraps everything in try/catch returning `{}`. `discoverSkills` uses `Promise.allSettled`.
- **Config validation:** All numeric ranges enforced (topK 1-10, hintSize 5-50, minQueryLength 5-500, temperature 0-2, maxTokens 50-1024, retrievalTimeoutMs 1000-300000). Conditional requirements (custom→endpoint, openai-compatible→baseUrl, cloud→cloudDimensions integer 1-4096, custom→customDimensions integer 1-4096). Empty/whitespace model names rejected. `rawObj` helper correctly rejects arrays, null, and primitives.
- **Config schema ↔ interface parity:** All 22 configSchema properties match the TypeScript `SkillWeaverConfig` interface. All defaults match between `openclaw.plugin.json` and `DEFAULTS` in config.ts.

### Security — no issues found

- Prompt injection prevented by stripping `<user_query>`/`</user_query>` tags from user input
- API keys passed in headers, never in URLs or error messages
- Error messages truncate body at 500 chars, don't leak sensitive information
- No path traversal risk — `fs.readdir` returns directory entries, not user-controlled input
- `configSchema` has `additionalProperties: false` on all objects, preventing unknown config keys

### Type Safety — no issues found

- `strict: true` in tsconfig
- No `@ts-nocheck` in production code
- Embedding backends implement `EmbeddingBackend` interface structurally
- `rawObj` helper in `resolveConfig` safely narrows `unknown` to `Record<string, unknown>`
- `toBool` helper handles all edge cases (boolean, string variants, null, undefined, numbers)

### Testing — no gaps found

- 254 tests across 16 test files cover all code paths including error branches, edge cases, race conditions, dispose idempotency, platform-specific behavior, and integration wiring
- 1 skipped test is platform-specific (`skipIf(process.platform === "darwin")`)
- Tests cover: prompt injection sanitization, Anthropic response parsing, abort signal propagation, timeout behavior, watcher lifecycle, rebuild coalescing, child watcher cleanup on error, dimension mismatch detection, pipeline load failure storage

### Non-Observations (pre-existing, non-actionable)

1. **`json.data.sort()` mutates in-place** (`cloud.ts:72`, `custom.ts:72`) — local variable, no aliasing. Style preference only.
2. **`opts.enabled` in HandlerOptions unused in production** — production checks `config.enabled` in index.ts before handler creation. Exists for testability.
3. **Sequential embedding in `local.ts`** — known deferred optimization, no correctness impact.
4. **DRY violation between `cloud.ts` and `custom.ts`** — code quality, acceptable for v0.1.0.
5. **`console.*` in logger.ts** — acceptable for standalone extension (host's tslog not available).

## Verdict

**One actionable item:** `engines.node` version mismatch (#1). Everything else is clean.

## Test Results

```
Test Files  16 passed (16)
      Tests  254 passed | 1 skipped (255)
   Duration  2.74s
```

## Decision

**Actionable: [1]**

Only the `engines.node` fix is required. The codebase is clean for graduation after that single change.
