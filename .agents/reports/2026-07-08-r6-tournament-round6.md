# Tournament Round 6 — Adversarial Review

**Date:** 2026-07-08
**Challengers:** deepseek/deepseek-v4-pro (C1), moonshotai/kimi-k2.7-code (C2), z-ai/glm-5.2 (C3)

## Scoring Summary

| Challenger | Issues Found | Valid | Remediations Accepted | Score |
|------------|-------------|-------|----------------------|-------|
| C1 (DeepSeek) | 3 | 3 | 3 | 6 |
| C2 (Kimi) | 7 | 6 | 5 | 11 |
| C3 (GLM) | 6 | 6 | 5 | 11 |

**Winners: C2 (Kimi) and C3 (GLM)** — 11 points each

## Issues Found (Deduplicated)

### Medium (4 issues)
| ID | Description | Found By | Remediated |
|----|-------------|----------|------------|
| R6-001 | SkillIndex resurrected after dispose | C1, C3 | ✅ |
| R6-002 | Linux watcher misses SKILL.md (known limitation) | C2, C3 | ⚠️ Documented |
| R6-003 | CustomEmbedding dims not configurable | C1 | ✅ |
| R6-004 | No discoverSkills tests | C3 | ⚠️ V2 |

### Low (8 issues)
| ID | Description | Found By | Remediated |
|----|-------------|----------|------------|
| R6-005 | Decomposer error lacks response body | C1 | ✅ |
| R6-006 | Watcher error handler leaks FSWatcher | C2 | ✅ |
| R6-007 | BOM handling in frontmatter regex | C3 | ✅ |
| R6-008 | decomposerTimeoutMs unreachable | C3 | ⚠️ V2 |
| R6-009 | embedSingle empty result TypeError | C3 | ✅ |
| R6-010 | pnpm-workspace.yaml wrong key | C2 | ✅ |
| R6-011 | resolveEffectiveDecomposerConfig dead code | C2 | ✅ |
| R6-012 | sad.maxIterations unused | C2 | ⚠️ V2 |

## Tests

- 116 tests passing
- Typecheck: clean

## Summary

6 rounds complete. 70+ issues found and fixed. Codebase is well-hardened. Round 7 needed for second clean round.
