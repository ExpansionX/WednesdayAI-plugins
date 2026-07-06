# Decisions Ledger — Plugin-SkillWeaver

Decisions made by the implementer that were not pre-specified in the task files. Recorded per WAI decompose convention.

## Decompose decisions (pre-implementation)

None yet — all decisions resolved in spec ADRs (0001-0004) or task files.

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