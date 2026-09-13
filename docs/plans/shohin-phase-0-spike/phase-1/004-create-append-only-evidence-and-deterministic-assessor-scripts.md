---
id: "004"
phase: 1
title: "Create append-only evidence and deterministic assessor scripts"
status: ready
depends_on: ["003"]
parallel: false
conflicts_with: ["019"]
files:
  - "plugins/shohin/spike/scripts/notify.sh"
  - "plugins/shohin/spike/scripts/report-append.sh"
  - "plugins/shohin/spike/scripts/opencode-wrapper.sh"
  - "plugins/shohin/spike/scripts/orchestrator-abort.sh"
  - "plugins/shohin/spike/src/evidence-scripts.test.ts"
irreversible: false
scope_test: "plugins/shohin/spike/src/evidence-scripts.test.ts"
allowed_change: create
covers_criteria: []
covers_tests: []
---
## Failing test (write first)
Create the test first. Assert notify JSON escaping/locking; report append locking; wrapper records role/model/attempt/argv/start/end/status, captures stdout and stderr separately under a 0700 run dir while preserving both streams and status, and exposes token-usage records without environment/secret values; concurrent writes do not interleave. Invoke assessor exactly as `orchestrator-abort.sh <envelope-file> <repo-root>` with no stdin and assert `{overall:'abort',items:[{task_id,decision:'abort',reason}]}` matching the installed runner schema.


## Change
Create four executable strict Bash scripts using Python JSON encoding and flock. Notify accepts exactly the runner's three args. Report append records literal command plus captured stdout/stderr. Wrapper requires explicit real OpenCode binary/call log/role/model/attempt/run dir; tee/capture stderr before the copied executor's `/dev/null` boundary, preserve NDJSON stdout/status, and append redacted per-call timing/usage records. Assessor reads envelope path from `$1`, validates repo root `$2`, extracts attended task ids, and emits the runner's actual overall/items decision schema; it never reads stdin or invokes a model. It is not claimed to control gate-fail, which routes through `_infra_retry`.


## Allowed moves
Only create these scripts and their test. Never log environment values, auth-file contents or prompts. The deterministic assessor is used for measurement/control only and its model cost is recorded as zero.


## STOP triggers
Stop if the runner passes a different notify arity, the assessor decision schema cannot be confirmed from the installed runner, JSON records can interleave under the concurrency test, or forwarding output changes OpenCode NDJSON.


Declared decision points (from the spec; do not edit here):
- DP1: The OpenCode harness or the model provider behind a ladder rung is unavailable or rejects the request for the whole attempt window, so a probe task cannot obtain an executor.  [codes: ladder_exhausted, panel_unavailable, implementer_stopped]
- DP2: The cleanup task (D9) is reached: it deletes the spike directory, the target topic's plan directory and branch, and must not run without the operator's approval token.  [codes: human_gate_required]
- DP3: The spec is amended during the run (for example a probe order change) so the precheck token no longer matches.  [codes: spec_stale]


## Manual verification (record in decisions-ledger)
Run `npm --prefix plugins/shohin/spike exec -- vitest run src/evidence-scripts.test.ts`, typecheck, and `stat -c '%a %n' plugins/shohin/spike/scripts/*`. Expected: tests/typecheck pass and every script is 755.


## Done when
`WAI_TYPECHECK_CMD='npm --prefix plugins/shohin/spike run typecheck' WAI_TEST_CMD='npm --prefix plugins/shohin/spike exec -- vitest run {scope}' bash /home/david/.agents/wai/scripts/task-gate.sh shohin-phase-0-spike 004` exits 0
