---
audience: user, admin, developer
component: skillweaver
sources:
  - extensions/skillweaver/src/config.ts
  - extensions/skillweaver/src/decomposer.ts
  - extensions/skillweaver/openclaw.plugin.json
  - extensions/skillweaver/index.ts
generated: 2026-07-25
---

# SkillWeaver

**Status:** Shipped | **Plugin ID:** `skillweaver` | **Package:** `@wednesdayai/skillweaver`

## Overview

SkillWeaver is a compositional skill routing plugin for WednesdayAI. It decomposes multi-step queries into sub-tasks, retrieves relevant skills via vector search, and injects only the matched skill descriptions into the conversation context.

This replaces the default behavior of dumping all 56+ skill descriptions into the system prompt (~8K–15K tokens), reducing context consumption by >99% while improving routing accuracy.

## Quick Start

Copy the plugin to your WednesdayAI extensions directory, then install and build:

```bash
cp -r extensions/skillweaver ~/.openclaw/extensions/
cd ~/.openclaw/extensions/skillweaver
npm install
npm run build
wednesdayai gateway restart --deep
```

Enable it in your `openclaw.json`:

```json
{
  "plugins": {
    "skillweaver": {}
  }
}
```

### Optimize System Prompt (recommended)

For maximum context savings, set skills mode to `"names"` so full descriptions aren't duplicated in the system prompt:

```json
{
  "agents": {
    "defaults": {
      "systemPrompt": {
        "sections": {
          "skills": {
            "mode": "names"
          }
        }
      }
    }
  }
}
```

## Setup

### 1. Choose an Embedding Backend

| Backend | Best For | Config |
|---------|----------|--------|
| `local` (default) | Privacy, no API keys | `{ "embedding": { "backend": "local" } }` |
| `cloud` | Accuracy, speed | `{ "embedding": { "backend": "cloud" } }` + `OPENAI_API_KEY` |
| `custom` | Self-hosted | `{ "embedding": { "backend": "custom", "endpoint": "..." } }` |

### 2. Configure the Decomposer

The decomposer breaks queries into sub-tasks. By default (`provider: "gateway"`) it routes
through the gateway's own model layer via core's analysis runtime — no API keys, no separate
provider setup — using the **current session's default model**. To pin a specific model from
your core `models` config:

```json
{
  "decomposer": {
    "model": "<provider>/<model>"
  }
}
```

Supported providers: `gateway` (default), plus `openrouter`, `openai`, `anthropic`,
`openai-compatible` for direct calls (these require `decomposer.model` and an API key).

### 3. Tune Retrieval (Optional)

```json
{
  "retrieval": {
    "topK": 3,
    "minQueryLength": 20
  }
}
```

## Features

### Automatic Skill Routing

When a user sends a complex query like "download this dataset, analyze it, and email the report", SkillWeaver:

1. Decomposes into: `["download dataset", "run analysis", "send email"]`
2. Retrieves matching skills for each sub-task
3. Injects only those skill descriptions into the context

Inbound channel metadata (Conversation info / Sender blocks) is stripped before routing, so
decomposition operates on the bare user message.

### Skill-Aware Decomposition (SAD)

Two-pass decomposition for improved accuracy:
- **Pass 1**: Raw decomposition into sub-tasks
- **Pass 2**: Re-decomposition with skill hints for better matching

Enabled by default. Disable with `sad.enabled: false`.

### File Watching

Skill directories are watched for changes. When a `SKILL.md` file is added, modified, or deleted, the index rebuilds automatically (2-second debounce).

### Sub-Agent Isolation

Routing is automatically skipped for sub-agent events to prevent recursive decomposition.

## Configuration Reference

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `enabled` | boolean | `true` | Master switch |
| `decomposer.provider` | string | `"gateway"` | `gateway` routes via core's analysis runtime; direct providers also supported |
| `decomposer.model` | string \| null | `null` | Gateway: optional `<provider>/<model>` ref; `null` = session default model. Required for direct providers |
| `decomposer.maxTokens` | integer | `4096` | Output cap (50–16384); reasoning models spend thinking tokens from it first |
| `embedding.backend` | string | `"local"` | Embedding backend |
| `retrieval.topK` | integer | `3` | Skills per sub-task |
| `retrieval.minQueryLength` | integer | `20` | Min query length to route (after metadata stripping) |
| `sad.enabled` | boolean | `true` | Enable 2-pass SAD |
| `skills.dirs` | string[] | `[]` | Custom skill directories |

Full config reference: [extensions/skillweaver/README.md](/extensions/skillweaver/README.md)

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| Skills not routing | Query too short | Increase `retrieval.minQueryLength` or use longer queries |
| Slow first response | Local model loading | Normal — subsequent calls are instant |
| `decompose failed … analysis empty` | Reasoning model spent the whole token budget thinking | Raise `decomposer.maxTokens` or pin a non-reasoning model |
| Decomposer 400 (gateway) | `decomposer.model` ref not live on the model router | Verify the ref against the router, not just the core catalog |
| Decomposer 401 (direct providers) | Missing API key | Set `decomposer.apiKey` or the provider env var (`OPENROUTER_API_KEY`, …) |
| Startup warn: analysis pathway missing | Core build predates `api.runtime.analysis` | Plugin runs retrieval-only; upgrade core to restore decomposition |
| High context usage | Too many skills returned | Reduce `retrieval.topK` |

## Capabilities

| Capability | Status |
|------------|--------|
| Query decomposition | ✅ Pass-1 + Pass-2 (SAD) |
| Gateway-native LLM routing | ✅ Via core analysis runtime (`api.runtime.analysis`), session-default or pinned model, no plugin API keys |
| Vector retrieval | ✅ HNSW cosine similarity |
| Local embedding | ✅ all-MiniLM-L6-v2 via @xenova/transformers |
| Cloud embedding | ✅ OpenAI text-embedding-3-small |
| Custom embedding | ✅ Any OpenAI-compatible endpoint |
| Inbound metadata stripping | ✅ Routes on the bare user message, not the channel wrapper |
| Retrieval-only fallback | ✅ Degrades gracefully when no decomposer is available |
| File watching | ✅ Auto-rebuild on SKILL.md changes |
| Sub-agent isolation | ✅ Skips routing for sub-agent events |
| Prompt injection defense | ✅ Sanitizes skill descriptions and queries |
| Abort signal propagation | ✅ Full pipeline timeout support |

## Status & Deployment

**Current state (2026-07-25):** working in production. History of field fixes, newest first:

- **Inbound metadata stripping** (`8f556d5`): `cleanUserMessage` at `context.collect` still
  contains core's inbound metadata blocks; the handler now strips them (port of core's canonical
  `strip-inbound-meta.ts` — sentinel list must stay in sync). A core-side `rawUserText` field on
  the collect event is planned to remove this liability.
- **Reasoning-model token budget** (`32da959`): decomposer `maxTokens` default raised 256 → 4096;
  thinking tokens count against the cap, so 256 yielded empty responses.
- **Gateway-native decomposition** (`d70506f`): decomposer routes via `api.runtime.analysis`
  (session-default or config-pinned model); no hardcoded models or plugin API keys anywhere.
  Supersedes the interim env-key fallback fix (`73cbf32`).
- **v1 silent no-op** (`508d08f`): handler read `event.cleanUserMessage.text`, but pi-ai's
  `UserMessage` only carries `content`. Sub-agent guard mirrors core's `isSubagentSessionKey`
  (`19a1ead`, post adversarial review).

Contracts are verified against `WednesdayAI-core` (source of truth for hooks/extensions/
plugin-sdk); the plugin-sdk import is still a compile-time stub, so re-verify against core when
the hook contract changes.

**Deploy to a live gateway:**

```bash
cd extensions/skillweaver && npm run build
rsync -a --delete dist/ ~/.openclaw/extensions/skillweaver/dist/
rsync -a --delete src/  ~/.openclaw/extensions/skillweaver/src/
cp index.ts openclaw.plugin.json package.json README.md CHANGELOG.md ~/.openclaw/extensions/skillweaver/
systemctl --user restart openclaw-gateway.service
journalctl --user -u openclaw-gateway.service --since "-2 min" | grep skillweaver   # expect "skillweaver: registered"
```

The plugin must be listed in `plugins.allow` and enabled via `plugins.entries.skillweaver.enabled`
in `~/.openclaw/openclaw.json` (already true on the primary deployment).

## Links

- [Plugin README](/extensions/skillweaver/README.md)
- [Spec](/dev-docs/workstreams/plugin-skillweaver/spec/2026-07-06-plugin-skillweaver.md)
- [Implementation Plan](/dev-docs/workstreams/plugin-skillweaver/plans/plugin-skillweaver/plan.md)
- [ADRs](/dev-docs/adr/)
