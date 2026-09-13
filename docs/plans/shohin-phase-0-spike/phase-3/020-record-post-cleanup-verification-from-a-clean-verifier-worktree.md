---
id: "020"
phase: 3
title: "Record post-cleanup verification from a clean verifier worktree"
status: ready
depends_on: ["019"]
parallel: false
conflicts_with: ["001","009","010","011","012","013","014","015","016","017","018","019"]
files:
  - "dev-docs/workstreams/shohin-phase-0-spike/spike-report.md"
irreversible: false
scope_test: "N/A"
allowed_change: edit
covers_criteria: ["SC8"]
covers_tests: ["TS8"]
---
## Failing test (write first)
N/A — Task019 commit supplies report/deletion preimage; final cleanliness is a read-only post-Task020-commit gate.


## Change
**File:** `dev-docs/workstreams/shohin-phase-0-spike/spike-report.md`. Under SC8 after Cleanup execution, use a detached verifier at committed Task019 to append `### Clean verifier evidence` with literal command/output: empty status; tracked spike count computed with `git ls-files ... | grep ... | wc -l` (or grep plus `|| true`) and asserted zero; non-spike diff empty; target branch/plan/install/plugin absent; gateway active/healthy. Remove verifier. State explicitly this embedded evidence is Task019 tree and final SC8 cleanliness is established only after Task020 commit by the outer gate. Commit only report. After commit, run the same checks read-only against final HEAD with no repository/ledger writes; preserve output only in the executor's immutable external gate artifact/DAG log, not a file that dirties the repository.


## Allowed moves
Edit only SC8's final evidence. The verifier is detached/read-only except normal worktree administrative files and is removed. Do not reinstall/delete anything to make a check pass; a failure is reported and halts.


## STOP triggers
Stop if Task019 uncommitted, verifier dirty, spike path/branch/install remains, non-spike diff exists, gateway unhealthy, a zero-count pipeline returns false failure, or post-commit proof would require writing inside repo.


Declared decision points (from the spec; do not edit here):
- DP1: The OpenCode harness or the model provider behind a ladder rung is unavailable or rejects the request for the whole attempt window, so a probe task cannot obtain an executor.  [codes: ladder_exhausted, panel_unavailable, implementer_stopped]
- DP2: The cleanup task (D9) is reached: it deletes the spike directory, the target topic's plan directory and branch, and must not run without the operator's approval token.  [codes: human_gate_required]
- DP3: The spec is amended during the run (for example a probe order change) so the precheck token no longer matches.  [codes: spec_stale]


## Manual verification (record in decisions-ledger)
After Task020 commit, outer gate reruns status/count/diff/branch/worktree/install/plugin/gateway checks read-only. Expected all SC8 observables; external gate output is immutable evidence. Do not write decisions-ledger/report afterward.


## Done when
`bash /home/david/.agents/wai/scripts/task-gate.sh shohin-phase-0-spike 020` exits 0
