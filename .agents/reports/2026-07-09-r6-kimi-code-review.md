# SkillWeaver Final Code Review — Round 6

**Reviewer:** Kimi (moonshotai/kimi-k2.7-code)  
**Target:** `extensions/skillweaver/` at `/Users/david/Code/WednesdayAI-plugins-skillweaver`  
**Scope:** All 31 `.ts` source and test files  
**Verification:** `pnpm typecheck` ✅ | `pnpm test` ✅ (254 passed, 1 skipped)

---

## Findings

| # | File:line | Severity | Category | Finding | Confidence | Actionable? |
|---|-----------|----------|----------|---------|-----------|-------------|
| 1 | `extensions/skillweaver/src/skill-index.ts:179-198` | medium | correctness / resource-leak | `watchChildDirs()` is invoked with `void watchChildDirs()` on every non-`SKILL.md` parent event on Linux, and its check-`has`-then-`set` sequence is not atomic. Two rapid parent events can race: both see the same subdirectory not yet in `watchers`, both create an `fs.watch`, and the second `set` overwrites the first in the map. The leaked watcher is invisible to `unwatch()` and parent-error cleanup, so it stays alive and can fire duplicate rebuilds. | high | yes |
| 2 | `extensions/skillweaver/src/skill-index.ts:212-219` | low | quality | The parent-watcher `error` handler closes all watchers under `dir`, but it never clears `rebuildTimer`. A debounced rebuild scheduled just before the error will still fire and call `skillProvider()` / `build()` even though the watchers have been torn down. | high | yes |
| 3 | `extensions/skillweaver/index.ts:167-180` | low | quality | The `gateway_stop` handler only wraps `backend.dispose()` in `try/catch`. If `index.dispose()` (which calls `watcher.close()`) ever throws, `initPromise` is never awaited and `backend.dispose()` never runs, leaving backend resources uncleaned during shutdown. | medium | yes |
| 4 | `extensions/skillweaver/package.json:29-31` | low | quality | `engines.node` is `>=20.0.0`, but WednesdayAI-core requires Node.js `>=24.0.0` (`AGENTS.md` §2). The mismatch is harmless today (AbortSignal.any works on 20+) but is a divergence from the host project’s runtime contract. | high | yes |

---

## Non-actionable

| # | File:line | Severity | Category | Finding | Confidence | Why non-actionable |
|---|-----------|----------|----------|---------|-----------|---------------------|
| 5 | `extensions/skillweaver/index.ts:109-200` | low | test-coverage | `discoverSkills` and the plugin initialization/retry paths are only covered by mocked integration tests; there is no direct file-system unit test for skill discovery. | high | Pre-existing coverage gap; function is private and already listed in the V2 backlog. |
| 6 | `extensions/skillweaver/src/embedding/local.ts:46-51` | low | performance | `embed()` processes texts sequentially. Batching could reduce overhead, but this is a known deferred optimization. | high | Pre-existing backlog item; no correctness impact. |
| 7 | Multiple test files | low | cosmetic | Many `// eslint-disable-next-line @typescript-eslint/no-explicit-any` comments remain, but this extension has no ESLint config and is excluded from Oxlint. | high | Inert / style-only; no runtime effect. |

---

## Verdict: With fixes

The codebase is in very good shape: typecheck is clean, all 254 tests pass, and the architecture is sound. The remaining issues are small, shutdown/file-watching edge cases rather than feature-breaking bugs. The one concrete race condition (#1) should be fixed before declaring the tree fully clean.

**Actionable: [1, 2, 3, 4]**

---

## Notes on convergence

- Claude Opus’s Round 5 "clean" verdict did not surface the Linux child-watcher race, the stale rebuild timer, or the incomplete shutdown cleanup chain.
- These findings do not indicate a regression from prior rounds; they are latent edge cases in code that currently passes all tests.
