---
doc_type: backlog
status: active
workstream: plugin-skillweaver
title: "Post-SkillWeaver: What's Next"
created: 2026-07-09
author: david
---

# Post-SkillWeaver: What's Next

## Current State Assessment

### SkillWeaver v0.1.0 — COMPLETE

| Dimension | Status | Evidence |
|-----------|--------|----------|
| Implementation | ✅ Done | 14 source files, 18 tasks across 7 phases |
| Tests | ✅ 254 passing | 88%+ coverage, 16 test files |
| Adversarial review | ✅ Converged | 6 rounds, 7 models, 75+ issues fixed |
| PR feedback | ✅ Clean | 3/3 comments replied, no actionable findings |
| Documentation | ✅ Complete | README, docs page, CHANGELOG, dev log, 4 ADRs |
| Code review gate | ✅ Passed | `Actionable: []` after final fix |
| Branch | ✅ Pushed | `feat/plugin-skillweaver-execute`, MERGEABLE, CLEAN |

### What Makes It World Class Today

1. **Rigorous review pipeline** — 18 reviewer sessions across 7 different AI models (DeepSeek, GLM, Kimi, MiMo, MiniMax, GPT-5.5, Claude Opus), 75+ issues found and fixed, convergence confirmed by 3 independent reviewers
2. **Production-grade error handling** — abort signal propagation across full pipeline, graceful degradation on every failure mode, shared timeout budgets
3. **Security hardening** — prompt injection defense (sanitizes opening + closing tags), API key isolation, sub-agent event filtering, input validation
4. **Pluggable architecture** — 3 embedding backends, 4 decomposer providers, all configurable via JSON schema with validation
5. **Comprehensive testing** — 254 tests covering race conditions, resource leaks, edge cases, timeout handling, not just happy paths

### What Would Make It Best of Breed

1. **Benchmark validation** — SC1 (CatR@10 ≥ 65%) and SC2 (DA ≥ 60%) are untested against real queries. The benchmark harness exists (`src/__tests__/benchmark.ts`) but hasn't been run against the actual WednesdayAI skill corpus.
2. **LLM listwise reranker** — The paper shows +10.3% CatR@1 from a reranker stage. This is V2 scope but would be a significant accuracy boost.
3. **Iterative SAD convergence** — Current V1 does a single 2-pass decomposition. Multi-iteration with Jaccard convergence monitoring would improve complex query handling.
4. **MCP tool catalog integration** — Route MCP tools, not just SKILL.md skills. This would make SkillWeaver a universal router.
5. **Skill usage analytics** — Track which skills get routed to, which queries fail routing, optimize the index based on real usage patterns.
6. **Distributed index** — ADR-0004 says "revisit at 1,000+ skills." If the skill corpus grows, HNSW in-memory won't scale.

---

## Top 3 Priorities (Validated, Ready to Start)

### Priority 1: Ship SkillWeaver v0.1.0 (Merge PR)

**What:** Merge `feat/plugin-skillweaver-execute` into `main` and publish.
**Why:** The implementation is complete and reviewed. Shipping validates the `context.collect` hook pattern for the broader plugin ecosystem.
**Effort:** 30 minutes (merge + verify)
**Blocked by:** Nothing — PR is MERGEABLE, all checks pass.
**Next step:** Run `/wai:ship` to merge and clean up.

### Priority 2: Benchmark Validation (SC1/SC2)

**What:** Run the benchmark harness against WednesdayAI's 56+ bundled skills with 50 compositional queries. Measure CatR@10 and DA.
**Why:** These are the paper's core claims. Without validation, we're shipping on faith. The benchmark harness exists but hasn't been exercised.
**Effort:** 2-4 hours (curate 50 queries, run benchmark, analyze results, tune if needed)
**Blocked by:** Priority 1 (need the plugin merged and loadable)
**Files:** `extensions/skillweaver/src/__tests__/benchmark.ts`
**Success:** CatR@10 ≥ 65%, DA ≥ 60%

### Priority 3: V2 Planning — Reranker + Iterative SAD

**What:** Design and plan the next evolution: LLM listwise reranker (paper's appendix K) and multi-iteration SAD convergence.
**Why:** The paper shows these are the two highest-impact improvements (+10.3% CatR@1 from reranker, better decomposition from iterative SAD). Planning now means we can start implementation immediately after shipping.
**Effort:** 1-2 hours (design doc + task breakdown)
**Blocked by:** Priority 2 (need benchmark baseline to measure improvement against)
**Output:** New spec + plan in `docs/superpowers/specs/` and `docs/plans/plugin-skillweaver-v2/`

---

## Backlog (Future Work, Not Yet Prioritized)

| Item | Source | Effort | Dependencies |
|------|--------|--------|--------------|
| MCP tool catalog integration | Spec out-of-scope | Large | MCP protocol stability |
| Distributed index (Redis/Qdrant) | ADR-0004 "revisit at 1K+" | Medium | Skill corpus growth |
| Skill usage analytics/telemetry | Spec out-of-scope | Medium | v0.1.0 shipping |
| Runtime skill execution orchestration | Spec out-of-scope | Large | v0.1.0, MCP integration |
| Cross-agent skill sharing | Vision | Large | Community adoption |
| Skill versioning + compatibility matrix | Vision | Medium | Skill corpus growth |
| Compose/DAG planner (Stage 3) | Paper Stage 3 | Large | Reranker, iterative SAD |

---

## Known Issues / Technical Debt

| Item | Severity | Notes |
|------|----------|-------|
| WAI DAG run state stale | Low | `.wai-run-state.json` shows task 001 deadlocked — not reflective of actual state (all 18 tasks complete). Clean up or ignore. |
| `index.ts` coverage at 47% | Low | Integration-heavy `register()`/`discoverSkills()` — requires full plugin context to test. Acceptable for v0.1.0. |
| `skill-index.ts` Linux-only paths untested | Low | Non-recursive subdirectory watching only runs on Linux. macOS CI can't test it. |

---

## Next Session Prompt

Use this prompt in a new session to pick up where we left off:

```
You are working on the WednesdayAI-plugins repo at ~/Code/WednesdayAI-plugins-skillweaver.

## Context
SkillWeaver v0.1.0 is COMPLETE — 254 tests, 88%+ coverage, 6 rounds of adversarial review, PR #1 ready to merge on branch `feat/plugin-skillweaver-execute`.

## Your Tasks (in order)

### 1. Ship v0.1.0
- Run `/wai:ship` to merge PR #1 into main
- Verify the merge is clean
- Confirm the plugin loads correctly after merge

### 2. Benchmark Validation (SC1/SC2)
- Read the benchmark harness at `extensions/skillweaver/src/__tests__/benchmark.ts`
- Curate 50 compositional queries against WednesdayAI's bundled skills (read SKILL.md files from `~/.openclaw/skills/` or the extensions directory)
- Run the benchmark and measure:
  - CatR@10 (Category Recall@10) — target ≥ 65%
  - DA (Decomposition Accuracy) — target ≥ 60%
- If targets are not met, analyze failure modes and tune:
  - Adjust `retrieval.topK` or `retrieval.hintSize`
  - Try different decomposer models
  - Adjust SAD prompt format
- Document results in `dev-docs/logs/2026-07-09-benchmark-results.md`

### 3. V2 Planning
- Read the SkillWeaver paper (arXiv:2606.18051) sections on:
  - Listwise reranker (appendix K) — +10.3% CatR@1
  - Iterative SAD convergence (section 4.3)
- Design the V2 spec considering:
  - How to integrate a reranker stage after HNSW retrieval
  - How to implement multi-iteration SAD with Jaccard convergence
  - Whether to add MCP tool catalog integration in V2 or defer
- Write the spec to `docs/superpowers/specs/2026-07-09-plugin-skillweaver-v2.md`
- Create the implementation plan at `docs/plans/plugin-skillweaver-v2/plan.md`

### 4. Clean Up Stale State
- Remove or update `docs/plans/plugin-skillweaver/.wai-run-state.json` (stale — shows task 001 deadlocked but all 18 tasks are complete)
- Update `dev-docs/workstreams/plugin-skillweaver/README.md` status to `shipped` after merge

## Key Files
- Plugin: `extensions/skillweaver/` (14 source files, 16 test files)
- Spec: `docs/superpowers/specs/2026-07-06-plugin-skillweaver.md`
- ADRs: `dev-docs/adr/0001-0004`
- Benchmark: `extensions/skillweaver/src/__tests__/benchmark.ts`
- Paper: arXiv:2606.18051

## Constraints
- Follow WednesdayAI coding conventions (TypeScript ESM, strict, Vitest, no `any`)
- All changes require tests (80%+ coverage threshold)
- Run `pnpm tsgo` and `pnpm check` before committing
- Use `scripts/committer` for commits
- Document decisions in ADRs
```
