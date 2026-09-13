---
id: "011"
phase: 2
title: "Run the cold baseline and derive the minimal ephemeral HOME"
status: ready
depends_on: ["010"]
parallel: false
conflicts_with: ["001","009","010","012","013","014","015","016","017","018","019","020"]
files:
  - "dev-docs/workstreams/shohin-phase-0-spike/spike-report.md"
irreversible: false
scope_test: "N/A"
allowed_change: edit
covers_criteria: ["SC2"]
covers_tests: ["TS2"]
---
## Failing test (write first)
N/A — each failed authentication run is the deliberate RED observation.


## Change
**File:** `dev-docs/workstreams/shohin-phase-0-spike/spike-report.md`. Replace SC2 marker with iteration table and raw redacted evidence. Before every sample: prove prior full `.scope`/pids dead; invoke pinned runner `--reset full` in target; restore/verify external baseline; rotate probe logs/cost; assert pending expected ids and clean target; never reset outer tree. Start fresh ignored runtime allow-list from immutable empty default. For each exact auth/config error add only one harness path/XDG redirect and fresh HOME; never copy operator secrets/caches wholesale. Run frozen baseline cold/no attach/test mode, workers 1, WAI_DAG_MAX_ATTEMPTS=1, wrapper and pre-dispatch reservation; note actual off-by-one semantics and require successful first attempt for one-rung evidence. Completion executes and independently verifies at least one task. Embed runtime allow-list metadata only.


## Allowed moves
Edit only SC2 evidence in the report. Runtime changes to ignored home.allow copy/run-data/runner artifacts are allowed and must be described, not committed. Do not weaken the explicit environment or use an operator HOME as fallback.


## STOP triggers
Stop on DP1, spend cap, 30-minute attempt, a request for non-harness credentials, a need to copy the whole HOME, or any evidence that the executor inherited a gateway/git/SSH/gh secret.


Declared decision points (from the spec; do not edit here):
- DP1: The OpenCode harness or the model provider behind a ladder rung is unavailable or rejects the request for the whole attempt window, so a probe task cannot obtain an executor.  [codes: ladder_exhausted, panel_unavailable, implementer_stopped]
- DP2: The cleanup task (D9) is reached: it deletes the spike directory, the target topic's plan directory and branch, and must not run without the operator's approval token.  [codes: human_gate_required]
- DP3: The spec is amended during the run (for example a probe order change) so the precheck token no longer matches.  [codes: spec_stale]


## Manual verification (record in decisions-ledger)
The gateway run status plus supervisor truth shows at least one independently gate-verified target commit. Inspect `/proc/<pid>/environ` during the run and the ephemeral HOME after; only allowed entries exist. The SC2 table contains one preceding error for every copied item.


## Done when
`WAI_TYPECHECK_CMD='npm --prefix plugins/shohin/spike run typecheck' WAI_TEST_CMD='npm --prefix plugins/shohin/spike exec -- vitest run {scope}' bash /home/david/.agents/wai/scripts/task-gate.sh shohin-phase-0-spike 011` exits 0
