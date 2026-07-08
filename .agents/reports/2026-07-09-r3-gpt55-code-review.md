# Round 3 Code Review: SkillWeaver

Date: 2026-07-09
Reviewer: GPT-5.5
Target: `extensions/skillweaver/`

## Summary

Found and remediated 3 remaining actionable issues. No unresolved actionable findings remain from this pass.

## Findings

### SW-R3-001: Decomposer timeout could still hang when the underlying promise ignored `AbortSignal`

- Severity: High
- Confidence: High
- Files: `extensions/skillweaver/src/handler.ts`, `extensions/skillweaver/src/handler.test.ts`
- Issue: `createCollectHandler()` created an `AbortController` for decomposer calls, but directly awaited `decomposer.decompose()`. If the underlying fetch/custom decomposer ignored the signal or never settled, the handler could hang indefinitely despite `decomposerTimeoutMs`.
- Recommendation: Race decomposer calls against the same timeout budget and abort on timeout.
- Remediation: Wrapped Pass 1 and Pass 2 decomposer calls in `withTimeout()`, sharing the existing decomposer deadline and aborting the controller on timeout.
- Test: Added regression coverage for a decomposer promise that never resolves and ignores `AbortSignal`.
- Effort: Small.

### SW-R3-002: Retrieval result cap could exceed the configured context budget

- Severity: Medium
- Confidence: High
- Files: `extensions/skillweaver/src/retriever.ts`, `extensions/skillweaver/src/retriever.test.ts`
- Issue: `retrieve()` used `Math.max(topK, maxResults)`, so when `topK` was larger than `hintSize` or an explicit `maxResults`, SkillWeaver could inject more skills than the intended context cap.
- Recommendation: Honor `maxResults` as the hard cap after deduplication and sorting.
- Remediation: Changed the cap to `Math.max(0, maxResults)`.
- Test: Added coverage for `topK: 10` with `hintSize: 5`, expecting only 5 retrieved skills.
- Effort: Small.

### SW-R3-003: Non-recursive file watchers missed newly-created skill directories

- Severity: Medium
- Confidence: Medium-High
- Files: `extensions/skillweaver/src/skill-index.ts`, `extensions/skillweaver/src/skill-index.test.ts`
- Issue: On non-recursive watcher platforms, the root watcher ignored events whose filename did not end with `SKILL.md`. Creating a new skill directory emits an event for the directory name, so newly-installed skills could be missed until restart. The async initial child-watch setup also lacked a guard after `unwatch()`/`dispose()`.
- Recommendation: For non-recursive watchers, treat root-level changes as rebuild triggers and refresh child directory watchers, with disposed/unwatched guards before registering child watchers.
- Remediation: Added `watchChildDirs()`, invoked it initially and after non-`SKILL.md` root events, and guarded async watcher registration against disposal/unwatch.
- Test: Added a Linux-platform regression test that emits a new-directory root event and verifies a rebuild is scheduled.
- Effort: Medium.

## Additional Cleanup

- Trimmed non-empty subtasks before retrieval so whitespace from LLM output does not degrade retrieval quality.
- Extended the existing Pass-1 filtering test to assert trimming behavior.

## Static Analysis And Test Results

- `npm run typecheck`: Pass.
- `npm test -- src/handler.test.ts src/retriever.test.ts src/skill-index.test.ts --run`: Pass, 53 tests.
- `npm test -- --run`: Pass, 16 files, 228 tests.
- `npm run lint`: unavailable; package has no `lint` script.

## Residual Notes

- No installed lint tool was present in `extensions/skillweaver/node_modules/.bin`; TypeScript typecheck was the available static gate.
- An untracked `coverage/` directory was present after review and was left untouched.
