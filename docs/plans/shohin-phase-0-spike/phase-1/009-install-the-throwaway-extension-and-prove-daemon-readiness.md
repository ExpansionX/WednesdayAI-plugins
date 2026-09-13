---
id: "009"
phase: 1
title: "Install the throwaway extension and prove daemon readiness"
status: ready
depends_on: ["008"]
parallel: false
conflicts_with: ["001","010","011","012","013","014","015","016","017","018","019","020"]
files:
  - "dev-docs/workstreams/shohin-phase-0-spike/spike-report.md"
irreversible: false
scope_test: "N/A"
allowed_change: edit
covers_criteria: []
covers_tests: []
---
## Failing test (write first)
N/A — the daemon registry is the observable.


## Change
**File:** `dev-docs/workstreams/shohin-phase-0-spike/spike-report.md`. Append under Development gateway redacted evidence for all tests/typecheck/build, absent target, managed-copy install, enable, and setting the closed plugin config `repoRoot` to this canonical outer checkout before restart. Poll daemon health/custom status to ready. Record `SPIKE_INSTALL_DIR` realpath, configured root/common-dir identity, and source-vs-installed hashes. From here runtime allow-list mutations occur only in per-run ignored data and probe patches only in a copied `<runDir>/runner` generation after copy-before-hash-before-launch; repo source is never assumed live. If source runtime code changes, require explicit reinstall/restart and new hash pair.


## Allowed moves
Edit only the report in Git. Host writes are limited to the managed shohin-spike install/config and daemon restart. Never include the gateway token or raw daemon environment.


## STOP triggers
Stop if the install target already exists, install is reported untracked/linked, plugin is not explicitly enabled, daemon-side custom status never reaches ready, or restart breaks gateway health.


Declared decision points (from the spec; do not edit here):
- DP1: The OpenCode harness or the model provider behind a ladder rung is unavailable or rejects the request for the whole attempt window, so a probe task cannot obtain an executor.  [codes: ladder_exhausted, panel_unavailable, implementer_stopped]
- DP2: The cleanup task (D9) is reached: it deletes the spike directory, the target topic's plan directory and branch, and must not run without the operator's approval token.  [codes: human_gate_required]
- DP3: The spec is amended during the run (for example a probe order change) so the precheck token no longer matches.  [codes: spec_stale]


## Manual verification (record in decisions-ledger)
`OPENCLAW_CATALOG_REMOTE=0 wednesdayai plugins info shohin-spike --json`, `wednesdayai gateway call plugins/health --json`, and `wednesdayai gateway call shohinSpike.status --params '{}' --json` all identify the installed plugin; status is ready. Record outputs after redaction.


## Done when
`WAI_TYPECHECK_CMD='npm --prefix plugins/shohin/spike run typecheck' WAI_TEST_CMD='npm --prefix plugins/shohin/spike exec -- vitest run {scope}' bash /home/david/.agents/wai/scripts/task-gate.sh shohin-phase-0-spike 009` exits 0
