# shohin-phase-0-spike Plan

## Spec
docs/superpowers/specs/2026-09-05-shohin-phase-0-spike.md

## Approach
Build the spike as a disposable but fully tested plugin inside the real development gateway, then drive one separately committed two-task WAI topic through controlled probes. The first phase adopts and reconciles the operator-authorized durable gateway, then establishes the narrow environment boundary, systemd scope controller, untrusted-hint parser, independent commit verifier, recovery sweep, and synchronous RPC surface. Code is split by contract so every test names one boundary and later tasks consume only already-fixed interfaces.

The second phase performs the probes in the frozen order and writes raw, redacted evidence directly into one report: cold HOME discovery; model-id and restricted warm attach; cancellation; attention forgery; real gateway death and reset; inventory/cost; lane-worktree failure. Runtime artifacts stay ignored and every destructive probe runs only against the throwaway target worktree. The final phase derives the Phase 1 Executor/recovery contracts, performs operator-approved cleanup, and proves SC8 from a clean verifier worktree after cleanup is committed.


## Phases
- **Phase 1: gateway-and-supervisor-harness** — Adopt and reconcile the operator-designated persistent dev gateway, then build/install a tested throwaway supervisor around a real isolated WAI target.
- **Phase 2: controlled-runner-probes** — Run the seven empirical probes in order and capture complete redacted evidence for SC1-SC7.
- **Phase 3: contract-and-cleanup** — Derive the Phase 1 contract/recovery policy, remove every throwaway artifact behind a human gate, and prove SC8.

## Tasks

| id | phase | title | deps | conflicts |
|---|---:|---|---|---|
| 001 | 1 | Adopt and freeze the development gateway baseline | dep: none | conflicts: 009 010 011 012 013 014 015 016 017 018 019 020 |
| 002 | 1 | Create the throwaway plugin package and strict test harness | dep: 001 | conflicts: 019 |
| 003 | 1 | Create the credential-minimising environment builder | dep: 002 | conflicts: 019 |
| 004 | 1 | Create append-only evidence and deterministic assessor scripts | dep: 003 | conflicts: 019 |
| 005 | 1 | Create the systemd scope controller and in-scope watchdog | dep: 004 | conflicts: 019 |
| 006 | 1 | Create hint parsing and commit-grounded truth verification | dep: 005 | conflicts: 019 |
| 007 | 1 | Create the durable spike supervisor and recovery sweep | dep: 006 | conflicts: 019 |
| 008 | 1 | Register synchronous service lifecycle and admin RPC handlers | dep: 007 | conflicts: 019 |
| 009 | 1 | Install the throwaway extension and prove daemon readiness | dep: 008 | conflicts: 001 010 011 012 013 014 015 016 017 018 019 020 |
| 010 | 1 | Prepare the isolated two-task WAI target topic | dep: 009 | conflicts: 001 009 011 012 013 014 015 016 017 018 019 020 |
| 011 | 2 | Run the cold baseline and derive the minimal ephemeral HOME | dep: 010 | conflicts: 001 009 010 012 013 014 015 016 017 018 019 020 |
| 012 | 2 | Measure model-id ladder dispatch and restricted warm attach | dep: 011 | conflicts: 001 009 010 011 013 014 015 016 017 018 019 020 |
| 013 | 2 | Prove scope cancellation contains detached descendants | dep: 012 | conflicts: 001 009 010 011 012 014 015 016 017 018 019 020 |
| 014 | 2 | Prove attention and run-state files remain non-authoritative | dep: 013 | conflicts: 001 009 010 011 012 013 015 016 017 018 019 020 |
| 015 | 2 | Observe real gateway death and both reset modes | dep: 014 | conflicts: 001 009 010 011 012 013 014 016 017 018 019 020 |
| 016 | 2 | Inventory the runner bundle environment and complete cost accounting | dep: 015 | conflicts: 001 009 010 011 012 013 014 015 017 018 019 020 |
| 017 | 2 | Force lane-worktree failure and verify fail-closed patch | dep: 016 | conflicts: 001 009 010 011 012 013 014 015 016 018 019 020 |
| 018 | 3 | Synthesize the Phase 1 Executor contract and recovery policy | dep: 017 | conflicts: 001 009 010 011 012 013 014 015 016 017 019 020 |
| 019 | 3 | Remove all throwaway code and target artifacts | dep: 018 | conflicts: 001 002 003 004 005 006 007 008 009 010 011 012 013 014 015 016 017 018 020 |
| 020 | 3 | Record post-cleanup verification from a clean verifier worktree | dep: 019 | conflicts: 001 009 010 011 012 013 014 015 016 017 018 019 |
