# Decisions Ledger

## Submission
Plan accepted from submit envelope.


## Task 001 baseline adoption — 2026-09-13T08:48:36Z
- decision001 confirmed this existing `openclaw-gateway.service` as the Shohin development/testing gateway.
- Backed up config/unit privately under `/home/david/.openclaw/backups/shohin-phase-0-spike/task001-20260913T084345Z` with directory mode 700 and file mode 600.
- Reconciled only `session.storage` to SQLite primary at `/home/david/.openclaw/sessions.db` with `fallbackToJsonlOnError=false` and persisted `OPENCLAW_SKIP_CHANNELS=1` in a focused user-unit drop-in; validation preceded restart.
- Verified active/enabled unit, loopback listeners on 127.0.0.1/[::1]:18789, HTTP 200 health, RPC health `ok:true`, selected unit properties, existing legacy session JSON preserved, and refreshed `.precheck.passed` at base `5be287d73394f9bee55e9de84e7d98111c9a981d`.
