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
