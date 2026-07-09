---
doc_type: adr
id: 0003
workstream: plugin-skillweaver
title: "ADR-0003: SAD prompt contract and response format"
status: accepted
created: 2026-07-06
---

# ADR-0003: SAD prompt contract and response format

## Context

The Skill-Aware Decomposition (SAD) pipeline sends two prompts to the decomposer LLM:

1. **Pass 1** — decompose the query into atomic sub-tasks with no skill hints
2. **Pass 2** — re-decompose with a hint set of skill names and descriptions from Pass-1 retrieval

The prompt format and response parsing are a contract between the plugin and any decomposer model. If this format changes, decomposition quality may degrade until the new prompt is tuned.

## Decision

### Pass 1 prompt (vanilla decomposition)

```
System: You are a task decomposer. Break complex user queries into atomic sub-tasks.
Each sub-task should require exactly one skill or tool to complete.
Output a JSON object with a "subTasks" array of strings.
Do not include any other text.

User: <query>

Output format: { "subTasks": ["task 1", "task 2", ...] }
```

### Pass 2 prompt (SAD with hints)

Same system prompt, but the user message is extended:

```
User: <query>

Available skills (use these names where applicable):
- skill-name: description of what the skill does
- another-skill: another description
...

Align your sub-task descriptions to match the available skill vocabulary.
Output format: { "subTasks": ["task 1", "task 2", ...] }
```

### Response format

```json
{ "subTasks": ["string", "string", ...] }
```

Parsing: extract first JSON object from response → validate `subTasks` is an array of strings → max 10 sub-tasks → truncate if exceeded.

### Hint construction

From Pass-1 retrieval results across all sub-tasks:
1. Take the top-1 result per sub-task (most relevant skill per sub-task)
2. Deduplicate by skill name
3. Take the top `hintSize` (default 15) entries ranked by retrieval score
4. Format each hint as: `- skill-name: description`
5. If hints < 3 (very poor retrieval), include a generic fallback: "If no skill matches, describe the task in general terms."

## Rationale

### JSON-only, no markdown wrapping

The decomposer must output pure JSON. Markdown code fences (` ```json ... ``` `) are stripped before parsing. This avoids the most common parsing failure mode (model wraps JSON in markdown). Any JSON object in the response is matched by regex — the first valid `{...}` wins.

### Hint format: name + description, not raw JSON

Hints are formatted as human-readable bullet points, not a JSON array of skill objects. Rationale: the decomposer LLM is better at reading natural language than parsing nested JSON structures in a prompt. The format `- name: description` is compact (15 hints × ~75 chars = ~1,100 tokens) and readable.

### Max 10 sub-tasks

The paper's benchmark has queries with up to 5 ground-truth sub-tasks. Capping at 10 prevents runaway decomposition on simple queries while allowing reasonable headroom. The cap is configurable but defaults to 10.

### Fallback on poor retrieval

If Pass-1 retrieves <3 distinct skills (very poor retrieval, possibly for a query about a domain with no matching skills), the hint set includes a generic fallback sentence. This prevents the decomposer from hallucinating skill names that don't exist — it instructs the model to use generic descriptions instead.

### Single-iteration in V1

The paper shows DA converges after iteration 1 (51.3% → 67.0%), with CatR@1 peaking at iteration 2 (38.9%). V1 runs one iteration. Multi-iteration with Jaccard convergence monitoring is V2 scope.

## Consequences

- **Positive:** Structured, deterministic parsing. Any model that can output JSON works.
- **Positive:** Hint format is compact and human-readable — doesn't require the decomposer to parse a complex data structure.
- **Positive:** Fallback on poor retrieval prevents hallucination.
- **Negative:** Prompt quality directly impacts decomposition accuracy. Different decomposer models may need different prompt tuning. The benchmark suite should validate with 2–3 different decomposer models.
- **Negative:** JSON parsing is fragile — a model that adds explanatory text before/after the JSON object may cause parse failures. The regex extraction (`/{[\s\S]*}/`) mitigates this but isn't perfect.

## Alternatives considered

### Function/tool calling for decomposition
Register a `decompose_query` tool and let the model call it. More robust parsing (the model outputs a tool call, not raw JSON). Rejected because: (1) adds complexity — we'd need to construct a full tool-calling message, (2) not all small/cheap models support tool calling well, (3) the prompt-based approach is simpler and the paper validates it.

### XML/structured text instead of JSON
Some models (Claude) handle XML better than JSON in prompts. Rejected for V1 — JSON is universally supported and simpler to parse. If Claude models consistently fail JSON output, an XML variant can be added behind the same `Decomposer` interface.

### Embedding the hints directly (no Pass-2 prompt)
Instead of feeding hints back to the decomposer LLM, embed the hint set into the retrieval index and re-retrieve. Rejected — the paper shows SAD's gains come from the LLM aligning its vocabulary to the hint set, not from better retrieval. Retrieval-only feedback doesn't fix over-decomposition (36% of failures).