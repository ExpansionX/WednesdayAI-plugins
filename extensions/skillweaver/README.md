# @wednesdayai/skillweaver

Compositional skill routing for WednesdayAI agents. Decomposes multi-step queries, retrieves relevant skills via vector search, and injects only the matched skills into the conversation context — reducing token usage by >99% while improving routing accuracy.

Based on the SkillWeaver paper (Gao 2026, arXiv:2606.18051).

## What It Does

Without SkillWeaver, all 56+ bundled skill descriptions are dumped into the system prompt (~8K–15K tokens). SkillWeaver replaces this with an intelligent pipeline:

1. **Decompose** — Breaks complex queries into atomic sub-tasks using a small LLM
2. **Retrieve** — Matches each sub-task to relevant skills via HNSW vector search
3. **Compose** — Injects only the matched skill descriptions into the conversation context

This happens automatically via the `context.collect` hook — no system prompt modification, no cache invalidation.

## Install

Copy the plugin to your WednesdayAI extensions directory, then install and build:

```bash
cp -r extensions/skillweaver ~/.openclaw/extensions/
cd ~/.openclaw/extensions/skillweaver
npm install
npm run build
wednesdayai gateway restart --deep
```

For development:

```bash
cd extensions/skillweaver
npm install
npm run build
```

## Configuration

Add to your `openclaw.json`:

```json
{
  "plugins": {
    "skillweaver": {
      "enabled": true,
      "decomposer": {
        "provider": "openrouter",
        "model": "qwen/qwen2.5-7b-instruct"
      },
      "embedding": {
        "backend": "local"
      },
      "sad": {
        "enabled": true
      }
    }
  }
}
```

### Minimal (uses all defaults)

```json
{
  "plugins": {
    "skillweaver": {}
  }
}
```

Defaults: local embedding (all-MiniLM-L6-v2), OpenRouter decomposer, SAD enabled, top-3 retrieval.

### Optimize System Prompt (recommended)

For maximum context savings, set the skills section to `"names"` in your agent config so full descriptions aren't duplicated:

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

### Cloud Embedding (OpenAI)

```json
{
  "plugins": {
    "skillweaver": {
      "embedding": {
        "backend": "cloud",
        "cloudModel": "text-embedding-3-small",
        "cloudDimensions": 1536
      }
    }
  }
}
```

Requires `OPENAI_API_KEY` environment variable or agent provider credentials.

### Custom Embedding Endpoint

```json
{
  "plugins": {
    "skillweaver": {
      "embedding": {
        "backend": "custom",
        "endpoint": "http://localhost:8080/v1/embeddings",
        "customModel": "all-MiniLM-L6-v2",
        "customDimensions": 384
      }
    }
  }
}
```

For self-hosted embedding servers (Infinity, TEI, etc.).

### OpenAI-Compatible Decomposer

```json
{
  "plugins": {
    "skillweaver": {
      "decomposer": {
        "provider": "openai-compatible",
        "model": "local-model",
        "baseUrl": "http://localhost:11434/v1/chat/completions"
      }
    }
  }
}
```

## Configuration Reference

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `enabled` | boolean | `true` | Master on/off switch |
| `decomposer.provider` | string | `"openrouter"` | LLM provider: `openrouter`, `openai`, `anthropic`, `openai-compatible` |
| `decomposer.model` | string | `"qwen/qwen2.5-7b-instruct"` | Model for query decomposition |
| `decomposer.apiKey` | string | null | API key override (defaults to agent credentials) |
| `decomposer.baseUrl` | string | null | Base URL for `openai-compatible` provider |
| `decomposer.temperature` | number | `0.1` | Sampling temperature (0–2) |
| `decomposer.maxTokens` | number | `256` | Max tokens in decomposition response |
| `embedding.backend` | string | `"local"` | Backend: `local`, `cloud`, `custom` |
| `embedding.model` | string | `"all-MiniLM-L6-v2"` | Model for local backend |
| `embedding.cloudModel` | string | `"text-embedding-3-small"` | Model for cloud (OpenAI) backend |
| `embedding.customModel` | string | `"custom"` | Model name for custom endpoint |
| `embedding.cloudDimensions` | integer | `1536` | Vector dimensions for cloud backend |
| `embedding.customDimensions` | integer | `384` | Vector dimensions for custom backend |
| `embedding.endpoint` | string | null | URL for custom embedding endpoint |
| `embedding.apiKey` | string | null | API key for custom backend |
| `retrieval.topK` | integer | `3` | Skills returned per sub-task (1–10) |
| `retrieval.hintSize` | integer | `15` | Total hints for SAD Pass-2 (5–50) |
| `retrieval.minQueryLength` | integer | `20` | Skip routing for shorter queries |
| `retrieval.retrievalTimeoutMs` | integer | `30000` | Retrieval timeout in ms |
| `sad.enabled` | boolean | `true` | Enable 2-pass Skill-Aware Decomposition |
| `skills.dirs` | string[] | `[]` | Custom skill directories (defaults to `~/.openclaw/skills`) |

## How It Works

### Skill-Aware Decomposition (SAD)

When SAD is enabled (default), decomposition runs in two passes:

1. **Pass 1** — Decompose query into raw sub-tasks
2. **Pass 2** — Re-decompose with skill hints injected, producing skill-matched sub-tasks

This improves decomposition accuracy from ~50% to ~68%.

### Skill Discovery

Skills are discovered from:
- `~/.openclaw/skills/` (user-installed skills)
- Directories listed in `skills.dirs`
- Any directory containing `SKILL.md` files

Skills are indexed at startup and watched for changes (auto-rebuild on file changes).

### Embedding Backends

| Backend | Model | Dimensions | Latency | Privacy |
|---------|-------|------------|---------|---------|
| `local` | all-MiniLM-L6-v2 | 384 | ~100ms cold, ~1ms warm | Fully local |
| `cloud` | text-embedding-3-small | 1536 | ~200ms | Sent to OpenAI |
| `custom` | configurable | configurable | varies | Depends on endpoint |

## Troubleshooting

### Skills not being routed

1. Check `enabled: true` in config
2. Verify skill directories contain `SKILL.md` files
3. Check gateway logs for `[skillweaver]` entries
4. Ensure query length exceeds `retrieval.minQueryLength` (default 20)

### Decomposer errors

- **401/403**: Check `decomposer.apiKey` or agent provider credentials
- **429**: Rate limited — reduce request frequency or use a different provider
- **Timeout**: Increase `retrieval.retrievalTimeoutMs` or use a faster model

### Embedding issues

- **Local backend slow on first call**: Model download + initialization (~10s). Subsequent calls are instant.
- **Cloud backend errors**: Verify `OPENAI_API_KEY` is set
- **Custom backend errors**: Verify endpoint URL and that it accepts OpenAI-compatible embedding format

### High context usage

If context is still high, check:
- `sad.enabled: false` disables Pass-2 (uses Pass-1 only, fewer hints)
- Reduce `retrieval.topK` to return fewer skills per sub-task
- Reduce `retrieval.hintSize` to limit Pass-2 hint count

## Security Notes

- API keys are never logged or exposed in context contributions
- Prompt injection attacks on skill descriptions are mitigated via sanitization
- Sub-agent events are automatically skipped to prevent recursive routing
- All LLM responses are validated before use

## Development

```bash
cd extensions/skillweaver
npm install
npm test              # Run all tests
npm run typecheck     # TypeScript check
npm run build         # Build to dist/
```

254 tests, 88%+ coverage.

## Links

- [Spec](/docs/superpowers/specs/2026-07-06-plugin-skillweaver.md)
- [Implementation Plan](/docs/plans/plugin-skillweaver/plan.md)
- [ADRs](/dev-docs/adr/)
- [Workstream Tracker](/dev-docs/workstreams/plugin-skillweaver/README.md)
