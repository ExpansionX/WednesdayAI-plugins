---
id: "005"
phase: 1
title: "Create the systemd scope controller and in-scope watchdog"
status: ready
depends_on: ["004"]
parallel: false
conflicts_with: ["019"]
files:
  - "plugins/shohin/spike/src/scope.ts"
  - "plugins/shohin/spike/src/scope.test.ts"
  - "plugins/shohin/spike/scripts/watchdog.sh"
irreversible: false
scope_test: "plugins/shohin/spike/src/scope.test.ts"
allowed_change: create
covers_criteria: []
covers_tests: []
---
## Failing test (write first)
Create `scope.test.ts` first with injected command/fs/clock seams. Assert `systemd-run` receives minimal control env, while after `--` `env -i` creates separate executor env; exact `.scope` Id. Assert three probe-only controls reject outside probe mode: strace prefix, recorded setsid descendant, and watchdog-disabled mode. Inspect identities; external cancel verifies Id then TERM/bounded KILL. Normal stale watchdog derives cgroup-v2 path and atomically writes cgroup.kill, catching setsid without surviving its own kill. Watchdog-disabled probe runs/waits for runner without polling heartbeat so RuntimeMaxSec is isolated. Fake fixtures touch no real scope.


## Change
Create no-shell scope controller with full `.scope` identity, split control/executor env, heartbeat and identity checks. Support only in explicit probe mode: `strace -ff -e trace=execve -o <runDir>/execve`; watchdog-spawned setsid child carrying marker and persisted pid/start-time; and watchdog-disabled mode that runs/waits for runner but skips heartbeat polling. Normal in-scope watchdog starts runner, polls heartbeat, validates unified cgroup-v2, then writes cgroup.kill once; unavailable/unwritable is named fail-closed. External cancel remains control-env TERM/bounded KILL after revalidation.


## Allowed moves
Only the two TypeScript files and watchdog. No process-group fallback, executor bus access, or suffix-less unit. Probe options are disabled by default and accepted only in explicit probe mode.


## STOP triggers
Stop if systemd scope/cgroup-v2 cgroup.kill is unavailable or not delegated, systemctl Id differs from the full `.scope` name, control env contains credentials, executor env contains bus/credential values, strace is unavailable for the explicit inventory probe, or testing could touch a real unit.


Declared decision points (from the spec; do not edit here):
- DP1: The OpenCode harness or the model provider behind a ladder rung is unavailable or rejects the request for the whole attempt window, so a probe task cannot obtain an executor.  [codes: ladder_exhausted, panel_unavailable, implementer_stopped]
- DP2: The cleanup task (D9) is reached: it deletes the spike directory, the target topic's plan directory and branch, and must not run without the operator's approval token.  [codes: human_gate_required]
- DP3: The spec is amended during the run (for example a probe order change) so the precheck token no longer matches.  [codes: spec_stale]


## Manual verification (record in decisions-ledger)
Run the scoped Vitest file and typecheck, then launch `/bin/sleep 2` through a harmless test scope and inspect selected unit properties. Remove that scope. Record exact accepted systemd-run argv in the ledger.


## Done when
`WAI_TYPECHECK_CMD='npm --prefix plugins/shohin/spike run typecheck' WAI_TEST_CMD='npm --prefix plugins/shohin/spike exec -- vitest run {scope}' bash /home/david/.agents/wai/scripts/task-gate.sh shohin-phase-0-spike 005` exits 0
