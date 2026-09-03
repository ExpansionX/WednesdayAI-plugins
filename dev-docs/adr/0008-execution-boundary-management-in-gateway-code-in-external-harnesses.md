---
doc_type: adr
id: 0008
workstream: shohin
title: "ADR-0008: Management turns run in the gateway; code execution runs in external harnesses behind an executor interface"
status: accepted
created: 2026-09-03
---

# ADR-0008: Management turns run in the gateway; code execution runs in external harnesses behind an executor interface

## Context

Two kinds of model call exist in the factory. Management calls (select the next item, decide continue or abort, cluster findings, plan a workstream) are short, need the persona's memory and hooks, and benefit from gateway routing, cost capture and learning-core. Execution calls (implement a task, run tests, fix a failure) are long, need a coding harness with tools, permissions, worktrees and session resume, and benefit from provider diversity.

WednesdayAI-core already exposes what management needs: the `agent` gateway RPC and `agent.wait`, the `agent.turn` producer seam on the backbone (kinds `cron | work | heartbeat | nudge`, producible by a plugin with a manifest grant), `agent.nudge`, `runtime.signals`, and `runtime.analysis` for tool-less classification under 120 seconds. Core also exposes CLI backends (`claude -p`, `codex exec`) and the acpx ACP runtime, but those are wired to sessions and tools rather than to a plugin-callable run API.

The WAI DAG runner (`wai-dag-run.sh`) is a headless program that already spawns `claude -p` or `opencode run`, isolates workers in worktrees, runs deterministic task gates, escalates through an ordered model ladder, dispatches an assessor that returns continue, patch, retry or abort, and calls a notify command per attention item. The operator has standardised on OpenCode sub-agents for model diversity: implementers on `subagent-glm-flash` escalating to `subagent-gpt-terra` then `subagent-gpt-sol`; review panels on `subagent-opus`, `subagent-gpt-sol`, `subagent-grok`; challengers on `subagent-grok`, `subagent-kimi`, `subagent-gpt-sol`.

## Decision

1. **Management runs inside WednesdayAI.** Personas are WednesdayAI agents. The Foreman, Principal, Architect, Sentinel and Release Manager are started through `agent.turn` (the plugin manifest grants that produce topic; `agent.turn` is default-deny otherwise) or the `agent` RPC, and awaited with `agent.wait`. Cheap classification uses `runtime.analysis`. No management call goes to an external CLI. Installing the plugin does not create agents or cron jobs, so persona dispatch ships in Phase 4 with a configuration fragment and an install check. Phase 1 dispatches from an in-process `registerService` timer with no model.
2. **Code execution runs outside, behind one interface.** The factory defines `Executor { start, resume, status, cancel, events }` with a handle that records `pid`, `pgid` and the run directory. A run maps to exactly one executor invocation in a worktree owned by the supervisor. `start` returns immediately; the supervisor observes the run through `events`.
3. **The first and only Phase 1 executor is `DagRunnerExecutor`**, which launches a pinned copy of `wai-dag-run.sh` (configured path, recorded sha256) inside a systemd user scope with a runtime ceiling via `node:child_process`, with an ephemeral HOME and an allow-listed environment, never through the SDK's `runCommandWithTimeout`, which blocks until exit and kills only the direct child, and never as a bare process group, which cannot contain a child that calls `setsid`. OpenCode is the harness. The runner takes its worker ladder as model ids in `WAI_DAG_WORKER_MODELS` and passes them to `opencode run -m`; OpenCode itself accepts `--agent`, so the Phase 0 spike decides whether to pass the model ids behind the operator's sub-agents or to add an agent mode to the runner. The runner's `WAI_DAG_OPENCODE_SERVER` attach path is evaluated in the same spike. The runner's notify command appends attention items to a file in the run directory; the supervisor tails that file and the runner's run-state file as hints only, and establishes outcomes from exit status, commits on the branch and its own re-run of the deterministic task gate. No HTTP route is involved.
4. **Model tiers are plugin configuration**, a map from tier (`frontier | mid | cheap | implementer-ladder | panel | challengers`) to `provider/model` or sub-agent ids. Core has no capability tiering and none is requested.
5. **Not adopted:** the Claude Agent SDK (nobody in the ecosystem uses it and the CLI already wraps it), an MCP client in core (Shohin exposes tools natively), and a bespoke in-process coding loop (it would re-implement what OpenCode and the CLIs already do).
6. A vk-swarm node is a candidate second executor in Phase 8 because it already wraps ten harnesses with resume and log normalisation. It is added behind the same interface or not at all.

## Rationale

- Keeping management in the gateway gives every persona memory, learning-core lessons, hooks, cost capture and the same tool policy machinery as any other agent.
- Reusing the DAG runner gives Phase 1 the gates, ladder and assessor for free; rewriting them in TypeScript would be a multi-week detour with no new capability.
- One interface with one implementation is the cheapest way to keep the option of a second executor without paying for it now.
- OpenCode sub-agents provide the provider diversity the review process depends on at lower cost than the Claude CLI, and align with the operator's stated roster.

## Consequences

- Positive: no new SDK, protocol or client library is introduced.
- Positive: the executor can be swapped without touching the kernel or the personas.
- Negative: the supervisor must manage a bash process group, its environment and its worktree, and must translate the runner's notify and run-state files into normalised run events. This is the bulk of Phase 1's factory work.
- Negative: the runner resumes from its own run-state file, which lives in the worktree, and can `git reset --hard` under `--reset full`. The supervisor owns one recovery policy, fixed by the Phase 0 spike: a lost run is journalled, its scope confirmed stopped, its parent moved to `blocked`, and only a human `runs retry` resumes it, in the recorded worktree, with the chosen `--reset` mode, journalling refs before and after. A fresh worktree is never used for a retry because the runner's state and baseline would be absent. The claim token is passed into the runner's environment so its outputs can be attributed, but bash cannot be fenced by token; fencing applies at the kernel write path.
- Negative: the installed runner can drift from the reviewed source. The executor records the sha256 of the copy it ran, and the plugin configuration pins the path.
- Negative: a run executes a whole topic, not one task. The kernel models this as a parent item with one run and child items per task, updated from task-level events.
- Negative: cost for external executors is estimated from the harness's usage output, not captured by core's `model_call_ended` hook. Phase 4's dollar cap uses the estimate.
- Negative: the DAG runner's escalation ladder and the Principal persona overlap. In Phase 1 the runner's assessor stands in for the Principal; in Phase 4 the runner is configured to raise attention instead of self-assessing, and the Principal decides with board and vision context.

## Alternatives considered

- **Everything in-process via `runtime.analysis` and sub-agents.** The analysis runtime is tool-less and capped at 120 seconds; the embedded agent is not a coding harness with worktrees and permission modes.
- **Claude CLI as the only harness.** Anthropic-only, no cost accounting in core, and a known hang when settings hooks are present.
- **vk-swarm as the executor from Phase 1.** Mature but not yet daily-drivable by its own latest spec, and it brings a second store.
