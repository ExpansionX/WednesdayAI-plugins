---
id: "010"
phase: 1
title: "Prepare the isolated two-task WAI target topic"
status: ready
depends_on: ["009"]
parallel: false
conflicts_with: ["001","009","011","012","013","014","015","016","017","018","019","020"]
files:
  - "dev-docs/workstreams/shohin-phase-0-spike/spike-report.md"
irreversible: false
scope_test: "N/A"
allowed_change: edit
covers_criteria: []
covers_tests: []
---
## Failing test (write first)
N/A — the target's own precheck and plan lint are the gates.


## Change
**File:** `dev-docs/workstreams/shohin-phase-0-spike/spike-report.md`. Append Target topic evidence. Create a mode-0700 sibling/runtime worktree outside both outer checkout and Git common-dir `.git`, branch `spike/shohin-spike-target`; record `git worktree list --porcelain`, canonical common dir and path. Prepare active target spec/precheck/plan via real submitters. Before target tasks, create and commit a throwaway targeted gate fixture under the target's own plan artifacts that exits nonzero unless Shohin manifest has closed `storage.sqlitePath:string`; it is planning/test evidence, not a product edit. T001 edits only the manifest and its scope test invokes that targeted fixture, so preimage is demonstrably RED and post-change GREEN; generic manifest validation is additional only. T002 creates only `plugins/shohin/manifest.test.mjs` and runs node:test. Exactly two sequential tasks, no test mode, committed/fresh/lint-clean. Record task paths, baseline and input externally.


## Allowed moves
Only the report changes on the outer branch. All target artifacts live and commit only on the throwaway branch/worktree; do not merge or push it. Use submitters rather than hand-writing rendered target plan files. The target is a real WAI topic but its tiny breakdown review may be a recorded manual review because this outer plan already fixes both tasks exactly.


## STOP triggers
Stop if branch/worktree exists, target is inside outer checkout or `.git`, common-dir identity differs, outer checkout changes, targeted T001 gate is not RED on preimage/GREEN after intended edit, precheck/lint fails, product file sets exceed manifest+test, or target plan is dirty/uncommitted.


Declared decision points (from the spec; do not edit here):
- DP1: The OpenCode harness or the model provider behind a ladder rung is unavailable or rejects the request for the whole attempt window, so a probe task cannot obtain an executor.  [codes: ladder_exhausted, panel_unavailable, implementer_stopped]
- DP2: The cleanup task (D9) is reached: it deletes the spike directory, the target topic's plan directory and branch, and must not run without the operator's approval token.  [codes: human_gate_required]
- DP3: The spec is amended during the run (for example a probe order change) so the precheck token no longer matches.  [codes: spec_stale]


## Manual verification (record in decisions-ledger)
In the target worktree run branch guard, freshness, readiness and plan lint; all pass. `git status --porcelain` is empty, current branch is spike/shohin-spike-target, and the two target task files have exact non-overlapping file lists and 002 depends on 001. In the outer checkout only the report is modified.


## Done when
`WAI_TYPECHECK_CMD='npm --prefix plugins/shohin/spike run typecheck' WAI_TEST_CMD='npm --prefix plugins/shohin/spike exec -- vitest run {scope}' bash /home/david/.agents/wai/scripts/task-gate.sh shohin-phase-0-spike 010` exits 0
