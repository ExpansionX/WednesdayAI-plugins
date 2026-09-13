---
id: "014"
phase: 2
title: "Prove attention and run-state files remain non-authoritative"
status: ready
depends_on: ["013"]
parallel: false
conflicts_with: ["001","009","010","011","012","013","015","016","017","018","019","020"]
files:
  - "dev-docs/workstreams/shohin-phase-0-spike/spike-report.md"
irreversible: false
scope_test: "N/A"
allowed_change: edit
covers_criteria: ["SC4"]
covers_tests: ["TS4"]
---
## Failing test (write first)
N/A — the deliberately impossible target gate creates the expected attention path.


## Change
**File:** `dev-docs/workstreams/shohin-phase-0-spike/spike-report.md`. Replace SC4 marker. Run full reset, then commit a disposable probe-only mutation to the target's pre-existing targeted gate fixture so it deterministically exits nonzero; record this probe baseline. Start workers=1/MAX_ATTEMPTS=0. Document actual control flow: gate-fail enters `_infra_retry`, reaches bounded exhaustion, and does not claim assessor control; deterministic assessor remains correctly wired for assessor-routed kinds. Capture attention log/JSONL after bounded drain, run-state hint, exit, commits and independent failing gate. Forge valid done hints/state, call status, prove authoritative outcome unchanged. Restore original external target baseline and clean state.


## Allowed moves
Edit only SC4 evidence. Disposable target mutation and forged ignored run-data are allowed, never committed to the outer branch. Do not make the supervisor consume or promote from either forged file.


## STOP triggers
Stop if forcing attention requires editing the frozen outer spec/plan, if a forged hint changes supervisor truth, if unknown task ids are accepted as authoritative, or if the target cannot be restored to its external baseline.


Declared decision points (from the spec; do not edit here):
- DP1: The OpenCode harness or the model provider behind a ladder rung is unavailable or rejects the request for the whole attempt window, so a probe task cannot obtain an executor.  [codes: ladder_exhausted, panel_unavailable, implementer_stopped]
- DP2: The cleanup task (D9) is reached: it deletes the spike directory, the target topic's plan directory and branch, and must not run without the operator's approval token.  [codes: human_gate_required]
- DP3: The spec is amended during the run (for example a probe order change) so the precheck token no longer matches.  [codes: spec_stale]


## Manual verification (record in decisions-ledger)
Attention-file count matches emitted notify calls after bounded drain or discrepancy is explicitly recorded; state reaches a terminal label; independent truth remains failure before and after forged hints; target returns clean at baseline.


## Done when
`WAI_TYPECHECK_CMD='npm --prefix plugins/shohin/spike run typecheck' WAI_TEST_CMD='npm --prefix plugins/shohin/spike exec -- vitest run {scope}' bash /home/david/.agents/wai/scripts/task-gate.sh shohin-phase-0-spike 014` exits 0
