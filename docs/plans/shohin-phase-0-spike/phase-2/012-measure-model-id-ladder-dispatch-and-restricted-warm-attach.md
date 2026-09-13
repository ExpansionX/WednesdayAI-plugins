---
id: "012"
phase: 2
title: "Measure model-id ladder dispatch and restricted warm attach"
status: ready
depends_on: ["011"]
parallel: false
conflicts_with: ["001","009","010","011","013","014","015","016","017","018","019","020"]
files:
  - "dev-docs/workstreams/shohin-phase-0-spike/spike-report.md"
irreversible: false
scope_test: "N/A"
allowed_change: edit
covers_criteria: ["SC3a","SC3b"]
covers_tests: ["TS3"]
---
## Failing test (write first)
N/A — unsupported model/attach output is an accepted measured result.


## Change
**File:** `dev-docs/workstreams/shohin-phase-0-spike/spike-report.md`. Replace SC3a/SC3b markers. Full reset before each sample. SC3a: successful frozen MAX_ATTEMPTS=1 first attempt, then separately reserved named controlled-worker-failure patch to exact generation with MAX_ATTEMPTS=2 reaching attempts 1-3/all model IDs; embed patch and restore. Report model IDs versus named-agent behavior before optional --agent copy experiment. SC3b compares same-baseline cold to separately scoped restricted-HOME serve with per-role accounting; never operator server; prove attach or stderr fallback; control prewarm/teardown.


## Allowed moves
Edit only SC3a/SC3b report evidence. Ignored runtime runner-copy/run-data patches are allowed only after unpatched evidence and must be embedded as diffs. No external warm server with operator HOME is valid evidence.


## STOP triggers
Stop on DP1/spend/time cap, if cold and warm start from different externally verified baselines, if the warm server cannot be contained/restricted, or if argv/tokens/timing cannot be attributed by mode.


Declared decision points (from the spec; do not edit here):
- DP1: The OpenCode harness or the model provider behind a ladder rung is unavailable or rejects the request for the whole attempt window, so a probe task cannot obtain an executor.  [codes: ladder_exhausted, panel_unavailable, implementer_stopped]
- DP2: The cleanup task (D9) is reached: it deletes the spike directory, the target topic's plan directory and branch, and must not run without the operator's approval token.  [codes: human_gate_required]
- DP3: The spec is amended during the run (for example a probe order change) so the precheck token no longer matches.  [codes: spec_stale]


## Manual verification (record in decisions-ledger)
Both tables name the same target plan baseline and task set. Wrapper records prove `-m <model-id>` and warm `--attach <url>` or capture the attach failure. Warm scope has no surviving processes after teardown.


## Done when
`WAI_TYPECHECK_CMD='npm --prefix plugins/shohin/spike run typecheck' WAI_TEST_CMD='npm --prefix plugins/shohin/spike exec -- vitest run {scope}' bash /home/david/.agents/wai/scripts/task-gate.sh shohin-phase-0-spike 012` exits 0
