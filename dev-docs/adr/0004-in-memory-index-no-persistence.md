---
doc_type: adr
id: 0004
workstream: plugin-skillweaver
title: "ADR-0004: In-memory skill index, no persistence"
status: accepted
created: 2026-07-06
---

# ADR-0004: In-memory skill index, no persistence

## Context

The SkillWeaver plugin builds a vector index of all skill `name + description` strings at startup. We must decide whether to persist this index to disk or rebuild it in-memory on every startup.

## Decision

Build the skill index in-memory at plugin startup. Do not persist to disk. Rebuild on any skill file change (fs.watch, debounced).

## Rationale

At WednesdayAI's current skill scale (56 bundled + up to ~150 user-installed = ~200 skills), the index is trivial:

- 200 skills × 384-dim vectors = **307KB** of vector data
- 200 skills × ~200 bytes metadata = **~40KB** of metadata
- Total index footprint: **<1MB memory**
- Build time: embed 200 texts × local all-MiniLM-L6-v2 ≈ **<500ms**
- Cloud backend: 200 texts × ~50ms/embed ≈ **~10s** (one-time)

Adding persistence would require:
- Serialization format (binary, JSON, or msgpack)
- File I/O with atomic writes
- Invalidation rules (checksum mismatch, model change, skill file change)
- Migration strategy for format changes
- Version tracking to detect stale caches

This complexity has **zero practical benefit** at current scale. The rebuild cost (<1s local, ~10s cloud) is paid once at gateway startup or plugin reload — it's not on the critical path for any agent request.

If the WednesdayAI skill ecosystem grows to thousands of skills (matching CompSkillBench's 2,209-skill pool), persistence can be added later behind the same `SkillIndex` interface without changing any consumer code.

## Consequences

- **Positive:** Simpler code — no serialization, no file I/O, no invalidation, no migration.
- **Positive:** Always fresh — index is rebuilt from current skill files on every startup. No stale cache bugs.
- **Positive:** Dimension-agnostic — if the user switches embedding backends (384-dim → 1536-dim), the index rebuilds automatically with the new dimensions. A persisted index would need dimension-aware invalidation.
- **Negative:** ~500ms–10s startup latency while index builds. Paid once at gateway start / plugin load, not per-request. Acceptable.
- **Negative:** Cloud embedding backends pay API cost on every rebuild. At 200 skills × $0.02/1K tokens (OpenAI ada-002 pricing), rebuild costs ~$0.002. Negligible.

## Alternatives considered

### Persist to ~/.openclaw/skillweaver/index.bin
Save and load the hnswlib index state. Rejected — complexity > benefit at current scale. Revisit when skill count exceeds ~1,000.

### Persist embeddings only, rebuild index from cached embeddings
Store the embedding vectors as JSON, rebuild hnswlib index from them on load. Similar complexity to full persistence. Rejected for same reason.

### SQLite with sqlite-vec extension
Use SQLite's vector extension for storage + query. Would solve persistence naturally, but adds a native dependency and schema management. Overkill for <1MB index.