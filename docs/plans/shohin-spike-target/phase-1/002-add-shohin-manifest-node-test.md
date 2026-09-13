---
id: "002"
phase: 1
title: "Add Shohin manifest node test"
status: ready
depends_on: ["001"]
parallel: false
conflicts_with: []
files:
  - "plugins/shohin/manifest.test.mjs"
siblings: ["plugins/shohin/LICENSE","plugins/shohin/README.md","plugins/shohin/VISION.md","plugins/shohin/index.ts","plugins/shohin/openclaw.plugin.json","plugins/shohin/package.json"]
irreversible: false
scope_test: "plugins/shohin/manifest.test.mjs"
allowed_change: create
covers_criteria: ["SC2"]
covers_tests: ["TS2"]
---
## Failing test (write first)
Create a node:test regression that reads the Shohin manifest after task 001 and asserts the closed storage sqlitePath schema. The file is absent at the target baseline, so task-gate's create boundary proves it is introduced by this task.


## Change
**File:** `plugins/shohin/manifest.test.mjs`

Create a node:test module using `node:assert/strict` and `node:fs` to parse `plugins/shohin/openclaw.plugin.json`. Assert that `configSchema.properties.storage.type` is `object`, `configSchema.properties.storage.additionalProperties` is `false`, the storage schema exposes only `sqlitePath`, and `configSchema.properties.storage.properties.sqlitePath.type` is `string`.


## Allowed moves
Test-file creation only. Do not edit the Shohin manifest or any other product file in this task.


## STOP triggers
Stop if task 002 touches anything except `plugins/shohin/manifest.test.mjs`, if it does not depend on task 001, or if `node --test plugins/shohin/manifest.test.mjs` is not green after creation.


Declared decision points (from the spec; do not edit here):
- DP1: The target branch, worktree, common-dir identity, or red/green gate result does not match the recorded baseline before any target task executes.  [codes: target_identity_mismatch, target_gate_not_red_green]


## Manual verification (record in decisions-ledger)
Run `node --test plugins/shohin/manifest.test.mjs` after task 002 creates the file and confirm the commit file set contains only the new test file.


## Done when
`WAI_TYPECHECK_CMD="node --check plugins/shohin/manifest.test.mjs" bash /home/david/.agents/wai/scripts/task-gate.sh shohin-spike-target 002` exits 0
