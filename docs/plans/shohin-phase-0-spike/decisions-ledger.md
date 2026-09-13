# Decisions Ledger

## Task 004 evidence scripts — 2026-09-13
- At commit `bb162c5d6af18366f534c35f81abded1b987f12f`, the worker reports the scoped evidence-script Vitest suite (4 tests), typecheck, full nested suite (21 tests), and WAI task004 gate passed. `stat -c '%a %n' plugins/shohin/spike/scripts/*` reported 755 for all four scripts.
- CLI fixtures exercised concurrent notify/report appends, escaping, wrapper stdout/stderr/status preservation and usage metadata, argv redaction, and deterministic no-stdin assessor schema. Installed WAI notify and assessor interfaces were inspected. No paid model call occurred.
- Root `pnpm lint` failed because oxlint is unavailable; no lint pass is claimed. Evidence and limitations are recorded in Zenith mission-001's work-004 attempt report; independent harness validation is pending.

## Task 003 environment builder — 2026-09-13
- Worker commit `6b2ab812c982d563548a7a5da65927d8e13765fd` adds the four declared files. The worker reports scoped Vitest (12 tests), nested typecheck, and the WAI task003 gate passed at that exact commit. Independent harness validation remains pending.
- Explicit deny assertions cover absolute and parent-traversing HOME entries, symlinks, special files/directories, invalid topics, noncanonical or different-repository worktrees, credential-bearing executor/control inputs, executor bus variables, invalid runtime/bus addresses, and implicit process environment leakage. Positive cases cover contained mode-0700 HOME copies, same-common-directory worktrees, and distinct executor/control environment objects.
- Immutable source defaults remain empty `home.allow` and PATH-only `env.allow`; no paid inner call occurred. Full worker evidence is in Zenith mission-001's work-003 attempt report. The orchestrator records this note because the worker's four-file scope excluded this ledger.

## Submission
Plan accepted from submit envelope.


## Task 001 baseline adoption — 2026-09-13T08:48:36Z
- decision001 confirmed this existing `openclaw-gateway.service` as the Shohin development/testing gateway.
- Backed up config/unit privately under `/home/david/.openclaw/backups/shohin-phase-0-spike/task001-20260913T084345Z` with directory mode 700 and file mode 600.
- Reconciled only `session.storage` to SQLite primary at `/home/david/.openclaw/sessions.db` with `fallbackToJsonlOnError=false` and persisted `OPENCLAW_SKIP_CHANNELS=1` in a focused user-unit drop-in; validation preceded restart.
- Verified active/enabled unit, loopback listeners on 127.0.0.1/[::1]:18789, HTTP 200 health, RPC health `ok:true`, selected unit properties, existing legacy session JSON preserved, and refreshed `.precheck.passed` at base `5be287d73394f9bee55e9de84e7d98111c9a981d`.
