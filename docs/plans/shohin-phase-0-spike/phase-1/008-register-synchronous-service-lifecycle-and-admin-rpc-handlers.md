---
id: "008"
phase: 1
title: "Register synchronous service lifecycle and admin RPC handlers"
status: ready
depends_on: ["007"]
parallel: false
conflicts_with: ["019"]
files:
  - "plugins/shohin/spike/index.ts"
  - "plugins/shohin/spike/index.test.ts"
irreversible: false
scope_test: "plugins/shohin/spike/index.test.ts"
allowed_change: create
covers_criteria: []
covers_tests: []
---
## Failing test (write first)
Create `index.test.ts` first. Assert synchronous register, exact service and three admin-default RPCs. Service start extracts/validates configured canonical repoRoot, runs only bounded recovery phase 1 before publishing ready, schedules expensive exited-run verification asynchronously, and reports recovering/ready/error. Run validates topic/repo/options including probe flags, rejects probes unless explicit probe mode, accepts linked targets only by common-dir identity, and promptly returns handle. Status/cancel validate runId; malformed params use SDK errors; no extra capabilities.


## Change
Create synchronous plugin definition. Configure supervisor during service start from closed manifest `repoRoot`; log unique register/recovery phase markers. Register exactly run/cancel/status. Validate plain objects, required strings, finite ceilings and closed probe options; never wait for DAG completion. Status separates service readiness from run hints/truth. Export only default id shohin-spike.


## Allowed moves
Create only index and its test. No async register, HTTP route, tool, cron, custom scope declaration, direct config/session reads, or swallowing of invalid input.


## STOP triggers
Stop if installed SDK handler signatures differ from the core source, the plugin cannot load TypeScript through Jiti, a method collision exists, or service readiness cannot be represented without another file.


Declared decision points (from the spec; do not edit here):
- DP1: The OpenCode harness or the model provider behind a ladder rung is unavailable or rejects the request for the whole attempt window, so a probe task cannot obtain an executor.  [codes: ladder_exhausted, panel_unavailable, implementer_stopped]
- DP2: The cleanup task (D9) is reached: it deletes the spike directory, the target topic's plan directory and branch, and must not run without the operator's approval token.  [codes: human_gate_required]
- DP3: The spec is amended during the run (for example a probe order change) so the precheck token no longer matches.  [codes: spec_stale]


## Manual verification (record in decisions-ledger)
Run index.test.ts, all spike tests, typecheck and build. Expected all green and dist contains only runtime code. `git diff --check` is clean.


## Done when
`WAI_TYPECHECK_CMD='npm --prefix plugins/shohin/spike run typecheck' WAI_TEST_CMD='npm --prefix plugins/shohin/spike exec -- vitest run {scope}' bash /home/david/.agents/wai/scripts/task-gate.sh shohin-phase-0-spike 008` exits 0
