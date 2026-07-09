# Tournament Round 5 — Adversarial Review

**Date:** 2026-07-08
**Challengers:** minimax/minimax-m3 (C1), xiaomi/mimo-v2.5-pro (C2), gpt-5.5 (C3)

## Scoring Summary

| Challenger | Issues Found | Valid | Remediations Accepted | Score |
|------------|-------------|-------|----------------------|-------|
| C1 (Minimax) | 18 | 10 | 8 | 18 |
| C2 (Mimo) | 4 | 3 | 2 | 5 |
| C3 (ChatGPT) | 7 | 5 | 3 | 8 |

**Winner: C1 (Minimax)** — 18 points

## Issues Found (Deduplicated)

### Medium (4 issues)
| ID | Description | Found By | Remediated |
|----|-------------|----------|------------|
| R5-001 | HNSW native not disposed on rebuild | C1 | ✅ |
| R5-002 | CloudEmbedding dims no config escape hatch | C1, C2 | ✅ |
| R5-003 | CustomEmbedding dims/model not configurable | C1, C3 | ✅ |
| R5-004 | skills.dirs not in openclaw.plugin.json schema | C3 | ✅ |

### Low (10 issues)
| ID | Description | Found By | Remediated |
|----|-------------|----------|------------|
| R5-005 | toBool fallback unused, case-sensitive | C1, C2 | ✅ |
| R5-006 | formatHints doesn't sanitize newlines | C1 | ✅ |
| R5-007 | sanitizeMarkdown allows `<>` | C1 | ✅ |
| R5-008 | Dead `hints.length > 0` check | C1 | ✅ |
| R5-009 | Unused query param in formatSkillContext | C1 | ✅ |
| R5-010 | Watcher dedup test doesn't verify | C2 | ✅ |
| R5-011 | Inconsistent logger imports | C2 | ⚠️ V2 |
| R5-012 | @xenova/transformers not in deps | C3 | ⚠️ V2 |
| R5-013 | decomposer apiKey not resolved from env | C3 | ⚠️ V2 |
| R5-014 | Sub-agent check field name | C3 | ⚠️ V2 |

## Tests

- 116 tests passing
- Typecheck: clean

## Summary

Rounds 1-5 have found and fixed 60+ issues. The codebase is now well-hardened. Round 6 is needed to confirm zero valid issues.
