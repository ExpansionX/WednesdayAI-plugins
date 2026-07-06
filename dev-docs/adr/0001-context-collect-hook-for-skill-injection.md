---
doc_type: adr
id: 0001
workstream: plugin-skillweaver
title: "ADR-0001: Use context.collect hook for skill injection"
status: accepted
created: 2026-07-06
---

# ADR-0001: Use `context.collect` hook for skill injection

## Context

The SkillWeaver plugin must inject retrieved skill descriptions into the agent's context on each run. WednesdayAI provides two candidate hooks:

1. **`before_prompt_build`** — returns a `systemPrompt` string that *replaces* the entire system prompt. Can also return `prependContext`.

2. **`context.collect`** — returns a `PromptContribution` with `prependContext`, `appendContext`, `appendAfterUserMessage`, and other blocks that land in the *conversation* portion, not the system prompt.

## Decision

Use `context.collect` hook for skill injection. Do not use `before_prompt_build`.

## Rationale

### Cache preservation

WednesdayAI's system prompt is fully cached via:
- Anthropic: `cache_control: { type: "ephemeral" }` on the system message
- OpenAI: `prompt_cache_key` keyed on `agent+model` (not conversation)

If we inject per-query skill content into the system prompt (via `before_prompt_build`'s `systemPrompt` return), the system prompt varies per request → cache miss → full ~15K token cost instead of ~1.5K (cached read at 10%).

If we inject skill content into the conversation (via `context.collect`'s `prependContext`), the system prompt stays identical across requests → full cache hit. The conversation portion is dynamic anyway — adding 500–1500 tokens of skill descriptions has zero marginal caching penalty.

### Correct semantic placement

Skill routing is a *per-query* concern. The skills relevant to "analyze this CSV" are different from those for "deploy this Docker container." Placing skill descriptions in the system prompt (persistent, session-scoped instructions) implies they're always relevant — they're not. Placing them in the conversation context ("here are skills for *this specific query*") is semantically correct.

### Proven pattern

The `memory-lancedb` extension already uses this pattern: it reads the user message, searches a vector DB for relevant memories, and injects them as `prependContext` via `context.collect`. SkillWeaver follows the same architecture: search → inject as conversation context.

## Consequences

- **Positive:** Full system prompt cache preservation. No cache regression from enabling the plugin.
- **Positive:** Skill descriptions appear in the conversation at the right time (before the user message) and are naturally pruned by compaction like any other context.
- **Negative:** Skill content is not in the system prompt, so it's not "permanent instructions." The `skills: "names"` config preserves a lightweight index in the system prompt to compensate.
- **Negative:** The `context.collect` hook does not receive the final assembled system prompt — we can't inspect whether the user actually has `skills: "names"` set at runtime. We must check `api.config` at startup instead.

## Alternatives considered

### `before_prompt_build` with `prependContext`
This returns `prependContext` (not `systemPrompt`), which also lands in conversation. But the hook signature bundles `systemPrompt` override capability, creating a footgun risk (future maintainer uses `systemPrompt` return, breaks caching). `context.collect` has no `systemPrompt` return — it's impossible to accidentally break caching.

### `context.project` with message rewriting
Can rewrite the messages array to strip/replace skill descriptions. Too fragile — depends on exact system prompt formatting. Better to not put skill content there in the first place.

### New core hook
Would require core changes, defeating the "extension-only" constraint. The existing hooks are sufficient.