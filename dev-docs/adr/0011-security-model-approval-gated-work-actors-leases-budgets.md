---
doc_type: adr
id: 0011
workstream: shohin
title: "ADR-0011: Security model — manifest-bound approvals, boundary-derived actors, executor isolation, untrusted executor output, budgets and a kill switch"
status: accepted
created: 2026-09-03
---

# ADR-0011: Security model — manifest-bound approvals, boundary-derived actors, executor isolation, untrusted executor output, budgets and a kill switch

## Context

Shohin lets agents start subprocesses that edit repositories and spend money on model calls, and it ingests untrusted text from logs, CI output, public issues and pull-request comments. The work-tracker has no actor identity on writes. vk-swarm's test environment can, by its own findings, stop production containers. WAI's execute skill is marked `disable-model-invocation` precisely so that only a human starts it, yet its runner trusts two files that any process in the tree can write: the precheck token and the per-task `.approved` marker. Core's glossary defines approval-gated work as work that "can change external state, delete data, migrate records, spend money, or alter configuration" and requires "explicit approval recorded first". Core provides exec policy presets (ADR 0029), a read-only conversation facade (ADR 0012), gateway method scopes, and cost capture on `model_call_ended`. The gateway runs as a systemd user service on Linux, so transient user scopes are available for OS-enforced containment.

A challenger review established that a worktree and a process group isolate git state and cancellation, not credentials or filesystem access; that an executor running as the operator's user with the operator's HOME can read the gateway token and git credentials and therefore impersonate a human; and that an approval bound only to an item can be widened by editing the task files it will execute.

## Decision

The controls are numbered S1 to S18 in `docs/PROGRAM.md` §5 with their phases. This ADR records the model they implement.

1. **Actors are derived at boundaries, never supplied.** Every command carries an `Actor { kind, id, sessionKey?, runId? }` that the boundary computes: gateway RPC from the authenticated client and scope, agent tool from the turn identity, supervisor from the run id and its lease generation. The CLI is a gateway client using the operator's token; it never opens the store. Executors hold no gateway token, so they cannot reach any boundary as a human.
2. **Approvals bind to an execution manifest.** An approval row records decider, decision, reason, timestamp, TTL, the item, and the hash of a `RunManifest` (repository root, base commit, branch, spec sha, task-tree hash, file allow-list, budget, side-effect class). `claim` succeeds only when a granted, unexpired approval exists for the current hash. Any change to the task tree, files, branch, base or side-effect class produces a new hash and voids the approval. Approvals are granted by humans over `operator.admin` RPC; no tool path exists. Every software item defaults to `approval_required` until project policy narrows it. Phase 4 adds a declared patch envelope so the Principal's small amendments can be pre-approved; anything outside the envelope requires a fresh human decision.
3. **Human gates live in the store, not in files.** Shohin never trusts `.precheck.passed` or `reviews/*.approved` as authority. The supervisor verifies the precheck token is committed at the manifest's base commit and that the checked-out task tree hashes to the manifest before it starts a run. No persona may write those paths.
4. **Protected repositories.** Project policy names repositories as protected. WednesdayAI-core is protected by default. Items touching them are approval-gated, may never target `main`, and their pull requests are never merged by automation.
5. **Executor isolation.** Runs execute only in a worktree under a `0700` plugin-owned run directory, never in the operator's checkout. The executor runs in a systemd user scope with a runtime ceiling, so cancellation stops everything it spawned, including children that call `setsid`. It gets an ephemeral HOME holding only the harness's copied auth and config, an allow-listed environment, worktree remotes with push disabled, and no operator git credential helper, SSH agent socket, `gh` state or gateway token. Core's exec policy presets apply. A watchdog inside the scope exits when the supervisor's heartbeat file goes stale. Executor output is redacted for known credential shapes before persistence. Network egress is a recorded residual risk until the Phase 8 container executor.
6. **Executor output is a hint, never truth.** Files the executor can write, including `attention.jsonl` and the runner's run-state file, are recorded as events tagged `source: executor`. Item transitions and run outcomes derive only from facts the supervisor establishes itself: exit status, commits present on the branch, its own re-run of the deterministic task gate, and manifest equality. Task ids in hints are validated against the manifest and transitions must be monotonic.
7. **One supervisor, fenced.** A store has one supervisor lease with a fencing generation acquired by conditional update. Events, heartbeats and cancellations from a stale generation are rejected. Process identity for recovery is the scope unit plus pid and start time; nothing is signalled before identity is confirmed.
8. **Least-privilege personas.** Each persona's agent config carries a tool allow-list. The Foreman has no shell and no file write. The Sentinel is read-only. The Principal may write only task files and the decisions ledger under its topic, never `reviews/**`, `.precheck.passed`, `plan.md` or the spec. The Architect writes specs and plans but cannot start runs. The Release Manager may push and open pull requests only in a deterministic policy-gated step, and may not merge protected repositories. A test asserts each list against a golden file.
9. **Budgets and kill switch.** Every run carries a wall-clock ceiling enforced by the scope, worker and attempt maximums passed to the runner, a unit budget accounted from executor usage that stops new starts when exhausted, and from Phase 4 a dollar estimate cap. Each persona has a daily run limit. `shohin.paused` and the `shohin.kill` admin RPC stop all scopes and refuse new starts. Operator activity is a renewable lease with a bounded TTL; absence means not active.
10. **Untrusted text stays untrusted.** Logs, CI output, issues, PR comments, repository contents and commit messages are data with provenance. Sentinel wraps, tags, caps and sanitises them, and findings never become executor instructions without promotion. Instructions an executor runs are those bound to the approved manifest. PR comments are read in a triage turn that emits a structured proposal; pushes and PRs run in a separate deterministic step under policy, never in a turn that read untrusted text.
11. **Path containment.** Topic slugs are validated before any path is built; only registered canonical repository roots are accepted; `realpath` containment rejects symlink components and traversal; references are resolved as git blobs at a commit, never followed on the working tree.
12. **Scopes.** Plugin-registered gateway methods cannot declare a scope today and unclassified methods require `operator.admin`, so every `shohin.*` method is admin-only until the Phase 7 scope seam. After the seam: reads `operator.read`, writes `operator.write`, run start, cancel, kill and approvals `operator.admin`.
13. **Conversation data.** The plugin never opens session storage. It reads conversations only through the read-only facade of core ADR 0012.
14. **Audit and retention.** `work_events` and `work_run_events` are append-only with no update or delete path. Retention removes run directories, worktrees and logs after a configured period and never journal rows or evidence referenced by a `done` item.

## Rationale

- Approval as a stored decision bound to a content hash is the only form an autonomous system cannot talk itself out of or quietly widen.
- Deriving actors at boundaries makes the audit trail a query and makes impersonation require a credential the executor does not have.
- A user scope is the shipped Linux primitive that contains a process tree without containers; worktrees alone do not.
- Treating executor output as hints closes the path where a compromised run promotes itself.
- Least privilege per persona limits the blast radius of a confused model to what that role could do anyway.

## Consequences

- Positive: every control is enforced in the store, the supervisor or the OS, not in a prompt.
- Positive: the Phase 7 core changes are the first real test of the protected-repository path, with a human approving each item.
- Negative: approvals add latency and re-approval churn when the Principal patches a task. Phase 4's patch envelope bounds the churn; the churn is the point.
- Negative: the supervisor re-runs the task gate itself, which doubles gate cost for the parts of the gate that are not free. Deterministic gates are cheap; this is accepted.
- Negative: an ephemeral HOME may break harness features that expect the operator's config. Phase 0 enumerates what must be copied.
- Negative: dollar caps are estimates for external executors. Ceilings and unit caps are exact and apply from Phase 1.
- Negative: egress is not controlled until Phase 8. The environment carries no credential beyond the harness's own auth, which is the accepted residual.

## Alternatives considered

- **Prompt-level rules only.** Cheap and unenforceable.
- **A single "autonomy level" knob.** Hides which action is gated; replaced by per-item flags and per-persona lists.
- **Approvals as files in the repository.** This is what WAI does, and any process in the tree can forge them.
- **Separate OS users per executor.** Real isolation, but heavy to operate and superseded by the Phase 8 container executor behind the same `Executor` interface.
- **Process groups instead of scopes.** Do not contain a child that calls `setsid` and die with nothing when the gateway dies.
