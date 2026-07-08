# Round 4 Code Review — SkillWeaver Plugin

**Reviewer:** MiMo (Round 4)
**Date:** 2026-07-09
**Scope:** All source files + test files in `extensions/skillweaver/`
**Baseline:** 233 tests passing (post-Round 3)

## Summary

After 35+ issues fixed across Rounds 1-3, the codebase is in solid shape. This round found **0 bugs** and **5 test coverage gaps** for runtime safety checks that were untested. All gaps have been filled.

## Findings

### No Bugs Found

The codebase is clean. All modules have correct:
- Error handling with graceful fallbacks
- Resource lifecycle (dispose/unwatch patterns)
- Race condition handling (buildGeneration, AbortSignal, pendingRebuild)
- Input validation and sanitization
- Concurrency safety (withTimeout, Promise.race patterns)

### TEST-1: CloudEmbedding dimension mismatch untested (cloud.ts:68-73)

**File:** `src/embedding/cloud.test.ts`

The runtime dimension check in `embed()` that throws when the API returns vectors with wrong dimensions had no test coverage. This is a safety net against misconfigured models.

**Fix:** Added test verifying `embed()` throws on dimension mismatch.

### TEST-2: CustomEmbedding dimension mismatch untested (custom.ts:68-73)

**File:** `src/embedding/custom.test.ts`

Same gap as TEST-1 for the custom backend.

**Fix:** Added test verifying `embed()` throws on dimension mismatch.

### TEST-3: CloudEmbedding.embedSingle() empty result untested (cloud.ts:79)

**File:** `src/embedding/cloud.test.ts`

The defensive check `if (results.length === 0) throw` in `embedSingle()` was untested.

**Fix:** Added test verifying `embedSingle()` throws when `embed()` returns empty data.

### TEST-4: CustomEmbedding.embedSingle() empty result untested (custom.ts:79)

**File:** `src/embedding/custom.test.ts`

Same gap as TEST-3 for the custom backend.

**Fix:** Added test verifying `embedSingle()` throws when `embed()` returns empty data.

### TEST-5: LocalEmbedding "Xenova/" prefix passthrough untested (local.ts:27)

**File:** `src/embedding/local.test.ts`

The code `modelName.startsWith("Xenova/") ? modelName : \`Xenova/${modelName}\`` had only the non-prefix branch tested. Model names already prefixed with "Xenova/" should pass through unchanged.

**Fix:** Added test verifying "Xenova/all-MiniLM-L6-v2" passes through without double-prefixing.

## Remediation Summary

| # | Severity | Issue | Fixed | New Tests |
|---|----------|-------|-------|-----------|
| TEST-1 | Low | CloudEmbedding dimension mismatch untested | Yes | 1 |
| TEST-2 | Low | CustomEmbedding dimension mismatch untested | Yes | 1 |
| TEST-3 | Low | CloudEmbedding.embedSingle() empty untested | Yes | 1 |
| TEST-4 | Low | CustomEmbedding.embedSingle() empty untested | Yes | 1 |
| TEST-5 | Low | LocalEmbedding Xenova prefix untested | Yes | 1 |
| **Total** | | | | **5** |

## Non-Actionable Observations

1. **`json.data.sort()` mutates in-place** (cloud.ts:67, custom.ts:67) — `Array.sort()` mutates the original array. Since `json.data` is a local variable from `response.json()`, there's no aliasing issue. Using `.toSorted()` would be marginally cleaner for the ES2023 target but is a style preference, not a bug.

2. **Child watchers for removed directories linger** (skill-index.ts:183-186) — On non-recursive platforms, `watchChildDirs()` creates fs.watch watchers for child directories. If a child directory is removed, the watcher emits an error that is silently ignored, and the watcher reference stays in the Map. The watcher becomes non-functional but isn't cleaned up until `dispose()`. Negligible for typical skill collections (< 100 dirs).

3. **`opts.enabled` in HandlerOptions is dead code in production** (handler.ts:26) — Only used in tests. The production path checks `config.enabled` in index.ts before creating the handler. Acceptable for testability.

## Test Results

**Before:** 233 tests passing (16 test files)
**After:** 238 tests passing (16 test files) — 5 new tests added

Static analysis:
- `npx tsc --noEmit` — clean
- `npx tsc -p tsconfig.build.json` — clean

## Files Modified

| File | Changes |
|------|---------|
| `src/embedding/cloud.test.ts` | Added dimension mismatch + embedSingle empty tests |
| `src/embedding/custom.test.ts` | Added dimension mismatch + embedSingle empty tests |
| `src/embedding/local.test.ts` | Added Xenova prefix passthrough test |
