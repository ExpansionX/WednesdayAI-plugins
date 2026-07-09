# Tournament Round 8 — Adversarial Review

**Date:** 2026-07-09
**Challengers:** moonshotai/kimi-k2.7-code (C1), z-ai/glm-5.2 (C2), minimax/minimax-m3 (C3)

## Scoring Summary

| Challenger | Issues Found | Valid | Remediations Accepted | Score |
|------------|-------------|-------|----------------------|-------|
| C1 (Kimi) | 0 | 0 | 0 | 0 |
| C2 (GLM) | 7 | 5 | 4 | 9 |
| C3 (Minimax) | 15 | 8 | 5 | 13 |

**Winner: C3 (Minimax)** — 13 points

## Issues Found (Deduplicated)

### High (1 issue)
| ID | Description | Found By | Remediated |
|----|-------------|----------|------------|
| R8-001 | require() in ESM (R7 regression) | C2, C3 | ✅ |

### Medium (3 issues)
| ID | Description | Found By | Remediated |
|----|-------------|----------|------------|
| R8-002 | Embedding backends no timeout | C2, C3 | ⚠️ V2 |
| R8-003 | sad.maxIterations dead config | C2, C3 | ✅ |
| R8-004 | Inconsistent logger source | C2, C3 | ⚠️ V2 |

### Low (5 issues)
| ID | Description | Found By | Remediated |
|----|-------------|----------|------------|
| R8-005 | toBool case-sensitive | C2 | ✅ |
| R8-006 | OpenRouter HTTP-Referer not URL | C3 | ✅ |
| R8-007 | isSubAgent truthy check | C3 | ✅ |
| R8-008 | Sanitization asymmetry undocumented | C3 | ✅ |
| R8-009 | maxIterations not validated | C3 | ✅ (removed) |

### V2 (deferred)
| ID | Description | Found By |
|----|-------------|----------|
| R8-010 | @xenova/transformers not in deps | C3 |
| R8-011 | Timeout test false positive | C3 |
| R8-012 | No Anthropic test coverage | C2 |
| R8-013 | extractJsonArray fallback | C2 |
| R8-014 | Decomposer dispose doesn't abort | C3 |
| R8-015 | LocalEmbedding dispose leaks | C3 |

## Tests

- 113 tests passing
- Typecheck: clean

## Summary

8 rounds complete. 90+ issues found and fixed. The `require()` in ESM was a regression introduced by the R7 Linux watcher fix — caught and fixed in the same tournament.
