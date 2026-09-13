# Shohin Phase 0 spike report

## Baseline identity
- UTC baseline capture: 2026-09-13T08:48:36Z.
- Spike day cap: USD 50; no paid inner-runner dispatch is authorized until the model/role mapping and conservative per-call reservation are attributable within the remaining cap.
- Repository: `/data/.worktree/74d2b924bcab7880c9787f573e996a33c50e6588/vivid-otter`.
- Branch: `vivid-otter`.
- PRE_SPIKE_SHA: `5be287d73394f9bee55e9de84e7d98111c9a981d`.
- Initial worktree status was `vivid-otter...origin/main [ahead 5]` with pre-existing deletion `docs/plans/shohin-phase-0-spike/.wai-findings-seen` and untracked harness/planning files under `.agents`, `.claude`, `.codex`, `.opencode-shohin-phase0-plan.mjs`, and `docs/plans/shohin-phase-0-spike/`. These were inventoried before implementation and preserved except for task-owned reconciled plan/spec/report/precheck paths.
- Root build/test scripts: none at repository root; task gates use the installed WAI scripts and, after task 002 creates it, nested package commands under `plugins/shohin/spike`.

Tool and source provenance:

```text
$ git rev-parse HEAD
5be287d73394f9bee55e9de84e7d98111c9a981d

$ git branch --show-current
vivid-otter

$ node --version
v26.8.1

$ pnpm --version
10.23.0

$ git --version
git version 2.53.0

$ systemctl --version | head -1
systemd 259 (259.5-0ubuntu3.4)

$ opencode --version
1.18.30

$ cat /home/david/.agents/wai/scripts/VERSION
0.32.0

$ command -v wednesdayai
/home/linuxbrew/.linuxbrew/bin/wednesdayai

$ wednesdayai --version
0.4.11

$ readlink -f /home/linuxbrew/.linuxbrew/bin/wednesdayai
/home/linuxbrew/.linuxbrew/lib/node_modules/wednesdayai/openclaw.mjs

$ git -C /data/Code/WednesdayAI-core rev-parse HEAD
46769abdb4aaf2f494e2953158f7a2c34e7e8b37

$ node -e "const p=require('/data/Code/WednesdayAI-core/package.json'); console.log(JSON.stringify({name:p.name, version:p.version}, null, 2));"
{
  "name": "wednesdayai",
  "version": "0.4.11"
}

$ git -C /data/Code/WednesdayAI-core status --short --branch --untracked-files=no
branch main...origin/main [behind 2]; no local changes reported
```

Installed/WAI file hashes captured for later bundle comparisons:

```text
b206f0072c8fde03328cd9db45c47434ebe1fc8c1367abb9d88f5093980116f2  /home/linuxbrew/.linuxbrew/lib/node_modules/wednesdayai/openclaw.mjs
02e718be945c73ab1d1fcfbe4707dfae84d1147329e351b5c938738f860c5ccb  /home/linuxbrew/.linuxbrew/lib/node_modules/wednesdayai/dist/index.js
3700320b3e3276d902e799b0021d118cea26334c5a29461f08c9cf06a36e97d0  /home/linuxbrew/.linuxbrew/lib/node_modules/wednesdayai/package.json
4954d57c054959686267e98ff23810d322f4737ab9706ef0a7916e7031eef10e  /home/david/.agents/wai/scripts/wai-dag-run.sh
48493782a4d4c3e19453f06b07a0830b4c17e765e46acb0d23996d27d81eeaac  /home/david/.agents/wai/scripts/wai-dag-executors.sh
becfff0995104be076a010e0c8f01ecd4c2fb5b736fbb87513f08acb1f82d878  /home/david/.agents/wai/scripts/task-gate.sh
7b05f16572b9a4351b8ae37ce0da374b0705ce6cbcb6349541b7c5e8b24edb42  /home/david/.agents/wai/scripts/wai-plan-lint.sh
bd05d04d35a8476291940d2a600cef55c757c36c2cca555ebe4db495f8d536af  /home/david/.agents/wai/scripts/wai-precheck.sh
e0ccf7913110f807adecc59be43ce6fb334f82a8a7f70f70fbbba34bf1eeaaf2  /home/david/.agents/wai/scripts/VERSION
```

## Development gateway
Ownership: `/home/david/.zenith/projects/20260913T063314Z-resume-shohin-phase-0-spike-from-existing-docs-superpowers-specs/.zenith/decisions/001-gateway-authorization.md` records the operator decision on 2026-09-13 to reconfigure this existing `openclaw-gateway.service` for development/testing. The change was limited to explicit SQLite primary storage with JSONL fallback disabled and persisted channel skipping; no onboarding, reinstall, global update or WednesdayAI-core edit was performed.

Protected backup before host mutation:

```text
$ install -d -m 700 /home/david/.openclaw/backups/shohin-phase-0-spike/task001-20260913T084345Z
$ install -m 600 ~/.openclaw/openclaw.json /home/david/.openclaw/backups/shohin-phase-0-spike/task001-20260913T084345Z/openclaw.json
$ install -m 600 ~/.config/systemd/user/openclaw-gateway.service /home/david/.openclaw/backups/shohin-phase-0-spike/task001-20260913T084345Z/openclaw-gateway.service
$ stat -c '%a %U:%G %n' /home/david/.openclaw/backups/shohin-phase-0-spike/task001-20260913T084345Z /home/david/.openclaw/backups/shohin-phase-0-spike/task001-20260913T084345Z/openclaw.json /home/david/.openclaw/backups/shohin-phase-0-spike/task001-20260913T084345Z/openclaw-gateway.service
700 david:david /home/david/.openclaw/backups/shohin-phase-0-spike/task001-20260913T084345Z
600 david:david /home/david/.openclaw/backups/shohin-phase-0-spike/task001-20260913T084345Z/openclaw.json
600 david:david /home/david/.openclaw/backups/shohin-phase-0-spike/task001-20260913T084345Z/openclaw-gateway.service
```

Configuration and structural diff after the authorized merge:

```text
$ wednesdayai config validate
Config valid: ~/.openclaw/openclaw.json

$ wednesdayai config get session.storage --json
{
  "backend": "sqlite",
  "mode": "primary",
  "sqlitePath": "/home/david/.openclaw/sessions.db",
  "fallbackToJsonlOnError": false
}

$ node -e "<redacted structural diff against backup>"
{
  "changedPaths": [
    "meta.lastTouchedAt",
    "session.storage.backend",
    "session.storage.fallbackToJsonlOnError",
    "session.storage.mode",
    "session.storage.sqlitePath"
  ],
  "safeSessionStorage": {
    "backend": "sqlite",
    "mode": "primary",
    "sqlitePath": "~/.openclaw/sessions.db",
    "fallbackToJsonlOnError": false
  }
}
```

Channel skip persistence and process evidence:

```text
$ systemctl --user show openclaw-gateway.service --property=DropInPaths --no-pager
DropInPaths=/home/david/.config/systemd/user/openclaw-gateway.service.d/10-shohin-phase0-dev.conf

$ stat -c '%a %U:%G %s %n' /home/david/.config/systemd/user/openclaw-gateway.service.d/10-shohin-phase0-dev.conf
600 david:david 47 /home/david/.config/systemd/user/openclaw-gateway.service.d/10-shohin-phase0-dev.conf

$ tr '\0' '\n' < /proc/1556776/environ | grep -E '^OPENCLAW_SKIP_CHANNELS='
OPENCLAW_SKIP_CHANNELS=1
```

Validation and restart evidence:

```text
$ wednesdayai config validate
Config valid: ~/.openclaw/openclaw.json

$ systemd-analyze --user verify openclaw-gateway.service
(exit 0, no output)

$ systemctl --user daemon-reload
(exit 0, no output)

$ systemctl --user restart openclaw-gateway.service
(exit 0, no output)
```

Selected non-secret unit properties after restart:

```text
$ systemctl --user show openclaw-gateway.service --property=Id,FragmentPath,Restart,RestartUSec,KillMode,MainPID,NRestarts,ActiveState,UnitFileState,ExecMainStartTimestamp,SubState --no-pager
Id=openclaw-gateway.service
ActiveState=active
SubState=running
FragmentPath=/home/david/.config/systemd/user/openclaw-gateway.service
UnitFileState=enabled
Restart=always
RestartUSec=5s
MainPID=1556776
NRestarts=0
ExecMainStartTimestamp=Sun 2026-09-13 08:45:02 UTC
KillMode=process

$ systemctl --user is-active openclaw-gateway.service
active

$ systemctl --user is-enabled openclaw-gateway.service
enabled
```

Loopback listener and health:

```text
$ ss -H -ltnp 'sport = :18789'
LISTEN 0      511    127.0.0.1:18789 0.0.0.0:* users:(("openclaw-gatewa",pid=1556776,fd=30))
LISTEN 0      511        [::1]:18789    [::]:* users:(("openclaw-gatewa",pid=1556776,fd=31))

$ curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:18789/health
200

$ wednesdayai gateway health --json
{
  "ok": true,
  "channels": {},
  "channelOrder": [],
  "channelLabels": {},
  "defaultAgentId": "main",
  "agents": [{"agentId":"main","isDefault":true}],
  "sessions": {"path":"/home/david/.openclaw/agents/main/sessions/sessions.json","count":0}
}
```

Gateway status caveat: `wednesdayai gateway status --json` exits 0 and reports RPC `ok: true`, `bindMode: loopback`, `bindHost: 127.0.0.1`, and `port: 18789`, but its embedded service-runtime probe says `systemctl --user unavailable` when launched without `XDG_RUNTIME_DIR` and `DBUS_SESSION_BUS_ADDRESS`. Direct `systemctl --user` checks above pass when those user-bus variables are provided.

Existing session material was not deleted. The legacy JSON store remains at `/home/david/.openclaw/agents/main/sessions/sessions.json` with one `agent:main:main` record, and the configured SQLite file exists at `/home/david/.openclaw/sessions.db`. Public `wednesdayai sessions --json` still lists the legacy record; gateway health's session count is a live-runtime/cache observation, not proof that legacy metadata was destroyed.

Baseline documentation gates:

~~~text
$ bash /home/david/.agents/wai/scripts/wai-plan-lint.sh shohin-phase-0-spike
  sql anchors: no ```sql fenced blocks in 24 file(s) — nothing to validate
PLAN-LINT PASS: shohin-phase-0-spike — plan/frontmatter consistent, verification + SC-coverage complete

$ bash /home/david/.agents/wai/scripts/wai-precheck.sh shohin-phase-0-spike --spec docs/superpowers/specs/2026-09-05-shohin-phase-0-spike.md --base 5be287d73394f9bee55e9de84e7d98111c9a981d --check-only
CHECK-ONLY PASS: all asserts passed for 'shohin-phase-0-spike'; no token written.

$ sed -n '1,20p' docs/plans/shohin-phase-0-spike/.precheck.passed
spec=docs/superpowers/specs/2026-09-05-shohin-phase-0-spike.md
spec_sha=ca609fff5cf477a0fb59b07886843e1bf9b57f6f
base=5be287d73394f9bee55e9de84e7d98111c9a981d

$ git hash-object docs/superpowers/specs/2026-09-05-shohin-phase-0-spike.md
ca609fff5cf477a0fb59b07886843e1bf9b57f6f
~~~

## SC1 — scope cancellation
<!-- evidence:SC1 -->

## SC2 — ephemeral HOME
<!-- evidence:SC2 -->

## SC3a — ladder dispatch
<!-- evidence:SC3a -->

## SC3b — warm attach
<!-- evidence:SC3b -->

## SC4 — attention and terminal signals
<!-- evidence:SC4 -->

## SC5 — gateway death and reset
<!-- evidence:SC5 -->

## SC6 — runner inventory and cost
<!-- evidence:SC6 -->

## SC7 — lane worktree failure
<!-- evidence:SC7 -->

## SC8 — cleanup
<!-- evidence:SC8 -->

## Runner changes proposed upstream
<!-- conclusion:runner-changes -->

## Proposed Phase 1 Executor contract
<!-- conclusion:executor-contract -->

## Proposed Phase 1 recovery policy
<!-- conclusion:recovery-policy -->
