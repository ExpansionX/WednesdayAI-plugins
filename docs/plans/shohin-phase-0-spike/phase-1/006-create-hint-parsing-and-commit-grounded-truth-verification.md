---
id: "006"
phase: 1
title: "Create hint parsing and commit-grounded truth verification"
status: ready
depends_on: ["005"]
parallel: false
conflicts_with: ["019"]
files:
  - "plugins/shohin/spike/src/evidence.ts"
  - "plugins/shohin/spike/src/evidence.test.ts"
irreversible: false
scope_test: "plugins/shohin/spike/src/evidence.test.ts"
allowed_change: create
covers_criteria: []
covers_tests: []
---
## Failing test (write first)
Create `evidence.test.ts` first with a temporary git repository and fake gate. Assert: malformed/duplicate/unknown-task notify and run-state entries are retained only as `{source:'executor',authoritative:false}` hints; forged terminal hints cannot produce success; runner exit 0 plus a complete expected task-to-commit map plus each gate exit 0 is required for verified success; missing task, non-ancestor commit, dirty manifest hash, runner nonzero or gate nonzero produces a named failure. Assert the gate is run in a temporary verifier worktree checked out at the exact task commit, with `task-gate.sh <topic> <id> --commit <same sha>`, restricted env, and the verifier worktree removed afterward.


## Change
Create `evidence.ts` exports for bounded hint parsing, expected-task commit enumeration and authoritative outcome. Expected ids come from committed task files at external baseline. Accept only post-baseline commits ancestral to recorded branch. Verify each in a detached exact-SHA worktree by `/home/david/.agents/wai/scripts/task-gate.sh <topic> <id> --commit <same-sha>` with explicit credential-free env and literal WAI typecheck/test controls appropriate to that target; never run historical tests from final HEAD. Success requires runner exit 0, exact commit coverage, every independent gate green and manifest equality; all executor files remain provenance-tagged hints.


## Allowed moves
Only the two files. Do not treat `.wai-run-state.json`, `.wai-dag-plan-commit`, `.dag-passed-commits`, notify records, worker handoffs, commit messages or runner exit 0 alone as truth.


## STOP triggers
Stop if task ids cannot be derived from the baseline commit, a historical gate would execute against final HEAD, the gate requires operator credentials, or verification needs an unlisted file.


Declared decision points (from the spec; do not edit here):
- DP1: The OpenCode harness or the model provider behind a ladder rung is unavailable or rejects the request for the whole attempt window, so a probe task cannot obtain an executor.  [codes: ladder_exhausted, panel_unavailable, implementer_stopped]
- DP2: The cleanup task (D9) is reached: it deletes the spike directory, the target topic's plan directory and branch, and must not run without the operator's approval token.  [codes: human_gate_required]
- DP3: The spec is amended during the run (for example a probe order change) so the precheck token no longer matches.  [codes: spec_stale]


## Manual verification (record in decisions-ledger)
Run the scoped Vitest file and typecheck. The forged-hint case must stay green only because the outcome remains failure; record this invariant in the ledger.


## Done when
`WAI_TYPECHECK_CMD='npm --prefix plugins/shohin/spike run typecheck' WAI_TEST_CMD='npm --prefix plugins/shohin/spike exec -- vitest run {scope}' bash /home/david/.agents/wai/scripts/task-gate.sh shohin-phase-0-spike 006` exits 0
