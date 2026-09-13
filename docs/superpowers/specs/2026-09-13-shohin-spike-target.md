---
doc_type: spec
status: active
workstream: shohin-spike-target
change_kind: behaviour
verify_cmd: "node --test plugins/shohin/manifest.test.mjs"
---

# Shohin Spike Target

## Intent
Prepare a tiny real WAI target that changes the existing Shohin manifest in one task and adds a focused manifest regression in the next task. The target exists only to exercise WAI's task decomposition, file boundaries, and deterministic gate behavior before paid probe dispatch is allowed.


## User stories
- **US1:** As the spike operator, I can see a targeted gate fail on the baseline manifest and succeed after the intended manifest-only edit.
- **US2:** As a maintainer, I can keep a small node:test regression that reads the Shohin manifest and checks the storage sqlitePath schema.

## Success criteria
SC1: A repo-root command running the precommitted targeted gate fixture exits nonzero on the baseline manifest and exits zero after only `plugins/shohin/openclaw.plugin.json` declares `configSchema.properties.storage` as a closed object with `sqlitePath` typed string.
→ US1
SC2: Task 002 creates `plugins/shohin/manifest.test.mjs` as a node:test module whose assertions inspect the committed Shohin manifest for the closed `storage.sqlitePath` string schema.
→ US2

## Users
The immediate user is the Shohin Phase 0 spike operator. Later workers use the target branch as a controlled two-step repository change with visible red and green gate evidence.


## Constraints
The target branch is disposable and must not be merged or pushed. The baseline stays before either target task. Task 001 may edit only the existing Shohin manifest, and task 002 may create only the manifest node:test file. No paid model dispatch is part of preparing this target.


## Out of scope
The target does not implement durable Shohin product behavior beyond the planned manifest schema edit and planned regression file. It does not change WednesdayAI core, gateway configuration, production channels, or any runner script.


## Approach
Use a linked worktree on the same git common directory. Freeze this active spec, submit a two-task plan, and precommit the task 001 targeted gate fixture as plan evidence. Leave the branch clean at the pre-task baseline for the later WAI execution probe.


## Design
Task 001 updates `plugins/shohin/openclaw.plugin.json` so the manifest config schema declares `storage` as a closed object whose `sqlitePath` property is typed as a string.
Task 002 creates `plugins/shohin/manifest.test.mjs` as a node:test module that parses the committed Shohin manifest and asserts the same closed `storage.sqlitePath` schema.


## Decisions
D1: Use exactly two sequential target tasks: a manifest-only edit, then a manifest-test creation. This keeps the probe's dependency and file boundaries mechanically visible.


## Test strategy
TS1: Run the precommitted targeted gate fixture before and after the manifest-only edit and record the nonzero and zero exits.
TS2: Run `node --test plugins/shohin/manifest.test.mjs` after task 002 creates it.
