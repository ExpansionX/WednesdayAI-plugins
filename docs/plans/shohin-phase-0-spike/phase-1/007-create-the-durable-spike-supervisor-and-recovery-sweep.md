---
id: "007"
phase: 1
title: "Create the durable spike supervisor and recovery sweep"
status: ready
depends_on: ["006"]
parallel: false
conflicts_with: ["019"]
files:
  - "plugins/shohin/spike/src/supervisor.ts"
  - "plugins/shohin/spike/src/supervisor.test.ts"
irreversible: false
scope_test: "plugins/shohin/spike/src/supervisor.test.ts"
allowed_change: create
covers_criteria: []
covers_tests: []
---
## Failing test (write first)
Create `supervisor.test.ts` first with injected adapters/fake clock. Assert 0700 run dir and atomic durable record with repo/common-dir/topic/branch/external baseline, immutable runner generation and per-file hashes (run, executors, gate, cost, watch, VERSION), full scope/process identities, runtime allow-list, heartbeat and durable spend ledger. Start copies pristine bundle first, applies only named probe patch second, hashes third, launches that exact generation; never overwrites a selected generation. Before each dispatch reserve conservative USD by role and refuse when total+reservation exceeds 50; reconcile actual worker/validator/assessor/prewarm/terminal usage. Start is asynchronous and single-topic. Recovery's synchronous bounded phase revalidates active scope and refreshes heartbeat before any expensive work, then returns; exited-run truth gates run asynchronously. Lost/unknown never start/reset/retry. Cancel is idempotent.


## Change
Create `SpikeSupervisor` with injected adapters. Authorize registered root or linked same-common-dir target. Per run: copy full WAI bundle; apply the fixed reviewed observability instrumentation patch (role/model/attempt/timing/token/stderr) and any closed named probe patch after copy; record exact diffs; hash required files; launch only immutable generation. Build fresh runtime allow-list. Set frozen success-path env including OpenCode, workers=1, WAI_DAG_MAX_ATTEMPTS=1, model IDs, wrapper/notify/assessor/report, no test mode and target cwd; report that MAX=1 permits one retry on failure but a successful baseline dispatches once. Add durable conservative USD reservations/reconciliation for all roles and refuse before cap. Recovery synchronously verifies active identities and refreshes heartbeat before bounded return, then asynchronously verifies exited truth. Journal; never auto-reset/retry; service stop leaves run to watchdog.


## Allowed moves
Only supervisor/test. No auto-reset/retry, executor truth, process.env inheritance, dirty/staged start, mutable runner reuse, post-hoc spend-only accounting, or external baseline solely in target.


## STOP triggers
Stop if bundle incomplete, named patch cannot be applied exactly after copy, daemon cannot reach required binaries via explicit env, spend reservation cannot be conservative/durable, recovery cannot refresh a verified live heartbeat before bounded start returns, pid reuse cannot be excluded, or executor files would become authority.


Declared decision points (from the spec; do not edit here):
- DP1: The OpenCode harness or the model provider behind a ladder rung is unavailable or rejects the request for the whole attempt window, so a probe task cannot obtain an executor.  [codes: ladder_exhausted, panel_unavailable, implementer_stopped]
- DP2: The cleanup task (D9) is reached: it deletes the spike directory, the target topic's plan directory and branch, and must not run without the operator's approval token.  [codes: human_gate_required]
- DP3: The spec is amended during the run (for example a probe order change) so the precheck token no longer matches.  [codes: spec_stale]


## Manual verification (record in decisions-ledger)
Run the scoped Vitest file and typecheck. Inspect one fixture run directory mode and persisted record; expected 700 and no credential values.


## Done when
`WAI_TYPECHECK_CMD='npm --prefix plugins/shohin/spike run typecheck' WAI_TEST_CMD='npm --prefix plugins/shohin/spike exec -- vitest run {scope}' bash /home/david/.agents/wai/scripts/task-gate.sh shohin-phase-0-spike 007` exits 0
