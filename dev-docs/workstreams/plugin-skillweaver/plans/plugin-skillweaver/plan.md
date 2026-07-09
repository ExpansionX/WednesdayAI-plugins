# Plugin: SkillWeaver — Implementation Plan

## Approach

This plugin is a standalone community extension for WednesdayAI living in a separate
`WednesdayAI-plugins` repository. It implements the SkillWeaver compositional skill routing pipeline
(Gao 2026, arXiv:2606.18051) using the `context.collect` lifecycle hook — the same seam
`memory-lancedb` uses for auto-recall. The plugin injects retrieved skill descriptions into the
**conversation** (not the system prompt), preserving the system prompt cache.

Each phase is a shippable, testable tracer-bullet increment:
- **Phase 1** — the extension loads and validates config (proves the shell works)
- **Phase 2** — embedding backends produce vectors (proves all 3 backends)
- **Phase 3** — skills are indexed and searchable (proves hnswlib integration)
- **Phase 4** — SAD decomposition pipeline runs against a real LLM (proves the core algorithm)
- **Phase 5** — full pipeline fires on every agent turn via `context.collect` (proves hook wiring)
- **Phase 6** — error resilience and lifecycle management (proves production readiness)
- **Phase 7** — benchmark suite and integration tests (proves SC achievement)

## Phases

| # | Phase | Task count | dep: | conflicts: |
|---|-------|-----------|------|------------|
| 1 | Plugin Shell | 001 002 003 | - | none |
| 2 | Embedding Layer | 004 005 006 007 | - | none |
| 3 | Skill Index | 008 009 | - | none |
| 4 | Decomposition & Retrieval | 010 011 | - | none |
| 5 | Hook Integration | 012 013 014 | - | none |
| 6 | Resilience & Edge Cases | 015 016 | - | none |
| 7 | Benchmark & Verification | 017 018 | - | none |

## Task dependency matrix

| Id | Phase | Title | dep: | conflicts: |
|----|-------|-------|------|------------|
| 001 | 1 | Extension package scaffolding | dep: - | conflicts: none |
| 002 | 1 | Config schema resolver + validator | dep: 001 | conflicts: none |
| 003 | 1 | Plugin entry point + config warning | dep: 002 | conflicts: none |
| 004 | 2 | EmbeddingBackend interface + types | dep: 001 | conflicts: none |
| 005 | 2 | LocalEmbedding backend | dep: 004 | conflicts: none |
| 006 | 2 | CloudEmbedding backend | dep: 004 | conflicts: none |
| 007 | 2 | CustomEmbedding backend | dep: 004 | conflicts: none |
| 008 | 3 | SkillIndex build + search | dep: 001 004 | conflicts: none |
| 009 | 3 | Index rebuild on fs change | dep: 008 | conflicts: none |
| 010 | 4 | Decomposer + SAD prompts | dep: 002 004 | conflicts: none |
| 011 | 4 | Retriever + hint construction | dep: 008 010 | conflicts: none |
| 012 | 5 | ContextInjector formatting | dep: 001 004 | conflicts: none |
| 013 | 5 | context.collect handler | dep: 003 008 010 011 012 | conflicts: none |
| 014 | 5 | Full register() wiring | dep: 003 004 008 010 011 012 013 | conflicts: none |
| 015 | 6 | Error resilience | dep: 013 014 | conflicts: none |
| 016 | 6 | Lifecycle management | dep: 014 | conflicts: none |
| 017 | 7 | Benchmark harness | dep: 011 | conflicts: none |
| 018 | 7 | Integration tests | dep: 016 | conflicts: none |