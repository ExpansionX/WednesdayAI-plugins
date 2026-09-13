---
id: "018"
phase: 3
title: "Synthesize the Phase 1 Executor contract and recovery policy"
status: ready
depends_on: ["017"]
parallel: false
conflicts_with: ["001","009","010","011","012","013","014","015","016","017","019","020"]
files:
  - "dev-docs/workstreams/shohin-phase-0-spike/spike-report.md"
irreversible: false
scope_test: "N/A"
allowed_change: edit
covers_criteria: []
covers_tests: []
---
## Failing test (write first)
N/A — this task interprets the already captured empirical evidence.


## Change
**File:** `dev-docs/workstreams/shohin-phase-0-spike/spike-report.md`. **Anchors:** `<!-- conclusion:runner-changes -->`, `<!-- conclusion:executor-contract -->`, and `<!-- conclusion:recovery-policy -->`. Replace each marker. Runner changes: one row per observed gap with installed hash, exact script/symbol, evidence section, proposed patch and whether Phase 1 blocks on upstreaming; include lane fail-closed, optional --agent, notify escaping/coverage, MAX_ATTEMPTS semantics, baseline overwrite, historical-gate checkout and usage-accounting findings only when evidence supports them. Executor contract: print the final TypeScript interface with `id`, pinned `version:{path,sha256,bundleHashes}`, `start(manifest):Promise<RunHandle>`, `resume(handle,mode)`, `status(handle)`, `cancel(handle)`, `events(handle,cursor)`, and handle fields repo/topic/branch/externalBaseline/unit/process identities/runDir/startedAt/generation; state exact env, cwd, signal and truth contracts. Recovery: numbered algorithm for startup sweep, identity check, live reattach, dead/lost classification, old-scope confirmation, parent blocked, human retry only, same recorded worktree, chosen reset mode and evidence, attempts/approval consequences. End with one explicit GO / GO-WITH-RUNNER-PATCH / NO-GO recommendation for Phase 1, citing evidence not intuition.


## Allowed moves
Edit only the three conclusion regions. Do not invent successful observations, change the frozen Phase 1 architecture silently, or turn unresolved evidence into an implementer choice; label a blocker and recommendation.


## STOP triggers
Stop if any SC1-SC7 section is marker/empty, evidence conflicts, contract choice is undecidable, or recommendation contradicts evidence. Preserve `<!-- evidence:SC8 -->` for cleanup.


Declared decision points (from the spec; do not edit here):
- DP1: The OpenCode harness or the model provider behind a ladder rung is unavailable or rejects the request for the whole attempt window, so a probe task cannot obtain an executor.  [codes: ladder_exhausted, panel_unavailable, implementer_stopped]
- DP2: The cleanup task (D9) is reached: it deletes the spike directory, the target topic's plan directory and branch, and must not run without the operator's approval token.  [codes: human_gate_required]
- DP3: The spec is amended during the run (for example a probe order change) so the precheck token no longer matches.  [codes: spec_stale]


## Manual verification (record in decisions-ledger)
Search: zero conclusion markers and zero evidence markers except exactly one SC8 marker. Cross-reference contracts and answer all seven exit questions; recommendation is one named verdict.


## Done when
`WAI_TYPECHECK_CMD='npm --prefix plugins/shohin/spike run typecheck' WAI_TEST_CMD='npm --prefix plugins/shohin/spike exec -- vitest run {scope}' bash /home/david/.agents/wai/scripts/task-gate.sh shohin-phase-0-spike 018` exits 0
