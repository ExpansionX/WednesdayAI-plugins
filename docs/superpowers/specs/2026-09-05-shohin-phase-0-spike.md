---
doc_type: spec
status: active
workstream: shohin-phase-0-spike
change_kind: docs
verify_cmd: "none"
---

# Shohin Phase 0 — spike: can a WednesdayAI plugin drive the WAI DAG runner inside an OS-enforced scope?

## Intent
Phase 1 of the Shohin program (`plugins/shohin/docs/PROGRAM.md` §3) rests on one unproven assumption: that a WednesdayAI plugin service can run the WAI DAG runner (`wai-dag-run.sh`) headless, with OpenCode as the harness, inside an OS-enforced scope that the supervisor can observe, stop and recover, without giving the executor the operator's credentials. ADR 0008 commits to that executor and ADR 0011 commits to that isolation model. Neither has been run.

The challenger review of the program plan found that the obvious paths do not work: the SDK's `runCommandWithTimeout` blocks until exit and kills only the direct child; a bare process group cannot contain a child that calls `setsid`; the runner trusts files any process in the tree can write; the runner takes model ids rather than OpenCode agent names; the runner keeps its state inside the worktree and can `git reset --hard` on `--reset full`; and an ephemeral HOME may break the harness's authentication. Each of these is a question with a cheap empirical answer and an expensive wrong guess. Phase 1's executor adapter, supervisor and recovery policy cannot be specified honestly until they are answered.

This spike answers them. It builds throwaway code, runs the runner against a tiny prepared topic in this repository, observes what happens, and writes one report. The report names the executor adapter contract Phase 1 will implement and the recovery policy the supervisor will enforce. Nothing else survives.

`change_kind: docs` and `verify_cmd: none` are deliberate. The spike's only surviving artifact is a report; every line of code it builds is deleted before close, so there is no runtime behaviour to reach or to verify post-merge. The report itself records the runtime observations that Phase 1 depends on.


## User stories
- **US1:** As the operator, when a plugin service launches the runner inside a systemd user scope, I expect that stopping the scope kills everything the run spawned, including OpenCode grandchildren and any child that detached itself, so a cancelled run cannot keep committing.
- **US2:** As the operator, when the runner executes with an ephemeral HOME that holds only the harness's copied auth, I expect OpenCode to authenticate and complete a task, and I expect to know exactly which files had to be copied, so Phase 1 can give executors no operator credentials.
- **US3:** As the Phase 1 implementer, when I configure the worker ladder, I expect to know whether the runner can reach the operator's OpenCode sub-agents by name or only by model id, and whether attaching to a warm OpenCode server changes cost or latency, so the executor adapter passes the right thing.
- **US4:** As the Phase 1 implementer, when the runner raises attention or finishes, I expect to know which signals the supervisor can trust (exit status, commits on the branch, gate outputs) and which are only hints (the notify file, the run-state file), so the supervisor never promotes a run on executor-written evidence.
- **US5:** As the operator, when the gateway dies mid-run, I expect to know whether the run stops on its own, what state it leaves in the worktree, and what each `--reset` mode discards on retry, so Phase 1's recovery policy is written from observation rather than from reading the script.
- **US6:** As the Phase 1 implementer, when I write the executor adapter, I expect a list of everything the runner needs from its environment and a pinned runner version, so the adapter can be exact and the executor can record what it ran.
- **US7:** As the operator, when lane worktree creation fails inside the runner, I expect to know whether it falls back to the shared integration tree, and if so what makes it fail closed, so an executor can never write outside its worktree.
- **US8:** As the operator, when the spike closes, I expect the repository to contain the report and nothing else from the spike, so the throwaway stays throwaway.

## Success criteria
SC1: With the runner launched through `systemd-run --user --scope`, `systemctl --user list-units` shows the run's transient scope while the run is active, and after `systemctl --user kill` on that scope, a process listing filtered on the run directory path returns no processes and no new commit appears on the target branch. The report records both listings. If a systemd user session is unavailable on the host, the report records that, records the fallback used, and records which processes survived a process-group kill.
→ US1
SC2: The runner completes at least one task with `HOME` set to a directory the spike created, and the report lists every file copied into that directory and the OpenCode error observed with each file absent.
→ US2
SC3a: The run log shows the OpenCode invocation the runner issued for each attempt, and the report states whether the ladder reached the operator's sub-agents by name or only the model ids behind them.
→ US3
SC3b: The report records wall-clock and token usage for the same task once with `WAI_DAG_OPENCODE_SERVER` unset and once attached to a warm server, or records that the attach path failed and why.
→ US3
SC4: The notify file contains one JSON line per attention item the runner raised, the run-state file reaches a terminal state, and the report lists the authoritative signal set the supervisor will use (exit status, commits on the branch, per-task gate output) beside the hint set it will not trust.
→ US4
SC5: With the gateway killed mid-run (`SIGKILL` on the `openclaw-gateway` user unit), the report records whether the run continued, stopped at the scope's `RuntimeMaxSec`, or stopped on the watchdog; records the journal timestamps of the kill, the unit restart, the plugin load and the recovery sweep; records the worktree state after restart; and records the output of `wai-dag-run.sh --reset` and of `--reset full` on that worktree, naming exactly which files and commits each discarded.
→ US5
SC6: The report lists every binary, environment variable, auth file and git precondition the runner required, and the sha256 of the runner script that ran, and records per-task wall-clock and cost including validator and assessor calls.
→ US6
SC7: With lane worktree creation forced to fail, the report records whether the runner wrote to the shared tree, and names the environment setting or patch that makes it fail closed, with the observed behaviour after applying it.
→ US7
SC8: After the report is committed, `git status` is clean; `git ls-files plugins/shohin` lists no path containing `/spike/`; a `git diff` of `plugins/shohin` against the pre-spike tree, with the spike directory excluded, is empty; the target topic's branch and plan directory are removed; `~/.openclaw/extensions/shohin-spike` does not exist and `wednesdayai plugins list` does not show it; the `openclaw-gateway` unit is still active.
→ US8

## Users
- **David, as operator.** Decides, from the report, whether Phase 1 proceeds on the DAG runner as designed, on a modified runner, or on a different first executor.
- **The Phase 1 implementer** (human or board-dispatched). Reads the report's adapter contract, environment list, signal set and recovery policy as the ground truth for `src/factory/executor`, `src/factory/supervisor` and `src/factory/verify`.
- **The WAI runner maintainers** (agent-plugins). Receive a concrete list of any runner changes the spike shows are needed: an agent mode for OpenCode, a fail-closed lane worktree, a notify payload change.
- **The operator's development host.** Provides the persistent WednesdayAI development gateway (`openclaw-gateway` systemd user unit) that the operator authorized for this workstream. Task 001 adopts the existing unit after a protected backup, focused SQLite/channel-skip reconciliation, validation, restart and health checks; the gateway stays after the spike as shared development and testing infrastructure for every later Shohin phase.
- **Not affected:** MondayDev personas, work-tracker users, WednesdayAI-core source. The spike changes no repository other than this one.


## Constraints
- **Throwaway plugin, durable gateway.** Spike code lives under `plugins/shohin/spike/` on the workstream branch, is installed into the dev gateway as extension `shohin-spike`, and both the source and the installed copy are deleted before close. It registers only a service and admin-scoped gateway methods, never an HTTP route, tool or cron job. The development gateway itself is host infrastructure and persists.
- **No core changes.** WednesdayAI-core is read-only. If a core seam appears necessary, the report says so and Phase 1 decides.
- **No runner changes merged.** The spike may patch its own copy of the runner to test a fail-closed or agent-mode hypothesis, and records the diff in the report. Changes to agent-plugins are proposed, not made.
- **Prepared target topic.** The runner needs a real topic with a committed precheck token and a plan that passes lint, so the spike prepares a separate throwaway topic in this repository (two trivial tasks against the Shohin shell) through `/wai:prd-new`, `/wai:spec`, `/wai:precheck` and `/wai:decompose` by hand, runs without `WAI_DAG_TEST_MODE`, and removes the topic afterwards.
- **Credential-free executor.** The spike's environment allow-list is the one in `plugins/shohin/docs/PROGRAM.md` §2: `PATH`, an ephemeral `HOME`, the harness's own auth, and the runner's own variables. No gateway token, no operator git credential helper, no SSH agent socket, no `gh` state. The report records the executor's `/proc/<pid>/environ`.
- **Worker ladder.** `WAI_DAG_WORKER_MODELS` carries only verified model ids in the intended order. Named OpenCode agent definitions are not assumed to exist; if the actual mapping cannot be established, the paid probe stops before dispatch and records the block.
- **Budget.** Abort any single task attempt that exceeds 30 minutes; abort the spike if total spend exceeds the operator's stated USD 50 cap for the day; record both in the report. No paid inner-runner dispatch may start until the role/model mapping and conservative per-call reservation leave an enforceable remaining cap.
- **Host and gateway.** Runs on the operator's Linux host under the existing operator-authorized WednesdayAI 0.4.11 development gateway from the expected local core, running as the `openclaw-gateway` systemd user unit on loopback port 18789 with channels skipped and explicit SQLite primary session storage with `fallbackToJsonlOnError=false`. Task 001 records the protected backup, structural diff, validation, restart and health proof instead of reinstalling or editing WednesdayAI-core.
- **Reference material is read-only.** OpenClaw, vk-swarm, MondayDev and agent-plugins are cited by path in the report and never modified.
- **Report is the deliverable.** It answers the seven exit questions in `plugins/shohin/docs/PROGRAM.md` §2 with evidence and ends with the proposed `Executor` adapter contract and recovery policy for Phase 1.


## Out of scope
- Any kernel or factory code that survives: store, commands, RPCs, tools, supervisor, CLI.
- Adding an agent mode, a fail-closed lane worktree, or a structured notify payload to the WAI runner itself; the spike only determines whether they are needed.
- Container or cgroup isolation beyond a systemd user scope; network egress control.
- Postgres, the board page, personas, approvals, migration from work-tracker.
- Benchmarking model quality across the ladder; the spike measures reachability, cost and time, not correctness of the code the workers produce.
- Running the spike on any host other than the operator's.
- Connecting the development gateway to any channel, provider credentials beyond what the spike needs, or production data; it is a development instance only.


## Approach
Adopt the existing operator-authorized **development WednesdayAI gateway** on this host after focused reconciliation, then build a **throwaway plugin** (`plugins/shohin/spike/`, installed as extension `shohin-spike`) whose `registerService` supervisor does exactly what the Phase 1 supervisor will do to an executor, and drive it through seven probes in a fixed order against a throwaway target topic. Running inside the real gateway means gateway death is real: `SIGKILL` on the `openclaw-gateway` unit, followed by the unit's restart and the service's boot-time recovery sweep. Every probe appends a fenced evidence block to `dev-docs/workstreams/shohin-phase-0-spike/spike-report.md`; the report's last section proposes the `Executor` adapter contract and the recovery policy for Phase 1.

Order, chosen so each probe reuses the previous one's state and the destructive probes come last:

0. **Adopt the dev gateway**: capture `PRE_SPIKE_SHA` as `5be287d73394f9bee55e9de84e7d98111c9a981d`, back up the effective config/unit outside the repository with restrictive permissions, merge only `session.storage` SQLite primary/fallback-disabled fields and the channel-skip drop-in, validate config and unit, restart the existing `openclaw-gateway.service`, then confirm active/enabled, loopback 18789, health RPC, config path and selected non-secret unit properties. No onboarding, reinstall, global update or core edit is part of this step.
1. **Prepare** the target topic `shohin-spike-target` (two trivial tasks against the Shohin shell) through the WAI flow by hand using `/home/david/.agents/wai/scripts`; commit its precheck token against the inherited program baseline, not `main`. Record the installed runner's sha256.
2. **Baseline run** inside a `systemd-run --user --scope` with a runtime ceiling, an ephemeral HOME and the allow-listed environment, `WAI_DAG_WORKER_MODELS` set to verified model ids, cold OpenCode. Iterate the HOME copy-in list until OpenCode authenticates. Produces SC2, SC3a, SC6, SC4 (terminal path).
3. **Attach run** of the same topic against a warm `opencode serve` via `WAI_DAG_OPENCODE_SERVER`. Produces SC3b.
4. **Cancel probe**: start a run, stop the scope mid-task, list processes and commits. Produces SC1.
5. **Attention probe**: run a task whose gate cannot pass so the runner raises attention; inspect the notify file and run-state. Completes SC4.
6. **Gateway-death probe**: `systemctl --user kill --signal=SIGKILL openclaw-gateway` mid-run; observe the scope, the watchdog and the ceiling; observe the unit's restart and the service's recovery sweep in the journal; then run `--reset` and `--reset full` in the same worktree and diff refs and files before and after. Produces SC5.
7. **Lane-failure probe**: make the runner's lane worktree creation fail (read-only `TMPDIR`); observe where it writes; apply the fail-closed change to the spike's copy of the runner and re-observe. Produces SC7.
8. **Cleanup**: uninstall the `shohin-spike` extension from the gateway, delete `plugins/shohin/spike/`, the target topic's plan directory and branch; commit the report; verify SC8 (no `/spike/` path remains under `plugins/shohin`, and the rest of that tree matches the pre-spike commit). The gateway stays.

Each probe is a task in the plan. The report, not the code, is what precheck's downstream gates measure.


## Design
**Development gateway (persistent host infrastructure):** The operator-designated `openclaw-gateway` systemd user unit already exists and is authorized for development/testing. Task 001 may only take a protected external backup, preserve unrelated config and existing session material, set explicit SQLite primary session storage with `fallbackToJsonlOnError=false`, persist `OPENCLAW_SKIP_CHANNELS=1` through a focused drop-in, validate, reload/restart, and reverify health. The report records the unit file, `Restart=` policy, selected unit properties, config path, structural redacted diff and versions without printing raw environment, auth or backup contents.

**Spike plugin (`plugins/shohin/spike/`, installed by copy to `~/.openclaw/extensions/shohin-spike/`, all deleted at close):** a minimal `openclaw.plugin.json` with id `shohin-spike`, an `index.ts` that calls `registerService({ id: 'shohin-spike-supervisor', start, stop })` and `registerGatewayMethod` for `shohinSpike.run`, `shohinSpike.cancel` and `shohinSpike.status` (admin-scoped by default), driven from the operator's shell with `wednesdayai gateway call shohinSpike.run --params '{...}'` and friends (A13). The service body is the supervisor:

- `supervisor.ts`: builds the run directory (`0700`), builds the ephemeral HOME from `home.allow` (a list of paths copied from the operator's HOME, starting empty and grown by observation), builds the environment from `env.allow`, launches `systemd-run --user --scope --unit=shohin-spike-<runId> --property=RuntimeMaxSec=<ceiling> -- watchdog.sh <runner> <topic>`, records the scope unit, pid and pid start time, tails `<runDir>/attention.jsonl` and `docs/plans/<topic>/.wai-run-state.json`, writes a heartbeat file every 10 seconds, and on `cancel` runs `systemctl --user kill --signal=SIGTERM` then `SIGKILL` on the unit. It never reads the runner's files as truth: after exit it enumerates commits on the branch and re-runs `/home/david/.agents/wai/scripts/task-gate.sh` in detached worktrees at the exact commit under test.
- `watchdog.sh`: runs inside the scope; execs the runner in the background, polls the supervisor heartbeat file, and kills its own process tree if the heartbeat is older than 60 seconds. This is the mechanism that answers whether a run outlives its supervisor.
- `notify.sh`: the `WAI_DAG_NOTIFY_CMD` target; appends `{topic, id, reason, at}` as one JSON line to `<runDir>/attention.jsonl`.
- `runner/`: a copy of the installed runner (`/home/david/.agents/wai/scripts/`, `wai-dag-run.sh` sha256 `4954d57c054959686267e98ff23810d322f4737ab9706ef0a7916e7031eef10e`) so hypotheses (fail-closed lane worktree, `--agent` mode) can be patched without touching agent-plugins; every patch is recorded as a diff in the report.
- `report-append.sh`: appends a fenced evidence block with a heading, the command, and captured output to the report.
- `home.allow`, `env.allow`: the two allow-lists, versioned in the report.

**Target topic:** `shohin-spike-target`, two tasks: add `storage.sqlitePath` to the Shohin manifest's `configSchema`, and add a test asserting the manifest parses. Prepared by hand through prd-new, spec, precheck and decompose on a branch `spike/shohin-spike-target`; deleted in the cleanup task.

**Evidence model:** the report has one section per success criterion. Each contains the exact command, the raw output, and a one-paragraph reading. Hint sources (notify file, run-state file) are always labelled as hints; the truth set (exit status, `git log` on the branch, gate output) is labelled as truth. The final section states the proposed `Executor` interface (name, `version`, `start`, `resume`, `status`, `cancel`, `events`, handle fields) and the recovery policy (which `--reset` mode, in which worktree, what it destroys, how a new start is refused until the old scope is confirmed stopped).

**Gateway death (D7):** real. `systemctl --user kill --signal=SIGKILL openclaw-gateway` stops the supervisor's heartbeat and tailers while the scope lives on; the unit's `Restart=` policy brings the gateway back, the plugin loads, and the service's `start` runs the recovery sweep against the run directory. The journal timestamps of kill, restart, plugin load and sweep are captured, so restart ordering is observed rather than assumed.

**Budget guard:** the supervisor enforces the 30-minute per-attempt abort by `RuntimeMaxSec` on the scope. A successful baseline with `WAI_DAG_MAX_ATTEMPTS=1` must dispatch once; controlled failure probes that need to prove ladder breadth use the documented retry count for that probe and record the observed semantics. Usage is read from the runner's per-attempt usage output and totalled in the report only after pre-dispatch reservations prove the USD 50 day cap cannot be exceeded.


## Decisions
- **D1 Where the supervisor prototype runs:** as a real throwaway plugin service inside the existing development WednesdayAI gateway that the operator authorized for this workstream in decision001. This proves plugin loading, service lifecycle and recovery on restart, not only the scope mechanics.
- **D2 Containment mechanism:** `systemd-run --user --scope`, verified on this host before dependent probes proceed. If a systemd user session is unavailable, a process-group fallback may be recorded as an empirical negative observation, but systemd containment assertions remain blocked rather than relabelled as passed.
- **D3 Target topic:** a separate throwaway topic prepared by hand, because the runner refuses to run without a committed precheck token and lint-clean plan, and running the spike against its own plan is circular.
- **D4 Ephemeral HOME construction:** start from an empty allow-list and add files by observed OpenCode failure, rather than mirroring the operator's HOME, so the minimal set is discovered rather than assumed.
- **D5 Runner version:** the installed copy under `/home/david/.agents/wai/scripts/` (current `wai-dag-run.sh` sha256 `4954d57c054959686267e98ff23810d322f4737ab9706ef0a7916e7031eef10e`), because that is what a plugin on this host uses. Any drift from source/reference copies is recorded as a finding rather than silently normalized.
- **D6 Spend cap:** USD 50 for the spike day and 30 minutes per attempt, overridable by the operator. Native WAI flat estimates do not establish dollar bounds; paid work is refused until actual model mapping, per-role pricing and resource ceilings are attributable.
- **D7 Gateway death:** real `SIGKILL` on the `openclaw-gateway` user unit, with restart ordering captured from the journal. **Irreversible:** no.
- **D8 Ladder passing:** model ids in `WAI_DAG_WORKER_MODELS` first; only if that fails to reach the intended providers is the `--agent` patch tried on the spike's runner copy.
- **D9 Cleanup is irreversible** (branch and plan directory deletion): the cleanup task is marked irreversible and requires the operator's approval token; ADR link: none needed, the deletion is of throwaway artifacts created by this workstream. Rationale recorded in `dev-docs/adr/0011` §5 (throwaway stays throwaway) by reference.

- **D10 Gateway baseline adoption method:** use the existing 0.4.11 global install and local core provenance, then perform only the decision001-authorized SQLite/channel-skip reconciliation with protected backup, validation, restart and health proof. Do not reinstall, globally update, onboard, or edit WednesdayAI-core without a separate decision.

None of D1 to D8 and D10 deletes code, removes a dependency or changes a contract. D9 deletes only artifacts this workstream created.


## Test strategy
TS1: Scope containment probe: start a run, from inside the run spawn a child that calls `setsid sleep 600`, stop the exact transient scope, then check unit/cgroup state, recorded PID/start-time identities and `git log --oneline <branch>` before and after; all captured into the report (SC1). If user-scope/cgroup control is unavailable, record the fallback process-group observation and stop dependent systemd assertions as blocked.
TS2: Ephemeral HOME probe: run with an empty `home.allow`, capture the OpenCode error, add the single file it names, repeat until a task completes; the sequence of (file added, error before) pairs is the report table (SC2).
TS3: Ladder and attach probe: baseline run with `WAI_DAG_WORKER_MODELS` set to verified model ids and the run log grepped for each `opencode run` argv; then the same topic reset and run with `WAI_DAG_OPENCODE_SERVER` pointing at a warm restricted-HOME `opencode serve`; wall-clock, usage and any attach failure are captured (SC3a, SC3b).
TS4: Signal probe: a task whose scope test cannot pass forces attention; `attention.jsonl` line count versus attention items in the runner's own log, run-state terminal field, exit status, and a forged extra line appended to `attention.jsonl` shown to change nothing the supervisor concludes (SC4).
TS5: Gateway-death probe: `systemctl --user kill --signal=SIGKILL openclaw-gateway` while a task is mid-attempt; `systemctl --user status` of the run scope every 15 seconds until it ends; `journalctl --user -u openclaw-gateway` for kill, restart, plugin-load and recovery-sweep lines with timestamps; `git rev-list --all` and `ls -la docs/plans/<topic>` before and after `--reset`, then after `--reset full` (SC5).
TS6: Inventory probe: `/proc/<pid>/environ` of the runner and of one OpenCode child, `which` of every binary the runner invoked (from `strace -f -e execve` or the runner's own log), `sha256sum` of the runner copy, and the per-attempt usage lines totalled (SC6).
TS7: Lane-failure probe: first record the invalid read-only `TMPDIR` outcome, then force `_lane_worktree_add` failure in a copied runner generation with a dispatch marker to prove whether the stock fallback writes in the shared target tree. Repeat from a fresh copied generation with the fail-closed fallback patch, expecting refusal, no marker, and no target diff/commit (SC7).
TS8: Cleanup verification: `git status --porcelain` empty, `git ls-files plugins/shohin | grep -c spike` equals 0, `git diff <pre-spike-sha> -- plugins/shohin ':!plugins/shohin/spike'` empty, `git branch --list 'spike/*'` empty, `ls docs/plans/shohin-spike-target` absent, `ls ~/.openclaw/extensions/shohin-spike` absent, `wednesdayai plugins list` without shohin-spike, `systemctl --user is-active openclaw-gateway` = active (SC8).
