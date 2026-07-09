# Code Review — Round 2 (Kimi)

**Target:** `extensions/skillweaver/`  
**Branch:** `main` worktree revision used for Round 2  
**Effort:** high / exhaustive

## Findings

| # | File(s) | Severity | Category | Finding | Confidence | Actionable? |
|---|---------|----------|----------|---------|-----------|-------------|
| 1 | `src/embedding/cloud.ts:5`, `index.ts:21-25`, `src/config.ts`, `openclaw.plugin.json` | High | correctness | `CloudEmbedding` hardcodes 1536 dimensions, so using `text-embedding-3-large` (3072d) or any non-1536 OpenAI-compatible embedding model throws a runtime dimension-mismatch error. | High | yes |
| 2 | `src/retriever.ts:25-38`, `index.ts:127-130` | High | correctness / performance | `retrieve()` returns the union of every per-sub-task result with no global cap. A 10-task query with `topK=10` can inject 100 skills into the context window. | High | yes |
| 3 | `src/handler.ts:51-75`, `src/config.ts`, `openclaw.plugin.json` | High | correctness / reliability | Retrieval (`buildHintSet` + `retrieve`) is unbounded by time. A slow local embedding model or a wedged `hnswlib-node` search can hang the `context.collect` handler. | High | yes |
| 4 | `package.json`, `tsconfig.json`, `tsconfig.build.json` | High | packaging / quality | Package shipped TypeScript sources as `main: "./index.ts"` with no build step, no `files` whitelist, and no compiled `dist/` output. WednesdayAI's plugin loader expects compiled JS. | High | yes |
| 5 | `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `package-lock.json` | High | tooling | Two lockfiles (`package-lock.json` and `pnpm-lock.yaml`) existed and `pnpm install` failed because protobufjs/sharp build scripts were neither allowed nor denied. `pnpm test` was broken for contributors using the repo-preferred package manager. | High | yes |
| 6 | `src/embedding/local.ts:21-22` | Medium | quality / build | `// @ts-expect-error` on the dynamic `@xenova/transformers` import was no longer suppressing an error, so `tsc --noEmit` failed with `Unused '@ts-expect-error' directive`. | High | yes |
| 7 | `src/retriever.ts:40-56` | Medium | quality | `buildHintSet()` accumulates hints in sub-task order and then slices. A high-score hint from a later sub-task can be dropped in favor of a low-score hint from an earlier one. | Medium | yes |
| 8 | `openclaw.plugin.json` | Medium | correctness | String schema fields that `resolveConfig()` accepts as `null` (`apiKey`, `baseUrl`, `endpoint`, `customDimensions`) declared `"type": "string"` only. A config file that explicitly sets them to `null` would be rejected by schema validation even though the code handles it. | Medium | yes |
| 9 | `src/config.ts`, `openclaw.plugin.json` | Low | quality | `retrievalTimeoutMs` existed nowhere in the config surface / schema, preventing users from tuning the retrieval timeout. | Medium | yes |
| 10 | `src/decomposer.ts:109`, `src/context-injector.ts:24` | Low | quality | Oxlint flagged unnecessary escapes inside regex character classes (`\[` inside `[...]`). | High | yes |
| 11 | `src/retriever.test.ts:3`, `src/embedding/types.test.ts:7`, `src/skill-index.test.ts:1,235`, `src/embedding/local.test.ts:1` | Low | quality | Unused imports/variables surfaced by Oxlint; harmless but noisy. | High | yes |
| 12 | `src/embedding/index.ts` | Low | quality | Listed in Round 2 scope but file does not exist. No runtime code imports it, so it is a bookkeeping/docs gap rather than a bug. | High | no (non-actionable) |

## Non-actionable

| # | File:line | Severity | Category | Finding | Confidence | Why non-actionable |
|---|-----------|----------|----------|---------|-----------|---------------------|
| 1 | `src/embedding/index.ts` (missing) | Low | bookkeeping | File was requested in the review checklist but is not present in the repo. No source imports it. | High | Out of scope for a code fix; addressed in the report. |

## Verdict: With fixes (all remediated)

Actionable: []

---

## Remediation Summary

All actionable findings were fixed in-place. Verification results:

- `pnpm test` — 225/225 passing (was 206 before this round; count grew from new tests added for the fixes).
- `npx tsc --noEmit` — clean.
- `npx oxlint .` — clean.
- `pnpm run build` — produces `dist/` successfully.
- `pnpm install` — succeeds after workspace build-policy fix.

### Specific changes

1. **CloudEmbedding dimensions are configurable**  
   - Added `dimensions` option to `CloudEmbeddingOptions` with default 1536.  
   - Added `embedding.cloudDimensions` to config schema, defaults, and validation.  
   - `index.ts` passes the configured value through.  
   - New tests cover configurable dimensions.  
   - Files: `src/embedding/cloud.ts`, `src/config.ts`, `index.ts`, `openclaw.plugin.json`, `src/embedding/cloud.test.ts`

2. **Retriever caps total results and sorts hints globally**  
   - Added `maxResults` option (defaults to `hintSize`).  
   - `retrieve()` now slices to `max(topK, maxResults)` after global score sort.  
   - `buildHintSet()` collects scores, sorts descending, then slices — later sub-tasks can win.  
   - Files: `src/retriever.ts`

3. **Handler retrieval timeout**  
   - Added `withTimeout()` helper and `retrievalTimeoutMs` option (default 30s).  
   - `buildHintSet` and `retrieve` are raced against the timeout; handler catches and returns `{}` on timeout.  
   - Added `retrieval.retrievalTimeoutMs` to schema, defaults, and validation.  
   - Files: `src/handler.ts`, `src/config.ts`, `openclaw.plugin.json`

4. **Build / packaging**  
   - Changed `main` to `./dist/index.js`, added `types`, `files`, and `engines.node`.  
   - Added `build` and `typecheck` scripts.  
   - Added `tsconfig.build.json` excluding tests so `dist/` is clean.  
   - Files: `package.json`, `tsconfig.build.json`

5. **Package manager lockfile hygiene**  
   - Removed duplicate `extensions/skillweaver/package-lock.json`.  
   - Set `protobufjs: false` and `sharp: false` in `pnpm-workspace.yaml` so `pnpm install` completes without waiting for interactive build approval.  
   - Files: `pnpm-workspace.yaml`, `package-lock.json` (deleted)

6. **TypeScript cleanup**  
   - Replaced dead `@ts-expect-error` in `src/embedding/local.ts` with an `as any` dynamic import.  
   - Files: `src/embedding/local.ts`

7. **Schema nullable fields**  
   - Changed `decomposer.apiKey`, `decomposer.baseUrl`, `embedding.apiKey`, `embedding.endpoint`, `embedding.customDimensions`, and the new `embedding.cloudDimensions` to accept `"type": ["string"/"integer", "null"]`.  
   - Files: `openclaw.plugin.json`

8. **Lint cleanup**  
   - Removed unnecessary escapes in `src/decomposer.ts:109` and `src/context-injector.ts:24`.  
   - Removed unused imports/variables across test files.  
   - Files: `src/decomposer.ts`, `src/context-injector.ts`, `src/retriever.test.ts`, `src/embedding/types.test.ts`, `src/skill-index.test.ts`, `src/embedding/local.test.ts`

9. **Test coverage for new config knobs**  
   - Added validation tests for `cloudDimensions` and `retrievalTimeoutMs`.  
   - Updated the `defaults` fixture in `src/config.test.ts` to include the new fields.  
   - Files: `src/config.test.ts`

## Estimated effort for each issue

| Issue | Effort | Actual |
|-------|--------|--------|
| Cloud dimensions config | Small (~15 min) | ✅ Done |
| Retriever global cap + hint sorting | Small (~15 min) | ✅ Done |
| Retrieval timeout | Small (~15 min) | ✅ Done |
| Build / packaging infra | Medium (~30 min) | ✅ Done |
| Lockfile / pnpm workspace | Small (~10 min) | ✅ Done |
| TS / lint cleanups | Small (~15 min) | ✅ Done |
| Schema nullable fields | Small (~10 min) | ✅ Done |

---

*Report written by Kimi (Round 2 reviewer) on 2026-07-09.*
