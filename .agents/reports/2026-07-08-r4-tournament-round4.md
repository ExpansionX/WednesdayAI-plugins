# Tournament Round 4 — Adversarial Review

**Date:** 2026-07-08
**Challengers:** moonshotai/kimi-k2.7-code (C1), deepseek/deepseek-v4-pro (C2), z-ai/glm-5.2 (C3)

## Scoring Summary

| Challenger | Issues Found | Valid | Remediations Accepted | Score |
|------------|-------------|-------|----------------------|-------|
| C1 (Kimi) | 9 | 6 | 5 | 11 |
| C2 (DeepSeek) | 10 | 7 | 5 | 12 |
| C3 (GLM) | 25 | 15 | 12 | 27 |

**Winner: C3 (GLM)** — 27 points

## Issues Found (Deduplicated)

### Critical/High (5 issues)
| ID | Description | Found By | Remediated |
|----|-------------|----------|------------|
| R4-001 | Watch skipped for default skills dir | C3 | ✅ |
| R4-002 | dispose() doesn't bump buildGeneration | C1, C3 | ✅ |
| R4-003 | fs.watch recursive broken on Linux | C2, C3 | ✅ |
| R4-004 | Watcher error events unhandled | C1 | ✅ |
| R4-005 | discoverSkills silent error swallowing | C3 | ✅ |

### Medium (7 issues)
| ID | Description | Found By | Remediated |
|----|-------------|----------|------------|
| R4-006 | Prompt injection in formatHints | C2, C3 | ✅ |
| R4-007 | Sub-tasks bypass sanitizeMarkdown | C1, C3 | ✅ |
| R4-008 | Integer fields not validated | C1, C3 | ✅ |
| R4-009 | Boolean("false") config coercion | C1 | ✅ |
| R4-010 | extractJsonArray fallback wrong bracket | C3 | ✅ |
| R4-011 | AbortController timer leak | C2 | ✅ |
| R4-012 | decomposer reports wrong pass on error | C2 | ✅ |

### Low (10 issues)
| ID | Description | Found By | Remediated |
|----|-------------|----------|------------|
| R4-013 | No score floor on retrieval | C1 | ✅ |
| R4-014 | String skills.dirs silently ignored | C3 | ✅ |
| R4-015 | Custom embedding dimensions not configurable | C2 | ⚠️ V2 |
| R4-016 | LocalEmbedding dimensions hardcoded | C1 | ⚠️ V2 |
| R4-017 | @xenova/transformers not in package.json | C1 | ⚠️ V2 |
| R4-018 | resolveEffectiveDecomposerConfig dead code | C3 | ⚠️ V2 |
| R4-019 | Handler registered before index built | C2, C3 | ⚠️ V2 |
| R4-020 | Multi-line YAML descriptions truncated | C2 | ⚠️ V2 |
| R4-021 | Custom embedding model not configurable | C2 | ⚠️ V2 |
| R4-022 | sanitizer over-aggressive on backticks | C2 | ⚠️ V2 |

## Tests

- 116 tests passing
- Typecheck: clean
