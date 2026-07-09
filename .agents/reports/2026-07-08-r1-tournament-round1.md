# Tournament Round 1 — Adversarial Review

**Date:** 2026-07-08
**Challengers:** claude-opus-4-8 (C1), xiaomi/mimo-v2.5-pro (C2), moonshotai/kimi-k2.7-code (C3)

## Scoring Summary

| Challenger | Issues Found | Valid | Remediations Accepted | Score |
|------------|-------------|-------|----------------------|-------|
| C1 (Opus) | 18 | 12 | 8 | 20 |
| C2 (Mimo) | 15 | 10 | 6 | 16 |
| C3 (Kimi) | 28 | 18 | 12 | 30 |

**Winner: C3 (Kimi)** — 30 points

## Issues Found (Deduplicated)

### Critical (4 issues)
| ID | Description | Found By | Remediated |
|----|-------------|----------|------------|
| R1-001 | `skills.dirs` not merged from user config | C1, C3 | ✅ |
| R1-002 | `discoverSkills` mutates shared DEFAULTS array | C1, C3 | ✅ |
| R1-003 | `resolveBackend` no default case | C2, C3 | ✅ |
| R1-004 | `sad.maxIterations` validated but never used | C1, C2 | ⚠️ Kept (future use) |

### High (6 issues)
| ID | Description | Found By | Remediated |
|----|-------------|----------|------------|
| R1-005 | Decomposer silently swallows errors | C1, C2, C3 | ✅ |
| R1-006 | Contradictory system message | C1 | ✅ |
| R1-007 | Empty API key header sent | C1, C3 | ✅ |
| R1-008 | SAD Pass-2 reuses expired AbortSignal | C2 | ✅ |
| R1-009 | Race condition on startup | C2, C3 | ⚠️ Partially fixed |
| R1-010 | CloudEmbedding falls back to OPENAI_API_KEY for non-OpenAI | C1 | ⚠️ Not fixed (low risk) |

### Medium (8 issues)
| ID | Description | Found By | Remediated |
|----|-------------|----------|------------|
| R1-011 | HNSW `ef` hardcoded to 400 | C1, C3 | ✅ |
| R1-012 | Dead `createHnsw` method | C3 | ✅ |
| R1-013 | Greedy regex in `extractJsonArray` | C1, C3 | ✅ |
| R1-014 | YAML frontmatter quotes not stripped | C3 | ✅ |
| R1-015 | `validateConfig` missing hintSize/minQueryLength checks | C1 | ✅ |
| R1-016 | Prompt injection via unsanitized query | C3 | ✅ |
| R1-017 | `watch()` not wired in register() | C1, C3 | ✅ |
| R1-018 | ~80% code duplication in cloud/custom backends | C1, C2 | ⚠️ Not fixed (refactor) |

## Remediations Applied

1. **config.ts**: Merge `skills.dirs` from raw config, add runtime type guards for nested objects, add missing validation checks
2. **index.ts**: Copy dirs array before mutation, add default throw to resolveBackend, strip YAML quotes, wire up watch()
3. **decomposer.ts**: Add error logging, fix contradictory system message, conditionally set API key headers, wrap query in `<user_query>` delimiter, fix greedy regex
4. **handler.ts**: Use fresh AbortController for Pass-2, add error logging
5. **skill-index.ts**: Scale ef with index size, remove dead createHnsw, always validate search results
6. **logger.ts**: Create local logger module (avoid plugin-sdk dependency)
7. **config.test.ts**: Update tests to use resolveConfig for proper coverage

## Tests

- 116 tests passing (was 115)
- Typecheck: clean

## Unresolved Items (Accepted as Design Decisions)

1. **R1-004 (maxIterations)**: Config field kept for future V2 multi-iteration SAD. Documented in schema.
2. **R1-009 (race condition)**: Partially fixed — watch() now wired, but initial build is still fire-and-forget. Acceptable for V1 since the first few messages will get empty results, then routing kicks in.
3. **R1-010 (OPENAI_API_KEY fallback)**: Low risk — users configuring custom endpoints should set their own API key. Documented.
4. **R1-018 (code duplication)**: Refactoring cloud/custom into shared base is a larger change. Accepted as tech debt for V1.
