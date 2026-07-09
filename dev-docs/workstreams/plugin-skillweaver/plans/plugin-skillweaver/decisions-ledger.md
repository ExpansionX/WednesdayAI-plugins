# Decisions Ledger — Plugin-SkillWeaver

Decisions made by the implementer that were not pre-specified in the task files. Recorded per WAI decompose convention.

## Decompose decisions (pre-implementation)

None yet — all decisions resolved in spec ADRs (0001-0004) or task files.

## Reachability gate

**Date:** 2026-07-09
VERDICT: PASS

### Call-path trace

The full routing pipeline is exercised through real entry points, not isolated unit mocks:

1. **Entry:** `register()` in `index.ts` → creates handler via `createCollectHandler()` → registers on `context.collect` hook
2. **Handler:** `handler.ts:30` → `createCollectHandler()` → receives `CollectEvent` → extracts `cleanUserMessage.text`
3. **Decompose:** `decomposer.ts:134` → `Decomposer.decompose()` → Pass-1 (no hints) → if SAD enabled + hints found → Pass-2 (with hints)
4. **Retrieve:** `retriever.ts:22` → `Retriever.retrieve()` → builds hint set via `buildHintSet()` → searches `SkillIndex.search()` per sub-task
5. **Index:** `skill-index.ts:93` → `SkillIndex.search()` → embeds query via backend → HNSW `searchKnn()` → returns scored results
6. **Compose:** `context-injector.ts:17` → `formatSkillContext()` → formats matched skills as markdown → returns `{ prependContext }` contribution
7. **Lifecycle:** `index.ts:167` → `gateway_stop` handler → disposes decomposer, index, backend in order with try/catch

### Real-seam tests

The integration test (`src/__tests__/integration.test.ts`) exercises the full pipeline:
- Mocks only the external HTTP boundary (fetch for decomposer LLM calls)
- Exercises real `SkillIndex.build()`, `search()`, `Retriever.retrieve()`, `formatSkillContext()`
- Verifies `context.collect` hook receives correctly formatted contribution
- Tests SAD 2-pass flow (pass-1 → hint set → pass-2)
- Tests sub-agent event filtering (skips routing)
- Tests error resilience (decomposer failure → graceful empty result)

Unit tests verify each seam independently:
- `handler.test.ts`: handler → decomposer → retriever → formatSkillContext (mocked boundaries)
- `skill-index.test.ts`: build → search → dispose lifecycle with real HNSW index
- `decomposer.test.ts`: prompt construction → HTTP call → response parsing (mocked fetch)
- `retriever.test.ts`: hint set construction → index search → result aggregation

### Coverage

- 254 tests passing across 16 test files
- 88.05% statements / 86.51% branch / 87.37% functions / 90.33% lines
- All error paths tested: timeout, abort, HTTP errors, malformed responses, disposed state

### Adversarial review

6 rounds across 7 AI models (DeepSeek, GLM, Kimi, MiMo, MiniMax, GPT-5.5, Claude Opus):
- 75+ issues found and fixed
- Round 6: 3/3 reviewers declared codebase clean
- Final code review gate: `Actionable: []`

## Tournament remediation decisions (R1)

| # | Finding | Source | Fix Applied |
|---|---------|--------|-------------|
| 1 | SAD prompts return `{ "subTasks": [...] }` object, not bare array | Codex+Gemini | task 010: extractJsonArray with backward-compat array fallback |
| 2 | Poor-retrieval fallback when hints < 3 | Gemini | task 010: append helper sentence |
| 3 | Config schema missing `skills.dirs`, decomposer model hardcoded | Gemini | task 002: added `resolveEffectiveDecomposerConfig()` + `skills.dirs` |
| 4 | `watch()` never assigned watcher, invalid `import()` call | Codex+Gemini | task 009: top-level `import { watch } from "fs"`, assign + recursive + close prior |
| 5 | AbortSignal timeout "hollow" — not created in handler | Codex+Gemini | task 015: handler creates AbortController with `decomposerTimeoutMs`, passes signal |
| 6 | CatR metric binary per query instead of per-sub-task recall | Codex+Gemini | task 017: computeCatR returns fraction 0..1, aggregates as average |
| 7 | `agent_end` destroys singleton index — should use `gateway_stop` | Gemini | task 016: lifecycle hook changed to `gateway_stop` with `disposed` idempotency flag |
| 8 | `discoverSkills()` hollow stub — needs real SKILL.md scanner | Codex | task 014: scans configured `skills.dirs` for SKILL.md files |
| 9 | task 004 missing `irreversible: true` + ADR-0002 cite | Codex | task 004: added `irreversible: true` |
| 10 | Integration test hook count assertion stale after gateway_stop fix | Codex | task 018: hook count 1→2, SC4 test uses long query |
| 11 | `formatSkillContext` source string generic — should identify plugin | Codex | task 012: `source: "plugin-skillweaver"`, `depends_on: ["001","004"]` |
| 12 | task 010/012 missing dep on 004 (types) | Codex | task 010: `depends_on: ["002","004"]`, task 012: `depends_on: ["001","004"]` |
| 13 | CLI exit code for benchmark: exit 0 on pass, 1 on fail | Codex | task 017: `benchmarkMain()` exits 0 when SCs met |