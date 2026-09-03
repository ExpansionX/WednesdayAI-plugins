---
doc_type: adr
id: 0005
workstream: shohin
title: "ADR-0005: Shohin is an installable WednesdayAI plugin, and WednesdayAI is the host"
status: accepted
created: 2026-09-03
---

# ADR-0005: Shohin is an installable WednesdayAI plugin, and WednesdayAI is the host

## Context

Four task systems exist across the operator's repositories: WAI plan files in git (`agent-plugins`), the MondayDev work-tracker in Postgres with an MCP server and an admin board, vk-swarm's SQLite attempts with a Rust executor layer, and upstream OpenClaw's Workboard plugin. The vk-swarm umbrella spec of 2026-06-25 decided that vk-swarm is the standalone host and WednesdayAI is "a thin adapter, never the host". The operator has set that decision aside for this program and asked what enables a proper AI-driven software factory that also serves non-software work.

WednesdayAI-core's glossary (`CONTEXT.md`) already reserves *work-tracker*, *work run*, *approval-gated work* and *worker liveness*, and states that heartbeat instructions do not replace the work-tracker. Core does not implement any of them. Core does provide the substrate a control plane needs: a durable backbone work queue with claim and ack, a task pipeline with a budget governor and crash recovery, cron and idle wake-ups, the `agent` RPC and `agent.turn` producer seam for starting a persona turn, gateway method and HTTP route registration, domain storage placement, and diagnostic and agent event streams.

Two placement options exist in this repo: `extensions/` (bundled with core, versioned with core, discovered automatically) and `plugins/` (npm-installable, independently versioned through release-please, opt-in).

## Decision

1. Shohin is built as a WednesdayAI plugin. WednesdayAI is the host of the work kernel, the personas, and the run supervisor. External systems (OpenCode, Claude CLI, vk-swarm nodes) are executors reached through an interface, never peers that own state.
2. Shohin lives in `plugins/shohin/` as `@wednesdayai/shohin`, not in `extensions/`.
3. For this program, the vk-swarm "never the host" stance does not apply. vk-swarm remains a candidate executor and a source of design lessons; it is not migrated and its hive is not used.

## Rationale

- The glossary boundary already exists. Building the work-tracker as the plugin that core's own vocabulary anticipates avoids inventing a parallel model.
- Independent versioning matters more than bundling. A system meant to iterate on itself weekly cannot wait for core releases, and core's frozen-core promise should not absorb a fast-moving domain.
- Opt-in is a security property. Shohin runs subprocess executors and writes to repositories. An operator should install it deliberately.
- One process and one store. Hosting the kernel in the gateway means personas, tools, cron, the journal and the supervisor share one transaction boundary. Every alternative (vk-swarm as host, Workboard port, separate service) introduces a second store and the sync problem that vk-swarm's own analysis identified as its disease.

## Consequences

- Positive: no core changes are required for Phases 0 to 6. The plugin uses only shipped SDK surfaces.
- Positive: the MondayDev personas that already say "work-tracker dictates all tasks" get the same capability under the same name, in-process.
- Negative: the plugin must implement its own schema and migrations; core offers storage placement but no migration framework, and its default SQLite placement sits under the learning tree, so Shohin requires an explicit storage path.
- Negative: plugin-registered gateway methods cannot declare a scope today, so every `shohin.*` RPC is `operator.admin` until core gains a scope argument.
- Negative: three small core seams (plugin tab descriptor, plugin event passthrough, scope argument on plugin gateway methods) are needed before the board can live inside the console with least-privilege reads. They are scheduled as Phase 7 and each will carry its own core ADR.
- Negative: plugins cannot enqueue `agent.turn` without a manifest grant, and installing a plugin does not create agents or cron jobs. Persona-driven dispatch therefore ships in Phase 4 with an explicit configuration fragment and an install check; Phase 1 dispatches from an in-process service without a model.
- Negative: the vk-swarm umbrella spec must be amended to record that WednesdayAI hosts management for this program. That amendment is a task in Phase 0.

## Alternatives considered

- **Forward-port OpenClaw Workboard.** A complete kanban with dispatcher and UI, but it depends on five runtime APIs core lacks, executes via in-process sub-agents with no WAI gates, and ties the program to a fast-moving upstream. Its card contract is adopted (ADR 0006); its code is not.
- **vk-swarm as execution plane with WednesdayAI as management.** Reuses the most mature executor layer but forces two processes and two databases from day one. Kept as an optional executor instead.
- **Bundled extension.** Rejected for the versioning and opt-in reasons above.
