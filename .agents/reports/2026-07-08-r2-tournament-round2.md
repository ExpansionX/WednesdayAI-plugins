# Tournament Round 2 — Adversarial Review

**Date:** 2026-07-08
**Challengers:** deepseek/deepseek-v4-pro (C1), minimax/minimax-m3 (C2), z-ai/glm-5.2 (C3)

## Scoring Summary

| Challenger | Issues Found | Valid | Remediations Accepted | Score |
|------------|-------------|-------|----------------------|-------|
| C1 (DeepSeek) | 16 | 10 | 7 | 17 |
| C2 (Minimax) | 20 | 12 | 8 | 20 |
| C3 (GLM) | 17 | 11 | 7 | 18 |

**Winner: C2 (Minimax)** — 20 points

## Issues Found (Deduplicated)

### Critical (3 issues)
| ID | Description | Found By | Remediated |
|----|-------------|----------|------------|
| R2-001 | `require()` in ESM module (R1 fix introduced this) | C1, C2, C3 | ✅ |
| R2-002 | Race condition on init (fire-and-forget) | C2, C3 | ⚠️ Partially fixed |
| R2-003 | `hints` field dead code (always `[]`) | C1, C2 | ✅ |

### High (5 issues)
| ID | Description | Found By | Remediated |
|----|-------------|----------|------------|
| R2-004 | Watch only monitors first skill directory | C1 | ✅ |
| R2-005 | `discoverSkills` promise has no `.catch()` | C1 | ✅ |
| R2-006 | Dimension mismatch across backends | C1, C2, C3 | ⚠️ Not fixed (V2) |
| R2-007 | Sensitive path exposure in context injection | C2, C3 | ✅ |
| R2-008 | No retry logic for decomposer LLM calls | C2 | ⚠️ Not fixed (V2) |

### Medium (6 issues)
| ID | Description | Found By | Remediated |
|----|-------------|----------|------------|
| R2-009 | Frontmatter parser fails on Windows line endings | C2 | ✅ |
| R2-010 | Missing temperature/maxTokens validation | C1 | ✅ |
| R2-011 | `skills.dirs` doesn't validate array contents | C1, C3 | ✅ |
| R2-012 | `searchKnn` passes explicit `undefined` filter | C2 | ✅ |
| R2-013 | Concurrent watch rebuilds can corrupt index | C1, C2 | ⚠️ Not fixed (V2) |
| R2-014 | Blocking synchronous I/O in watch callback | C2 | ✅ (async) |

### Low (4 issues)
| ID | Description | Found By | Remediated |
|----|-------------|----------|------------|
| R2-015 | `process.exit()` in benchmark | C2 | ⚠️ Not fixed (low) |
| R2-016 | Redundant `DEFAULTS` spread in resolveConfig | C3 | ⚠️ Not fixed (low) |
| R2-017 | No test for `gateway_stop` lifecycle | C3 | ⚠️ Not fixed (low) |
| R2-018 | No test for Anthropic API path | C1, C2 | ⚠️ Not fixed (low) |

## Remediations Applied

1. **index.ts**: Replace `require()` with async `discoverSkills()`, watch all dirs, add `.catch()` to promise chain
2. **types.ts**: Remove dead `hints` field from `DecompositionResult`
3. **decomposer.ts**: Remove `hints: []` from return values
4. **context-injector.ts**: Remove full file paths from context injection
5. **config.ts**: Add temperature/maxTokens validation, validate skills.dirs array contents
6. **skill-index.ts**: Accept async callbacks in `watch()`, drop explicit `undefined` arg from `searchKnn`

## Tests

- 116 tests passing
- Typecheck: clean

## Unresolved Items (Accepted as Design Decisions)

1. **R2-002 (race condition)**: Partially fixed — `.catch()` added, but handler can still fire before index is ready. Acceptable for V1 since the first few messages get empty results, then routing kicks in.
2. **R2-006 (dimension mismatch)**: Requires runtime validation of embedding dimensions. Deferred to V2 — needs first-response detection logic.
3. **R2-008 (retry logic)**: Requires exponential backoff implementation. Deferred to V2 — needs retry policy design.
4. **R2-013 (concurrent rebuilds)**: Requires mutex/generation counter. Deferred to V2 — needs concurrency design.
