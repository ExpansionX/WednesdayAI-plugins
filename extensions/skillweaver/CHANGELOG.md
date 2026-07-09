# Changelog

All notable changes to the SkillWeaver plugin will be documented in this file.

## [0.1.0] - 2026-07-08

### Added

- **Core pipeline**: decompose → retrieve → compose via `context.collect` hook
- **Skill-Aware Decomposition (SAD)**: 2-pass decomposition with skill hints
- **Embedding backends**: local (all-MiniLM-L6-v2), cloud (OpenAI), custom (OpenAI-compatible)
- **HNSW vector index**: in-memory cosine similarity search with auto-rebuild
- **File watching**: auto-rebuild on SKILL.md changes with 2s debounce
- **Sub-agent isolation**: skips routing for sub-agent events
- **Prompt injection defense**: sanitizes `</user_query>` tags and markdown escapes
- **Abort signal propagation**: full pipeline timeout with shared AbortController
- **Config validation**: type coercion, range checks, provider-specific validation
- **Error resilience**: graceful degradation on decomposer/retriever/embedding failures
- **254 unit tests** with 88%+ coverage across 16 test files

### Security

- API keys never logged or exposed in context contributions
- Skill description sanitization prevents prompt injection
- Input validation on all config fields
- Sub-agent event filtering prevents recursive routing
