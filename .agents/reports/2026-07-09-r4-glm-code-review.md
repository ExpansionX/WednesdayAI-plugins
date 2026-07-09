# Round 4 Code Review: SkillWeaver (GLM)

Date: 2026-07-09
Reviewer: GLM-5.2
Target: `extensions/skillweaver/`
Baseline: 241 tests passing, 84.87% statement coverage (post-Kimi-R4 uncommitted changes)

## Summary

Found and remediated 4 remaining issues. All 244 tests pass (1 skipped). Type-check clean.

## Findings

### SW-R4-GLM-001: Missing `customModel` validation for custom embedding backend

- Severity: Medium
- Confidence: High
- Files: `src/config.ts`, `src/config.test.ts`
- Issue: `validateConfig()` validated `embedding.model` for the local backend and `embedding.cloudModel` for the cloud backend, but did NOT validate `embedding.customModel` for the custom backend. A user setting `customModel: ""` would have an empty string sent in the API request body, producing a confusing endpoint-side error.
- Remediation: Added a non-empty check for `customModel` when `backend === "custom"`, matching the pattern used for `model` and `cloudModel`. Added 2 regression tests (empty string, whitespace-only).
- Effort: Small.

### SW-R4-GLM-002: Stale child watcher entries prevent re-watching recreated directories

- Severity: Medium
- Confidence: High
- Files: `src/skill-index.ts`, `src/skill-index.test.ts`
- Issue: On non-recursive watcher platforms (Linux), `watchChildDirs()` creates child directory watchers and registers a no-op error handler: `subW.on("error", () => { /* ignore */ })`. When a child directory is deleted, the watcher errors but stays in `this.watchers` forever. If a new directory with the same name is later created, `watchChildDirs()` skips it because `this.watchers.has(subDir)` returns true (stale entry). This means skill directories deleted and recreated would silently stop being watched.
- Remediation: Changed the child watcher error handler to `subW.on("error", () => { this.watchers.delete(subDir); })`, removing the stale entry so future re-creation is detected. Added a regression test that simulates `process.platform = "linux"`, creates a child watcher, emits an error, and verifies removal from the map.
- Effort: Small.

### SW-R4-GLM-003: Indentation inconsistency in parent watcher error handler

- Severity: Low
- Confidence: High
- Files: `src/skill-index.ts`
- Issue: The Kimi R4 fix replaced the parent watcher error handler with `this.unwatch()` but introduced an indentation inconsistency: `w.on("error", ...)` was indented at 4 spaces instead of 6 (inside the `try` block), breaking visual alignment with the surrounding `const w = watch(...)` and `this.watchers.set(dir, w)` statements.
- Remediation: Re-indented the error handler to 6 spaces, matching the `try` block scope.
- Effort: Trivial.

### SW-R4-GLM-004: Dead `recursive`/`maxDepth` parameters in `discoverSkills`

- Severity: Low (code smell)
- Confidence: High
- Files: `index.ts`
- Issue: `discoverSkills()` accepted `opts: { recursive?: boolean; maxDepth?: number }` but was always called with default opts (`recursive = false`, `maxDepth = 3`). The `if (depth > maxDepth) return` guard was always `if (0 > 3)` (never true), and the `if (recursive) { await walkDir(...) }` block was dead code. This added unnecessary complexity and suggested a feature (recursive scanning) that was never implemented.
- Remediation: Removed the `opts` parameter, `recursive`/`maxDepth` variables, the `depth` parameter from `walkDir()`, and the dead recursive-walk block. Updated both call sites (which already passed no opts).
- Effort: Small.

## Verification

```
$ npx tsc --noEmit
(no output = success)

$ npx tsc -p tsconfig.build.json --noEmit
(no output = success)

$ npx vitest run
 Test Files  16 passed (16)
      Tests  244 passed | 1 skipped (245)

$ npx vitest run --coverage
Statements   : 88.05% ( 597/678 )
Branches     : 86.51% ( 417/482 )
Functions    : 87.37% ( 90/103 )
Lines        : 90.33% ( 542/600 )
```

Coverage improved from 84.87% to 88.05% statements (skill-index.ts: 79.51% to 90.41%).
