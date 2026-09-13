---
id: "016"
phase: 2
title: "Inventory the runner bundle environment and complete cost accounting"
status: ready
depends_on: ["015"]
parallel: false
conflicts_with: ["001","009","010","011","012","013","014","015","017","018","019","020"]
files:
  - "dev-docs/workstreams/shohin-phase-0-spike/spike-report.md"
irreversible: false
scope_test: "N/A"
allowed_change: edit
covers_criteria: ["SC6"]
covers_tests: ["TS6"]
---
## Failing test (write first)
N/A — inventory is reconciled from observed exec and usage events.


## Change
**File:** `dev-docs/workstreams/shohin-phase-0-spike/spike-report.md`. Replace SC6 marker with six reconciled tables: immutable runtime bundle path/file/hash including run, executors, gate, cost-report, watch, VERSION; complete executable path/version inventory from the Task005 probe-only `strace -ff -e trace=execve` prefix (not wrapper alone); variable names for control env, runner and child with all values redacted/classified; copied auth/config/cache roles; git preconditions; and durable per-call accounting task/role/model/attempt/start/end/elapsed/tokens/estimated-USD/reservation/source for worker, validator, prewarm, assessor (deterministic zero is labelled construction), terminal reviewer. Reconcile instrumented copied bundle/wrapper records against dag-cost.tsv's conflation/omissions. Include installed runner hash and read-only source drift. Assert running reservations prevented exceeding USD 50, not merely that post-hoc total is low.


## Allowed moves
Edit only SC6 evidence. Read `/proc` only for recorded run identities while alive; never persist values of tokens/secrets. No new credential, package, runner or core changes.


## STOP triggers
Stop if observed executable/env/auth inventory is incomplete, values cannot be redacted safely, cost cannot be attributed at least by role/model/tokens/time, the cap is exceeded, or collecting data would require privileged tracing of unrelated processes.


Declared decision points (from the spec; do not edit here):
- DP1: The OpenCode harness or the model provider behind a ladder rung is unavailable or rejects the request for the whole attempt window, so a probe task cannot obtain an executor.  [codes: ladder_exhausted, panel_unavailable, implementer_stopped]
- DP2: The cleanup task (D9) is reached: it deletes the spike directory, the target topic's plan directory and branch, and must not run without the operator's approval token.  [codes: human_gate_required]
- DP3: The spec is amended during the run (for example a probe order change) so the precheck token no longer matches.  [codes: spec_stale]


## Manual verification (record in decisions-ledger)
Reconcile observed execve names with `command -v`; every runner bundle hash verifies; environment table names forbidden credentials as absent; sum token/cost rows and compare with cap; report calls out built-in dag-cost.tsv gaps rather than presenting its flat estimate as truth.


## Done when
`WAI_TYPECHECK_CMD='npm --prefix plugins/shohin/spike run typecheck' WAI_TEST_CMD='npm --prefix plugins/shohin/spike exec -- vitest run {scope}' bash /home/david/.agents/wai/scripts/task-gate.sh shohin-phase-0-spike 016` exits 0
