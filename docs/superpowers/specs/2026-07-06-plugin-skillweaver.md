---
doc_type: spec
status: active
id: TRK-005
workstream: plugin-skillweaver
change_kind: behaviour
title: "Plugin: SkillWeaver — Compositional Skill Routing for WednesdayAI"
created: 2026-07-06
updated: 2026-07-06
author: david
tags: [plugin, extension, skills, routing, retrieval, decomposition]
---

## Intent (what / why)

WednesdayAI agents face a growing skill library (56+ bundled skills, plus user-installed skills) dumped entirely into the system prompt. This burns 5K–15K context tokens just on skill descriptions, 95% of which are irrelevant to any given query. For complex multi-step queries ("download this dataset, analyze it, email the report"), the agent must scan all skills and guess which to compose — there's no routing intelligence.

SkillWeaver (Gao 2026, arXiv:2606.18051) formalizes this as the **Compositional Skill Routing** problem and demonstrates a decompose-retrieve-compose pipeline that:
- Reduces context window consumption by **>99%** (884K → ~2K tokens at 2,209-skill scale)
- Improves decomposition accuracy from 51% → 67.7% via Skill-Aware Decomposition (SAD)
- Achieves Category Recall@10 of ~70% using metadata-only bi-encoder retrieval

This plugin brings SkillWeaver to WednesdayAI as a community extension, serving dual purpose: a production-grade skill router AND a reference implementation for the `context.collect` hook pattern.

## Users / who is affected

| User | Impact |
|------|--------|
| **End users** (agent operators with many skills) | Automatic routing — no manual skill selection. Smaller context = faster responses, lower API cost. |
| **Plugin developers** | Reference implementation for `context.collect` + prompt contribution pattern. Demonstrates embedding infrastructure in an extension. |
| **Skill authors** | Skills get used more accurately — router matches skills to query intent rather than relying on LLM scanning a long list. |

### User stories

US1: As an agent operator, I want skills automatically matched to my query so I don't waste context tokens on irrelevant skill descriptions, and so complex multi-step queries are decomposed and routed correctly.

US2: As a plugin developer, I want a reference implementation of the `context.collect` hook pattern for skill routing so I can build similar plugins without breaking system prompt caching.

US3: As an infrastructure operator, I want to choose my embedding backend (local/cloud/custom) so I can optimize for cost, latency, privacy, or existing self-hosted infrastructure.

## Success criteria

### CatR@10 ≥ 65%
SC1: Retrieval accuracy — On a benchmark of 50 compositional queries against WednesdayAI's bundled skills, CatR@10 ≥ 65% (correct-category skill in top-10 candidates per sub-task). → US1:

### DA ≥ 60%
SC2: Decomposition accuracy — SAD decomposition produces correct step count (DA) on ≥ 60% of compositional queries (baseline: vanilla LLM decomposition ~45-50%). → US1:

### Context ≤ 300 tokens
SC3: Context reduction — When active with `skills: "names"` config, the skills section of the system prompt ≤ 300 tokens (vs ~8K–15K in "default" mode). → US1:

### No cache regression
SC4: Cache safety — System prompt cache hit rate unchanged from baseline (skills injected as conversation context, not system prompt). → US1:

### Slash commands preserved
SC5: Slash command survival — All existing skill slash commands (`/github`, `/weather`, etc.) continue functioning when plugin is active. → US1: US2:

### 3 embedding backends
SC6: Pluggable embedding — Plugin works with at least three embedding backends: local (all-MiniLM-L6-v2 via @xenova/transformers), cloud (OpenAI text-embedding-3-small), custom (arbitrary OpenAI-compatible endpoint, e.g. Infinity in Docker). → US1: US3:

### ≤ 5s latency
SC7: Latency budget — End-to-end routing (decompose + retrieve + inject) adds ≤ 3s overhead to agent startup on typical hardware. Optional SAD decomposition pass adds ≤ 5s. → US1:

## Constraints

- **Extension only** — no core changes to WednesdayAI. Uses existing `context.collect` hook + `api.config`.
- **Skill index built at startup** — embedding index constructed in `register()`, updated on skill file changes via fs watch (debounced).
- **Separate decomposer model** — configurable, defaults to agent's own model but should support a cheaper/smaller model (e.g., Qwen2.5-7B, gpt-4o-mini) to reduce the decomposition cost overhead.
- **No core config mutation** — plugin cannot set `agents.defaults.systemPrompt.sections.skills`. Must detect and warn; user configures manually.
- **Node.js ≥ 24** — same runtime requirement as WednesdayAI core.
- **External dependency ceiling** — max 3 new npm deps (embedding lib, vector index, maybe an MCP SDK for skill catalog query).

## Out of scope

- **Compose/DAG planner** (Stage 3 of SkillWeaver) — the paper's compose stage with inter-skill compatibility scoring. V1 focuses on decompose + retrieve; composition is sequential (order from decomposition).
- **Iterative SAD convergence monitoring** — V1 runs exactly 1 SAD iteration (Pass-1 decompose → retrieve → Pass-2 re-decompose). Multi-iteration with hint Jaccard convergence is V2.
- **LLM listwise reranker** — the paper's appendix K reranker that lifts CatR@1 +10.3%. V2 or separate plugin.
- **MCP tool catalog integration** — this plugin routes WednesdayAI *skills* (SKILL.md instructional content), not MCP tools. A separate plugin could handle MCP tool routing using the same pattern.
- **Runtime skill execution orchestration** — the plugin selects skills; it does not execute them or manage the execution DAG.
- **Skill usage analytics / telemetry**.
- **Auto-configuration of `skills: "names"`** — we can't mutate core config. Documentation + startup warning only.

## Approach

The plugin injects retrieved skill descriptions into the **conversation** (not the system prompt) via the `context.collect` lifecycle hook — the same seam `memory-lancedb` uses for auto-recall. This preserves the system prompt's full cacheability while delivering query-relevant skill content exactly where the agent needs it: alongside the user's message.

Per-agent-run pipeline:
1. `context.collect` fires with the clean user message
2. If query length < `minQueryLength` (default 20 chars), skip — simple queries don't need routing
3. Otherwise: run SAD decomposition (2-pass) against the configured decomposer model
4. Retrieve top-K skills per sub-task from the embedding index
5. Return skill descriptions as `prependContext` blocks in a `PromptContribution`
6. The hook runner injects these blocks into the conversation context before the user message

Skill index lifecycle:
- Built in `register()` at plugin startup
- Watched for changes via fs.watch (debounced rebuild)
- In-memory hnswlib index, never persisted to disk (rebuild is cheap at 56–200 skills)

Config adaptation:
- At startup, read `api.config.agents.defaults.systemPrompt.sections.skills`
- If `"default"` or unset: log a warning recommending `"names"` mode
- Plugin works regardless — but with redundancy in "default" mode

## Design / architecture

### Components

```
┌─────────────────────────────────────────────────────┐
│                  plugin-skillweaver                   │
├─────────────────────────────────────────────────────┤
│  register(api)                                       │
│    ├─ ConfigValidator ── validates plugin config     │
│    ├─ SkillIndex ──────── builds vector index        │
│    │   ├─ EmbeddingBackend (local/cloud/custom)      │
│    │   └─ hnswlib index (in-memory)                  │
│    ├─ Decomposer ──────── SAD pipeline               │
│    │   ├─ decomposerModel (configurable LLM)         │
│    │   └─ SAD prompt templates                       │
│    ├─ Retriever ───────── NN search per sub-task     │
│    └─ ContextInjector ─── PromptContribution builder │
│                                                      │
│  api.on("context.collect", handler)                   │
└──────────────────────┬──────────────────────────────┘
                       │ PromptContribution
                       ▼
              WednesdayAI hook runner
              → prependContext injected into conversation
```

### Data flow (per agent run)

```
context.collect event { cleanUserMessage, messages, envelope }
  │
  ├─ query.length < minQueryLength? → return {} (skip)
  │
  ├─ Pass 1: Decomposer.decompose(query, hints=null)
  │   └─ LLM call → ["fetch dataset", "analyze data", "generate report"]
  │
  ├─ For each sub-task: SkillIndex.search(subTask, topK=hintSize)
  │   └─ Embed sub-task → hnswlib NN search → [skill1, skill2, ...]
  │
  ├─ Build hint set: deduplicate top result per sub-task, take top hintSize unique
  │
  ├─ Pass 2 (SAD): Decomposer.decompose(query, hints=hintSet)
  │   └─ LLM call + hints → ["download CSV from URL", "run statistical analysis", "create chart"]
  │
  ├─ For each refined sub-task: SkillIndex.search(subTask, topK=config.topK)
  │   └─ Return top-K SkillEntry[]
  │
  └─ ContextInjector.format(skillEntries)
     └─ PromptContribution { prependContext: [ContextBlock, ...] }
```

### Index schema

Each skill is embedded as a single vector from its `name + description` string:

```
indexKey = skill.name
document  = `${skill.name}: ${skill.description}`
vector    = embed(document)  // 384-dim (all-MiniLM-L6-v2) or backend-specific
metadata  = { name, description, location, category?, source }
```

The skill body (full SKILL.md content) is NOT embedded — the paper shows metadata-only retrieval achieves
CatR@10 of ~70%, sufficient for the top-K retrieval that SAD feeds into decomposition.

### Hook contribution format

```ts
// Returned from context.collect handler
{
  prependContext: [
    {
      id: "skillweaver:route",
      source: "plugin-skillweaver",
      text: [
        "## Skill Routing",
        `For this query, the following skills are recommended:`,
        "",
        "### skill-name",
        "Description of the skill...",
        `Location: /path/to/skill/SKILL.md`,
        "",
        "### another-skill",
        "Description...",
      ].join("\n"),
      priority: 10,             // lower = earlier in context
      tokenEstimate: 1200,
      metadata: {
        matchedSkills: ["skill-name", "another-skill"],
        subTasks: ["download CSV", "run analysis"],
        decomposerModel: "qwen/qwen2.5-7b-instruct",
      },
    },
  ],
}
```

### Plugin config schema

```jsonc
{
  "plugins": {
    "skillweaver": {
      "enabled": true,              // master on/off
      "decomposer": {
        "provider": "openrouter",   // or "openai", "anthropic", "openai-compatible"
        "model": "qwen/qwen2.5-7b-instruct",
        "apiKey": null,             // null = use agent's provider creds; string = override
        "baseUrl": null,            // for openai-compatible endpoints
        "temperature": 0.1,
        "maxTokens": 256
      },
      "embedding": {
        "backend": "local",         // "local" | "cloud" | "custom"
        "model": "all-MiniLM-L6-v2", // local model name (Xenova)
        "cloudModel": "text-embedding-3-small", // cloud model (OpenAI)
        "endpoint": null,           // custom: OpenAI-compatible endpoint URL + API key
        "apiKey": null
      },
      "retrieval": {
        "topK": 3,                  // skills returned per sub-task
        "hintSize": 15,             // total hints passed to SAD Pass-2
        "minQueryLength": 20        // skip routing for very short queries
      },
      "sad": {
        "enabled": true,            // enable SAD (2-pass); false = Pass-1 only
        "maxIterations": 1          // V1 cap; future: multi-iteration
      }
    }
  }
}
```

### Embedding backend interface

```ts
interface EmbeddingBackend {
  readonly id: string;
  readonly dimensions: number;
  embed(texts: string[]): Promise<Float32Array[]>;
  embedSingle(text: string): Promise<Float32Array>;
  dispose(): void | Promise<void>;
}
```

Three implementations:
- `LocalEmbedding` — @xenova/transformers with all-MiniLM-L6-v2 (80MB, runs in-process)
- `CloudEmbedding` — OpenAI embeddings API (text-embedding-3-small or user-specified)
- `CustomEmbedding` — any OpenAI-compatible `/v1/embeddings` endpoint (Infinity, Ollama, etc.)

Backend selection happens at `register()` time based on config. The index builder is backend-agnostic.

## Decisions

### D1 — `context.collect` hook for injection (irreversible: contract)

**Choice:** Use `context.collect` hook to inject skill descriptions, not `before_prompt_build`.

**Rationale:** `context.collect` returns `PromptContribution` with `prependContext` blocks, which land in the conversation portion — not the system prompt. This preserves the system prompt cache (Anthropic ephemeral, OpenAI `prompt_cache_key`). `before_prompt_build` returns a `systemPrompt` string that replaces the entire system prompt, which would vary per-query and destroy the cache hit for the full ~15K token system message.

**Trade-off:** Skill content lives in conversation context rather than system instructions, so the agent sees it as "context provided for this turn" rather than "persistent instructions." This is acceptable — skills are turn-relevant and the "names" config preserves the persistent skill inventory.

**ADR:** [ADR-0001](/dev-docs/adr/0001-context-collect-hook-for-skill-injection.md)

### D2 — Pluggable embedding backend (irreversible: interface contract)

**Choice:** Abstract embedding behind a `EmbeddingBackend` interface with three implementations (local, cloud, custom).

**Rationale:** Users have diverse infrastructure. Some run everything locally (no API keys), some use cloud providers, some self-host embeddings via Infinity/Ollama in Docker. The interface is a thin abstraction — `embed(strings) → vectors` — that any backend can satisfy. The paper uses all-MiniLM-L6-v2 (384-dim), but higher-dimensional models (text-embedding-3-small: 1536-dim) may improve retrieval. The hnswlib index is dimension-agnostic.

**ADR:** [ADR-0002](/dev-docs/adr/0002-pluggable-embedding-backend-interface.md)

### D3 — SAD prompt contract (irreversible: decomposer protocol)

**Choice:** Structured JSON prompt with explicit sub-task format. Pass-1 prompt asks the decomposer to break the query into atomic sub-tasks. Pass-2 prompt adds a `hints` section listing available skill names and descriptions, instructing the model to align sub-task descriptions to the hint vocabulary.

**Rationale:** The paper's key finding: decomposition vocabulary mismatch is the primary bottleneck (36% of failures are over-decomposition, 22% vocabulary mismatch). The SAD prompt must bridge generic LLM descriptions ("download the data") to retrievable skill names ("api-client", "http-fetch"). The hint set provides this vocabulary bridge.

The prompt contract is: `{ subTasks: string[] }` — a JSON array of one-skill-per-task strings. This is intentionally minimal to keep parsing deterministic.

**ADR:** [ADR-0003](/dev-docs/adr/0003-sad-prompt-contract.md)

### D4 — Metadata-only embedding

**Choice:** Embed only `name + description`, not the full SKILL.md body.

**Rationale:** The paper shows metadata-only retrieval achieves CatR@10 of 69.0% (vs 70.3% with body-aware, a 1.3pp difference). The 99% context reduction already achieved by not dumping full bodies into the prompt. Embedding full bodies would inflate the index size and embedding cost with negligible accuracy gain for the retrieve-then-rerank pipeline.

### D5 — In-memory hnswlib, no persistence

**Choice:** Build the skill index in-memory at startup; never persist to disk. Rebuild on any skill file change.

**Rationale:** 56–200 skills × 384-dim vectors = negligible memory (<1MB). Rebuild takes <1s. Adding persistence (file I/O, serialization format, invalidation rules, format versioning) adds complexity with no practical benefit at this scale. If the plugin ecosystem grows to thousands of skills, persistence can be added later behind the same `SkillIndex` interface.

**ADR:** [ADR-0004](/dev-docs/adr/0004-in-memory-index-no-persistence.md)

### D6 — Separate decomposer model, configurable

**Choice:** The decomposition LLM call uses a separately configurable model, not the agent's primary model.

**Rationale:** Decomposition needs a model that follows structured instructions precisely (structured JSON output), not a model that's creative or conversational. A smaller, cheaper model (Qwen2.5-7B, gpt-4o-mini) does this well. This also avoids consuming the agent's rate limits and context window for the routing pass. Users can configure the decomposer model independently of their agent model, including using a different provider.

## Test strategy

### Unit tests

| Module | What's tested |
|--------|--------------|
| `SkillIndex` | Build from skill entries, search returns correct results, rebuild on fs change, empty library, deduplicated names |
| `Decomposer` | Parse valid JSON response, handle malformed JSON, handle empty/missing subTasks field, Pass-1 no hints, Pass-2 with hints |
| `Retriever` | Cosine similarity ranking, top-K truncation, dedup across sub-tasks, score threshold filtering |
| `ContextInjector` | Format skill entries → PromptContribution, empty results → empty contribution, token count estimation |
| `ConfigValidator` | Valid config passes, missing required fields, invalid backend names, invalid model names |
| `EmbeddingBackend` (×3) | Local: loads model, embeds text, correct dimensions. Cloud: sends correct API request format. Custom: handles endpoint URL and auth. |

### Integration tests

| Scenario | Verification |
|----------|-------------|
| Full pipeline (mock LLM) | Query → decompose → retrieve → inject → correct PromptContribution shape |
| All 3 embedding backends | Same skill set, same query, results within tolerance across backends |
| Hook registration | `context.collect` handler registered on `api.on()`, fires on agent run |
| Config adaptation warning | "default" skills mode → warning logged. "names"/"off" → no warning |
| Cache boundary | Skill content lands in `prependContext` (conversation), not `systemPrompt` |
| Slash commands | Verify skill commands still resolve when plugin active |
| Sub-agent propagation | Plugin does NOT fire for sub-agents (check `envelope` for sub-agent flag) |
| Error resilience | Embedding backend down → gracefully skip routing, don't crash agent run |
| Short query skip | Query ≤ `minQueryLength` → no routing, no decomposer call |

### Benchmark suite

50 compositional queries derived from WednesdayAI's bundled skill categories:
- 25 "easy" (2 skills, 2 categories)
- 15 "medium" (3 skills, 3 categories)
- 10 "hard" (4–5 skills, 4–5 categories)

Measured: CatR@10, CatR@1, DA, DA±1, latency (decompose + retrieve).
Compared: Vanilla (Pass-1 only, no hints) vs SAD (2-pass with hints).

### Edge case tests

- Empty skill library → index builds with 0 entries, search returns []
- Skill with empty description → still indexed by name
- Decomposer returns 0 sub-tasks → skip retrieval, return empty contribution
- Decomposer returns 20 sub-tasks → cap at configurable max (default 10)
- User message is a single word ("hi", "thanks") → skip routing
- User message is a URL → skip routing (not a compositional query)
- Embedding backend times out → catch, log, return empty contribution (never crash)
- Two skills with identical names from different sources → last-loaded wins, log warning
- Plugin uninstalled while index is building → clean teardown