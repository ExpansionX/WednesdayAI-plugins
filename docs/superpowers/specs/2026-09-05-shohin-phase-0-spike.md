---
doc_type: spec
status: draft
id: 2026-09-05-shohin-phase-0-spike
workstream: shohin-phase-0-spike
change_kind: docs
verify_cmd: none
title: "Shohin Phase 0 — spike: can a WednesdayAI plugin drive the WAI DAG runner inside an OS-enforced scope?"
created: 2026-09-05
updated: 2026-09-05
author: david
tags: [shohin, spike, factory, executor, dag-runner, opencode, systemd]
program: plugins/shohin/docs/PROGRAM.md
adrs: [0005, 0008, 0011]
---

> Intent capture (`/wai:prd-new`). Design sections are added by `/wai:spec` in this same file.
> This doc captures **what / why / done-means**, not the **how**.
>
> `change_kind: docs` and `verify_cmd: none` are deliberate. The spike's only surviving
> artifact is a report; every line of code it builds is deleted before close, so there is no
> runtime behaviour to reach or to verify post-merge. The report itself records the runtime
> observations that Phase 1 depends on.

## Intent (what / why)

Phase 1 of the Shohin program (`plugins/shohin/docs/PROGRAM.md` §3) rests on one unproven
assumption: that a WednesdayAI plugin service can run the WAI DAG runner (`wai-dag-run.sh`)
headless, with OpenCode as the harness, inside an OS-enforced scope that the supervisor can
observe, stop and recover, without giving the executor the operator's credentials. ADR 0008
commits to that executor and ADR 0011 commits to that isolation model. Neither has been run.

The challenger review of the program plan found that the obvious paths do not work: the SDK's
`runCommandWithTimeout` blocks until exit and kills only the direct child; a bare process group
cannot contain a child that calls `setsid`; the runner trusts files any process in the tree can
write; the runner takes model ids rather than OpenCode agent names; the runner keeps its state
inside the worktree and can `git reset --hard` on `--reset full`; and an ephemeral HOME may
break the harness's authentication. Each of these is a question with a cheap empirical answer
and an expensive wrong guess. Phase 1's executor adapter, supervisor and recovery policy cannot
be specified honestly until they are answered.

This spike answers them. It builds throwaway code, runs the runner against a tiny prepared
topic in this repository, observes what happens, and writes one report. The report names the
executor adapter contract Phase 1 will implement and the recovery policy the supervisor will
enforce. Nothing else survives.

## Users / who is affected

- **David, as operator.** Decides, from the report, whether Phase 1 proceeds on the DAG runner
  as designed, on a modified runner, or on a different first executor.
- **The Phase 1 implementer** (human or board-dispatched). Reads the report's adapter contract,
  environment list, signal set and recovery policy as the ground truth for
  `src/factory/executor`, `src/factory/supervisor` and `src/factory/verify`.
- **The WAI runner maintainers** (agent-plugins). Receive a concrete list of any runner changes
  the spike shows are needed: an agent mode for OpenCode, a fail-closed lane worktree, a
  notify payload change.
- **Not affected:** MondayDev personas, work-tracker users, WednesdayAI-core. The spike touches
  no shared state and installs nothing.

## User stories

- **US1:** As the operator, when a plugin service launches the runner inside a systemd user
  scope, I expect that stopping the scope kills everything the run spawned, including OpenCode
  grandchildren and any child that detached itself, so a cancelled run cannot keep committing.
- **US2:** As the operator, when the runner executes with an ephemeral HOME that holds only the
  harness's copied auth, I expect OpenCode to authenticate and complete a task, and I expect to
  know exactly which files had to be copied, so Phase 1 can give executors no operator
  credentials.
- **US3:** As the Phase 1 implementer, when I configure the worker ladder, I expect to know
  whether the runner can reach the operator's OpenCode sub-agents by name or only by model id,
  and whether attaching to a warm OpenCode server changes cost or latency, so the executor
  adapter passes the right thing.
- **US4:** As the Phase 1 implementer, when the runner raises attention or finishes, I expect to
  know which signals the supervisor can trust (exit status, commits on the branch, gate
  outputs) and which are only hints (the notify file, the run-state file), so the supervisor
  never promotes a run on executor-written evidence.
- **US5:** As the operator, when the gateway dies mid-run, I expect to know whether the run
  stops on its own, what state it leaves in the worktree, and what each `--reset` mode discards
  on retry, so Phase 1's recovery policy is written from observation rather than from reading
  the script.
- **US6:** As the Phase 1 implementer, when I write the executor adapter, I expect a list of
  everything the runner needs from its environment and a pinned runner version, so the adapter
  can be exact and the executor can record what it ran.
- **US7:** As the operator, when lane worktree creation fails inside the runner, I expect to
  know whether it falls back to the shared integration tree, and if so what makes it fail
  closed, so an executor can never write outside its worktree.
- **US8:** As the operator, when the spike closes, I expect the repository to contain the report
  and nothing else from the spike, so the throwaway stays throwaway.

## Success criteria

Each criterion names something observable on the host during or after the spike and recorded
verbatim in the spike report at `dev-docs/workstreams/shohin-phase-0-spike/spike-report.md`.

- **SC1:** With the runner launched through `systemd-run --user --scope`, `systemctl --user
  list-units` shows the run's transient scope while the run is active, and after `systemctl
  --user kill` on that scope, a process listing filtered on the run directory path returns no
  processes and no new commit appears on the target branch. The report records both listings.
  If a systemd user session is unavailable on the host, the report records that, records the
  fallback used, and records which processes survived a process-group kill. → US1
- **SC2:** The runner completes at least one task with `HOME` set to a directory the spike
  created, and the report lists every file copied into that directory and the OpenCode error
  observed with each file absent. → US2
- **SC3a:** The run log shows the OpenCode invocation the runner issued for each attempt, and
  the report states whether the ladder reached the operator's sub-agents by name or only the
  model ids behind them. → US3
- **SC3b:** The report records wall-clock and token usage for the same task once with
  `WAI_DAG_OPENCODE_SERVER` unset and once attached to a warm server, or records that the
  attach path failed and why. → US3
- **SC4:** The notify file contains one JSON line per attention item the runner raised, the
  run-state file reaches a terminal state, and the report lists the authoritative signal set
  the supervisor will use (exit status, commits on the branch, per-task gate output) beside the
  hint set it will not trust. → US4
- **SC5:** With the gateway killed mid-run, the report records whether the run continued,
  stopped at the scope's `RuntimeMaxSec`, or stopped on the watchdog; records the worktree
  state on restart; and records the output of `wai-dag-run.sh --reset` and of `--reset full`
  on that worktree, naming exactly which files and commits each discarded. → US5
- **SC6:** The report lists every binary, environment variable, auth file and git precondition
  the runner required, and the sha256 of the runner script that ran, and records per-task
  wall-clock and cost including validator and assessor calls. → US6
- **SC7:** With lane worktree creation forced to fail, the report records whether the runner
  wrote to the shared tree, and names the environment setting or patch that makes it fail
  closed, with the observed behaviour after applying it. → US7
- **SC8:** After the report is committed, `git status` is clean and `git ls-files` shows no
  file under a spike directory and no change to `plugins/shohin/index.ts` or its manifest;
  the target topic's branch and plan directory are removed. → US8

## Constraints

- **Throwaway.** Spike code lives under `plugins/shohin/spike/` on the workstream branch and is
  deleted before close. It registers nothing that persists: no HTTP route, no tool, no cron job.
- **No core changes.** WednesdayAI-core is read-only. If a core seam appears necessary, the
  report says so and Phase 1 decides.
- **No runner changes merged.** The spike may patch its own copy of the runner to test a
  fail-closed or agent-mode hypothesis, and records the diff in the report. Changes to
  agent-plugins are proposed, not made.
- **Prepared target topic.** The runner needs a real topic with a committed precheck token and
  a plan that passes lint, so the spike prepares a separate throwaway topic in this repository
  (two trivial tasks against the Shohin shell) through `/wai:prd-new`, `/wai:spec`,
  `/wai:precheck` and `/wai:decompose` by hand, runs without `WAI_DAG_TEST_MODE`, and removes
  the topic afterwards.
- **Credential-free executor.** The spike's environment allow-list is the one in
  `plugins/shohin/docs/PROGRAM.md` §2: `PATH`, an ephemeral `HOME`, the harness's own auth,
  and the runner's own variables. No gateway token, no operator git credential helper, no SSH
  agent socket, no `gh` state. The report records the executor's `/proc/<pid>/environ`.
- **Worker ladder.** `WAI_DAG_WORKER_MODELS` carries the model ids behind `subagent-glm-flash`,
  `subagent-gpt-terra` and `subagent-gpt-sol`, in that order, read from the operator's OpenCode
  agent definitions.
- **Budget.** Abort any single task attempt that exceeds 30 minutes; abort the spike if total
  spend exceeds the operator's stated cap for the day; record both in the report.
- **Host.** Runs on the operator's Linux host with a systemd user session, as the gateway does.
- **Reference material is read-only.** OpenClaw, vk-swarm, MondayDev and agent-plugins are cited
  by path in the report and never modified.
- **Report is the deliverable.** It answers the seven exit questions in
  `plugins/shohin/docs/PROGRAM.md` §2 with evidence and ends with the proposed `Executor`
  adapter contract and recovery policy for Phase 1.

## Out of scope

- Any kernel or factory code that survives: store, commands, RPCs, tools, supervisor, CLI.
- Adding an agent mode, a fail-closed lane worktree, or a structured notify payload to the WAI
  runner itself; the spike only determines whether they are needed.
- Container or cgroup isolation beyond a systemd user scope; network egress control.
- Postgres, the board page, personas, approvals, migration from work-tracker.
- Benchmarking model quality across the ladder; the spike measures reachability, cost and time,
  not correctness of the code the workers produce.
- Running the spike on any host other than the operator's.
