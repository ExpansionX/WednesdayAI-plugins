---
doc_type: adr
id: 0002
workstream: plugin-skillweaver
title: "ADR-0002: Pluggable embedding backend interface"
status: accepted
created: 2026-07-06
---

# ADR-0002: Pluggable embedding backend interface

## Context

The SkillWeaver plugin needs to embed skill names and descriptions into vectors for similarity search. Users have diverse embedding infrastructure:

- Some run everything locally (no API keys, air-gapped)
- Some use cloud providers (OpenAI, Gemini)
- Some self-host embeddings via Infinity, Ollama, or similar Docker services

## Decision

Define an `EmbeddingBackend` interface with three concrete implementations selected by config. The interface is:

```ts
interface EmbeddingBackend {
  readonly id: string;
  readonly dimensions: number;
  embed(texts: string[]): Promise<Float32Array[]>;
  embedSingle(text: string): Promise<Float32Array>;
  dispose(): void | Promise<void>;
}
```

Three backends:
1. **`local`** — `@xenova/transformers` with `all-MiniLM-L6-v2` (384-dim). Runs in-process, no network, 80MB model download on first use.
2. **`cloud`** — OpenAI `/v1/embeddings` API. Defaults to `text-embedding-3-small` (1536-dim). Requires API key.
3. **`custom`** — Any OpenAI-compatible `/v1/embeddings` endpoint. User provides URL, model name, optional API key.

## Rationale

### Interface is intentionally minimal

Two methods: `embed` (batch) and `embedSingle` (convenience). No streaming, no fine-tuning, no model management. This keeps the contract simple enough that all three backends are trivial to implement. The index layer doesn't care which backend it uses — it just calls `embed()`.

### Dimension-agnostic index

The hnswlib index is dimension-agnostic — it stores vectors of whatever dimension the backend produces. This means switching from local (384-dim) to cloud (1536-dim) requires a full index rebuild (re-embed all skills), but no code changes. Config change + restart = new backend active.

### Local as default, cloud as upgrade

The default is local (`all-MiniLM-L6-v2`) because it requires zero configuration — no API keys, no endpoints, no network. It works immediately. The paper validates this exact model. Users who want higher accuracy can switch to cloud (OpenAI `text-embedding-3-small`) which has a better embedding quality at the cost of API latency + cost.

### Custom for self-hosters

Users running Infinity, Ollama, or other OpenAI-compatible embedding servers can point the plugin at their local endpoint. No new code path — just a different URL. This covers the "Infinity in Docker with all-MiniLM-L6-v2" use case without adding Infinity-specific code.

## Consequences

- **Positive:** Users choose their own cost/latency/privacy trade-off.
- **Positive:** Interface is small enough that adding a 4th backend (e.g., Gemini embedding, Cohere) is a single file.
- **Negative:** Different backends produce different-quality embeddings for the same text. The benchmark suite must validate all three backends independently.
- **Negative:** Switching backends requires a full index rebuild (embed all skills from scratch). Acceptable because skill count is small (56–200) and rebuild is <1s.

## Alternatives considered

### Single backend (local only)
Simpler, but excludes users who prefer cloud embeddings or self-host embedding servers. Rejected — the paper itself uses cloud embeddings for some experiments; local-only is unnecessarily restrictive.

### Multiple backends with auto-fallback
"Try cloud, fall back to local if unavailable." Adds complexity (retry logic, degraded-accuracy mode) with unclear benefit. If the user picks a backend, they expect it to be used. Explicit config > magic fallback.

### Transformer.js model selection within local backend
Allow any Xenova model, not just all-MiniLM-L6-v2. Rejected for V1 — model dimension must be known at index creation time, and supporting arbitrary models adds config validation complexity. The custom backend already handles "any model I want" via the OpenAI-compatible endpoint path.