---
doc_type: workstream
status: active
id: TRK-005
workstream: plugin-skillweaver
title: "Plugin: SkillWeaver — Compositional Skill Routing for WednesdayAI"
created: 2026-07-06
updated: 2026-07-06
staging_pointers:
  spec: docs/superpowers/specs/2026-07-06-plugin-skillweaver.md
  plans: []
  tasks: []
---

# plugin-skillweaver

A WednesdayAI community plugin implementing SkillWeaver (Gao 2026) compositional skill routing: decompose complex queries, retrieve relevant skills via bi-encoder similarity, and inject only the needed skills into the agent's context.

## Status

**active** — design settled. Next: `/wai:precheck` then `/wai:decompose`.

## Quick links

- [Spec](/docs/superpowers/specs/2026-07-06-plugin-skillweaver.md)
- [ADR-0001](/dev-docs/adr/0001-context-collect-hook-for-skill-injection.md) — `context.collect` hook for skill injection
- [ADR-0002](/dev-docs/adr/0002-pluggable-embedding-backend-interface.md) — Pluggable embedding backend interface
- [ADR-0003](/dev-docs/adr/0003-sad-prompt-contract.md) — SAD prompt contract and response format

## ADRs

| ID | Title | Status |
|----|-------|--------|
| 0001 | `context.collect` hook for skill injection | accepted |
| 0002 | Pluggable embedding backend interface | accepted |
| 0003 | SAD prompt contract and response format | accepted |

## Phases

_(populated by /wai:decompose)_