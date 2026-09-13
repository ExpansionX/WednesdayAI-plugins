---
id: "001"
phase: 1
title: "Add closed Shohin storage sqlitePath config"
status: ready
depends_on: []
parallel: false
conflicts_with: []
files:
  - "plugins/shohin/openclaw.plugin.json"
irreversible: false
scope_test: "docs/plans/shohin-spike-target/reviews/t001-storage-sqlite-path-gate.mjs"
allowed_change: edit
covers_criteria: ["SC1"]
covers_tests: ["TS1"]
---
## Failing test (write first)
The precommitted targeted gate fixture reads the baseline Shohin manifest and exits nonzero because configSchema.properties.storage is absent. Run `node --test docs/plans/shohin-spike-target/reviews/t001-storage-sqlite-path-gate.mjs` before the manifest edit and record the nonzero exit.


## Change
**File:** `plugins/shohin/openclaw.plugin.json`

Add `storage` under `configSchema.properties` as `{ "type": "object", "additionalProperties": false, "properties": { "sqlitePath": { "type": "string" } } }`. Leave the existing `enabled` property and top-level closed config schema intact. Do not edit any other product file.


## Allowed moves
Manifest-only edit. Do not add the node:test regression in this task. Do not touch target plan artifacts except for normal WAI gate bookkeeping.


## STOP triggers
Stop if the gate fixture is not red before the manifest edit, if the manifest edit touches any path other than `plugins/shohin/openclaw.plugin.json`, or if the fixture is not green after the intended edit.


Declared decision points (from the spec; do not edit here):
- DP1: The target branch, worktree, common-dir identity, or red/green gate result does not match the recorded baseline before any target task executes.  [codes: target_identity_mismatch, target_gate_not_red_green]


## Manual verification (record in decisions-ledger)
Run the targeted fixture before and after the manifest-only edit. The baseline run must exit nonzero, and the post-edit run must exit zero.


## Done when
`WAI_TYPECHECK_CMD="node --check docs/plans/shohin-spike-target/reviews/t001-storage-sqlite-path-gate.mjs" bash /home/david/.agents/wai/scripts/task-gate.sh shohin-spike-target 001` exits 0
