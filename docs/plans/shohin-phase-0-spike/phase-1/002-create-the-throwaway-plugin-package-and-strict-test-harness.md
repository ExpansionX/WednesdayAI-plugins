---
id: "002"
phase: 1
title: "Create the throwaway plugin package and strict test harness"
status: ready
depends_on: ["001"]
parallel: false
conflicts_with: ["019"]
files:
  - "plugins/shohin/spike/.gitignore"
  - "plugins/shohin/spike/package.json"
  - "plugins/shohin/spike/openclaw.plugin.json"
  - "plugins/shohin/spike/tsconfig.json"
  - "plugins/shohin/spike/tsconfig.build.json"
  - "plugins/shohin/spike/package.test.ts"
siblings: ["extensions/skillweaver/package.json","extensions/skillweaver/tsconfig.json","extensions/skillweaver/package.test.ts"]
irreversible: false
scope_test: "plugins/shohin/spike/package.test.ts"
allowed_change: create
covers_criteria: []
covers_tests: []
---
## Failing test (write first)
Create `plugins/shohin/spike/package.test.ts` first. It reads siblings from `import.meta.dirname` and asserts package/id/private ESM/Node>=24, `wednesdayai.extensions` exactly `["./index.ts"]`, a closed manifest whose only property is optional string `repoRoot`, build/typecheck/test scripts, and exact ignored directories. After package.json exists, install locally and run with `npm --prefix plugins/shohin/spike exec -- vitest run package.test.ts`; expect RED until remaining scaffold exists. Never rely on root Vitest.


## Change
Create the six listed files. Read all three SkillWeaver siblings first and record their exclusions/guards/structure in the ledger, justifying divergences. Package is private NodeNext ESM, Jiti entry `./index.ts`, local dev dependencies including `wednesdayai` via `file:/data/Code/WednesdayAI-core`, never workspace. Manifest schema is closed and permits only optional `repoRoot:string`, used to register the canonical outer repository before installation. Install with `npm install --no-package-lock --ignore-scripts` inside the nested package; no root workspace/lock mutation. All task-gate invocations for scoped TypeScript tests must receive the orchestrator environment `WAI_TYPECHECK_CMD='if [ -f plugins/shohin/spike/package.json ]; then npm --prefix plugins/shohin/spike run typecheck; else true; fi'` and `WAI_TEST_CMD='npm --prefix plugins/shohin/spike exec -- vitest run {scope}'`; never create a tracked `.wai-test-cmd`.


## Allowed moves
Create only the six scaffold files. Do not add the nested path to pnpm-workspace.yaml, root lockfile, catalog, root Shohin package, or CI. Do not add runtime dependencies or suppress TypeScript errors.


## STOP triggers
Stop if any create target exists, the local core package cannot be installed as a dev dependency without changing the root lockfile, the SDK cannot resolve from `wednesdayai/plugin-sdk`, or the sibling conventions cannot be reconciled without an unlisted file.


Declared decision points (from the spec; do not edit here):
- DP1: The OpenCode harness or the model provider behind a ladder rung is unavailable or rejects the request for the whole attempt window, so a probe task cannot obtain an executor.  [codes: ladder_exhausted, panel_unavailable, implementer_stopped]
- DP2: The cleanup task (D9) is reached: it deletes the spike directory, the target topic's plan directory and branch, and must not run without the operator's approval token.  [codes: human_gate_required]
- DP3: The spec is amended during the run (for example a probe order change) so the precheck token no longer matches.  [codes: spec_stale]


## Manual verification (record in decisions-ledger)
Run `npm --prefix plugins/shohin/spike run typecheck`, `npm --prefix plugins/shohin/spike test -- package.test.ts`, and `git status --short`. Expected: typecheck and test pass; only the six tracked create targets appear (node_modules is ignored, no lockfile).


## Done when
`WAI_TYPECHECK_CMD='npm --prefix plugins/shohin/spike run typecheck' WAI_TEST_CMD='npm --prefix plugins/shohin/spike exec -- vitest run {scope}' bash /home/david/.agents/wai/scripts/task-gate.sh shohin-phase-0-spike 002` exits 0
