---
doc_type: program
workstream: shohin
title: "Shohin program plan — phases, migration boundaries, security controls, acceptance criteria"
status: draft
created: 2026-09-03
updated: 2026-09-03
authors: [David Rudduck, claude-fable-5-1]
adrs: [0005, 0006, 0007, 0008, 0009, 0010, 0011]
review: "challenger round 1 applied 2026-09-03: grok (architecture), gpt-sol (security), kimi (migration and operations)"
---

# Shohin program plan

This is the umbrella. Each phase below becomes one WAI workstream (`/wai:prd-new <phase-slug>` → `/wai:spec` → `/wai:precheck` → `/wai:decompose` → `/wai:execute` or `/wai:dag`). The umbrella names phases, their order, their acceptance criteria and the decisions they rest on. It does not design them; that is each phase's spec.

Decisions are recorded as ADRs in `/dev-docs/adr/`:

| ADR | Decision |
|---|---|
| [0005](../../../dev-docs/adr/0005-shohin-is-a-wednesdayai-plugin-and-wednesdayai-is-the-host.md) | Shohin is an installable WednesdayAI plugin; WednesdayAI is the host |
| [0006](../../../dev-docs/adr/0006-domain-agnostic-work-kernel-with-software-factory-module.md) | Domain-agnostic work kernel; software execution is a module behind it |
| [0007](../../../dev-docs/adr/0007-single-store-single-writer-journal-and-store-side-state-machine.md) | One store, one writer path, same-transaction journal, state machine enforced in SQL, integer ids |
| [0008](../../../dev-docs/adr/0008-execution-boundary-management-in-gateway-code-in-external-harnesses.md) | Management turns in the gateway; code execution in OS-scoped external harnesses via an executor interface |
| [0009](../../../dev-docs/adr/0009-plugin-served-board-page-before-console-tab.md) | Plugin-served board page first; console tab via three core seams later |
| [0010](../../../dev-docs/adr/0010-strangler-migration-from-work-tracker-shohin-v1-and-context-engine.md) | Strangler migration with compatibility tool names and preserved numeric ids; single rehearsed cutover |
| [0011](../../../dev-docs/adr/0011-security-model-approval-gated-work-actors-leases-budgets.md) | Security model: manifest-bound approvals, boundary-derived actors, executor isolation, untrusted executor output, budgets, kill switch |

## 1. Phases

| # | Phase | Produces | Depends on | Built by |
|---|---|---|---|---|
| 0 | Spike | a throwaway proof that a plugin service can run the WAI DAG runner inside an OS-enforced scope, on OpenCode with the model ladder, observe attention and terminal state, cancel it, and survive a gateway restart | nothing | hand |
| 1 | Vertical slice | walking skeleton on SQLite: kernel-minimum with approvals, factory-minimum with one executor and supervisor-verified evidence, an in-process dispatcher (no model), read-only CLI plus the three write commands the criteria need | 0 | hand |
| 2 | Kernel completeness and cutover | full card contract including notes, move, merge, delete; findings; compat ids and the 23 aliases with a status map and durable idempotency; Postgres engine with a shared conformance suite; notify hook; retention; the M1 and M3 cutover with rehearsal and rollback | 1 | board, every item approval-gated |
| 3 | Visibility | plugin-served board page: board, item detail, run log tail, attention inbox, chat into persona; cursor-polled journal | 1 | board |
| 4 | Personas, escalation and manifest re-approval | Foreman and Principal as agents with `agent.turn` grant; attention routing; execution manifests with re-approval on scope change; dollar caps; patch and resume; Release Manager with policy-gated push and PR | 1, 2 | board |
| 5 | Planning surface | Architect persona; prd-new, spec and decompose from chat; decomposed plans land as items automatically | 2, 4 | board; from here planning also happens on the board |
| 6 | Triage pipeline | Sentinel persona; diagnostic events, log transport, CI and GitHub issues as findings; clustering, promotion, bundling | 2, 4 | board |
| 7 | Core seams and console tab | in core: plugin tab descriptor, plugin event passthrough, scope argument on plugin gateway methods; in Shohin: board moves into the console, read RPCs drop to `operator.read` | 3 | board, with approval on every core item |
| 8 | Modules | people and organisations, time entries, context bridge extras; container executor with egress control; second executor (vk-swarm node) if still wanted | 2, 4 | board |

Phases 3 and 4 may run in parallel after Phase 2. Phase 7 is the first workstream that touches WednesdayAI-core.

"Built by board" means the phase's decomposed tasks are imported as items and executed by the dispatcher through the factory. Because approvals exist from Phase 1 and every software item defaults to `approval_required` until the Phase 2 project policy narrows it, every board-built item from Phase 2 onward carries a human approval before its run starts. Planning for Phases 2 to 4 still happens between the human and the Architect in the CLI.

## 2. Phase 0: spike

**Question.** Can a WednesdayAI plugin service run `wai-dag-run.sh` inside an OS-enforced scope against a small, fully prepared topic in a worktree, with OpenCode as the harness and the operator's model ladder, with an ephemeral HOME, and then observe attention and terminal state, cancel it cleanly, and recover after a gateway restart?

**Probe.**

1. A throwaway plugin registers a service that launches the runner through `systemd-run --user --scope --property=RuntimeMaxSec=<ceiling>` from `node:child_process`, so the whole run, including OpenCode grandchildren and anything that calls `setsid`, lives in one transient cgroup that `systemctl --user kill` can stop. If the systemd user session is unavailable, record it and fall back to a detached process group for the spike only.
2. The environment is an allow-list: `PATH`, an ephemeral `HOME` created for the run containing only the harness's own auth and config copied in, `WAI_DAG_OPENCODE`, `WAI_DAG_WORKER_MODELS` (model ids), `WAI_DAG_NOTIFY_CMD`, `WAI_DAG_WORKERS`, and the runner's timeout variables. No gateway token, no operator git credential helper, no SSH agent socket, no `gh` state.
3. `WAI_DAG_NOTIFY_CMD` points at a script that appends its three arguments (topic, task id, `kind: reason`) as JSON lines to `<run-dir>/attention.jsonl`. The service tails that file and `docs/plans/<topic>/.wai-run-state.json` as hints only, and reads exit status and the branch's commits as truth.
4. Target topic: a two-task plan in this repo, prepared by hand through `/wai:prd-new`, `/wai:spec`, `/wai:precheck` and `/wai:decompose`, with the precheck token committed, so plan lint passes without `WAI_DAG_TEST_MODE`.
5. Cancel mid-run by stopping the scope; confirm no OpenCode grandchildren survive and no commit lands after the stop.
6. Kill the gateway mid-run; observe whether `RuntimeMaxSec` and a supervisor-heartbeat watchdog wrapper stop the run without the gateway; restart the gateway; exercise `wai-dag-run.sh --reset` in the same worktree and record exactly what it discards versus `--reset full`.
7. Force lane-worktree creation to fail and confirm whether the runner falls back to the shared tree; if it does, identify the environment or patch that makes it fail closed.

**Exit.** A written answer to each of:

- Is a systemd user scope available on the target hosts, and does it contain everything the runner spawns? What is the fallback and its residual risk?
- Does OpenCode authenticate and run with an ephemeral HOME holding only copied auth? Which files must be copied?
- Does the runner reach OpenCode sub-agents (`--agent`) or only model ids (`-m`)? Does `WAI_DAG_OPENCODE_SERVER` attachment matter for cost or latency?
- Are the notify file and run-state file sufficient hints, and what is the authoritative signal set (exit status, gate outputs, commits on the branch)?
- What the runner needs from the environment: binaries, auth, `flock`, GNU `timeout`, a feature branch, a committed precheck token; and the sha256 of the runner version the spike used.
- The exact recovery policy for a run whose supervisor died: which `--reset` mode, in which worktree, what it destroys, and how the new run is refused until the old scope is confirmed stopped.
- Wall-clock and cost for one task on the ladder, counting validator and assessor calls.

**Acceptance.** The spike report exists, answers every question with evidence, and names the executor adapter contract Phase 1 will implement. Anything built is deleted.

## 3. Phase 1: vertical slice

The smallest end-to-end path that proves the kernel and the factory can drive the DAG runner, record what happened, and refuse what must be refused. It exercises principles 1 to 8 and 10 from VISION.md. It does not exercise principle 9 (review panels are the runner's, not yet the Principal's) or persona dispatch.

### Scenario

1. The operator has a decomposed topic in a target repository, prepared through the WAI flow by hand: spec, committed precheck token, `docs/plans/<topic>/plan.md`, phase files and task files with `depends_on` frontmatter, on a feature branch. The project row for that repository has `domain: software` and a registered canonical repository root.
2. The operator runs `wednesdayai shohin plans import <project> <topic>`. The CLI calls the gateway RPC with the operator's token; the actor is derived at the gateway boundary. `importPlan` validates the topic slug, resolves every referenced file as a git blob at the branch head, creates one parent item (`kind: feature`, `approval_required: true`) referencing the plan at that commit, one child item per task file, `parent` and `child` links, and `blocks` links from `depends_on`. Children whose dependencies are met are `ready`; the parent is `ready` but unapprovable until step 3.
3. The operator runs `wednesdayai shohin approvals grant <parent-id>`. The kernel records a `work_approvals` row bound to the item and to the manifest hash computed at import (repository, base commit, branch, spec sha, task-tree hash, budget). Approval decisions are `operator.admin` RPCs; no tool path exists for them.
4. The dispatcher service ticks. It calls `next`, receives the parent, and calls `startRun`. The claim command's `UPDATE` succeeds only if a granted approval exists for the current manifest hash, no active run exists for the item, and the supervisor holds the store's supervisor lease. The kernel records the claim with a token and a lease, creates a `work_runs` row carrying the manifest hash, worktree path, branch, baseline commit and runner sha256, and emits `run.started`, all in one write transaction.
5. The supervisor creates a worktree under the plugin's `0700` run directory on the feature branch, verifies the checked-out tree hash equals the manifest's task-tree hash and that the precheck token is committed at the base commit, writes the allow-listed environment and ephemeral HOME, and launches `DagRunnerExecutor` in a systemd user scope with a runtime ceiling. The scope unit name and the runner's pid plus start time are stored on the run.
6. The runner executes the topic. The supervisor tails `attention.jsonl` and `.wai-run-state.json` as hints, records them as `work_run_events` tagged `source: executor`, and heartbeats the lease while the scope is alive. Child items move only on supervisor-verified evidence: a task is `review` when a commit for it exists on the branch and the supervisor's own re-run of `task-gate.sh --commit <sha>` passes; `blocked` when the runner exits with that task unfinished or an attention item names it and no verified commit follows.
7. The runner exits. The supervisor derives the outcome from exit status, verified commits and gate results, writes the evidence bundle (branch, head commit, per-task gate output, run log path, run-state snapshot, runner sha256) as `work_artifacts`, finishes the run `succeeded` or `failed`, and the kernel moves the parent to `review` or `blocked` and releases the claim.
8. The operator runs `wednesdayai shohin runs show <run-id>` and `wednesdayai shohin items tree <parent-id>` and sees the run, the evidence, the children and the journal.

Chat-created items, notifications and persona-driven dispatch are absent from Phase 1 by design; they are Phases 2, 4 and 5.

### Components built

| Module | Contents |
|---|---|
| `src/kernel/store` | SQLite via `node:sqlite`; tables `work_projects`, `work_items`, `work_links`, `work_claims`, `work_approvals`, `work_events`, `supervisor_lease`; integer primary keys; migrations; explicit `storage.sqlitePath` config required, `fs-jsonl` refused at startup, the SDK default path never used |
| `src/kernel/tx` | `withWriteTx(fn)`: `BEGIN IMMEDIATE` on SQLite; application-generated `txn_id` UUID stamped on every row written in the transaction |
| `src/kernel/commands` | `createProject`, `createItem`, `link`, `transition`, `claim`, `heartbeat`, `release`, `next`, `importPlan`, `grantApproval`, `revokeApproval`; every command takes an actor derived at a boundary and writes its journal event in the same transaction; transitions, claims and approvals are conditional `UPDATE ... WHERE` statements whose row count is the verdict |
| `src/kernel/actors` | actor derivation for the three Phase 1 boundaries: gateway RPC (client id and scope), agent tool (turn identity), supervisor (run id); nothing accepts a caller-supplied actor |
| `src/kernel/paths` | topic slug validation; registered canonical repository roots; `realpath` containment with symlink rejection; git blob resolution at a commit |
| `src/kernel/tools` | `work_item_create`, `work_item_get`, `work_item_list`, `work_item_move`, `work_next` |
| `src/kernel/rpc` | `shohin.items.list`, `shohin.items.get`, `shohin.items.move`, `shohin.runs.list`, `shohin.runs.get`, `shohin.runs.cancel`, `shohin.runs.retry`, `shohin.approvals.grant`, `shohin.plans.import`, `shohin.events.tail` (cursor poll: `{ cursor, limit } → { events, cursor }`); all `operator.admin` until the Phase 7 scope seam |
| `src/factory/store` | tables `work_runs`, `work_run_events`, `work_artifacts`; partial unique index on active runs per item |
| `src/factory/manifest` | `RunManifest` computation and hashing at import; verification at run start |
| `src/factory/executor` | the `Executor` interface and `DagRunnerExecutor`, pinned to a configured runner path with a recorded sha256 |
| `src/factory/supervisor` | supervisor lease acquisition, worktree lifecycle in a `0700` run directory, ephemeral HOME, environment allow-list, systemd scope launch with runtime ceiling, heartbeat watchdog file, hint-file tailing, lease heartbeats, cancellation by scope, boot-time recovery sweep, redaction before persistence |
| `src/factory/verify` | supervisor-side truth: exit status, commit enumeration on the branch, `task-gate.sh --commit` re-run per task, precheck token presence at base commit, manifest hash equality |
| `src/factory/commands` | `startRun`, `cancelRun`, `markLost`, `retryRun`, `finishRun` |
| `src/factory/dispatcher` | a `registerService` timer: `next` → `startRun`, one run at a time, honours `shohin.paused` and the operator-activity lease; never retries a `blocked` item on its own |
| `src/cli` | `wednesdayai shohin projects|items|runs|events|plans|approvals`; all commands go through gateway RPCs with the operator token, never direct to the store |

### Interfaces frozen by this phase

```ts
type Actor = { kind: "human" | "persona" | "executor" | "adapter"; id: string; sessionKey?: string; runId?: string };

type WorkItemStatus = "triage" | "backlog" | "todo" | "ready" | "running" | "review" | "blocked" | "done" | "cancelled";

type WorkEvent = { id: number; txnId: string; at: number; actor: Actor; entity: "project" | "item" | "link" | "claim" | "approval" | "run"; entityId: number; type: string; source: "kernel" | "supervisor" | "executor"; payload: unknown };

type RunManifest = { repoRoot: string; baseCommit: string; branch: string; specSha: string; taskTreeHash: string; fileAllowList: string[]; budget: RunBudget; sideEffectClass: "repo-only" | "external" };

interface Executor {
  id: string;
  version: { path: string; sha256: string };
  start(input: { run: WorkRun; manifest: RunManifest; worktree: string; home: string; env: Record<string, string>; claimToken: string }): Promise<ExecutorHandle>;   // returns immediately
  resume(input: { run: WorkRun; handle: ExecutorHandle }): Promise<ExecutorHandle>;
  status(handle: ExecutorHandle): Promise<"running" | "exited" | "unknown">;
  cancel(handle: ExecutorHandle, reason: string): Promise<void>;                        // stops the scope
  events(handle: ExecutorHandle): AsyncIterable<RunEvent>;                              // hints: log | task | attention | terminal
}
type ExecutorHandle = { runId: number; scopeUnit: string; pid: number; pidStartTime: number; runDir: string; startedAt: number };
```

The journal event envelope, the `Actor` type, the status set, the `RunManifest` and the `Executor` interface are the five things later phases must not break.

### Recovery policy

- Exactly one supervisor may own a store. The supervisor acquires `supervisor_lease` by conditional update with a fencing generation and renews it; run events, heartbeats and cancellations from a supervisor that does not hold the current generation are rejected by the store.
- On boot, the supervisor lists `work_runs` in `running`. For each, it checks the scope unit and the recorded pid plus start time. If the scope is active and the identity matches, it re-attaches via `resume` and continues. Otherwise it marks the run `lost` with a `run.lost` event, releases the claim, and moves the parent to `blocked`, never back to `ready`. The dispatcher never restarts a `blocked` item; a human runs `runs retry`, which resumes in the recorded worktree with the `--reset` mode the spike selected and journals the refs before and after.
- A new `startRun` for an item is refused while any run for that item is `running` or has an unconfirmed scope, by the partial unique index and the identity check, not by item status.
- Every run carries an attempt number; `retryRun` beyond the configured maximum requires a fresh approval.

### Acceptance criteria

- AC1. The scenario runs end to end on a clean gateway with SQLite storage, driven only by `plans import`, `approvals grant` and the dispatcher timer.
- AC2. Every row in `work_items`, `work_claims`, `work_approvals` and `work_runs` has an actor derived at a boundary, and every state change has a journal event carrying the same `txn_id`. A test that passes a caller-supplied actor through any RPC or tool is rejected.
- AC3. An illegal transition (for example `todo` → `done`) is rejected with a typed error from the `work_item_move` tool and from `items move`, and the rejection leaves no journal event.
- AC4. Killing the gateway mid-run and restarting produces exactly one `run.lost` event, moves the parent to `blocked`, and refuses a new run until the old scope is confirmed stopped. The dispatcher does not restart it.
- AC5. `runs cancel` stops the scope, including OpenCode grandchildren and a child that called `setsid`, within 10 seconds, and records `cancelled` with the actor.
- AC6. Two overlapping `startRun` calls for the same item produce one run and one typed rejection, verified by a concurrency test.
- AC7. A command carrying an expired or mismatched claim token, or a supervisor generation that is not current, is rejected before any write.
- AC8. `startRun` against an item whose `approval_required` is true and whose current manifest hash has no granted approval is refused; changing the task tree after approval changes the hash and the refusal recurs.
- AC9. A forged line appended to `attention.jsonl` or an edited `.wai-run-state.json` claiming a task passed does not move that child item; only a verified commit plus a supervisor-side gate pass does.
- AC10. A task reference containing `..`, a symlink component, or a path outside the registered repository root is rejected at import.
- AC11. The executor's environment contains no gateway token, no operator git credential helper, no SSH agent socket and no `gh` state; a test inspects `/proc/<pid>/environ` of the running scope.
- AC12. Unit tests cover the transition table exhaustively; integration tests cover AC1 to AC11; coverage on `src/kernel` is at least 85 percent.
- AC13. No file in `src/kernel` imports from `src/factory`, enforced by a test.
- AC14. The plugin registers no HTTP route and no tool that writes files outside the plugin's run directory.

### Phase 2 acceptance criteria

Phase 2 is the irreversible phase, so its exit is fixed here rather than left to its spec.

- P2-1. Import verification: per-table row counts and a checksum over exported columns match `wt_*` at cutover, reported by the importer.
- P2-2. Compat ids: every imported project, feature and task keeps its original `wt` number through the alias layer; a replay of every workflow in MondayDev's work-tracker skill document against the aliases produces the same envelopes as recorded golden fixtures, including `generate_snapshot` byte for byte.
- P2-3. Status map: every `wt` status write the personas issue today, including `update_task status=done` from any state and `release_task`, succeeds through the alias layer by walking legal intermediate transitions inside one command, with each hop journalled.
- P2-4. Durable idempotency: a `create_task` retry with the same `idempotency_key` after a gateway restart returns the original response and creates nothing.
- P2-5. Rehearsal: the cutover and its rollback are each executed against a copy of the production database before the real cutover, and the go/no-go checklist in ADR 0010 is complete, including the live enumeration of mcporter registrations and a diff of every persona prompt against the 23 real tool names.
- P2-6. Postgres conformance: the kernel and factory suites, including the concurrency tests, pass on both engines.
- P2-7. Notify: a `blocked`, `lost` or approval-requested event reaches the operator's configured channel within one minute.
- P2-8. Retention: `runs purge` removes run directories, worktrees and logs older than the configured retention, never evidence artifacts referenced by a `done` item.
- P2-9. Owner per status: the table in §6 is enforced by a test that every status has a named owner persona or human role and a staleness deadline that emits an event.

## 4. Migration boundaries

Each boundary states what moves, what stays, the cutover rule and the rollback.

| Boundary | Moves | Stays | Cutover | Rollback |
|---|---|---|---|---|
| M1 work-tracker (live, Postgres `wt_*`) | projects, features as parent items, tasks, deps as `blocks` links, tags as labels, notes as kernel notes, `plan_path` as a reference, outcome fields as metadata; original numbers preserved as compat ids; `external_id = wt:<table>:<id>` | `wt_*` tables untouched | Phase 2, in a quiet window with heartbeats and cron digests paused: verify the DB roles of the MCP server and the admin board, revoke write grants for both, run the idempotent import once, register the 23 aliases, repoint every enumerated mcporter registration, resume heartbeats. No scheduled mirror exists before cutover | pause heartbeats; revert M3 first; replay the journal since cutover back into `wt_*` (updates to imported rows and inserts for rows created after cutover); restore grants; revert mcporter; then delete Shohin rows created by or since the import |
| M2 Shohin v1 (dormant Next.js) | nothing automatically; if the Cloud SQL instance holds real rows, a one-shot CSV export is attached to the Phase 8 workstream | repo archived; concepts carried by ADR 0010 | Phase 0: archive the repo; Phase 8: decide on export | none needed |
| M3 context-engine commitments | the promotion path: `commitment_promote` calls the Shohin `create_task` alias with `idempotency_key = commitment:<uuid>` and stores the returned compat id in the existing integer column | commitment detection, spaces, clusters, topics | same window as M1, before grants are revoked; the alias's durable idempotency makes a crash between the alias call and the commitments update safe to retry | revert the MondayDev change before restoring grants |
| M4 WAI artifacts (git) | nothing; Shohin stores references (repo, path, commit) | spec, plan, task files, decisions ledger, run-state files are canonical | Phase 1 for references and the plan importer; a drift check at run start compares the recorded commit with the branch head and refuses to start if the task tree changed without re-import | delete items; files are unaffected |
| M5 vk-swarm | nothing | everything | Phase 8 optional: a `VkSwarmExecutor` behind the `Executor` interface | drop the executor |

Rules that apply to every boundary: no dual-write period and no mirror period; the old system becomes read-only at cutover by database grant for every role that can write, never by convention; every imported row carries its origin in `external_id`; import scripts are idempotent and re-runnable; the cutover and its rollback are rehearsed on a copy first; and the cutover is a single item on the board with the approval flag set.

## 5. Security controls

| Id | Threat | Control | Mechanism | Phase |
|---|---|---|---|---|
| S1 | anonymous, forged or spoofed writes | actors are derived only at authenticated boundaries: gateway RPC (client id and scope), agent tool (turn identity), supervisor (run id and generation); no command accepts a caller-supplied actor; the CLI is a gateway client with the operator token, never a direct store writer; executors hold no gateway token | `src/kernel/actors`; AC2, AC11 | 1 |
| S2 | an agent starts work that changes external state without a human decision, or widens approved scope afterwards | `approval_required` defaults to true for every software item until Phase 2 project policy narrows it; an approval binds to the item and to the manifest hash; `claim` requires a granted approval for the current hash; any change to the task tree, files, branch, base or side-effect class changes the hash and voids the approval; approvals expire after a configured TTL with an event; approvals are granted only by humans over `operator.admin` RPC, never by tool | conditional `UPDATE` in `claim`; AC8 | 1 (bound to hash), 4 (patch envelope and re-approval flow) |
| S3 | protected repositories changed by automation; human gates forged as files | per-project `protected` policy (WednesdayAI-core protected by default) forces `approval_required`, refuses `main`, and forbids automated merge; Shohin's approvals live in the store, not in files; the supervisor verifies the precheck token is committed at the base commit and that the task tree hash matches the manifest before start; no persona may write `reviews/**` or `.precheck.passed` | project policy; `src/factory/verify` | 1 (verify), 2 (policy), 7 (proven on core) |
| S4 | executor escapes or damages the operator's checkout or credentials | runs execute only in a worktree under a `0700` plugin-owned run directory; the executor runs in a systemd user scope with a runtime ceiling and an ephemeral HOME holding only the harness's copied auth; no operator git credential helper, SSH agent socket, `gh` state or gateway token; worktree remotes have push disabled; exec policy presets from core ADR 0029 apply; runner lane-worktree creation must fail closed | supervisor; AC5, AC11 | 0 (verified), 1 |
| S5 | runaway spend or runaway runs | wall-clock ceiling per run enforced by the scope; worker concurrency and attempt maximums passed to the runner; unit accounting from executor usage output stops new starts when the budget is exhausted; dollar estimates from Phase 4; per-persona daily run limits; `shohin.paused` config plus `shohin.kill` admin RPC stops all scopes and refuses new starts; operator activity is a renewable lease with a bounded TTL set by the operator's CLI or session, and absence of the lease means not active | supervisor and dispatcher | 1 (ceiling, attempts, kill, pause lease), 4 (dollar cap) |
| S6 | prompt injection through ingested text or instruction-bearing content | Sentinel treats ingested logs, CI, issues and PR comments as data: wrapped, tagged with provenance, length-capped, sanitised; findings never become executor instructions without promotion; task instructions an executor runs are bound to the approved manifest; PR comments are processed in a read-only triage turn that emits a structured proposal; pushes and PRs run in a separate deterministic step under policy, not in the turn that read untrusted text | ingestion normaliser; Release Manager design | 4 (push step), 6 (ingestion) |
| S7 | a persona exceeds its role | least-privilege tool allow-lists per persona; Foreman has no shell and no file write; Sentinel is read-only; Principal writes only under `docs/plans/<topic>/phase-*/**` and the decisions ledger, never `reviews/**`, `.precheck.passed`, `plan.md` or the spec; a test asserts each list against a golden file | agent `tools` policy | 4, 6 |
| S8 | unauthorised board access | until the Phase 7 scope seam, every `shohin.*` RPC is `operator.admin`; after the seam, reads `operator.read`, writes `operator.write`, run start, cancel, kill and approvals `operator.admin` | gateway method scopes | 1 (admin-only), 7 |
| S9 | plugin reads conversation data it should not | the plugin never opens session storage; it reads conversations only through the read-only facade of core ADR 0012 | code review gate and a lint rule | 1 |
| S10 | lost audit trail | `work_events` and `work_run_events` are append-only; no update or delete path exists in the command layer; retention removes run directories and logs, never journal rows or evidence referenced by `done` items | schema and tests; P2-8 | 1, 2 |
| S11 | stale claimants or stale supervisors overwriting fresh work | lease expiry, token match and supervisor generation are part of every mutating `UPDATE ... WHERE`; expired, mismatched or superseded writers change zero rows | store; AC7 | 1 |
| S12 | secrets leaking into run logs, evidence or the process table | executor output is redacted for known credential shapes before persistence; the environment allow-list carries only the harness's own auth; no token appears on a command line or in `WAI_DAG_NOTIFY_CMD`; the notify sink is a file in the run directory | supervisor | 1 |
| S13 | executor pushes or opens PRs on its own | worktree remotes have push disabled; executors never hold push credentials; push and PR are Release Manager actions in a policy-gated deterministic step | supervisor; Release Manager tool policy | 1 (no push), 4 |
| S14 | path traversal or symlink escape via topics, references or `plan_path` | topic slugs validated before any path is built; only registered canonical repository roots; `realpath` containment with symlink rejection; references resolved as git blobs at a commit, never followed on the working tree | `src/kernel/paths`; AC10 | 1 |
| S15 | executor-writable files forging task events or evidence | `attention.jsonl` and `.wai-run-state.json` are hints tagged `source: executor`; item transitions and run outcomes derive only from supervisor-verified facts: exit status, commits on the branch, the supervisor's own gate re-run, manifest equality; task ids in hints are validated against the manifest and transitions must be monotonic | `src/factory/verify`; AC9 | 1 |
| S16 | two supervisors or PID reuse acting on the same run | single supervisor lease per store with fencing generation; process identity is scope unit plus pid and start time; signals only after identity check | recovery policy; AC4, AC7 | 1 |
| S17 | a run outliving its supervisor | scope `RuntimeMaxSec` ceiling; a watchdog wrapper inside the scope exits when the supervisor heartbeat file is stale beyond a threshold | Phase 0 verified; supervisor | 0, 1 |
| S18 | network egress from executors to exfiltrate or to reach unintended services | residual risk in Phases 1 to 7: executors share the host's network; recorded and accepted because the environment holds no credentials beyond the harness's own; Phase 8 container executor with an egress allow-list closes it | ADR 0011 | 8 |

## 6. Ownership by state

Every status has an owner and a staleness deadline. Absence of an owner is a bug, not a policy.

| Status | Owner until Phase 4 | Owner from Phase 4 | Stale after | On stale |
|---|---|---|---|---|
| triage | human | Sentinel proposes, human decides | 7 days | `item.stale` event, notify |
| backlog | human | Architect | none | none |
| todo | human | Foreman | 14 days | `item.stale` event |
| ready | dispatcher | Foreman | 1 day unclaimed | notify |
| running | supervisor | supervisor | lease expiry | `run.lost`, `blocked` |
| review | human | Release Manager proposes, human decides | 2 days | notify |
| blocked | human | Principal | 1 day | Principal attention, then human |
| done, cancelled | none | none | none | retention only |
| approval requested (flag) | human | human | approval TTL | `approval.expired` event, notify |

## 7. Things we refuse to fix later

Each of these is cheap now and a rewrite later. They are acceptance criteria, not aspirations.

- Actor derived at a boundary on every write from Phase 1; no caller-supplied actors ever (S1).
- Integer primary keys and a compat id map that preserves original work-tracker numbers (ADR 0007, ADR 0010).
- Journal in the same write transaction with an application `txn_id` and a `source` on every event from Phase 1.
- Transitions, claims, approvals and lease checks as conditional `UPDATE` statements in the store from Phase 1.
- Partial unique index on active runs per item and a fenced supervisor lease from Phase 1.
- Approvals bound to a manifest hash from Phase 1, even before the re-approval flow exists.
- Executor output as hints, never truth, from Phase 1 (S15).
- OS-enforced scope, ephemeral HOME and credential-free executor environment from Phase 0.
- `external_id` on every entity from Phase 1, even before any import exists.
- The `Executor` interface with `version`, `start`, `resume`, `status`, `cancel`, `events` and exactly one implementation from Phase 1.
- Durable idempotency keys that return the original response, from the first alias.
- `events.tail` specified as a cursor poll from Phase 1 so nothing pretends to stream before Phase 7.
- Explicit storage configuration from Phase 1; never the SDK's default path.
- An owner and a staleness deadline for every status from Phase 1, enforced by test from Phase 2.

## 8. Metrics

| Metric | Definition | Target |
|---|---|---|
| Unattended topics | consecutive topics that reach `review` from `ready` with no human action after approval; the streak resets on any `blocked`, `lost` or human retry | 1 by Phase 1; 10 by Phase 4 |
| Queue time | median `ready` → `run.started` over the trailing 20 runs | under 2 minutes by Phase 4 |
| Execution time | median `run.started` → `run.succeeded` for topics with one task touching one file, trailing 20 | under 20 minutes by Phase 4 |
| Principal autonomy | attention items closed by a Principal decision that led to `review` without a human retry, divided by all attention items, trailing 30 days | 50 percent by Phase 5 |
| Cutover fidelity | imported rows matching `wt_*` counts and checksums | 100 percent at M1 |
| Duplicate runs | runs for an item that overlapped another run for the same item, per 100 runs | 0 from Phase 1 |
| Budget stops | runs stopped by ceiling or budget, per 100 runs | under 5 by Phase 4 |

## 9. Out of scope for the program

Invoicing and payments; multi-tenant organisations; a plugin marketplace; hive or multi-node execution; a new frontend stack; any change to core conversation routing; automatic merge to `main` without an approval record; separate OS users per executor (superseded by the Phase 8 container executor).
