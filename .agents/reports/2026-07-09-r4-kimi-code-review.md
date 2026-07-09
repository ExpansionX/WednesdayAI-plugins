# Round 4 Code Review — SkillWeaver

**Date:** 2026-07-09  
**Reviewer:** kimi-k2.7-code  
**Scope:** `extensions/skillweaver/` source + tests  
**Result:** 5 actionable issues found and remediated. Type-check and test suite green.

---

## Executive Summary

| Metric | Value |
|--------|-------|
| Source files reviewed | 16 `.ts` files + manifest/config |
| Test files reviewed | 13 `.test.ts` files |
| Issues found | 5 |
| Issues remediated | 5 |
| `npm run typecheck` | ✅ passes |
| `npm test` | ✅ 241 passed, 1 skipped (was 233/1 skipped before fixes) |
| Coverage impact | increased by 8 tests; no regressions |

---

## Findings & Remediation

### 1. Production plugin entry point points to source TypeScript instead of compiled JS
- **Severity:** High
- **Location:** `extensions/skillweaver/package.json:33-35`
- **Issue:** `openclaw.extensions` referenced `"./index.ts"`, but `main` is `"./dist/index.js"` and `files` does not include root `index.ts`. A packed/published plugin would ship without the entry point declared here.
- **Fix:** Changed `openclaw.extensions` to `["./dist/index.js"]` and updated `package.test.ts` to match.

### 2. `SkillIndex.build()` leaves stale index when backend returns mismatched vector count
- **Severity:** Medium
- **Location:** `extensions/skillweaver/src/skill-index.ts:61-68`
- **Issue:** If `backend.embed()` returns a different number of vectors than skills, the function logged and returned without updating state. On a rebuild this kept the previous (now stale) skills and HNSW index in place.
- **Fix:** On mismatch, clear `this.skills` and `this.index` (guard-checked against the current build generation). Added a regression test that rebuilds an existing index with a bad backend and asserts it is cleared.

### 3. `SkillIndex.watch()` error handler leaks rebuild timer/state
- **Severity:** Medium
- **Location:** `extensions/skillweaver/src/skill-index.ts:208-217`
- **Issue:** When an `fs.watch` error fired, the handler closed watchers but did not clear a pending `rebuildTimer` or reset `rebuilding`/`pendingRebuild` flags. A subsequent rebuild could then be blocked or a scheduled timer could still fire on a removed/errored directory.
- **Fix:** Replaced the manual cleanup with `this.unwatch()`, which clears the timer and resets state. Updated `skill-index.test.ts` to assert the parent watcher is also removed from `this.watchers` after an error.

### 4. Cloud and custom embedding backends throw opaque error when `embedding` array is missing
- **Severity:** Medium
- **Location:** `extensions/skillweaver/src/embedding/cloud.ts:67-78`, `custom.ts:67-78`
- **Issue:** `new Float32Array(item.embedding)` was called before validating the field, producing a generic `Cannot read properties of undefined (reading 'length')` rather than a actionable backend-specific message.
- **Fix:** Validate `Array.isArray(sorted[0].embedding)` before the dimension check, and validate every item before constructing `Float32Array`. Added regression tests for missing `embedding`, dimension mismatch, and `embedSingle` on empty data for both backends.

### 5. `benchmarkMain()` has unhandled-rejection hazard
- **Severity:** Low
- **Location:** `extensions/skillweaver/src/__tests__/benchmark.ts:115-118`
- **Issue:** `runBenchmark()` promise chain had no `.catch()`; an async failure would yield an unhandled rejection instead of a clean non-zero exit.
- **Fix:** Added `.catch()` that logs the error and calls `process.exit(1)`.

---

## Verification

```text
$ npm run typecheck
> @wednesdayai/skillweaver@0.1.0 typecheck
> tsc --noEmit

(no output = success)

$ npm test
> @wednesdayai/skillweaver@0.1.0 test
> vitest run

 RUN  v4.1.10 /Users/david/Code/WednesdayAI-plugins-skillweaver/extensions/skillweaver

 Test Files  16 passed (16)
      Tests  241 passed | 1 skipped (242)
   Start at  09:44:54
   Duration  588ms
```

---

## Remaining Debt

No remaining action items. The codebase is clean.
