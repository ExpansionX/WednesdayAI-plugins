# Round 2 Code Review — SkillWeaver Plugin

**Reviewer:** Opus (Round 2)
**Date:** 2026-07-09
**Scope:** All source files + test files in `extensions/skillweaver/`
**Baseline:** 206 tests passing, 86.88% coverage (post Round 1)

## Summary

Round 1 (DeepSeek + GLM) addressed 19 issues including race conditions, prompt injection, timeout guards, and null checks. This Round 2 review found **9 additional issues** across 4 severity tiers, focusing on timeout budget correctness, unhandled promise rejections, resource leaks, and test coverage gaps.

---

## Issues Found

### HIGH-1: SAD 2-pass total timeout unbounded (handler.ts:39-52)

**File:** `src/handler.ts:39-52`

Each SAD pass creates its own `AbortSignal.timeout(timeoutMs)`. Pass 1 can consume up to 30s, then Pass 2 gets a fresh 30s window. Total worst case: **60s** instead of the intended 30s.

**Impact:** Under load or with a slow decomposer model, the handler can block the context.collect pipeline for up to 2x the configured timeout.

**Fix:** Create a single `AbortController` with one timeout shared across both passes. Pass the same signal to both decompose calls.

**Effort:** Small (~10 LOC)

---

### HIGH-2: `LocalEmbedding.loadPipeline()` — unhandled promise rejection (local.ts:15-16)

**File:** `src/embedding/local.ts:15-16`

The constructor stores a `Promise` from `loadPipeline()` in `this.pipeline` but never attaches a `.catch()`. If the dynamic import of `@xenova/transformers` fails (missing dependency, corrupt model), the rejection is unhandled until `embed()` is called. Node.js will emit an `unhandledRejection` warning/crash in the interim.

**Impact:** Unhandled promise rejection at startup; potential process crash in strict Node.js configurations.

**Fix:** Attach `.catch()` to the pipeline promise to store the error and re-throw on `embed()`.

**Effort:** Small (~8 LOC)

---

### HIGH-3: Orphaned child watchers on Linux (skill-index.ts:168-181)

**File:** `src/skill-index.ts:168-181`

When `useRecursive` is false (Linux), child watchers for subdirectories are created asynchronously via `readdir().then(...)`. If the parent watcher errors and its error handler fires before all children are created, the children that were already added to `this.watchers` remain active. The parent's error handler only closes the parent watcher — it doesn't cascade to children.

**Impact:** File descriptor leak on Linux. Child watchers persist until `unwatch()` or `dispose()` is explicitly called.

**Fix:** In the parent's error handler, close all child watchers whose keys start with the parent dir prefix.

**Effort:** Small (~8 LOC)

---

### MEDIUM-1: Fire-and-forget initialization races with gateway_stop (index.ts:155-168)

**File:** `index.ts:155-168`

The `discoverSkills(config).then(...)` chain is untracked. If `gateway_stop` fires before it completes, `backend.dispose()` runs while the in-flight `index.build()` is about to call `backend.embed()`. The backend's `disposed` flag causes `embed()` to throw, which is caught — but the entire initialization work is wasted and a spurious warning is logged.

**Impact:** Wasted work during shutdown; noisy but harmless warning in logs.

**Fix:** Store the discovery promise and either cancel or suppress errors during shutdown.

**Effort:** Small (~12 LOC)

---

### MEDIUM-2: `formatHints` doesn't strip backslashes (decomposer.ts:71)

**File:** `src/decomposer.ts:71`

The sanitization regex `[#*_[\]`<>]` strips markdown-sensitive characters, but backslashes are not in the character class. If a skill description contains literal `\n` (e.g., from a YAML dump), it passes through into the prompt as a literal backslash + `n`, which could confuse the LLM.

**Impact:** Minor prompt quality degradation with malformed skill descriptions.

**Fix:** Add `\\` to the strip character class, or handle `\n`/`\t` explicitly.

**Effort:** Trivial (1 LOC)

---

### MEDIUM-3: `extractJsonArray` bracket regex matches innermost, not outermost (decomposer.ts:106)

**File:** `src/decomposer.ts:106`

The non-greedy `\[([\s\S]*?)\]` regex matches innermost bracket pairs. For nested arrays like `[["task1"]]`, it captures `["task1"]` rather than the outer array. This works for typical flat LLM output but is fragile.

**Impact:** Low — LLM decomposition output is always flat string arrays. Noted for awareness.

**Fix:** Could use a bracket-depth parser, but the current behavior is acceptable for the use case.

**Effort:** Medium if changed; currently acceptable.

---

### MEDIUM-4: `CloudEmbedding` / `CustomEmbedding` don't validate API key presence (cloud.ts:26, custom.ts:28)

**Files:** `src/embedding/cloud.ts:26`, `src/embedding/custom.ts:28`

When the cloud backend is configured without an API key (neither in config nor env), the request proceeds without an `Authorization` header. The OpenAI API returns 401, but the error message doesn't indicate the missing key — just "request failed 401".

**Impact:** Confusing error for operators who forget to configure the API key.

**Fix:** Log a warning at construction time when no API key is available.

**Effort:** Trivial (~3 LOC per backend)

---

### TEST-1: No test for SAD 2-pass total timeout budget

**File:** `src/handler.test.ts`

The timeout test files only cover single-pass scenarios. There is no test verifying that the total timeout across both SAD passes is bounded.

**Fix:** Add a test where Pass 1 takes 25s and verify Pass 2 times out within the remaining budget.

**Effort:** Small (~15 LOC)

---

### TEST-2: No test for child watcher cleanup after parent error

**File:** `src/skill-index.test.ts`

There is no test verifying that child watchers created on Linux are cleaned up when the parent watcher errors.

**Fix:** Add a test that creates a parent watcher, triggers a parent error, and verifies child watchers are closed.

**Effort:** Small (~15 LOC)

---

## Remediation Summary

| # | Severity | Issue | Fixed | LOC Changed |
|---|----------|-------|-------|-------------|
| HIGH-1 | High | SAD 2-pass timeout unbounded | Yes | ~15 |
| HIGH-2 | High | Unhandled pipeline rejection | Yes | ~12 |
| HIGH-3 | High | Orphaned child watchers | Yes | ~10 |
| MEDIUM-1 | Medium | Fire-and-forget init race | Yes | ~15 |
| MEDIUM-2 | Medium | formatHints backslash leak | Yes | ~2 |
| MEDIUM-4 | Medium | Missing API key warning | Yes | ~6 |
| TEST-1 | Test | SAD timeout budget test | Yes | ~30 |
| TEST-2 | Test | Child watcher cleanup test | Yes | ~25 |
| FIX | Test | Config test stale from Round 1 | Yes | ~2 |

Issues MEDIUM-3 (bracket regex) was noted but not changed — the current behavior is acceptable for the use case (LLM output is always flat string arrays).

## Test Results

**Before:** 206 tests passing (16 test files)
**After:** 219 tests passing (16 test files) — 13 new tests added

All existing tests continue to pass. New tests cover:
- SAD 2-pass shared timeout budget (same AbortSignal for both passes)
- Timeout cleanup on early return
- Child watcher cascade cleanup on parent error
- LocalEmbedding pipeline error storage (no unhandled rejection)
- LocalEmbedding embedSingle pipeline error propagation
- Config defaults for `cloudDimensions` and `retrievalTimeoutMs` (fixed stale Round 1 tests)
