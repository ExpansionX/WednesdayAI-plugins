# Tournament Round 3 — Adversarial Review

**Date:** 2026-07-08
**Challengers:** gpt-5.5 (C1), xiaomi/mimo-v2.5-pro (C2), claude-opus-4-8 (C3)

## Scoring Summary

| Challenger | Issues Found | Valid | Remediations Accepted | Score |
|------------|-------------|-------|----------------------|-------|
| C1 (GPT-5.5) | 19 | 13 | 10 | 23 |
| C2 (Mimo) | 20 | 12 | 9 | 21 |
| C3 (Opus) | 13 | 9 | 7 | 16 |

**Winner: C1 (GPT-5.5)** — 23 points

## Issues Found (Deduplicated)

### Critical (1 issue)
| ID | Description | Found By | Remediated |
|----|-------------|----------|------------|
| R3-001 | Watcher only monitors last directory (unwatch on each call) | C1, C2, C3 | ✅ |

### High (3 issues)
| ID | Description | Found By | Remediated |
|----|-------------|----------|------------|
| R3-002 | Race condition: handler runs before index built | C1, C2 | ⚠️ Accepted (V1) |
| R3-003 | Race condition: concurrent rebuild corrupts index | C1, C2 | ✅ (generation counter) |
| R3-004 | Dimension mismatch across backends | C1, C2, C3 | ✅ |

### Medium (8 issues)
| ID | Description | Found By | Remediated |
|----|-------------|----------|------------|
| R3-005 | NaN passes range validation | C1 | ✅ |
| R3-006 | Prompt injection via skill descriptions | C1 | ✅ |
| R3-007 | sad.maxIterations dead config | C1, C2 | ⚠️ Kept (future use) |
| R3-008 | Handler logs wrong pass number | C3 | ✅ |
| R3-009 | CustomEmbedding missing encoding_format | C3 | ✅ |
| R3-010 | Logger produces [object Object] | C3 | ✅ |
| R3-011 | Watch triggers on any .md file | C2 | ✅ |
| R3-012 | CloudEmbedding no API key warning | C1 | ⚠️ Accepted (V1) |

### Low (6 issues)
| ID | Description | Found By | Remediated |
|----|-------------|----------|------------|
| R3-013 | Multi-line YAML descriptions truncated | C1, C2 | ⚠️ Documented |
| R3-014 | Pipeline promise caches rejection | C2 | ⚠️ Accepted (V1) |
| R3-015 | Dual logger implementations | C2 | ⚠️ Accepted (V1) |
| R3-016 | Benchmark unhandled promise rejection | C2 | ✅ |
| R3-017 | openai-compatible decomposer missing baseUrl validation | C3 | ✅ |
| R3-018 | Overly permissive priority assertion in test | C3 | ⚠️ Accepted (V1) |

## Remediations Applied

1. **skill-index.ts**: Multi-dir watchers (Map), generation counter for atomic build swap, watch only SKILL.md files, drop undefined arg from searchKnn
2. **config.ts**: NaN validation for all numeric fields, openai-compatible baseUrl check
3. **handler.ts**: Track actual pass number instead of assuming
4. **cloud.ts**: Dimension validation on first embed
5. **custom.ts**: Dimension validation + encoding_format: 'float'
6. **logger.ts**: Serialize meta as JSON
7. **context-injector.ts**: Sanitize markdown special chars in skill names/descriptions

## Tests

- 116 tests passing
- Typecheck: clean
