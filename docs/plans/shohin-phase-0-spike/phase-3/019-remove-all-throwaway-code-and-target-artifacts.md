---
id: "019"
phase: 3
title: "Remove all throwaway code and target artifacts"
status: ready
depends_on: ["018"]
parallel: false
conflicts_with: ["001","002","003","004","005","006","007","008","009","010","011","012","013","014","015","016","017","018","020"]
files:
  - "dev-docs/workstreams/shohin-phase-0-spike/spike-report.md"
  - "plugins/shohin/spike/.gitignore"
  - "plugins/shohin/spike/package.json"
  - "plugins/shohin/spike/openclaw.plugin.json"
  - "plugins/shohin/spike/tsconfig.json"
  - "plugins/shohin/spike/tsconfig.build.json"
  - "plugins/shohin/spike/package.test.ts"
  - "plugins/shohin/spike/home.allow"
  - "plugins/shohin/spike/env.allow"
  - "plugins/shohin/spike/index.ts"
  - "plugins/shohin/spike/index.test.ts"
  - "plugins/shohin/spike/src/environment.ts"
  - "plugins/shohin/spike/src/environment.test.ts"
  - "plugins/shohin/spike/src/evidence-scripts.test.ts"
  - "plugins/shohin/spike/src/scope.ts"
  - "plugins/shohin/spike/src/scope.test.ts"
  - "plugins/shohin/spike/src/evidence.ts"
  - "plugins/shohin/spike/src/evidence.test.ts"
  - "plugins/shohin/spike/src/supervisor.ts"
  - "plugins/shohin/spike/src/supervisor.test.ts"
  - "plugins/shohin/spike/scripts/notify.sh"
  - "plugins/shohin/spike/scripts/report-append.sh"
  - "plugins/shohin/spike/scripts/opencode-wrapper.sh"
  - "plugins/shohin/spike/scripts/orchestrator-abort.sh"
  - "plugins/shohin/spike/scripts/watchdog.sh"
siblings: ["dev-docs/workstreams/shohin-phase-0-spike/README.md"]
irreversible: true
scope_test: "N/A"
allowed_change: mixed
covers_criteria: []
covers_tests: []
---
## Failing test (write first)
N/A — D9 requires an operator approval token before any deletion.


## Change
Do nothing until the operator creates exact gate token `docs/plans/shohin-phase-0-spike/reviews/019.approved` containing approver, UTC timestamp and approved deletion scope; reference task-gate's exact path and never self-author it. Then prove no run/warm scope lives, capture ignored evidence/report backup externally, disable/uninstall managed plugin, explicitly remove leftover installed directory, restart/health-check gateway. Remove/prune target and lane worktrees, delete only branch `spike/shohin-spike-target`, remove ignored spike runtime/dependencies, then git-rm exactly listed tracked sources.

**File:** `dev-docs/workstreams/shohin-phase-0-spike/spike-report.md`. **Anchor:** literal `<!-- evidence:SC8 -->` inside `## SC8 — cleanup`. **Before:** marker. **After:** replace with `### Cleanup execution` containing approval-token identifier, UTC results, stopped scopes, uninstall/restart, target worktree/branch removal and pre-spike SHA. Task020 appends verifier evidence beneath this subsection.


## Allowed moves
Delete exactly the listed throwaway files and edit only the report. Do not delete the persistent gateway/config/database, Shohin shell, outer spike plan/spec/workstream, any non-spike branch, or any agent-plugins/core file. No wildcard branch deletion.


## STOP triggers
Stop with human_gate_required until exact operator-authored reviews/019.approved exists with approver/time/scope; also stop on live/unknown scope, missing backup, installed path mismatch, target branch still checked out, unlisted deletion, or non-spike Shohin drift.


Declared decision points (from the spec; do not edit here):
- DP1: The OpenCode harness or the model provider behind a ladder rung is unavailable or rejects the request for the whole attempt window, so a probe task cannot obtain an executor.  [codes: ladder_exhausted, panel_unavailable, implementer_stopped]
- DP2: The cleanup task (D9) is reached: it deletes the spike directory, the target topic's plan directory and branch, and must not run without the operator's approval token.  [codes: human_gate_required]
- DP3: The spec is amended during the run (for example a probe order change) so the precheck token no longer matches.  [codes: spec_stale]


## Manual verification (record in decisions-ledger)
Before returning, `git diff --name-status` shows only D for every listed spike source and M for the report; `git worktree list` and branch list contain no target; installed extension absent; custom RPC absent after healthy restart; persistent gateway active. Do not claim SC8 final cleanliness until Task 020's verifier worktree.


## Done when
`bash /home/david/.agents/wai/scripts/task-gate.sh shohin-phase-0-spike 019` exits 0
