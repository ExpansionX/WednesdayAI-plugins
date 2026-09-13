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


### Task 009 corrected live installation and readiness evidence

UTC window: 2026-09-13T13:04:09Z through 2026-09-13T13:18:37Z. This evidence supersedes the interrupted work009 helper-oracle claim. The earlier `GatewayClient` no-auth probe silently loaded cached device identity, so final unauthenticated evidence below uses raw WebSocket protocol 3 frames with both `auth` and `device` absent. Caller `connect.auth` fields are treated only as input, never as proof of verified authentication.

Entrypoint restoration before install:

```text
$ git diff -- plugins/shohin/spike/index.ts plugins/shohin/spike/index.test.ts
(exit 0, no output after restoring both files from b40c8a565ed9e57d6c42863291d274b3ed427f6f)

$ sha256sum plugins/shohin/spike/index.ts plugins/shohin/spike/index.test.ts /tmp/shohin-index.ts.restore /tmp/shohin-index.test.ts.restore
7dbfff23b3230b18679bc25670e5f8f7b03d97a248713e54639be5c928deeba0  plugins/shohin/spike/index.ts
610b8e697a5ad7039a1a684e9a66d153340b7744215227a76213aac9fbc1ce30  plugins/shohin/spike/index.test.ts
7dbfff23b3230b18679bc25670e5f8f7b03d97a248713e54639be5c928deeba0  /tmp/shohin-index.ts.restore
610b8e697a5ad7039a1a684e9a66d153340b7744215227a76213aac9fbc1ce30  /tmp/shohin-index.test.ts.restore
```

Nested package checks after restoration:

```text
$ npm --prefix plugins/shohin/spike exec -- vitest run plugins/shohin/spike/index.test.ts
(exit 0) Test Files 1 passed; Tests 6 passed

$ npm --prefix plugins/shohin/spike run typecheck
(exit 0) tsc --noEmit

$ npm --prefix plugins/shohin/spike test
(exit 0) Test Files 7 passed; Tests 50 passed

$ npm --prefix plugins/shohin/spike run build
(exit 0) tsc -p tsconfig.build.json

$ node --input-type=module -e "<Jiti import ./plugins/shohin/spike/index.ts through WednesdayAI-core jiti>"
{"id":"shohin-spike","keys":["default"]}
```

Pre-refresh managed-copy identity and stale hash finding:

```text
$ realpath /home/david/.openclaw/extensions/shohin-spike
/home/david/.openclaw/extensions/shohin-spike

$ OPENCLAW_CATALOG_REMOTE=0 wednesdayai plugins info shohin-spike --json
{
  "id": "shohin-spike",
  "source": "/home/david/.openclaw/extensions/shohin-spike/index.ts",
  "origin": "global",
  "enabled": true,
  "status": "loaded",
  "gatewayMethods": ["shohinSpike.run", "shohinSpike.cancel", "shohinSpike.status"],
  "services": ["shohin-spike-supervisor"],
  "httpRoutes": 0,
  "hookCount": 0,
  "diagnostics": []
}

$ node --input-type=module -e "<redacted config query for plugins.entries/installs.shohin-spike>"
{
  "entry": {
    "enabled": true,
    "config": {
      "repoRoot": "/data/.worktree/74d2b924bcab7880c9787f573e996a33c50e6588/vivid-otter"
    }
  },
  "install": {
    "source": "path",
    "sourcePath": "/data/.worktree/74d2b924bcab7880c9787f573e996a33c50e6588/vivid-otter/plugins/shohin/spike",
    "installPath": "/home/david/.openclaw/extensions/shohin-spike",
    "version": "0.0.0",
    "installedAt": "2026-09-13T12:50:03.339Z"
  }
}

$ sha256sum plugins/shohin/spike/index.ts /home/david/.openclaw/extensions/shohin-spike/index.ts
7dbfff23b3230b18679bc25670e5f8f7b03d97a248713e54639be5c928deeba0  plugins/shohin/spike/index.ts
844e6395d29c1fba286c99a4c92d03eaf8a1eb81237f36be358f5250dfd189f7  /home/david/.openclaw/extensions/shohin-spike/index.ts
```

Refresh of the verified mission-owned managed copy:

```text
$ wednesdayai plugins install --force /data/.worktree/74d2b924bcab7880c9787f573e996a33c50e6588/vivid-otter/plugins/shohin/spike
(exit 1) plugin already exists: /home/david/.openclaw/extensions/shohin-spike (delete it first)

$ wednesdayai plugins uninstall shohin-spike --dry-run
(exit 0) Will remove: config entry, install record. Dry run, no changes made.

$ wednesdayai plugins uninstall shohin-spike --force
(exit 0) Uninstalled plugin "shohin-spike". Removed: config entry, install record. Restart the gateway to apply changes.

$ test -d /home/david/.openclaw/extensions/shohin-spike && realpath /home/david/.openclaw/extensions/shohin-spike
/home/david/.openclaw/extensions/shohin-spike

$ rm -rf /home/david/.openclaw/extensions/shohin-spike
(exit 0; removed only the verified stale mission-owned managed directory)

$ wednesdayai plugins install /data/.worktree/74d2b924bcab7880c9787f573e996a33c50e6588/vivid-otter/plugins/shohin/spike
(exit 0) Plugin 'shohin-spike' installed. Run: wednesdayai plugins enable shohin-spike to activate it.

$ wednesdayai plugins enable shohin-spike
(exit 0) Enabled plugin "shohin-spike". Restart the gateway to apply.

$ wednesdayai config set plugins.entries.shohin-spike.config.repoRoot /data/.worktree/74d2b924bcab7880c9787f573e996a33c50e6588/vivid-otter
(exit 0) Updated plugins.entries.shohin-spike.config.repoRoot. Restart the gateway to apply.

$ wednesdayai config validate
Config valid: ~/.openclaw/openclaw.json
```

The plugin install command emitted the expected static warnings for this throwaway supervisor package's `child_process` use and a pre-existing media-provider doctor warning. `wednesdayai plugins enable shohin-spike` also reported an unrelated bundled `learning-core` duplicate task-pass warning during CLI-side registration; final gateway/plugin health for `shohin-spike` is clean.

Final source/installed identity after refresh and restart:

```text
$ sha256sum plugins/shohin/spike/index.ts plugins/shohin/spike/index.test.ts plugins/shohin/spike/dist/index.js plugins/shohin/spike/openclaw.plugin.json /home/david/.openclaw/extensions/shohin-spike/index.ts /home/david/.openclaw/extensions/shohin-spike/index.test.ts /home/david/.openclaw/extensions/shohin-spike/dist/index.js /home/david/.openclaw/extensions/shohin-spike/openclaw.plugin.json
7dbfff23b3230b18679bc25670e5f8f7b03d97a248713e54639be5c928deeba0  plugins/shohin/spike/index.ts
610b8e697a5ad7039a1a684e9a66d153340b7744215227a76213aac9fbc1ce30  plugins/shohin/spike/index.test.ts
f9c740bb188248e4d725c4a8c628283c29f9380c0e68310349b8595caabdc370  plugins/shohin/spike/dist/index.js
877a18e2816fc51cf4c8cedc22e90c787dd15dd6bc14165ff4aa1deb6bb34fba  plugins/shohin/spike/openclaw.plugin.json
7dbfff23b3230b18679bc25670e5f8f7b03d97a248713e54639be5c928deeba0  /home/david/.openclaw/extensions/shohin-spike/index.ts
610b8e697a5ad7039a1a684e9a66d153340b7744215227a76213aac9fbc1ce30  /home/david/.openclaw/extensions/shohin-spike/index.test.ts
f9c740bb188248e4d725c4a8c628283c29f9380c0e68310349b8595caabdc370  /home/david/.openclaw/extensions/shohin-spike/dist/index.js
877a18e2816fc51cf4c8cedc22e90c787dd15dd6bc14165ff4aa1deb6bb34fba  /home/david/.openclaw/extensions/shohin-spike/openclaw.plugin.json

$ node --input-type=module -e "<redacted final config/install query>"
{
  "installPath": "/home/david/.openclaw/extensions/shohin-spike",
  "realpath": "/home/david/.openclaw/extensions/shohin-spike",
  "isDirectory": true,
  "isSymbolicLink": false,
  "entry": {
    "enabled": true,
    "config": {
      "repoRoot": "/data/.worktree/74d2b924bcab7880c9787f573e996a33c50e6588/vivid-otter"
    }
  },
  "install": {
    "source": "path",
    "sourcePath": "/data/.worktree/74d2b924bcab7880c9787f573e996a33c50e6588/vivid-otter/plugins/shohin/spike",
    "installPath": "/home/david/.openclaw/extensions/shohin-spike",
    "version": "0.0.0",
    "installedAt": "2026-09-13T13:09:25.095Z"
  }
}
```

Configured root identity:

```text
$ realpath .
/data/.worktree/74d2b924bcab7880c9787f573e996a33c50e6588/vivid-otter

$ git rev-parse --show-toplevel
/data/.worktree/74d2b924bcab7880c9787f573e996a33c50e6588/vivid-otter

$ git rev-parse --git-common-dir
/data/Code/WednesdayAI-plugins/.git
```

Gateway restart and readiness:

```text
$ wednesdayai gateway restart --json
{"action":"restart","ok":false,"error":"Gateway service check failed: Error: systemctl is-enabled unavailable: Failed to connect to user scope bus via local transport: $DBUS_SESSION_BUS_ADDRESS and $XDG_RUNTIME_DIR not defined ..."}

$ env XDG_RUNTIME_DIR=/run/user/1000 DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus wednesdayai gateway restart --json
{"action":"restart","ok":true,"result":"restarted","service":{"label":"systemd","loaded":true,"loadedText":"enabled","notLoadedText":"disabled"}}

$ env XDG_RUNTIME_DIR=/run/user/1000 DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus systemctl --user show openclaw-gateway.service --property=Id,ActiveState,SubState,MainPID,NRestarts,ExecMainStartTimestamp,UnitFileState,FragmentPath,DropInPaths --no-pager
Id=openclaw-gateway.service
ActiveState=active
SubState=running
FragmentPath=/home/david/.config/systemd/user/openclaw-gateway.service
DropInPaths=/home/david/.config/systemd/user/openclaw-gateway.service.d/10-shohin-phase0-dev.conf
UnitFileState=enabled
MainPID=3566163
NRestarts=0
ExecMainStartTimestamp=Sun 2026-09-13 13:10:23 UTC

$ wednesdayai gateway health --json
{"ok": true, "channels": {}, "channelOrder": [], "defaultAgentId": "main", "sessions": {"count": 0}}

$ env XDG_RUNTIME_DIR=/run/user/1000 DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus wednesdayai gateway status --json
{"service":{"loaded":true,"runtime":{"status":"running","state":"active","subState":"running","pid":3566163}},"gateway":{"bindMode":"loopback","bindHost":"127.0.0.1","port":18789},"rpc":{"ok":true,"url":"ws://127.0.0.1:18789"}}

$ OPENCLAW_CATALOG_REMOTE=0 wednesdayai plugins info shohin-spike --json
{"id":"shohin-spike","origin":"global","enabled":true,"status":"loaded","source":"/home/david/.openclaw/extensions/shohin-spike/index.ts","gatewayMethods":["shohinSpike.run","shohinSpike.cancel","shohinSpike.status"],"services":["shohin-spike-supervisor"],"toolNames":[],"hookNames":[],"channelIds":[],"providerIds":[],"cliCommands":[],"commands":[],"httpRoutes":0,"hookCount":0,"diagnostics":[]}

$ wednesdayai gateway call plugins/health --json
{"status":"degraded","summary":{"loaded":5,"warned":1,"errored":0,"skipped":0,"disabled":54},"plugins":[{"id":"shohin-spike","status":"loaded","origin":"global","diagnostics":[]},"..."]}

$ wednesdayai gateway call shohinSpike.status --params '{}' --json
{"id":"shohin-spike","service":{"id":"shohin-spike-supervisor","status":"ready","repoRoot":"/data/.worktree/74d2b924bcab7880c9787f573e996a33c50e6588/vivid-otter","runRoot":"/home/david/.openclaw/shohin-spike/run-data","recovery":{"ignoredRunIds":[],"refreshedActiveRunIds":[],"scheduledTruthRunIds":["completed-fixture-009"]}}}

$ journalctl --user -u openclaw-gateway.service --since '2026-09-13 13:10:20 UTC' --no-pager | rg 'shohin-spike\.(register|recovery)'
2026-09-13T13:10:25.492Z [gateway] shohin-spike.register.start
2026-09-13T13:10:25.493Z [gateway] shohin-spike.register.complete
2026-09-13T13:10:26.041Z [plugins] shohin-spike.recovery.phase1.start
2026-09-13T13:10:26.049Z [plugins] shohin-spike.recovery.phase1.ready
```

Raw protocol 3 authorization probes, without `GatewayClient`:

```text
$ node --input-type=module <raw protocol3 WebSocket probe; real token read from config only in memory and redacted before output>
startedAt=2026-09-13T13:15:14.262Z finishedAt=2026-09-13T13:15:14.287Z
absent-auth-and-device: sent connect paramKeys=[caps,client,maxProtocol,minProtocol,role,scopes], hasAuth=false, hasDevice=false, role=operator, scopes=[operator.admin], protocol=[3,3]; response ok=false code=NOT_PAIRED details.code=DEVICE_IDENTITY_REQUIRED; close code=1008 reason="device identity required"; customMethodRequestsSentAfterDeniedHandshake=0
invalid-placeholder-token-no-device: sent connect paramKeys=[auth,caps,client,maxProtocol,minProtocol,role,scopes], hasAuth=true, hasDevice=false, auth.token=[placeholder-token], role=operator, scopes=[operator.admin], protocol=[3,3]; response ok=false code=INVALID_REQUEST details.code=AUTH_TOKEN_MISMATCH authReason=token_mismatch; close code=1008; customMethodRequestsSentAfterDeniedHandshake=0
authenticated-operator-read-method-denials: sent connect hasAuth=true, hasDevice=false, auth.token=[redacted-real-token], role=operator, scopes=[operator.read], protocol=[3,3]; hello ok=true, protocol=3, serverVersion=0.4.11, shohinMethods=[shohinSpike.cancel,shohinSpike.run,shohinSpike.status], authKeys=[]; shohinSpike.run/cancel/status each returned ok=false code=INVALID_REQUEST message="missing scope: operator.admin"
```

Authenticated admin RPC validation and no-side-effect inventory:

```text
$ node --input-type=module <admin CLI matrix; each case runs wednesdayai gateway call ... --json and records argv/exit/output>
startedAt=2026-09-13T13:18:21.712Z finishedAt=2026-09-13T13:18:37.956Z
before scopes: exit 0, no shohin-*.scope units
before persistent run-data: completed-fixture-009 directory plus heartbeat.json and run.json only
before fixture: hash=588e31e4a18c504161981c74c57c70a0a6eff7fe1c8a240adb44d27761cbea5f status=exited hasScope=false launchEnvKeys=[]
before process filter: openclaw-gateway PID 3566163 only

admin-status-ready: exit 0, service.status=ready
closed-status-params-denied: exit 1, Unknown status params key: extra
closed-cancel-params-denied: exit 1, Unknown cancel params key: extra
closed-run-top-params-denied: exit 1, Unknown run params key: extra
closed-run-options-denied: exit 1, Unknown run options key: extra
topic-traversal-denied: exit 1, Invalid Shohin topic: ../bad
topic-path-denied: exit 1, Invalid Shohin topic: bad/topic
topic-absolute-path-denied: exit 1, Invalid Shohin topic: /tmp/bad
repoRoot-relative-path-denied: exit 1, repoRoot must be an absolute normalized path
probe-strace-denied-without-mode: exit 1, Probe controls require explicit probeMode=true
probe-setsid-denied-without-mode: exit 1, Probe controls require explicit probeMode=true
probe-watchdog-denied-without-mode: exit 1, Probe controls require explicit probeMode=true
foreign-root-common-dir-denied: exit 1, Linked worktree common git directory does not match registered root
symlink-root-path-denied: exit 1, linked worktree must be the canonical path; symlink aliases are rejected
completed-fixture-cancel-1: exit 0, status=stopped, alreadyStopped=true, runId=completed-fixture-009
completed-fixture-cancel-2: exit 0, status=stopped, alreadyStopped=true, runId=completed-fixture-009
unknown-run-cancel-1: exit 0, status=unknown, alreadyStopped=true, runId=unknown-run-009
unknown-run-cancel-2: exit 0, status=unknown, alreadyStopped=true, runId=unknown-run-009
completed-fixture-status: exit 0, run.status=exited, hints.authoritative=false, truth.authoritative=true, truth.available=false

after scopes: exit 0, no shohin-*.scope units
after persistent run-data: unchanged
after fixture: same hash=588e31e4a18c504161981c74c57c70a0a6eff7fe1c8a240adb44d27761cbea5f, status=exited, hasScope=false, launchEnvKeys=[]
after process filter: openclaw-gateway PID 3566163 only
observations: persistentRunDataUnchanged=true, fixtureRecordHashUnchanged=true, shohinScopesUnchanged=true
temporary root-denial artifacts were isolated under /tmp/shohin-task009-rpc-wMMHf9/run-root/{foreign-root-009,symlink-root-009}; no scope or runner generation was created.
```

No paid model or WAI runner dispatch occurred in task009. All `run` probes failed during RPC parsing or target-root identity validation before bundle copy, budget reservation or `systemd-run`; completed/unknown cancellation did not signal any process.

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

### Harness repair R2 control-environment and live install evidence

UTC repair window: 2026-09-13T15:13:19Z through 2026-09-13T15:36:23Z. External repair evidence root: `/home/david/.zenith/projects/20260913T063314Z-resume-shohin-phase-0-spike-from-existing-docs-superpowers-specs/.zenith/missions/mission-001/evidence/harness/repair-r2`.

Repair summary: `repair-summary.json`. The supervisor now persists a distinct validated `controlEnv` in `run.json` while keeping `launchEnv` as executor launch provenance only. Active recovery and cancel read the persisted control env, revalidate it against the explicit control-environment contract, and fail closed with `record_unavailable` for legacy active records missing a valid control environment. A narrow scope-controller fallback also handles the real `systemd-run --scope` case where the transient launcher PID has exited before cancellation: after revalidating the full `.scope` Id through `systemctl show`, it sends TERM/KILL through `systemctl kill --kill-whom=all` rather than signaling a possibly stale PID.

Red/green regression proof:

```text
$ npm --prefix plugins/shohin/spike exec -- vitest run plugins/shohin/spike/src/supervisor.test.ts
(exit 1 before production fix) strict control-env tests failed: active recovery/cancel received executor env with HOME/TMPDIR/WAI_* instead of PATH/XDG_RUNTIME_DIR/DBUS_SESSION_BUS_ADDRESS.

$ npm --prefix plugins/shohin/spike exec -- vitest run plugins/shohin/spike/src/supervisor.test.ts
(exit 0 after repair) Test Files 1 passed; Tests 6 passed.
```

Nested checks after the final repair:

```text
$ npm --prefix plugins/shohin/spike run typecheck
(exit 0) tsc --noEmit

$ npm --prefix plugins/shohin/spike run build
(exit 0) tsc -p tsconfig.build.json

$ npm --prefix plugins/shohin/spike exec -- vitest run plugins/shohin/spike/src/scope.test.ts plugins/shohin/spike/src/supervisor.test.ts
(exit 0) Test Files 2 passed; Tests 16 passed

$ npm --prefix plugins/shohin/spike test
(exit 0) Test Files 7 passed; Tests 52 passed

$ git diff --check
(exit 0)
```

Saved task gates were run for the closest touched surfaces, but this targetless repair modifies already-created files and the saved task gates are still `allowed_change=create`:

```text
$ env WAI_TYPECHECK_CMD='npm --prefix plugins/shohin/spike run typecheck' WAI_TEST_CMD='npm --prefix plugins/shohin/spike exec -- vitest run {scope}' bash /home/david/.agents/wai/scripts/task-gate.sh shohin-phase-0-spike 005
(exit 1) GATE_FAIL_CHECK=allowed_change; REJECT: create: no A (addition) recorded

$ env WAI_TYPECHECK_CMD='npm --prefix plugins/shohin/spike run typecheck' WAI_TEST_CMD='npm --prefix plugins/shohin/spike exec -- vitest run {scope}' bash /home/david/.agents/wai/scripts/task-gate.sh shohin-phase-0-spike 007
(exit 1) GATE_FAIL_CHECK=allowed_change; REJECT: create: no A (addition) recorded

$ env WAI_TYPECHECK_CMD='npm --prefix plugins/shohin/spike run typecheck' WAI_TEST_CMD='npm --prefix plugins/shohin/spike exec -- vitest run {scope}' bash /home/david/.agents/wai/scripts/task-gate.sh shohin-phase-0-spike 009
(exit 0) CONFORMS: task 009 passed all deterministic gates; GATE_FAIL_CHECK=none
```

Harmless live active-scope proof used a temporary clean Git repo and a fake WAI bundle whose `wai-dag-run.sh` only sleeps, so no provider/model calls occurred. Evidence: `real-active-scope.mjs`, `real-active-scope-summary.json`, and `post-active-scope-cleanup.json`.

```text
start status: active
controlEnv keys: DBUS_SESSION_BUS_ADDRESS, PATH, XDG_RUNTIME_DIR
executor env includes HOME behind env -i: true
fresh supervisor recovery: refreshedActiveRunIds=[realactive], scheduledTruthRunIds=[]
heartbeat refreshed: 2026-09-13T15:28:42.309Z -> 2026-09-13T15:28:42.327Z
first cancel: alreadyStopped=false, sentTerm=true, sentKill=false
second cancel: alreadyStopped=true
scope wait status: 143
post-process scope inventory: exit 0, scopeIds=[], empty=true
```

Repaired managed-copy refresh and readiness:

```text
$ realpath /home/david/.openclaw/extensions/shohin-spike
/home/david/.openclaw/extensions/shohin-spike

$ stat -c '%F %a %U:%G %n' /home/david/.openclaw/extensions/shohin-spike
directory 700 david:david /home/david/.openclaw/extensions/shohin-spike

$ wednesdayai plugins uninstall shohin-spike --dry-run
(exit 0) Will remove: config entry, install record. Dry run, no changes made.

$ wednesdayai plugins uninstall shohin-spike --force
(exit 0) removed config entry and install record

$ rm -rf /home/david/.openclaw/extensions/shohin-spike
(exit 0; removed only the verified stale managed directory)

$ wednesdayai plugins install /data/.worktree/74d2b924bcab7880c9787f573e996a33c50e6588/vivid-otter/plugins/shohin/spike
(exit 0) installed copied development plugin

$ wednesdayai plugins enable shohin-spike
(exit 0)

$ wednesdayai config set plugins.entries.shohin-spike.config.repoRoot /data/.worktree/74d2b924bcab7880c9787f573e996a33c50e6588/vivid-otter
(exit 0)

$ wednesdayai config validate
(exit 0) Config valid: ~/.openclaw/openclaw.json

$ env XDG_RUNTIME_DIR=/run/user/1000 DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus wednesdayai gateway restart --json
(exit 0) {"action":"restart","ok":true,"result":"restarted"}
```

Exact source/installed generation at `source-installed-hashes.json` generated 2026-09-13T15:36:23.125Z, allMatch=true:

```text
src/supervisor.ts       9e5fa835b530c738d11d8bd9ed41af73b024d104544b638b6e8035d897f8389c
src/supervisor.test.ts  ff5349fa76207d6805206bd165f96395afed8352c8cac193fbf4609eb56f3621
src/scope.ts            945011bd8b151c7d2c592237c2bd7d1cd167ec247e741a4d2e5fe2d8dd5502ae
src/scope.test.ts       14a44c4e42fd3dc40a07d1ad3245bef8f95d5210968703e7aa9146284d0b9976
dist/src/supervisor.js  a98bd94859c232599390ebde2b67ff6a2e74ae5717f1f8a1dbbb96f8e291b49f
dist/src/scope.js       d1a764301eb16473610427798b930c0936f49c0d134089b09d2fbe90b265bb7c
index.ts                7dbfff23b3230b18679bc25670e5f8f7b03d97a248713e54639be5c928deeba0
dist/index.js           f9c740bb188248e4d725c4a8c628283c29f9380c0e68310349b8595caabdc370
openclaw.plugin.json    877a18e2816fc51cf4c8cedc22e90c787dd15dd6bc14165ff4aa1deb6bb34fba
```

Live readiness after restart:

```text
$ env XDG_RUNTIME_DIR=/run/user/1000 DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus systemctl --user show openclaw-gateway.service --property=Id --property=ActiveState --property=SubState --property=MainPID --property=NRestarts --property=ExecMainStartTimestamp --property=UnitFileState --no-pager
Id=openclaw-gateway.service
ActiveState=active
SubState=running
UnitFileState=enabled
MainPID=1192050
NRestarts=0
ExecMainStartTimestamp=Sun 2026-09-13 15:32:59 UTC

$ wednesdayai gateway health --json
(exit 0) ok=true, channels={}, sessions.count=0

$ OPENCLAW_CATALOG_REMOTE=0 wednesdayai plugins info shohin-spike --json
(exit 0) origin=global, enabled=true, status=loaded, diagnostics=[], services=[shohin-spike-supervisor], gatewayMethods=[shohinSpike.run, shohinSpike.cancel, shohinSpike.status]

$ wednesdayai gateway call shohinSpike.status --params '{}' --json
(exit 0) service.status=ready, repoRoot=/data/.worktree/74d2b924bcab7880c9787f573e996a33c50e6588/vivid-otter, runRoot=/home/david/.openclaw/shohin-spike/run-data, refreshedActiveRunIds=[], scheduledTruthRunIds=[completed-fixture-009]
```

Raw auth-boundary check after reinstall used protocol 3 WebSocket frames without `GatewayClient` and without reading credential files. Evidence: `raw-auth-negative.json`.

```text
absent auth/device: ok=false, errorCode=NOT_PAIRED, detailCode=DEVICE_IDENTITY_REQUIRED, closeCode=1008, customMethodRequestsSentAfterDeniedHandshake=0
invalid placeholder token/no device: ok=false, errorCode=INVALID_REQUEST, detailCode=AUTH_TOKEN_MISMATCH, authReason=token_mismatch, closeCode=1008, customMethodRequestsSentAfterDeniedHandshake=0
```

Root command limitation: `pnpm lint` exited 1 before linting because `oxlint` is not installed in this workspace. No paid model calls, provider changes, core edits, target task implementation, cleanup, auth-presence guard, raw auth config read, raw unit Environment read, credential-store read, or backup inspection occurred.


## Target topic
<!-- evidence:target-topic -->

UTC target preparation: 2026-09-13T13:54:48Z. No paid WAI/model dispatch was run.

Target worktree identity:

```text
$ git rev-parse HEAD
8f6285b0d514a6e91498f4e9e7a62c74d0a82c95

$ mkdir -m 700 /tmp/shohin-spike-target-worktree-010
$ git worktree add -b spike/shohin-spike-target /tmp/shohin-spike-target-worktree-010 8f6285b0d514a6e91498f4e9e7a62c74d0a82c95
Preparing worktree (new branch 'spike/shohin-spike-target')
HEAD is now at 8f6285b docs(shohin): record corrected live gateway checks

$ stat -c '%a %U:%G %n' /tmp/shohin-spike-target-worktree-010 /tmp/shohin-spike-target-worktree-010/.git
700 david:david /tmp/shohin-spike-target-worktree-010
600 david:david /tmp/shohin-spike-target-worktree-010/.git

$ realpath /data/.worktree/74d2b924bcab7880c9787f573e996a33c50e6588/vivid-otter
/data/.worktree/74d2b924bcab7880c9787f573e996a33c50e6588/vivid-otter

$ realpath /tmp/shohin-spike-target-worktree-010
/tmp/shohin-spike-target-worktree-010

$ realpath /data/Code/WednesdayAI-plugins/.git
/data/Code/WednesdayAI-plugins/.git

$ git -C /tmp/shohin-spike-target-worktree-010 rev-parse --path-format=absolute --show-toplevel
/tmp/shohin-spike-target-worktree-010

$ git -C /tmp/shohin-spike-target-worktree-010 rev-parse --path-format=absolute --git-common-dir
/data/Code/WednesdayAI-plugins/.git
```

Final worktree porcelain:

```text
$ git worktree list --porcelain
worktree /data/Code/WednesdayAI-plugins
HEAD 5d6ab5673b37b6b40428bfc47f6c68218122e2a5
branch refs/heads/main

worktree /home/david/.local/share/opencode/worktree/74d2b924bcab7880c9787f573e996a33c50e6588/vivid-otter
HEAD 8f6285b0d514a6e91498f4e9e7a62c74d0a82c95
branch refs/heads/vivid-otter

worktree /tmp/shohin-spike-target-worktree-010
HEAD 1e91a5d7d7cbcb849b682e5c7d70a2b44b4b3bd3
branch refs/heads/spike/shohin-spike-target
```

Target branch commits:

```text
$ git -C /tmp/shohin-spike-target-worktree-010 log --oneline 8f6285b0d514a6e91498f4e9e7a62c74d0a82c95..HEAD
1e91a5d docs(shohin): submit isolated target plan
263731c test(shohin): add target storage gate fixture
9b969df docs(shohin): prepare target spec baseline
```

WAI submitters and final plan gates:

```text
$ bash /home/david/.agents/wai/scripts/wai-readme.sh shohin-spike-target docs/superpowers/specs/2026-09-13-shohin-spike-target.md 'Shohin spike target'
(exit 0) created dev-docs/workstreams/shohin-spike-target/README.md

$ bash /home/david/.agents/wai/scripts/wai-submit-spec.sh < docs/plans/shohin-spike-target/envelope/spec-envelope.json
(exit 0)

$ bash /home/david/.agents/wai/scripts/wai-precheck.sh shohin-spike-target --spec docs/superpowers/specs/2026-09-13-shohin-spike-target.md --base 8f6285b0d514a6e91498f4e9e7a62c74d0a82c95
(exit 0) LOCAL PASS: token written to docs/plans/shohin-spike-target/.precheck.passed

$ bash /home/david/.agents/wai/scripts/wai-submit-plan.sh < docs/plans/shohin-spike-target/envelope/plan-envelope.json
(exit 0)

$ bash /home/david/.agents/wai/scripts/wai-submit-spec.sh --verify-render docs/superpowers/specs/2026-09-13-shohin-spike-target.md spec < docs/plans/shohin-spike-target/envelope/spec-envelope.json
(exit 0, no output)

$ bash /home/david/.agents/wai/scripts/wai-submit-plan.sh --verify-render docs/plans/shohin-spike-target plan < docs/plans/shohin-spike-target/envelope/plan-envelope.json
(exit 0, no output)

$ bash /home/david/.agents/wai/scripts/wai-branch-guard.sh --guard
wai-branch-guard: OK (branch 'spike/shohin-spike-target' is not a protected primary checkout)

$ bash /home/david/.agents/wai/scripts/wai-freshness.sh shohin-spike-target
FRESHNESS PASS: 'shohin-spike-target' spec matches the precheck token

$ bash /home/david/.agents/wai/scripts/wai-readiness.sh shohin-spike-target
readiness: no unfolded pre-execution findings for 'shohin-spike-target' at or above severity 'medium'

$ bash /home/david/.agents/wai/scripts/wai-plan-lint.sh shohin-spike-target
PLAN-LINT PASS: shohin-spike-target - plan/frontmatter consistent, verification + SC-coverage complete

$ bash /home/david/.agents/wai/scripts/wai-precheck.sh shohin-spike-target --spec docs/superpowers/specs/2026-09-13-shohin-spike-target.md --base 8f6285b0d514a6e91498f4e9e7a62c74d0a82c95 --check-only
CHECK-ONLY PASS: all asserts passed for 'shohin-spike-target'; no token written.
```

Committed target artifacts:

```text
$ git -C /tmp/shohin-spike-target-worktree-010 ls-tree -r --name-only HEAD docs/plans/shohin-spike-target dev-docs/workstreams/shohin-spike-target docs/superpowers/specs/2026-09-13-shohin-spike-target.md docs/superpowers/specs/2026-09-13-shohin-spike-target.decisions.json
dev-docs/workstreams/shohin-spike-target/README.md
docs/plans/shohin-spike-target/.precheck.passed
docs/plans/shohin-spike-target/decisions-ledger.md
docs/plans/shohin-spike-target/envelope/plan-envelope.json
docs/plans/shohin-spike-target/envelope/spec-envelope.json
docs/plans/shohin-spike-target/phase-1-target-manifest-boundary.md
docs/plans/shohin-spike-target/phase-1/001-add-closed-shohin-storage-sqlitepath-config.md
docs/plans/shohin-spike-target/phase-1/002-add-shohin-manifest-node-test.md
docs/plans/shohin-spike-target/plan.md
docs/plans/shohin-spike-target/reviews/t001-storage-sqlite-path-gate.mjs
docs/superpowers/specs/2026-09-13-shohin-spike-target.decisions.json
docs/superpowers/specs/2026-09-13-shohin-spike-target.md
```

Rendered task metadata:

```json
{
  "taskCount": 2,
  "tasks": [
    {
      "path": "docs/plans/shohin-spike-target/phase-1/001-add-closed-shohin-storage-sqlitepath-config.md",
      "id": "001",
      "depends_on": "[]",
      "scope_test": "docs/plans/shohin-spike-target/reviews/t001-storage-sqlite-path-gate.mjs",
      "allowed_change": "edit",
      "files": ["plugins/shohin/openclaw.plugin.json"]
    },
    {
      "path": "docs/plans/shohin-spike-target/phase-1/002-add-shohin-manifest-node-test.md",
      "id": "002",
      "depends_on": "[\"001\"]",
      "scope_test": "plugins/shohin/manifest.test.mjs",
      "allowed_change": "create",
      "files": ["plugins/shohin/manifest.test.mjs"]
    }
  ]
}
```

The submitter-rendered task files initially carried WAI's legacy generic `~/.claude/wai/scripts/task-gate.sh` Done line. The task metadata, plan rows, file lists and dependencies were rendered by the submitter; only those two generated Done lines were corrected in the target branch to concrete current-path gates under `/home/david/.agents/wai/scripts`.

Targeted red/green proof:

```text
$ node --test docs/plans/shohin-spike-target/reviews/t001-storage-sqlite-path-gate.mjs
(exit 1) AssertionError: actual undefined, expected 'object'

$ git diff --name-status
M	plugins/shohin/openclaw.plugin.json

$ node --test docs/plans/shohin-spike-target/reviews/t001-storage-sqlite-path-gate.mjs
(exit 0) tests 1, pass 1, fail 0

$ node scripts/validate-manifest.mjs
validate-manifest: OK (4 plugin(s))

$ git commit -m 'feat(shohin): target add storage sqlite path'
990334304cdd6d45d29f2c7c1597a1802562a94d

$ WAI_TYPECHECK_CMD='node --check docs/plans/shohin-spike-target/reviews/t001-storage-sqlite-path-gate.mjs' bash /home/david/.agents/wai/scripts/task-gate.sh shohin-spike-target 001 --commit 9903343
CONFORMS: task 001 passed all deterministic gates
GATE_FAIL_CHECK=none

$ git show --name-status --pretty=format: 9903343
M	plugins/shohin/openclaw.plugin.json

$ node --check plugins/shohin/manifest.test.mjs
(exit 0)

$ node --test plugins/shohin/manifest.test.mjs
(exit 0) tests 1, pass 1, fail 0

$ git commit -m 'test(shohin): target add manifest storage test'
3aaf446311f965ed5b27cf1fe936e1b8dc6dba12

$ WAI_TYPECHECK_CMD='node --check plugins/shohin/manifest.test.mjs' bash /home/david/.agents/wai/scripts/task-gate.sh shohin-spike-target 002 --commit 3aaf446
CONFORMS: task 002 passed all deterministic gates
GATE_FAIL_CHECK=none

$ git show --name-status --pretty=format: 3aaf446
A	plugins/shohin/manifest.test.mjs

$ git reset --hard 1e91a5d7d7cbcb849b682e5c7d70a2b44b4b3bd3
HEAD is now at 1e91a5d docs(shohin): submit isolated target plan

$ git -C /tmp/shohin-spike-target-worktree-010 status --porcelain
(exit 0, no output)

$ git -C /tmp/shohin-spike-target-worktree-010 branch --show-current
spike/shohin-spike-target
```

Linked worktree/common-dir checks:

```text
$ node --input-type=module <resolveLinkedWorktree actual-target and different-repo fixture>
{
  "registered": "/data/.worktree/74d2b924bcab7880c9787f573e996a33c50e6588/vivid-otter",
  "target": "/tmp/shohin-spike-target-worktree-010",
  "accepted": "/tmp/shohin-spike-target-worktree-010",
  "otherRepo": "/tmp/shohin-path003-other-C8OSs2",
  "differentRepoRejected": true,
  "rejection": "Linked worktree common git directory does not match registered root"
}

$ npm --prefix plugins/shohin/spike exec -- vitest run plugins/shohin/spike/src/environment.test.ts plugins/shohin/spike/index.test.ts
Test Files  2 passed (2)
Tests  18 passed (18)

$ npm --prefix plugins/shohin/spike run typecheck
(exit 0)

$ npm --prefix plugins/shohin/spike run build
(exit 0)
```

Target hygiene:

```text
$ printenv WAI_DAG_TEST_MODE
(exit 1, unset)

$ git -C /tmp/shohin-spike-target-worktree-010 diff --check 8f6285b0d514a6e91498f4e9e7a62c74d0a82c95..HEAD
(exit 0, no output)

$ git -C /tmp/shohin-spike-target-worktree-010 status --short --branch
## spike/shohin-spike-target
```

Dependency note: the target worktree intentionally did not carry the nested package's untracked `plugins/shohin/spike/node_modules`; direct target-worktree `npm --prefix plugins/shohin/spike run typecheck` and `run build` failed there with `tsc: not found`, and `index.test.ts` could not resolve `wednesdayai/plugin-sdk`. The same code-level checks passed in the outer workspace where the nested package dependencies from task002 are installed. Target-specific WAI/Git/Node surface checks above all ran in `/tmp/shohin-spike-target-worktree-010`.

### Target lifecycle metadata repair

UTC repair proof: 2026-09-13T16:00:59Z. This corrects the VAL-TARGET-002 lifecycle metadata regression while preserving the original task010 target setup. The target branch `spike/shohin-spike-target` moved from previous clean pre-task baseline `1e91a5d7d7cbcb849b682e5c7d70a2b44b4b3bd3` to current clean pre-task baseline `913b6ec13e5e5fb10bb8fc9ed4ce06f9f6d8fab2`.

Target metadata commit:

```text
$ git -C /tmp/shohin-spike-target-worktree-010 show --name-status --pretty=format: HEAD
M	dev-docs/workstreams/shohin-spike-target/README.md

$ git -C /tmp/shohin-spike-target-worktree-010 status --short --branch
## spike/shohin-spike-target
```

Current target identity:

```json
{
  "targetWorktree": "/tmp/shohin-spike-target-worktree-010",
  "targetMode": "700",
  "branch": "spike/shohin-spike-target",
  "commonGitDir": "/data/Code/WednesdayAI-plugins/.git",
  "previousBaseline": "1e91a5d7d7cbcb849b682e5c7d70a2b44b4b3bd3",
  "previousBaselineReadmeStatus": "draft",
  "currentBaseline": "913b6ec13e5e5fb10bb8fc9ed4ce06f9f6d8fab2",
  "currentReadmeStatus": "active",
  "precheckSpecSha": "0bb3dce2963aa76f830f1acea6d4db456b8c8b97",
  "precheckBase": "8f6285b0d514a6e91498f4e9e7a62c74d0a82c95",
  "taskCount": 2
}
```

Preserved target hashes after the repair and disposable-clone proof:

```text
49f02b9999c84c19e438a124b4b08ed2eb14063d788a1cc09f1510c5ed296ea8  dev-docs/workstreams/shohin-spike-target/README.md
5a7448e59dd745521a6f2c3f6bff633501032639781d72130897b6b0c7e4266f  docs/superpowers/specs/2026-09-13-shohin-spike-target.md
a2a632bf39cc0a39ba86c772df2c938c261de932bfe2933d3f386d84c3cb06c0  docs/plans/shohin-spike-target/.precheck.passed
c2a15b2bffbbe452be9c4a2e5bb074dd79bb34324e5622b9be6d7c75dee8ad0e  docs/plans/shohin-spike-target/reviews/t001-storage-sqlite-path-gate.mjs
7d2dd36505d8276cc69241434a2b3ec59c29beecc1397d21ebfad95f01557875  docs/plans/shohin-spike-target/phase-1/001-add-closed-shohin-storage-sqlitepath-config.md
108f7d66c9e3a4cd57501d689e5cfc6a53d33bde803e945bafb65b650975f458  docs/plans/shohin-spike-target/phase-1/002-add-shohin-manifest-node-test.md
```

External repair evidence:

```text
5950d34d13d90e069c39a66bd512c0b82fbcf68d8a270134ccc9f4025bfc5ee4  /home/david/.zenith/projects/20260913T063314Z-resume-shohin-phase-0-spike-from-existing-docs-superpowers-specs/.zenith/missions/mission-001/evidence/harness/repair-r2/current-target-baseline.json
8b028e5449eadbbfea4c24da39d11f556416bdf9f5e24897ad0ec476c90c0894  /home/david/.zenith/projects/20260913T063314Z-resume-shohin-phase-0-spike-from-existing-docs-superpowers-specs/.zenith/missions/mission-001/evidence/harness/repair-r2/target-status-repair-selfcheck.json
502630b696e2bd786fd560c4f17fb84efd048be2f3d447d1f9c026f06ac4edc2  /home/david/.zenith/projects/20260913T063314Z-resume-shohin-phase-0-spike-from-existing-docs-superpowers-specs/.zenith/missions/mission-001/evidence/harness/repair-r2/target-status-repair-selfcheck.log
```

Disposable clone proof: argument-array verifier used `/tmp/shohin-target-r2-clone-KaVu7p` at baseline `913b6ec13e5e5fb10bb8fc9ed4ce06f9f6d8fab2`. `wai-branch-guard.sh --guard`, `wai-freshness.sh shohin-spike-target`, `wai-readiness.sh shohin-spike-target --repo-root /tmp/shohin-target-r2-clone-KaVu7p`, `wai-plan-lint.sh shohin-spike-target`, `wai-precheck.sh ... --check-only`, `wai-submit-spec.sh --verify-render ...`, and `wai-submit-plan.sh --verify-render ...` all exited 0. The target-specific status check observed README `status: active`, precheck present, target status violation absent, and no `WAI_DAG_TEST_MODE` was passed to the checks.

Unchanged two-task fixture proof in the disposable clone: `node --test docs/plans/shohin-spike-target/reviews/t001-storage-sqlite-path-gate.mjs` exited 1 at the clean pre-task baseline, exited 0 after only `plugins/shohin/openclaw.plugin.json` was edited, and task001 gate passed at temporary commit `f0ae644f2cc86109b57b5e79a4c312e30edf1dd0` with commit file set `M plugins/shohin/openclaw.plugin.json`. Task002 then created only `plugins/shohin/manifest.test.mjs`; `node --check`, `node --test`, and task002 gate passed at temporary commit `11fe38ac186524aa926e49e86a918a84e7b43194` with commit file set `A plugins/shohin/manifest.test.mjs`. These temporary commits live only in the disposable clone; the real target worktree remains clean at `913b6ec13e5e5fb10bb8fc9ed4ce06f9f6d8fab2`.

Global status caveat: `wai-status.sh` in the disposable clone exited 3 for an inherited unrelated workstream, `dev-docs/workstreams/shohin-phase-0-spike/README.md`, which is still `draft` despite `docs/plans/shohin-phase-0-spike/.precheck.passed`. The target topic itself no longer has the draft-plus-advancement violation. This repair intentionally did not edit the inherited outer workstream README or any unrelated workstream metadata.

Remaining parent consumers to update before work011: `docs/plans/shohin-phase-0-spike/decisions-ledger.md` still records old target baseline `1e91a5d7d7cbcb849b682e5c7d70a2b44b4b3bd3`; mission regression ledger `missions/mission-001/regressions/VAL-TARGET-002.md` still records the now-repaired draft status as current; any work011 assignment/harness prompt that restores or verifies the target pre-task baseline must consume `evidence/harness/repair-r2/current-target-baseline.json` and use `913b6ec13e5e5fb10bb8fc9ed4ce06f9f6d8fab2`. Historical old-baseline lines earlier in this report remain preserved transcript evidence, not the current baseline.

## SC1 — scope cancellation
<!-- evidence:SC1 -->

R3 repair note (2026-09-13): the earlier control-env repair still treated malformed or unreadable launcher identity as launcher absence, which let `systemctl kill` signal a unit from fake-adapter cases. The repaired boundary now records and reuses systemd `InvocationID` plus cgroup identity from `systemctl show`, passes that recorded binding into cancellation after supervisor restart, refuses running units whose binding is missing or changed, and treats only explicit `ENOENT`/`ESRCH` launcher absence as eligible for verified unit fallback. Malformed `/proc/<pid>/stat`, EACCES, PID reuse, changed invocation, missing invocation/cgroup, bus/show errors and post-KILL stop timeout remain errors with no success persistence. Already stopped or collected scopes return a no-signal no-op, and concurrent supervisor cancellation coalesces to one controller call.

Evidence is under `/home/david/.zenith/projects/20260913T063314Z-resume-shohin-phase-0-spike-from-existing-docs-superpowers-specs/.zenith/missions/mission-001/evidence/harness/repair-r3/`. Red checks before implementation: focused `scope.test.ts` exited 1 with 9 new cancellation-boundary failures; focused `supervisor.test.ts` exited 1 with missing identity forwarding and duplicate concurrent cancel calls. Green checks after repair: `final-focused-scope-supervisor-tests.json` exited 0 with 23 tests; `final-nested-typecheck.json`, `final-nested-build.json`, `final-full-nested-tests.json`, `final-installed-build.json` and `final-diff-whitespace.json` exited 0. `final-wai-task009-gate.json` exited 0. Historical task gates `wai-task005-gate.json` and `wai-task007-gate.json` exited 1 only at `allowed_change=create`, as expected for repair edits to previously created files. Root `pnpm lint` remains blocked by missing `oxlint`, captured in `root-pnpm-lint.json`.

Live no-provider proof: `real-scope-cancel-r3.mjs` launched owned scope `shohin-shohin-phase-0-spike-r3-1789317655700-085c93eb.scope` through the real controller with the tracked watchdog and a fake sleep runner. Before cancel, `real-scope-cancel-r3-summary.json` recorded `InvocationID=add083598ce649ae9efceb286aba1f70`, the exact scope Id, cgroup path, three cgroup PIDs, and a recorded setsid descendant PID/start-time. First cancel sent TERM then bounded KILL and returned only after `LoadState=not-found`/`SubState=dead`; the descendant and launcher `/proc` identities were absent immediately and remained absent after 15 seconds. Repeated cancel returned `{sentTerm:false,sentKill:false}`. Final and post-cleanup owned `shohin-*.scope` inventories were empty and the temporary run directory was removed.

Install and gateway proof: the owned development copy at `/home/david/.openclaw/extensions/shohin-spike` was refreshed with the repaired source, built successfully, and `install-refresh-summary.json` shows source/install parity for repaired source, tests and dist artifacts. The local CLI no longer accepts the historical `gateway restart --deep` flag; `wednesdayai-gateway-restart-supported.json` records the supported `wednesdayai gateway restart` command exiting 0, followed by gateway health 0, plugin info loaded/enabled with empty diagnostics, and `shohinSpike.status` reporting service ready. `raw-auth-negative-r3.json` confirms default core auth still rejects absent auth/device and invalid placeholder-token handshakes without sending Shohin method calls. No paid provider/model calls were made.

R4 correction note (2026-09-13): decision020/021 left two residual defects after r3: missing or unsupported `LoadState`/`SubState` could authorize a signal, and `dead`/`failed` scope labels could be treated as stopped without hierarchical membership proof. The repaired controller now accepts only scope substates `running`, `start-chown`, `abandoned`, `stop-sigterm`, `stop-sigkill`, `dead`, and `failed`; `exited` is explicitly unknown for scopes. Missing, conflicting or unsupported state throws `scope_state_unknown` before PID or unit signaling. Terminal `dead`/`failed` observations require `cgroup.events` `populated 0` or verified absence of the captured cgroup path; malformed, inaccessible or contradictory membership throws `scope_membership_unavailable`; populated membership remains signalable only after recorded `InvocationID` and normalized cgroup binding are verified, and it never completes cancellation by label alone.

R4 fake-adapter evidence is under `/home/david/.zenith/projects/20260913T063314Z-resume-shohin-phase-0-spike-from-existing-docs-superpowers-specs/.zenith/missions/mission-001/evidence/harness/repair-r4/`. Red checks before implementation: focused `scope.test.ts` exited 1 with 7 new state/membership failures, and focused `supervisor.test.ts` exited 1 with 2 blind terminal-persistence failures. Green checks after repair: focused scope/supervisor tests exited 0 with 31 tests; nested typecheck and build exited 0; full nested suite exited 0 with 67 tests; `scope-state-preflight-r4.mjs` exited 0 across 10 all-fake cases covering unknown state, `exited`, malformed/EACCES membership, failed/dead populated hierarchy, nested-only population via `cgroup.events`, empty terminal membership, removed captured cgroup, and changed terminal identity. Historical task005 and task007 gates still exit 1 only at `GATE_FAIL_CHECK=allowed_change` because those saved gates are create-only; root `pnpm lint` still exits 1 before linting because `oxlint` is not installed.

R4 live no-provider proof: `real-scope-cancel-r4.mjs` launched owned scope `shohin-shohin-phase-0-spike-r4-1789320742999-669c5bc9.scope` through built `dist/src/scope.js` with explicit tracked `scripts/watchdog.sh`, probe-mode `recordSetsidDescendant`, and watchdog-disabled runner isolation. Before cancel, `real-scope-cancel-r4-summary.json` recorded exact Id, `InvocationID=79164ee5734e4bbfaf30031a06880121`, cgroup path, `cgroup.events` `populated 1`, cgroup PIDs `2111430`, `2111434`, `2111437`, and descendant PID `2111434` with start time `31389625` in the same cgroup. First cancel sent TERM then bounded KILL and returned only after the descendant, launcher and captured `cgroup.events` path were absent; the same absence held after 15 seconds. Repeated cancel returned `{sentTerm:false,sentKill:false}`. Final and post-cleanup owned `shohin-*.scope` inventories were empty and the temporary run directory was removed.

R4 install and gateway proof: the verified managed copy at `/home/david/.openclaw/extensions/shohin-spike` was refreshed from this source while preserving its `node_modules`, rebuilt successfully, and `gateway-install-r4-summary.json` shows source/install hash parity for repaired source, tests, scripts and built dist artifacts. The evidence script ran the supported `wednesdayai gateway restart` with explicit user-bus variables, then `wednesdayai gateway health --json`, `wednesdayai plugins info shohin-spike --json`, and `wednesdayai gateway call shohinSpike.status --params '{}' --json`; all exited 0, health was ok, the plugin was loaded/enabled with empty diagnostics, methods remained `shohinSpike.run`, `shohinSpike.cancel`, `shohinSpike.status`, service remained ready, and raw WebSocket protocol 3 absent-auth/device plus invalid-placeholder-token handshakes were denied without sending Shohin method calls. No paid provider/model calls were made.


R5 service-maintenance repair note (2026-09-13): decision027/029 identified two pre-paid lifecycle defects: the supervisor did not maintain active heartbeats after start/recovery, and the watchdog compared a 19-digit `date +%s%3N` value against second-derived heartbeat mtimes. The repair keeps the r4 identity, cgroup-membership and control-env protections, changes the normal RPC stale default to 60 seconds, starts one 10-second heartbeat maintenance loop only after a launched/recovered scope is verified active, and disposes that maintenance on cancel, runner terminal status, unknown classification or service stop. Service stop only disposes timers and wait observers; it does not cancel, reset or retry the live scope, leaving independent watchdog expiry for the later gateway-death proof.

Scope launch now returns a structured wait result with bounded 8192-byte closed-filtered stderr and exit status. Only recognized systemd start markers and watchdog heartbeat clock diagnostics are retained; unrecognized launch text is suppressed before persistence as `[unrecognized launch stderr suppressed]`. The supervisor observes that wait result as diagnostic evidence, persists it as `scopeLaunchExit`, and classifies an ended or unverifiable active scope as `unknown` rather than treating launcher exit as task truth. Positive hint/completion verification remains the next r5 integration task; this note does not accept task015 or the later real WAI death/reset matrix.

Evidence is under `/home/david/.zenith/projects/20260913T063314Z-resume-shohin-phase-0-spike-from-existing-docs-superpowers-specs/.zenith/missions/mission-001/evidence/harness/repair-r5/service-maintenance-2026-09-13T19-45-47-494Z/` and the final closed-diagnostic follow-up directory `/home/david/.zenith/projects/20260913T063314Z-resume-shohin-phase-0-spike-from-existing-docs-superpowers-specs/.zenith/missions/mission-001/evidence/harness/repair-r5/closed-launch-diagnostics-membership-2026-09-13T20-05-32-933Z/`. Green checks after final repair: focused scope/supervisor/index Vitest exited 0 with 50 tests; nested typecheck exited 0; nested build exited 0; full nested suite exited 0 with 80 tests; `git diff --check` exited 0. Root `pnpm lint` still exits 1 before linting because `oxlint` is missing, root `pnpm format` exits 1 because `oxfmt` is missing, and root `pnpm test` exits 1 because the root package has no test script/output. Historical task gates 005, 007 and 008 still reject repair edits at `allowed_change=create`; task009's edit gate previously exited 0.

Live no-provider watchdog proof: `enabled-watchdog-fresh-stale-closed-diagnostics.json` records `/usr/bin/date +%s%3N` still producing 19 digits on the host, while the repaired watchdog source no longer contains `%s%3N` and reports comparable 13-digit `now_ms`/`mtime_ms` diagnostics. An owned enabled fresh-heartbeat scope with `heartbeat-stale-ms=30000` stayed `loaded/running` after 1500ms; selected `cgroup.events` read `populated 1`, and cleanup cancellation removed it. A separate owned enabled stale-boundary scope with `heartbeat-stale-ms=1500` first showed `loaded/running` after 500ms with selected `cgroup.events` `populated 1` and a recorded setsid descendant, then the watchdog emitted `heartbeat stale now_ms=1789329939000 mtime_ms=1789329937000 age_ms=2000 stale_ms=1500`, exited 137 through cgroup kill, left the descendant not running, and ended with the unit `not-found/dead`. Wait stderr in the artifact contains only closed systemd start markers plus the recognized watchdog stale line, and final `shohin-*.scope` inventory was empty.

Install and gateway proof: the owned managed extension `/home/david/.openclaw/extensions/shohin-spike` was refreshed from source while preserving `node_modules`, rebuilt successfully, and the authorized development gateway restarted with the supported `wednesdayai gateway restart` command. `install-health-parity-closed-diagnostics.json` records source/install sha256 parity for the repaired source, watchdog and built dist artifacts; `wednesdayai gateway health --json`, `wednesdayai plugins info shohin-spike --json`, and `wednesdayai gateway call shohinSpike.status --params '{}' --json` all exited 0. Status reported service `ready`, no refreshed active runs, historical r4 failed lifecycle records ignored, and `completed-fixture-009` scheduled for async truth as before. No provider/model dispatch or credential changes occurred.

R5 production observation/completion repair note (2026-09-13): decision027-037 follow-up connected actual WAI run-state/attention observations and independent completion verification into the production Shohin spike supervisor. Native WAI .wai-run-state.json from docs/plans/<topic>/ is now parsed with topic/repo/run identity, real task state arrays, attention reasons and malformed/wrong-topic rejection; generic executor hints remain non-authoritative. Active runs refresh bounded observations on launch/recovery and dispose maintenance on terminal/cancel/service stop.

Completion handling now freezes the committed task manifest and verifier inputs before launch, snapshots prelaunch observation files, observes actual scope wait/runner exit separately from task truth, discovers native branch commits from dag-worker commit subjects, then persists asynchronous historical-verifier outcomes as success, named failure or verification error. Status distinguishes active run activity, verification pending/unavailable and available outcomes; missing trustworthy exit after gateway death remains unknown rather than fabricated.

Approved deterministic no-provider probes are now selected only by operator-controlled profile id through the existing admin run/probeMode path. The plugin config schema remains closed to optional repoRoot only. Missing, unknown, unapproved, altered, path-aliased or substituted profiles are refused before dispatch; model/provider/cost/control-env/probe/runner/bundle/run-root/heartbeat substitutions are denied; reviewed profiles bind manifest, starting HEAD, common git dir, service PATH, verifier commands, runner argv and transformed generation hashes.

Corrected parent-review packet: /home/david/.zenith/projects/20260913T063314Z-resume-shohin-phase-0-spike-from-existing-docs-superpowers-specs/.zenith/missions/mission-001/evidence/harness/repair-r5/profile-review-20260913T231355Z/. Candidate registry digest: sha256:86c411fedf6b6993ed258a9e529e4847c2eec5d8f889163b8b845f523a2b80f9. This supersedes the decision039-rejected `profile-review-20260913T223902Z` packet; scoped verifier checks now read produced output files in the actual historical checkout and fail on absent or wrong content, with `scope-check-negative-validation.json` proving all ten untouched-baseline checks fail. The packet preserves rejected historical drafts as unapproved history, prepares five clean fixture profiles (success, runner nonzero, gate nonzero, missing task commit, lifecycle hold), validates recursive canonical JSON nested-tamper sensitivity, records explicit unexecuted RPC/verifier inputs, and includes broader PATH-resolved executable dependency pins. No shohinSpike.run, deterministic runner, WAI runner, task gate, model/provider dispatch, target reset or live profile execution was performed; parent review is still required before installing the candidate registry and running live validators.

Green checks for this repair: nested typecheck, build and full Shohin spike Vitest suite passed with 99 tests; installed source/build parity and focused installed tests passed with 50 tests; corrected packet digest/syntax/runner-block/baseline-negative/resolver validations passed; supported gateway restart/status and shohinSpike.status RPC returned ready. Root pnpm lint remains blocked by missing oxlint, and root pnpm format remains blocked by missing oxfmt. The historical saved task gates still reject repair edits where their rules are create-only; those historical rejections were not changed or reinterpreted.

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
