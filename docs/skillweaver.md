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

The decomposer breaks queries into sub-tasks. Default uses OpenRouter with a small model:

```json
{
  "decomposer": {
    "provider": "openrouter",
    "model": "qwen/qwen2.5-7b-instruct"
  }
}
```

Supported providers: `openrouter`, `openai`, `anthropic`, `openai-compatible`.

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
| `decomposer.provider` | string | `"openrouter"` | LLM provider |
| `decomposer.model` | string | `"qwen/qwen2.5-7b-instruct"` | Decomposition model |
| `embedding.backend` | string | `"local"` | Embedding backend |
| `retrieval.topK` | integer | `3` | Skills per sub-task |
| `retrieval.minQueryLength` | integer | `20` | Min query length to route |
| `sad.enabled` | boolean | `true` | Enable 2-pass SAD |
| `skills.dirs` | string[] | `[]` | Custom skill directories |

Full config reference: [extensions/skillweaver/README.md](/extensions/skillweaver/README.md)

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| Skills not routing | Query too short | Increase `retrieval.minQueryLength` or use longer queries |
| Slow first response | Local model loading | Normal — subsequent calls are instant |
| Decomposer 401 | Missing API key | Set `decomposer.apiKey` or agent provider credentials |
| High context usage | Too many skills returned | Reduce `retrieval.topK` |

## Capabilities

| Capability | Status |
|------------|--------|
| Query decomposition | ✅ Pass-1 + Pass-2 (SAD) |
| Vector retrieval | ✅ HNSW cosine similarity |
| Local embedding | ✅ all-MiniLM-L6-v2 via @xenova/transformers |
| Cloud embedding | ✅ OpenAI text-embedding-3-small |
| Custom embedding | ✅ Any OpenAI-compatible endpoint |
| File watching | ✅ Auto-rebuild on SKILL.md changes |
| Sub-agent isolation | ✅ Skips routing for sub-agent events |
| Prompt injection defense | ✅ Sanitizes skill descriptions and queries |
| Abort signal propagation | ✅ Full pipeline timeout support |

## Links

- [Plugin README](/extensions/skillweaver/README.md)
- [Spec](/dev-docs/workstreams/plugin-skillweaver/spec/2026-07-06-plugin-skillweaver.md)
- [Implementation Plan](/dev-docs/workstreams/plugin-skillweaver/plans/plugin-skillweaver/plan.md)
- [ADRs](/dev-docs/adr/)