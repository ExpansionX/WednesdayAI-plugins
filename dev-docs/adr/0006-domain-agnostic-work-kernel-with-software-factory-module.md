---
doc_type: adr
id: 0006
workstream: shohin
title: "ADR-0006: Domain-agnostic work kernel; software execution is a module behind it"
status: accepted
created: 2026-09-03
---

# ADR-0006: Domain-agnostic work kernel; software execution is a module behind it

## Context

The operator uses the work-tracker for personal, consulting, R&D, ops and software work. The MondayDev it-expert, finance and health personas create ops tasks from heartbeats. The context-engine promotes conversational commitments into tasks. Software tasks additionally need runs, worktrees, gates and evidence. Shohin v1 modelled projects, tasks and time entries with no agent concept; vk-swarm modelled tasks, attempts and execution processes with no non-software concept; Workboard modelled cards with claims and dispatch but assumed an agent worker for everything.

A single model that tries to be both a life task list and an execution ledger ends up with nullable columns everywhere and a state machine nobody can enforce.

## Decision

1. The **work kernel** owns projects, work items, links, claims, approvals, notes, findings and the journal. Notes are append-only comments on an item by an actor; they carry the work-tracker `notes` field and give personas and humans a place to talk about an item without editing it. Move, merge and delete are kernel commands because eight of the compatibility aliases need them. It has no knowledge of worktrees, executors or gates. Its status set is fixed: `triage, backlog, todo, ready, running, review, blocked, done, cancelled`. Its link types are fixed: `parent, child, blocks, blocked_by, relates_to`. Its item kinds are `task, bug, feature, chore, commitment, ops, personal`. A project carries a `domain` of `general` or `software`; a software project also carries a repository reference. The kernel stores the reference as opaque data and never acts on it.
2. The **factory** module owns runs, attempts, artifacts, the executor interface, evidence and budgets. It attaches to items in projects whose `domain` is `software`, of kinds `task, bug, feature, chore`. It moves items only through kernel commands.
3. The dependency rule is one-directional: factory imports kernel; kernel never imports factory. A test enforces this.
4. The card contract borrows from upstream OpenClaw Workboard (statuses, links, claims with tokens and heartbeats, events, attempts, artifacts) and from the MondayDev work-tracker after its ADR-0005 (narrow enums, soft delete, dependencies, fractional sort order, plan path as a reference, outcome fields, idempotency keys).
5. Both modules live in one plugin package with hard directory boundaries (`src/kernel`, `src/factory`, `src/personas`, `src/ui`) until the plugin SDK offers a plugin-to-plugin call seam. Splitting into two plugins before that seam exists would force a second store.

## Rationale

- The MondayDev personas already treat the tracker as universal; the software factory is the new part, not the tracker.
- A domain-agnostic kernel is what allows Monday, the Foreman and a human to share one board without special cases.
- The one-directional dependency keeps the kernel testable in isolation and keeps the factory replaceable.
- Adopting an existing card contract avoids re-deriving nine statuses and five link types from scratch and keeps a future Workboard interop plausible.

## Consequences

- Positive: non-software items work from Phase 1 with no factory involvement.
- Positive: the factory can be disabled by config without affecting the board.
- Negative: some concepts must be expressed as item metadata rather than columns until a later phase (time entries, people, organisations).
- Negative: the single-package rule means the plugin's dependency footprint includes subprocess and git tooling even for operators who never run the factory. The factory's runtime dependencies are loaded lazily and only when `factory.enabled` is true.

## Alternatives considered

- **Separate plugins from day one.** Cleaner packaging, but with no plugin-to-plugin seam the factory would need its own store or a gateway round-trip for every write. Deferred until the seam exists.
- **Software-only tracker.** Simpler, but leaves work-tracker alive for everything else and preserves the four-silo problem.
- **Generic "custom fields" kernel.** Flexible, but Shohin v1 shows the failure mode: definitions without values, nothing enforced. Fixed kinds and statuses, extended by ADR when needed.
