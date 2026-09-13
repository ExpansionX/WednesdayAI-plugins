---
id: "003"
phase: 1
title: "Create the credential-minimising environment builder"
status: ready
depends_on: ["002"]
parallel: false
conflicts_with: ["019"]
files:
  - "plugins/shohin/spike/src/environment.ts"
  - "plugins/shohin/spike/src/environment.test.ts"
  - "plugins/shohin/spike/home.allow"
  - "plugins/shohin/spike/env.allow"
irreversible: false
scope_test: "plugins/shohin/spike/src/environment.test.ts"
allowed_change: create
covers_criteria: []
covers_tests: []
---
## Failing test (write first)
Create `environment.test.ts` first. Assert topic validation; canonical registered root resolution; linked worktrees accepted only when `git rev-parse --git-common-dir` matches the registered root; traversal/symlink/different-repository rejection; empty immutable source home.allow; contained copies into mode-0700 HOME; executor env contains only PATH/HOME/TMPDIR plus explicit runner variables and no bus/credential variables; control env contains only PATH plus validated XDG_RUNTIME_DIR and optional DBUS_SESSION_BUS_ADDRESS and still excludes gateway/git/SSH/gh credentials. Assert control and executor objects are distinct and no process.env spread occurs.


## Change
Create exports `validateTopic`, `resolveRegisteredRepoRoot`, `resolveLinkedWorktree`, `readAllowList`, `copyAllowedHome`, `buildExecutorEnvironment`, and `buildControlEnvironment`. Every source env/root is explicit. Linked targets are authorized by matching canonical Git common directory, never by being beneath another worktree. HOME copying rejects absolute/`..`/escaping symlinks/special files. Executor env has no user-bus access. Control env is used only to launch/inspect/cancel systemd units and contains PATH plus validated user-bus addresses; scan both outputs against forbidden credential names. Keep tracked home.allow empty and env.allow PATH-only as immutable source defaults; each run copies them under ignored run-data and only that runtime copy may grow from observed errors.


## Allowed moves
Only four create targets. No HOME/process.env mirroring. Tracked allow lists remain immutable; runtime copies live under run-data and are removed at cleanup.


## STOP triggers
Stop if OpenCode authentication appears to require copying the whole HOME, a secret not owned by the OpenCode harness, following a symlink outside HOME, or an unlisted environment variable.


Declared decision points (from the spec; do not edit here):
- DP1: The OpenCode harness or the model provider behind a ladder rung is unavailable or rejects the request for the whole attempt window, so a probe task cannot obtain an executor.  [codes: ladder_exhausted, panel_unavailable, implementer_stopped]
- DP2: The cleanup task (D9) is reached: it deletes the spike directory, the target topic's plan directory and branch, and must not run without the operator's approval token.  [codes: human_gate_required]
- DP3: The spec is amended during the run (for example a probe order change) so the precheck token no longer matches.  [codes: spec_stale]


## Manual verification (record in decisions-ledger)
Run `npm --prefix plugins/shohin/spike exec -- vitest run src/environment.test.ts` and `npm --prefix plugins/shohin/spike run typecheck`; both pass. Record the explicit deny assertions in the ledger.


## Done when
`WAI_TYPECHECK_CMD='npm --prefix plugins/shohin/spike run typecheck' WAI_TEST_CMD='npm --prefix plugins/shohin/spike exec -- vitest run {scope}' bash /home/david/.agents/wai/scripts/task-gate.sh shohin-phase-0-spike 003` exits 0
