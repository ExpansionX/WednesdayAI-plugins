---
audience: user, admin, developer
component: skillweaver
sources:
  - extensions/skillweaver/package.json
  - extensions/skillweaver/openclaw.plugin.json
  - extensions/skillweaver/src/config.ts
  - extensions/skillweaver/src/decomposer.ts
  - extensions/skillweaver/src/handler.ts
  - extensions/skillweaver/src/strip-inbound-meta.ts
  - extensions/skillweaver/index.ts
generated: 2026-07-25
---

# @wednesdayai/skillweaver

Compositional skill routing for WednesdayAI agents (v0.1.0). Decomposes multi-step queries,
retrieves relevant skills via vector search, and injects only the matched skills into the
conversation context — reducing token usage by >99% while improving routing accuracy.

Based on the SkillWeaver paper (Gao 2026, arXiv:2606.18051). Requires Node >= 24.

## For Users

### What It Does

Without SkillWeaver, all 56+ bundled skill descriptions are dumped into the system prompt
(~8K–15K tokens). SkillWeaver replaces this with an intelligent pipeline:

1. **Decompose** — Breaks complex queries into atomic sub-tasks using an LLM routed through the
   gateway's own model layer (no separate API keys needed)
2. **Retrieve** — Matches each sub-task to relevant skills via HNSW vector search
3. **Compose** — Injects only the matched skill descriptions into the conversation context

This happens automatically via the `context.collect` hook — no system prompt modification, no
cache invalidation. Inbound channel metadata (Conversation info / Sender blocks) is stripped
before routing, so decomposition operates on what you actually typed.

### Configuration

Add to your `openclaw.json`:

```json
{
  "plugins": {
    "skillweaver": {
      "enabled": true,
      "decomposer": {
        "provider": "gateway"
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

#### Minimal (uses all defaults)

```json
{
  "plugins": {
    "skillweaver": {}
  }
}
```

Defaults: local embedding (all-MiniLM-L6-v2), gateway decomposer using the current session's
default model, SAD enabled, top-3 retrieval.

#### Decomposer model selection

With the default `"gateway"` provider, decomposition routes through core's analysis runtime
(`api.runtime.analysis`) using the gateway's configured models and credentials:

- `decomposer.model` unset (`null`) — uses the **session default model** (the model the current
  agent is configured to use).
- `decomposer.model: "<provider>/<model>"` — pins a specific model from your core `models`
  config (a bare model name resolves against the default provider). Useful for pointing
  decomposition at a cheap/local tier.

```json
{
  "plugins": {
    "skillweaver": {
      "decomposer": {
        "model": "<provider>/<model>"
      }
    }
  }
}
```

Direct providers (`openrouter`, `openai`, `anthropic`, `openai-compatible`) remain available as
an escape hatch; they require `decomposer.model` and an API key — via `decomposer.apiKey` or the
provider's environment variable (`OPENROUTER_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`).

#### Optimize System Prompt (recommended)

For maximum context savings, set the skills section to `"names"` in your agent config so full
descriptions aren't duplicated:

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

#### Cloud Embedding (OpenAI)

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

#### Custom Embedding Endpoint

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

#### OpenAI-Compatible Decomposer (direct)

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

### Configuration Reference

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `enabled` | boolean | `true` | Master on/off switch |
| `decomposer.provider` | string | `"gateway"` | `gateway` routes via the core analysis runtime (no plugin API keys needed); or `openrouter`, `openai`, `anthropic`, `openai-compatible` for direct calls |
| `decomposer.model` | string \| null | `null` | With `gateway`: an optional `<provider>/<model>` or bare-model ref resolved by core config; `null` uses the session default model. Required for non-gateway providers |
| `decomposer.apiKey` | string | null | API key override for direct providers (falls back to the provider's env var) |
| `decomposer.baseUrl` | string | null | Base URL for `openai-compatible` provider |
| `decomposer.temperature` | number | `0.1` | Sampling temperature (0–2) |
| `decomposer.maxTokens` | number | `4096` | Max output tokens (50–16384). A cap, not a target — reasoning models spend thinking tokens from this budget before emitting content |
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
| `retrieval.minQueryLength` | integer | `20` | Skip routing for shorter queries (measured after metadata stripping) |
| `retrieval.retrievalTimeoutMs` | integer | `30000` | Retrieval timeout in ms (also the gateway analysis run timeout) |
| `sad.enabled` | boolean | `true` | Enable 2-pass Skill-Aware Decomposition |
| `skills.dirs` | string[] | `[]` | Custom skill directories (defaults to `~/.openclaw/skills`) |

### How It Works

#### Skill-Aware Decomposition (SAD)

When SAD is enabled (default), decomposition runs in two passes:

1. **Pass 1** — Decompose query into raw sub-tasks
2. **Pass 2** — Re-decompose with skill hints injected, producing skill-matched sub-tasks

This improves decomposition accuracy from ~50% to ~68%.

#### Skill Discovery

Skills are discovered from:
- `~/.openclaw/skills/` (user-installed skills)
- Directories listed in `skills.dirs`
- Any directory containing `SKILL.md` files

Skills are indexed at startup and watched for changes (auto-rebuild on file changes).

#### Embedding Backends

| Backend | Model | Dimensions | Latency | Privacy |
|---------|-------|------------|---------|---------|
| `local` | all-MiniLM-L6-v2 | 384 | ~100ms cold, ~1ms warm | Fully local |
| `cloud` | text-embedding-3-small | 1536 | ~200ms | Sent to OpenAI |
| `custom` | configurable | configurable | varies | Depends on endpoint |

### Troubleshooting

#### Skills not being routed

1. Check `enabled: true` in config
2. Verify skill directories contain `SKILL.md` files
3. Check gateway logs for `[skillweaver]` entries
4. Ensure query length exceeds `retrieval.minQueryLength` (default 20) — length is measured on
   the bare message text, after inbound metadata is stripped

#### Decomposer errors

- **`analysis empty`** (gateway provider): the model produced no content — usually a reasoning
  model whose thinking exhausted `decomposer.maxTokens`. Raise `decomposer.maxTokens`, or pin
  `decomposer.model` to a non-reasoning tier
- **400 from gateway provider**: the `decomposer.model` ref isn't recognised by your model
  router — verify it exists in the live provider, not just in the core catalog
- **401/403** (direct providers): set `decomposer.apiKey` or the provider's env var
  (`OPENROUTER_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`)
- **429**: Rate limited — reduce request frequency or use a different provider
- **Timeout**: Increase `retrieval.retrievalTimeoutMs` or use a faster model

Decomposer failures degrade gracefully: no skill context is injected for that turn and a single
warning is logged.

#### Embedding issues

- **Local backend slow on first call**: Model download + initialization (~10s). Subsequent calls are instant.
- **Cloud backend errors**: Verify `OPENAI_API_KEY` is set
- **Custom backend errors**: Verify endpoint URL and that it accepts OpenAI-compatible embedding format

#### High context usage

If context is still high, check:
- `sad.enabled: false` disables Pass-2 (uses Pass-1 only, fewer hints)
- Reduce `retrieval.topK` to return fewer skills per sub-task
- Reduce `retrieval.hintSize` to limit Pass-2 hint count

### Security Notes

- API keys are never logged or exposed in context contributions
- Prompt injection attacks on skill descriptions are mitigated via sanitization
- Inbound channel metadata (untrusted) is stripped before the message text reaches the decomposer
- Sub-agent events are automatically skipped to prevent recursive routing
- All LLM responses are validated before use

#### npm audit warnings

`hnswlib-node` and `@xenova/transformers` pull in native addon build tooling (prebuild-install,
node-gyp) that npm audit flags. These are transitive build-time dependencies, not runtime attack
surface, and cannot be resolved by `npm audit fix`. If native dependency auditing is a concern,
use `backend: "cloud"` or `backend: "custom"` to avoid loading the local embedding backend.

## For Administrators

### Install

Copy the plugin to your WednesdayAI extensions directory, then install and build:

```bash
cp -r extensions/skillweaver ~/.openclaw/extensions/
cd ~/.openclaw/extensions/skillweaver
npm install
npm run build
wednesdayai gateway restart --deep
```

The plugin must be listed in `plugins.allow` and enabled via
`plugins.entries.skillweaver.enabled` in `~/.openclaw/openclaw.json`.

### Deploy an updated build to a live gateway

```bash
cd extensions/skillweaver && npm run build
rsync -a --delete dist/ ~/.openclaw/extensions/skillweaver/dist/
rsync -a --delete src/  ~/.openclaw/extensions/skillweaver/src/
cp index.ts openclaw.plugin.json package.json README.md ~/.openclaw/extensions/skillweaver/
systemctl --user restart openclaw-gateway.service
journalctl --user -u openclaw-gateway.service --since "-2 min" | grep skillweaver
```

Expect `skillweaver: registered` in the journal. A startup warning about a missing analysis
pathway or API key means decomposition is degraded (retrieval-only) — see Troubleshooting.

### Credentials

With the default `gateway` provider, no plugin-side credentials are required — LLM calls use the
gateway's own model configuration. Direct providers read `decomposer.apiKey` from plugin config
or the provider env var (`OPENROUTER_API_KEY` / `OPENAI_API_KEY` / `ANTHROPIC_API_KEY`) from the
gateway process environment (e.g. a systemd drop-in).

### Observability

All log lines are tagged `[skillweaver]` / `[skillweaver/decomposer]` / `[skillweaver/handler]`.
Healthy routing logs `routing complete` with sub-task and match counts. Decomposer failures log a
single `decompose failed` warning per affected turn and the turn proceeds without skill context.

## For Developers

### Development

```bash
cd extensions/skillweaver
npm install
npm test              # Run all tests
npm run typecheck     # TypeScript check
npm run build         # Build to dist/
```

299 tests. Note: the `wednesdayai/plugin-sdk` import is a compile-time stub — the handler
contract is verified against `WednesdayAI-core` (`src/plugins/types.ts`), which is the source of
truth for hooks, extensions, and the plugin-sdk.

### Architecture notes

- **Gateway decomposition path** (`src/decomposer.ts`): with provider `"gateway"`, decomposition
  calls core's analysis runtime (`api.runtime.analysis.run`) with `responseFormat: "json"` and
  the handler's `sessionKey`, so model resolution follows core's `parseModelRef` /
  session-default semantics. Direct providers use raw `fetch` with per-provider request shapes.
- **Graceful degradation** (`index.ts`, `src/handler.ts`): if the core runtime does not expose
  the analysis pathway, the handler runs retrieval-only — the raw query becomes the single
  sub-task. A `Decomposer` is never constructed without a model (direct) or analysis runtime
  (gateway); both throw at construction.
- **Inbound metadata stripping** (`src/strip-inbound-meta.ts`): `cleanUserMessage` at
  `context.collect` is only clean of the session envelope — core bakes inbound metadata blocks
  into stored message content upstream. The stripper is ported from core's canonical
  `src/auto-reply/reply/strip-inbound-meta.ts`; **its sentinel list must stay in sync with
  core's `buildInboundUserContextPrefix`**. Planned: core exposing a raw pre-mutation
  `rawUserText` on the collect event will demote this to a legacy fallback.
- **No hardcoded models**: shipped code, manifest, and docs carry no model or provider-specific
  names; model selection is config-resolved (test fixtures use `"test-model"`).

## Links

- [Topic doc](/docs/skillweaver.md)
- [Spec](/dev-docs/workstreams/plugin-skillweaver/spec/2026-07-06-plugin-skillweaver.md)
- [Implementation Plan](/dev-docs/workstreams/plugin-skillweaver/plans/plugin-skillweaver/plan.md)
- [ADRs](/dev-docs/adr/)
- [Workstream Tracker](/dev-docs/workstreams/plugin-skillweaver/README.md)
