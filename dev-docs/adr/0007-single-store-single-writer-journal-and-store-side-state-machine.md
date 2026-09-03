---
doc_type: adr
id: 0007
workstream: shohin
title: "ADR-0007: One store, one writer path, same-transaction journal, store-side state machine"
status: accepted
created: 2026-09-03
---

# ADR-0007: One store, one writer path, same-transaction journal, store-side state machine

## Context

Three of the four reference systems record the same class of failure.

- vk-swarm's Phase 1 analysis: "Migration churn is the symptom; the disease is multi-channel sync with no cross-entity ordering, no end-to-end ack." Its sync layer was rebuilt twice and it still runs an outbox beside five legacy paths.
- The MondayDev work-tracker enforces its dependency gate only in the web API; MCP callers bypass it. Claim TTLs are never enforced by the server; only a stale cron script reaps them, and that script uses enum values that no longer exist.
- Work-tracker has no event stream, so the board polls and no agent can react to a change.

vk-swarm's later work shows the cure: an `event_journal` appended in the same transaction as the model write, leases with fencing tokens, and single-author state transitions.

## Decision

1. **One store.** The kernel and factory tables live in one database. Placement is read through `resolveDomainStorage({ domain: "shohin" })`, but the plugin requires an explicit `storage.sqlitePath` or `storage.databaseUrl` in its config and refuses to start on the SDK's default path (which sits under the learning tree) or on `fs-jsonl`. SQLite via `node:sqlite` ships in Phase 1; Postgres via `pg` ships in Phase 2 behind the same command layer with a shared conformance suite. The plugin owns its schema and migrations.
2. **One writer path.** Every mutation goes through a command in `src/kernel/commands` or `src/factory/commands`. Tools, RPCs, CLI, importers, adapters and personas call commands. No module executes SQL against kernel tables except the command layer and read queries.
3. **Same-transaction journal.** Every command runs inside `withWriteTx(fn)`, which opens `BEGIN IMMEDIATE` on SQLite and, on Postgres, `BEGIN` on a checked-out client with `pg_advisory_xact_lock` on the item id. The command writes its state change and its `work_events` row in that transaction and stamps both with an application-generated `txn_id` UUID. The journal is append-only; the command layer has no update or delete for it.
4. **State machine enforced in SQL.** Transitions are conditional statements of the form `UPDATE work_items SET status = $to WHERE id = $id AND status IN ($legal_from)`; zero rows changed is a typed error and rolls back the transaction. The dependency gate (no `running` while a `blocked_by` link points at an item not in `done` or `cancelled`) and the approval gate are `WHERE NOT EXISTS` clauses on the same statement. `CHECK` constraints hold the enum sets. The TypeScript transition table exists only to generate these statements and to document them; it is not the enforcement point.
5. **Leases with fencing.** A claim carries a token and an expiry. Every command that mutates a claimed item includes `AND claim_token = $token AND claim_expires_at > $now` in its `UPDATE`; expired or mismatched tokens change zero rows and raise a typed error. A partial unique index on active claims and on active runs per item makes double-claim impossible under concurrency. A sweeper exists only to emit `claim.expired` events for visibility.
6. **Integer ids.** Kernel entities use integer primary keys (SQLite `INTEGER`, Postgres `BIGINT`). The work-tracker compatibility layer preserves original `wt` numbers through a per-table compat id map and allocates new compat numbers above the imported maximum, so every alias returns the integers the MondayDev personas have memorised and `commitments.wt_task_id` keeps its integer type.
7. **Durable idempotency.** Commands that accept an idempotency key persist the key and the original response in the store; a retry after restart returns that response verbatim and writes nothing. Keys expire by a configured TTL.
8. **No mirrors.** No adapter keeps a copy of kernel state, and Shohin keeps no copy of any other system's state. The work-tracker compatibility layer, the board page, the context-engine bridge and any executor read from and write to the kernel through commands and the journal. There is no scheduled import; the M1 import runs once, at cutover.

## Rationale

- One transaction boundary removes the entire class of ordering and ack problems.
- Enforcing rules where the row is written is the only place every caller passes through.
- An append-only journal gives the UI, triage, audit and crash recovery one truth to read, and makes "what happened" a query instead of a forensic exercise.

## Consequences

- Positive: the board page reads the journal by cursor and never infers state from tables.
- Positive: crash recovery is a replay of the journal against run state, not a heuristic.
- Negative: the plugin must ship migrations for two engines and test both in CI from Phase 2, with a concurrency test (two overlapping starts, one winner) on each engine.
- Negative: bulk imports are slower because they go through commands. This is accepted; the M1 import is a one-time operation of a few hundred rows.
- Negative: `node:sqlite` is synchronous and runs on the gateway event loop. Write transactions must stay small; the supervisor batches run events before writing them.
- Negative: `txn_id` is an application id, not a database transaction id. The tests assert that all rows sharing a `txn_id` were written by one `withWriteTx` call.

## Alternatives considered

- **Core's `task_runs` tables as the store.** They model executions of registered passes, not user-facing items, and core's own docs say core does not own the work-tracker.
- **Event sourcing with projections.** Stronger, but a second concept to maintain. The journal is a log beside a current-state table, which is what vk-swarm converged on.
- **Trust callers to respect the state machine.** This is what work-tracker did.
