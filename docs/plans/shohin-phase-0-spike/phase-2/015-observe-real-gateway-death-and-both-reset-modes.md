---
id: "015"
phase: 2
title: "Observe real gateway death and both reset modes"
status: ready
depends_on: ["014"]
parallel: false
conflicts_with: ["001","009","010","011","012","013","014","016","017","018","019","020"]
files:
  - "dev-docs/workstreams/shohin-phase-0-spike/spike-report.md"
irreversible: false
scope_test: "N/A"
allowed_change: edit
covers_criteria: ["SC5"]
covers_tests: ["TS5"]
---
## Failing test (write first)
N/A — killing the gateway is the deliberate failure injection.


## Change
**File:** `dev-docs/workstreams/shohin-phase-0-spike/spike-report.md`. Replace SC5 marker. First compare adopted gateway Id/FragmentPath/version/config against Task001 ownership baseline; otherwise STOP. Back up target refs/state externally. For each variant run full pre-probe reset, start a deliberately long run, capture exact scope identities/T0, SIGKILL only the confirmed dev `openclaw-gateway.service`, poll scope, and capture precise journal kill/restart/plugin/recovery timestamps plus worktree state. Variants: (1) original RestartSec with watchdog; (2) temporary delayed-restart drop-in with watchdog, ceiling far above watchdog threshold; (3) delayed restart with watchdog explicitly disabled in probe mode and a controlled short RuntimeMaxSec, isolating ceiling. Restore and verify exact drop-in/unit properties after every variant. Only with old scope dead, separately capture pinned partial `--reset` effects; restore external scratch/baseline; capture `--reset full`; name every discarded/preserved ref/file and executor-writable baseline risk.


## Allowed moves
Edit only SC5 report. Temporary dev-unit drop-in is restored after each variant; gateway ends active at exact baseline. Target reset only after old full scope identity is dead; never reset outer or trust executor baseline alone.


## STOP triggers
Stop if ownership/unit identity differs, channels/production could be affected, backup absent, old scope uncertain, reset root is outer, gateway fails recovery, any drop-in property cannot be restored exactly, or watchdog-disabled probe can escape RuntimeMaxSec.


Declared decision points (from the spec; do not edit here):
- DP1: The OpenCode harness or the model provider behind a ladder rung is unavailable or rejects the request for the whole attempt window, so a probe task cannot obtain an executor.  [codes: ladder_exhausted, panel_unavailable, implementer_stopped]
- DP2: The cleanup task (D9) is reached: it deletes the spike directory, the target topic's plan directory and branch, and must not run without the operator's approval token.  [codes: human_gate_required]
- DP3: The spec is amended during the run (for example a probe order change) so the precheck token no longer matches.  [codes: spec_stale]


## Manual verification (record in decisions-ledger)
All required timestamps and three isolation variants are present; default/delayed-watchdog/delayed-no-watchdog-ceiling each name termination mechanism. Reset tables are exact. Gateway active and selected properties byte-for-byte match Task001 baseline.


## Done when
`WAI_TYPECHECK_CMD='npm --prefix plugins/shohin/spike run typecheck' WAI_TEST_CMD='npm --prefix plugins/shohin/spike exec -- vitest run {scope}' bash /home/david/.agents/wai/scripts/task-gate.sh shohin-phase-0-spike 015` exits 0
