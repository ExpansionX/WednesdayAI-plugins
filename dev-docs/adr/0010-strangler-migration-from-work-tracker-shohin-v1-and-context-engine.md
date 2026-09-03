---
doc_type: adr
id: 0010
workstream: shohin
title: "ADR-0010: Strangler migration with compatibility tool names; no dual-write, no big bang"
status: accepted
created: 2026-09-03
---

# ADR-0010: Strangler migration with compatibility tool names; no dual-write, no big bang

## Context

The MondayDev work-tracker is live: 11 projects, 28 features, about 460 tasks as of 2026-08-01, written by the MCP server's 23 tools, the admin v3 board, the context-engine's `commitment_promote`, and several persona heartbeats whose prompts say "work-tracker dictates all tasks". It has been dormant in development since June but is used daily. Shohin v1 is a dormant Next.js app with a Prisma schema for clients, projects, tasks, time entries and invoices, last touched 2026-01-01, deployed once to Cloud Run. The WAI plan and task files are the canonical content for specs and tasks and are consumed by scripts that expect them on disk. vk-swarm holds its own attempts and processes in SQLite.

## Decision

1. **Strangler, not big bang.** Shohin goes live beside the old systems, absorbs their callers one boundary at a time, and each old system becomes read-only at its cutover. There is never a period in which two systems accept writes for the same entity.
2. **Compatibility tool names, numbers and status semantics.** Shohin registers the 23 work-tracker tool names (`create_task`, `list_tasks`, `claim_task`, `release_task`, `generate_snapshot` and the rest) as aliases over kernel commands with the same parameter shapes and the same response envelope (`{ success, data }` or `{ success: false, error }`). Three things make that promise real rather than nominal. Ids stay integers: imported projects, features and tasks keep their original numbers through a per-table compat id map, and new ones are allocated above the imported maximum. Status semantics are mapped: `wt` statuses map onto kernel statuses (`in_progress` → `running`, `in_review` → `review`, `todo` → `ready`), and because work-tracker allows any status write from any state while the kernel does not, the alias layer walks the legal intermediate transitions inside one command and journals each hop, so `update_task status=done` from `in_progress` still succeeds. Prose outputs are pinned: `generate_snapshot` reproduces recorded golden fixtures byte for byte, including its rendering of `todo` as "Ready". Persona prompts and heartbeats do not change at cutover. Every live mcporter registration on the host is enumerated before cutover, because only two are in the repository, and every persona prompt is diffed against the real tool names, because at least one already calls names that do not exist.
3. **Import once, idempotently, at cutover.** Projects, features (as parent items), tasks, dependencies (as `blocks` links), tags (as labels), `plan_path` (as a reference), and outcome fields (as metadata) are imported with `external_id = wt:<table>:<id>`. Re-running the import updates by `external_id` and never duplicates. There is no scheduled mirror before cutover; Shohin holds no `wt` rows until the cutover step. A mirror would be the second copy that ADR 0007 forbids.

   The cutover is a runbook, rehearsed against a copy of the production database along with its rollback before it runs for real, and executed in a quiet window with heartbeats and cron digests paused. Go/no-go requires: rehearsal passed; mcporter registrations enumerated on the host; persona prompts diffed against the 23 names; the database roles used by the MCP server and by the admin v3 board identified so that write grants are revoked for both; the M3 change ready. The rollback is not a delete: heartbeats are paused, M3 is reverted first, the journal since cutover is replayed back into `wt_*` (updates to imported rows and inserts for rows created after cutover), grants are restored, mcporter is reverted, and only then are Shohin rows created by or since the import removed.
4. **Shohin v1 is archived**, not migrated. Its concepts that survive (the project → task → time entry → invoice line chain; polymorphic rate resolution by client, project or user; status plus fractional order for boards) are recorded here as the reference for Phase 8. If its Cloud SQL instance holds real rows, they are exported to CSV and attached to the Phase 8 workstream; nothing is imported automatically.
5. **Context-engine commitments join at the leaf, in the same cutover.** `commitment_promote` is changed in MondayDev to call the `create_task` alias with `idempotency_key = commitment:<uuid>` and store the returned compat id in its existing integer column. Today the promotion is one SQL transaction; after the change the task insert happens in Shohin and the commitment update in MondayDev, so the durable idempotency key is what makes a crash between the two safe to retry. That MondayDev change ships in the cutover window, before grants are revoked, because `wt_tasks` becomes read-only at cutover and promotion must not start failing. Spaces and projects remain parallel taxonomies with no edge, per MondayDev ADR-0024.
6. **WAI files stay canonical.** Shohin stores references (repository, path, commit), never copies. The Phase 2 importer turns a decomposed plan into items with `parent` and `blocks` links; the only write back to files is the task status flip that `wai-task-mark.sh` already performs.
7. **vk-swarm is not migrated.** Its data is not imported; its executor is a Phase 8 option.

## Rationale

- Live users and heartbeats depend on tool names, not on the MCP transport. Keeping names makes cutover a configuration change.
- Idempotent import by origin id is the only safe way to run a mirror before cutover and to roll back after it.
- Shohin v1 has no agents, string-typed statuses, float money, definition-only tags and custom fields, and a dead organisation layer. Reference beats migration.
- Content in git is where the gates and diff tooling live; copying it into a database would create the mirror ADR 0007 forbids.

## Consequences

- Positive: rollback at every boundary is a config revert; no old data is modified.
- Positive: MondayDev personas gain the journal, leases and approvals without prompt changes.
- Negative: the alias layer carries work-tracker's parameter quirks (`feature_id` as parent, project ids the personas have memorised, the snapshot's prose format) into Shohin's API surface. They are marked deprecated and removed one release after the admin board is retired; the integer ids themselves are permanent.
- Negative: walking intermediate transitions on behalf of an alias caller means the journal shows hops the caller never asked for. Each hop carries the alias as actor context so the audit trail stays honest.
- Negative: two boards exist between Phase 2 and Phase 3. The admin v3 board is read-only in that window.
- Negative: MondayDev must ship its own migration to rename `commitments.wt_task_id`. That is tracked in MondayDev, not here.

## Alternatives considered

- **Keep the MCP server and have Shohin call it.** Preserves a second writer and the sync problem.
- **Migrate Shohin v1's schema.** Its data model would need a rewrite before it could hold agents, actors or leases.
- **Cut over everything in one weekend.** No rollback path and no way to verify the mirror first.
