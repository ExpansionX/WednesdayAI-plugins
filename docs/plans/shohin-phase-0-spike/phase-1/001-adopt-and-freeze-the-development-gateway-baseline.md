---
id: "001"
phase: 1
title: "Adopt and freeze the development gateway baseline"
status: ready
depends_on: []
parallel: false
conflicts_with: ["009","010","011","012","013","014","015","016","017","018","019","020"]
files:
  - "dev-docs/workstreams/shohin-phase-0-spike/spike-report.md"
  - "docs/superpowers/specs/2026-09-05-shohin-phase-0-spike.md"
siblings: ["dev-docs/workstreams/shohin-phase-0-spike/README.md"]
irreversible: false
scope_test: "N/A"
allowed_change: create
covers_criteria: []
covers_tests: []
---
## Failing test (write first)
N/A — this task proves host infrastructure with command output, not repository behaviour.


## Change
**File:** `dev-docs/workstreams/shohin-phase-0-spike/spike-report.md`. **Anchor:** new file; it must not exist. **Before:** none. **After:** capture `PRE_SPIKE_SHA=$(git rev-parse HEAD)` before implementation; pin the inherited program baseline to `5be287d73394f9bee55e9de84e7d98111c9a981d`. The operator has already designated this host gateway for development/testing through decision001. Detect the existing `openclaw-gateway.service`, port 18789 listener, CLI/core version, explicit SQLite session-storage object, persisted channel-skip setting, gateway health, config path and selected non-secret unit properties. If it is not WednesdayAI 0.4.11 from the expected core, active/enabled on loopback 18789, explicitly SQLite primary with JSONL fallback disabled, channels skipped and operator-confirmed as this workstream's dev/test gateway after the authorized reconciliation, STOP and ask the operator. Never print the gateway token, raw unit Environment, config auth or backup unit.

Create frontmatter-free Markdown with exact headings: `# Shohin Phase 0 spike report`; `## Baseline identity`; `## Development gateway`; SC1, SC2, SC3a, SC3b, SC4, SC5, SC6, SC7 and SC8 headings exactly as frozen; then `## Runner changes proposed upstream`, `## Proposed Phase 1 Executor contract`, and `## Proposed Phase 1 recovery policy`. Record repository path/branch/HEAD, initial dirty inventory, core/CLI provenance, tool versions, UTC start and USD 50 cap. Record selected unit properties Id, FragmentPath, Restart, RestartUSec, KillMode, MainPID and NRestarts plus the ownership confirmation. Put literal evidence markers under SC1-SC7 and `<!-- evidence:SC8 -->` under SC8; put the three conclusion markers under the final headings. Reconcile the spec/plan/task docs to mission.md, refresh `.precheck.passed` with the real installed precheck at the pinned inherited baseline, and preserve the pre-existing `.wai-findings-seen` deletion without adding unrelated harness files.


## Allowed moves
Docs/repo changes are limited to the report, this task file, the Shohin spike plan/spec/phase/task docs, decisions ledger and genuine precheck token/bookkeeping. Host changes are limited to the decision001-authorized gateway reconciliation: protected external backup, explicit SQLite primary storage with `fallbackToJsonlOnError=false`, persisted channel skipping, validation, daemon reload/restart and health verification. Do not onboard, reinstall, globally update, mutate provider credentials/channel accounts, or touch WednesdayAI-core. Redact every secret before report persistence.


## STOP triggers
Stop if gateway ownership is unconfirmed, the existing gateway is absent/dirty/mismatched from 0.4.11 after the authorized reconciliation, not loopback 18789, not explicitly SQLite primary with fallback disabled, channels are active, unit/health is unavailable, precheck cannot be genuinely refreshed at the pinned base, or verification would expose a token. Never repair/reinstall/core-edit automatically.


Declared decision points (from the spec; do not edit here):
- DP1: The OpenCode harness or the model provider behind a ladder rung is unavailable or rejects the request for the whole attempt window, so a probe task cannot obtain an executor.  [codes: ladder_exhausted, panel_unavailable, implementer_stopped]
- DP2: The cleanup task (D9) is reached: it deletes the spike directory, the target topic's plan directory and branch, and must not run without the operator's approval token.  [codes: human_gate_required]
- DP3: The spec is amended during the run (for example a probe order change) so the precheck token no longer matches.  [codes: spec_stale]


## Manual verification (record in decisions-ledger)
Run protected backup/mode checks, redacted config validation/get, structural config diff against backup, deep status caveat, health RPC, enabled/active checks, selected systemctl properties including Id, loopback HTTP 200 and a focused running-process check for the channel-skip flag. Run plan lint, real precheck refresh/check-only at base `5be287d73394f9bee55e9de84e7d98111c9a981d`, task gate, `git diff --check`, and a report secret scan. Confirm exact adopted baseline, ownership approval, and no token-like report value.


## Done when
`bash /home/david/.agents/wai/scripts/task-gate.sh shohin-phase-0-spike 001 --base 5be287d73394f9bee55e9de84e7d98111c9a981d` exits 0
