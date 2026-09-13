---
id: "017"
phase: 2
title: "Force lane-worktree failure and verify fail-closed patch"
status: ready
depends_on: ["016"]
parallel: false
conflicts_with: ["001","009","010","011","012","013","014","015","016","018","019","020"]
files:
  - "dev-docs/workstreams/shohin-phase-0-spike/spike-report.md"
irreversible: false
scope_test: "N/A"
allowed_change: edit
covers_criteria: ["SC7"]
covers_tests: ["TS7"]
---
## Failing test (write first)
N/A — the unpatched fallback is the expected unsafe observation.


## Change
**File:** `dev-docs/workstreams/shohin-phase-0-spike/spike-report.md`. Replace SC7 marker with three reset-isolated observations. (1) Read-only TMPDIR proving prompt mktemp fails before lane creation. (2) Named post-copy probe patch to exact `<runDir>/runner/wai-dag-executors.sh`: force `_lane_worktree_add` failure and inject `_dispatch` marker written directly in resolved `dispatch_cwd` before OpenCode. Capture unsafe stock fallback stderr and marker in target root before coordinator handoff. (3) fresh pristine generation, same failure/marker hook plus exact fallback else patch changing shared-tree message to `refusing shared-tree dispatch` and returning nonzero; capture absent dispatch marker/target write. Pin and verify run/executors/gate/cost/watch/VERSION hashes, embed exact diffs, and restore target; never mutate repo/install/global runner.


## Allowed moves
Edit only SC7 report. All patches are named post-copy pre-hash changes to that run's immutable runner generation and embedded; source/installed/global scripts remain read-only.


## STOP triggers
Stop if failure occurs before `_lane_worktree_add`, direct dispatch marker is not captured before handoff, target baseline unknown, outer could be dispatch cwd, patch exceeds named symbols/else branch, or restoration/hash proof fails.


Declared decision points (from the spec; do not edit here):
- DP1: The OpenCode harness or the model provider behind a ladder rung is unavailable or rejects the request for the whole attempt window, so a probe task cannot obtain an executor.  [codes: ladder_exhausted, panel_unavailable, implementer_stopped]
- DP2: The cleanup task (D9) is reached: it deletes the spike directory, the target topic's plan directory and branch, and must not run without the operator's approval token.  [codes: human_gate_required]
- DP3: The spec is amended during the run (for example a probe order change) so the precheck token no longer matches.  [codes: spec_stale]


## Manual verification (record in decisions-ledger)
Report distinguishes invalid TMPDIR, unsafe fallback marker in target, and fail-closed no-marker result. Final has nonzero launch, refusal text, no target diff/commit, and fresh pristine generation hashes.


## Done when
`WAI_TYPECHECK_CMD='npm --prefix plugins/shohin/spike run typecheck' WAI_TEST_CMD='npm --prefix plugins/shohin/spike exec -- vitest run {scope}' bash /home/david/.agents/wai/scripts/task-gate.sh shohin-phase-0-spike 017` exits 0
