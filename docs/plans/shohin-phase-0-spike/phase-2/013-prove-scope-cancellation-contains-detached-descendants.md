---
id: "013"
phase: 2
title: "Prove scope cancellation contains detached descendants"
status: ready
depends_on: ["012"]
parallel: false
conflicts_with: ["001","009","010","011","012","014","015","016","017","018","019","020"]
files:
  - "dev-docs/workstreams/shohin-phase-0-spike/spike-report.md"
irreversible: false
scope_test: "N/A"
allowed_change: edit
covers_criteria: ["SC1"]
covers_tests: ["TS1"]
---
## Failing test (write first)
N/A — the pre-cancel process/commit listing is the baseline.


## Change
**File:** `dev-docs/workstreams/shohin-phase-0-spike/spike-report.md`. Replace SC1 marker. Run full pre-probe reset. Start explicit probe mode with tested setsid-descendant option; watchdog records PID/start-time/run marker. Confirm `systemctl show Id` equals full `shohin-spike-<id>.scope`, capture selected fields/cgroup.procs/recorded process identities and target git log. Invoke cancel; capture verified external TERM then bounded KILL. Recheck unit/cgroup, each recorded PID+start-time and git immediately/15s later. Do not use path grep as sole proof. Record no post-cancel commit. User-scope/cgroup.kill unavailability is a STOP/fail-closed finding, not a process-group fallback claim.


## Allowed moves
Edit only SC1 report evidence. All process control goes through the recorded unit and identity checks. The deliberate sleep is created only inside the run scope and must be absent at task end.


## STOP triggers
Stop if the recorded unit identity does not match, a process would be signalled by pid without start-time check, a descendant survives SIGKILL, a post-cancel commit appears, or process output would expose secret argv/environment.


Declared decision points (from the spec; do not edit here):
- DP1: The OpenCode harness or the model provider behind a ladder rung is unavailable or rejects the request for the whole attempt window, so a probe task cannot obtain an executor.  [codes: ladder_exhausted, panel_unavailable, implementer_stopped]
- DP2: The cleanup task (D9) is reached: it deletes the spike directory, the target topic's plan directory and branch, and must not run without the operator's approval token.  [codes: human_gate_required]
- DP3: The spec is amended during the run (for example a probe order change) so the precheck token no longer matches.  [codes: spec_stale]


## Manual verification (record in decisions-ledger)
Before cancel systemctl Id is exact `.scope`. After cancel scope/cgroup is absent/empty, every recorded PID is absent or has different start-time, and no commit follows cancel timestamp. Report includes full reset and before/after identities.


## Done when
`WAI_TYPECHECK_CMD='npm --prefix plugins/shohin/spike run typecheck' WAI_TEST_CMD='npm --prefix plugins/shohin/spike exec -- vitest run {scope}' bash /home/david/.agents/wai/scripts/task-gate.sh shohin-phase-0-spike 013` exits 0
