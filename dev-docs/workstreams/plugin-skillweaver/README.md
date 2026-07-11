---
doc_type: workstream
status: shipped
id: TRK-005
workstream: plugin-skillweaver
title: "Plugin: SkillWeaver — Compositional Skill Routing for WednesdayAI"
created: 2026-07-06
updated: 2026-07-09
staging_pointers:
  - dev-docs/workstreams/plugin-skillweaver/plans/plugin-skillweaver
  - dev-docs/workstreams/plugin-skillweaver/spec/2026-07-06-plugin-skillweaver.md
---

# plugin-skillweaver

A WednesdayAI community plugin implementing SkillWeaver (Gao 2026) compositional skill routing: decompose complex queries, retrieve relevant skills via bi-encoder similarity, and inject only the needed skills into the agent's context.

## Status

**complete** — v0.1.0 implemented, tested (254 tests, 88%+ coverage), reviewed (6 rounds, 7 models, 75+ issues fixed), documented, and PR ready to merge. See [dev log](/dev-docs/logs/2026-07-08-plugin-skillweaver.md) for full record.

## Quick links

- [Spec](spec/2026-07-06-plugin-skillweaver.md)
- [Implementation Plan](plans/plugin-skillweaver/plan.md)
- [Plugin README](/extensions/skillweaver/README.md)
- [CHANGELOG](/extensions/skillweaver/CHANGELOG.md)
- [ADR-0001](/dev-docs/adr/0001-context-collect-hook-for-skill-injection.md) — `context.collect` hook for skill injection
- [ADR-0002](/dev-docs/adr/0002-pluggable-embedding-backend-interface.md) — Pluggable embedding backend interface
- [ADR-0003](/dev-docs/adr/0003-sad-prompt-contract.md) — SAD prompt contract and response format
- [ADR-0004](/dev-docs/adr/0004-in-memory-index-no-persistence.md) — In-memory index, no persistence
- [Post-SkillWeaver Backlog](/dev-docs/backlog/2026-07-09-after-plugin-skillweaver.md)

## ADRs

| ID | Title | Status |
|----|-------|--------|
| 0001 | `context.collect` hook for skill injection | accepted |
| 0002 | Pluggable embedding backend interface | accepted |
| 0003 | SAD prompt contract and response format | accepted |
| 0004 | In-memory index, no persistence | accepted |

## Phases

| Phase | Tasks | Status |
|-------|-------|--------|
| 1 - Plugin Shell | 001, 002, 003 | ✅ Complete |
| 2 - Embedding Layer | 004, 005, 006, 007 | ✅ Complete |
| 3 - Skill Index | 008, 009 | ✅ Complete |
| 4 - Decomposition & Retrieval | 010, 011 | ✅ Complete |
| 5 - Hook Integration | 012, 013, 014 | ✅ Complete |
| 6 - Resilience | 015, 016 | ✅ Complete |
| 7 - Verification | 017, 018 | ✅ Complete |

## Metrics

| Metric | Target | Actual |
|--------|--------|--------|
| Tests | — | 254 passing |
| Coverage | ≥80% | 88%+ |
| Adversarial rounds | — | 6 rounds, 7 models |
| Issues found & fixed | — | 75+ |
| Final review verdict | — | Clean (3/3 R6 reviewers) |

## V2 Roadmap

See [Post-SkillWeaver Backlog](/dev-docs/backlog/2026-07-09-after-plugin-skillweaver.md) for priorities:
1. Ship v0.1.0 (merge PR)
2. Benchmark validation (SC1/SC2)
3. V2 planning — reranker + iterative SAD
