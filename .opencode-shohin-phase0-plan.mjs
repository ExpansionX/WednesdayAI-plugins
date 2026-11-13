const topic = "shohin-phase-0-spike";
const specPath = "docs/superpowers/specs/2026-09-05-shohin-phase-0-spike.md";
const report = "dev-docs/workstreams/shohin-phase-0-spike/spike-report.md";

const reportTasks = new Set(["001", ...Array.from({ length: 12 }, (_, i) => String(i + 9).padStart(3, "0"))]);
const spikeCreators = new Set(Array.from({ length: 7 }, (_, i) => String(i + 2).padStart(3, "0")));

function conflicts(id) {
  const values = new Set();
  if (reportTasks.has(id)) {
    for (const other of reportTasks) if (other !== id) values.add(other);
  }
  if (spikeCreators.has(id)) values.add("019");
  if (id === "019") {
    for (const other of spikeCreators) values.add(other);
  }
  return [...values].sort();
}

function task(id, phase, title, options) {
  return {
    id,
    phase,
    title,
    status: "ready",
    depends_on: options.depends_on ?? [],
    parallel: false,
    conflicts_with: conflicts(id),
    files: options.files,
    siblings: options.siblings,
    scope_test: options.scope_test,
    allowed_change: options.allowed_change,
    irreversible: options.irreversible ?? false,
    covers_criteria: options.covers_criteria ?? [],
    covers_tests: options.covers_tests ?? [],
    superseded: false,
    failing_test: options.failing_test,
    change: options.change,
    allowed_moves: options.allowed_moves,
    stop_triggers: options.stop_triggers,
    manual_verification: options.manual_verification,
  };
}

const tasks = [
  task("001", 1, "Adopt and freeze the development gateway baseline", {
    files: [report],
    siblings: ["dev-docs/workstreams/shohin-phase-0-spike/README.md"],
    scope_test: "N/A",
    allowed_change: "create",
    failing_test: "N/A — this task proves host infrastructure with command output, not repository behaviour.",
    change: `**File:** \`${report}\`\n**Anchor:** new file; it must not exist.\n**Before:** none.\n**After:** first capture \`PRE_SPIKE_SHA=$(git rev-parse HEAD)\`. Build \`/data/Code/WednesdayAI-core\` at its current commit with \`pnpm install\`, \`pnpm ui:build\`, \`pnpm build\`, \`npm pack\`, and globally install the resulting \`wednesdayai-0.4.11.tgz\` without sudo unless npm itself proves privilege is required. Run noninteractive onboarding with an unprofiled \`OPENCLAW_STATE_DIR=$HOME/.openclaw\`, risk accepted, local mode, auth skipped, loopback port 18789, generated token auth, tailscale off, daemon runtime node, daemon installed, and channels/skills/UI setup skipped. Persist the exact SQLite session-storage object from the frozen design and \`env.vars.OPENCLAW_SKIP_CHANNELS=\"1\"\`, validate config, then force-reinstall the user unit so that setting reaches the daemon. Never print or embed the gateway token, raw unit Environment, or the token-bearing backup unit.\n\nCreate the report with frontmatter-free Markdown and these exact top-level headings in order: \`# Shohin Phase 0 spike report\`, \`## Baseline identity\`, \`## Development gateway\`, \`## SC1 — scope containment and cancellation\`, \`## SC2 — minimal ephemeral HOME\`, \`## SC3a — worker ladder addressing\`, \`## SC3b — cold versus warm attach\`, \`## SC4 — hints versus truth\`, \`## SC5 — gateway death and reset recovery\`, \`## SC6 — runner dependency and cost inventory\`, \`## SC7 — lane-worktree failure\`, \`## SC8 — cleanup\`, \`## Runner changes proposed upstream\`, \`## Proposed Phase 1 Executor contract\`, and \`## Proposed Phase 1 recovery policy\`. Under Baseline identity record PRE_SPIKE_SHA, this repository path/branch/HEAD, core commit/version, Node/pnpm/npm/OpenCode/WAI versions, UTC start, and the operator-approved USD 50 cap. Under Development gateway embed redacted fenced command/output blocks for install and verification and selected non-secret systemd properties (Restart, RestartUSec, KillMode, MainPID, active/enabled) plus config path, SQLite path, control-UI HTTP status, and the journal line proving channels were skipped. Every later section initially contains the literal marker \`<!-- evidence:<SC id> -->\`; the three conclusion sections contain \`<!-- conclusion:<name> -->\`.`,
    change: `**File:** \`${report}\`. **Anchor:** new file; it must not exist. **Before:** none. **After:** capture \`PRE_SPIKE_SHA=$(git rev-parse HEAD)\`. The operator has already designated this host gateway for development/testing. Detect the existing \`openclaw-gateway.service\`, port 18789 listener, CLI/core version, explicit SQLite session-storage object, persisted channel-skip setting, gateway health, config path and selected non-secret unit properties. If and only if it is WednesdayAI 0.4.11 from the expected core, active/enabled on loopback 18789, explicitly SQLite with JSONL fallback disabled, channels skipped and operator-confirmed as this workstream's dev/test gateway, adopt it without onboarding, global install, config mutation or unit reinstall. Otherwise STOP and ask the operator; never repair automatically. Never print the gateway token, raw unit Environment, config auth or backup unit.\n\nCreate frontmatter-free Markdown with exact headings: \`# Shohin Phase 0 spike report\`; \`## Baseline identity\`; \`## Development gateway\`; SC1, SC2, SC3a, SC3b, SC4, SC5, SC6, SC7 and SC8 headings exactly as frozen; then \`## Runner changes proposed upstream\`, \`## Proposed Phase 1 Executor contract\`, and \`## Proposed Phase 1 recovery policy\`. Record repository path/branch/HEAD, core/CLI provenance, tool versions, UTC start and USD 50 cap. Record selected unit properties Id, FragmentPath, Restart, RestartUSec, KillMode, MainPID and NRestarts plus the ownership confirmation. Put literal evidence markers under SC1-SC7 and \`<!-- evidence:SC8 -->\` under SC8; put the three conclusion markers under the final headings.`,
    allowed_moves: "Create only the report. This task is read-only against host installation/config/unit: do not onboard, reinstall, mutate provider/channel config, or touch WednesdayAI-core. Redact every secret before report persistence.",
    stop_triggers: "Stop if gateway ownership is unconfirmed, the existing gateway is absent/dirty/mismatched from 0.4.11, not loopback 18789, not explicitly SQLite with fallback disabled, channels are active, unit/health is unavailable, or verification would expose a token. Never repair/reinstall automatically.",
    manual_verification: "Run redacted config validation/get, deep status, health RPC, enabled/active checks, selected systemctl properties including Id, and loopback HTTP 200. Confirm exact adopted baseline, ownership approval, and no token-like report value.",
  }),

  task("002", 1, "Create the throwaway plugin package and strict test harness", {
    depends_on: ["001"],
    files: [
      "plugins/shohin/spike/.gitignore",
      "plugins/shohin/spike/package.json",
      "plugins/shohin/spike/openclaw.plugin.json",
      "plugins/shohin/spike/tsconfig.json",
      "plugins/shohin/spike/tsconfig.build.json",
      "plugins/shohin/spike/package.test.ts",
    ],
    siblings: ["extensions/skillweaver/package.json", "extensions/skillweaver/tsconfig.json", "extensions/skillweaver/package.test.ts"],
    scope_test: "plugins/shohin/spike/package.test.ts",
    allowed_change: "create",
    failing_test: "Create `plugins/shohin/spike/package.test.ts` first. It reads siblings from `import.meta.dirname` and asserts package/id/private ESM/Node>=24, `wednesdayai.extensions` exactly `[\"./index.ts\"]`, a closed manifest whose only property is optional string `repoRoot`, build/typecheck/test scripts, and exact ignored directories. After package.json exists, install locally and run with `npm --prefix plugins/shohin/spike exec -- vitest run package.test.ts`; expect RED until remaining scaffold exists. Never rely on root Vitest.",
    change: "Create the six listed files. Read all three SkillWeaver siblings first and record their exclusions/guards/structure in the ledger, justifying divergences. Package is private NodeNext ESM, Jiti entry `./index.ts`, local dev dependencies including `wednesdayai` via `file:/data/Code/WednesdayAI-core`, never workspace. Manifest schema is closed and permits only optional `repoRoot:string`, used to register the canonical outer repository before installation. Install with `npm install --no-package-lock --ignore-scripts` inside the nested package; no root workspace/lock mutation. All task-gate invocations for scoped TypeScript tests must receive the orchestrator environment `WAI_TYPECHECK_CMD='if [ -f plugins/shohin/spike/package.json ]; then npm --prefix plugins/shohin/spike run typecheck; else true; fi'` and `WAI_TEST_CMD='npm --prefix plugins/shohin/spike exec -- vitest run {scope}'`; never create a tracked `.wai-test-cmd`.",
    allowed_moves: "Create only the six scaffold files. Do not add the nested path to pnpm-workspace.yaml, root lockfile, catalog, root Shohin package, or CI. Do not add runtime dependencies or suppress TypeScript errors.",
    stop_triggers: "Stop if any create target exists, the local core package cannot be installed as a dev dependency without changing the root lockfile, the SDK cannot resolve from `wednesdayai/plugin-sdk`, or the sibling conventions cannot be reconciled without an unlisted file.",
    manual_verification: "Run `npm --prefix plugins/shohin/spike run typecheck`, `npm --prefix plugins/shohin/spike test -- package.test.ts`, and `git status --short`. Expected: typecheck and test pass; only the six tracked create targets appear (node_modules is ignored, no lockfile).",
  }),

  task("003", 1, "Create the credential-minimising environment builder", {
    depends_on: ["002"],
    files: [
      "plugins/shohin/spike/src/environment.ts",
      "plugins/shohin/spike/src/environment.test.ts",
      "plugins/shohin/spike/home.allow",
      "plugins/shohin/spike/env.allow",
    ],
    scope_test: "plugins/shohin/spike/src/environment.test.ts",
    allowed_change: "create",
    failing_test: "Create `environment.test.ts` first. Assert topic validation; canonical registered root resolution; linked worktrees accepted only when `git rev-parse --git-common-dir` matches the registered root; traversal/symlink/different-repository rejection; empty immutable source home.allow; contained copies into mode-0700 HOME; executor env contains only PATH/HOME/TMPDIR plus explicit runner variables and no bus/credential variables; control env contains only PATH plus validated XDG_RUNTIME_DIR and optional DBUS_SESSION_BUS_ADDRESS and still excludes gateway/git/SSH/gh credentials. Assert control and executor objects are distinct and no process.env spread occurs.",
    change: "Create exports `validateTopic`, `resolveRegisteredRepoRoot`, `resolveLinkedWorktree`, `readAllowList`, `copyAllowedHome`, `buildExecutorEnvironment`, and `buildControlEnvironment`. Every source env/root is explicit. Linked targets are authorized by matching canonical Git common directory, never by being beneath another worktree. HOME copying rejects absolute/`..`/escaping symlinks/special files. Executor env has no user-bus access. Control env is used only to launch/inspect/cancel systemd units and contains PATH plus validated user-bus addresses; scan both outputs against forbidden credential names. Keep tracked home.allow empty and env.allow PATH-only as immutable source defaults; each run copies them under ignored run-data and only that runtime copy may grow from observed errors.",
    allowed_moves: "Only four create targets. No HOME/process.env mirroring. Tracked allow lists remain immutable; runtime copies live under run-data and are removed at cleanup.",
    stop_triggers: "Stop if OpenCode authentication appears to require copying the whole HOME, a secret not owned by the OpenCode harness, following a symlink outside HOME, or an unlisted environment variable.",
    manual_verification: "Run `npm --prefix plugins/shohin/spike exec -- vitest run src/environment.test.ts` and `npm --prefix plugins/shohin/spike run typecheck`; both pass. Record the explicit deny assertions in the ledger.",
  }),

  task("004", 1, "Create append-only evidence and deterministic assessor scripts", {
    depends_on: ["003"],
    files: [
      "plugins/shohin/spike/scripts/notify.sh",
      "plugins/shohin/spike/scripts/report-append.sh",
      "plugins/shohin/spike/scripts/opencode-wrapper.sh",
      "plugins/shohin/spike/scripts/orchestrator-abort.sh",
      "plugins/shohin/spike/src/evidence-scripts.test.ts",
    ],
    scope_test: "plugins/shohin/spike/src/evidence-scripts.test.ts",
    allowed_change: "create",
    failing_test: "Create the test first. Assert notify JSON escaping/locking; report append locking; wrapper records role/model/attempt/argv/start/end/status, captures stdout and stderr separately under a 0700 run dir while preserving both streams and status, and exposes token-usage records without environment/secret values; concurrent writes do not interleave. Invoke assessor exactly as `orchestrator-abort.sh <envelope-file> <repo-root>` with no stdin and assert `{overall:'abort',items:[{task_id,decision:'abort',reason}]}` matching the installed runner schema.",
    change: "Create four executable strict Bash scripts using Python JSON encoding and flock. Notify accepts exactly the runner's three args. Report append records literal command plus captured stdout/stderr. Wrapper requires explicit real OpenCode binary/call log/role/model/attempt/run dir; tee/capture stderr before the copied executor's `/dev/null` boundary, preserve NDJSON stdout/status, and append redacted per-call timing/usage records. Assessor reads envelope path from `$1`, validates repo root `$2`, extracts attended task ids, and emits the runner's actual overall/items decision schema; it never reads stdin or invokes a model. It is not claimed to control gate-fail, which routes through `_infra_retry`.",
    allowed_moves: "Only create these scripts and their test. Never log environment values, auth-file contents or prompts. The deterministic assessor is used for measurement/control only and its model cost is recorded as zero.",
    stop_triggers: "Stop if the runner passes a different notify arity, the assessor decision schema cannot be confirmed from the installed runner, JSON records can interleave under the concurrency test, or forwarding output changes OpenCode NDJSON.",
    manual_verification: "Run `npm --prefix plugins/shohin/spike exec -- vitest run src/evidence-scripts.test.ts`, typecheck, and `stat -c '%a %n' plugins/shohin/spike/scripts/*`. Expected: tests/typecheck pass and every script is 755.",
  }),

  task("005", 1, "Create the systemd scope controller and in-scope watchdog", {
    depends_on: ["004"],
    files: [
      "plugins/shohin/spike/src/scope.ts",
      "plugins/shohin/spike/src/scope.test.ts",
      "plugins/shohin/spike/scripts/watchdog.sh",
    ],
    scope_test: "plugins/shohin/spike/src/scope.test.ts",
    allowed_change: "create",
    failing_test: "Create `scope.test.ts` first with injected command/fs/clock seams. Assert `systemd-run` receives minimal control env, while after `--` `env -i` creates separate executor env; exact `.scope` Id. Assert three probe-only controls reject outside probe mode: strace prefix, recorded setsid descendant, and watchdog-disabled mode. Inspect identities; external cancel verifies Id then TERM/bounded KILL. Normal stale watchdog derives cgroup-v2 path and atomically writes cgroup.kill, catching setsid without surviving its own kill. Watchdog-disabled probe runs/waits for runner without polling heartbeat so RuntimeMaxSec is isolated. Fake fixtures touch no real scope.",
    change: "Create no-shell scope controller with full `.scope` identity, split control/executor env, heartbeat and identity checks. Support only in explicit probe mode: `strace -ff -e trace=execve -o <runDir>/execve`; watchdog-spawned setsid child carrying marker and persisted pid/start-time; and watchdog-disabled mode that runs/waits for runner but skips heartbeat polling. Normal in-scope watchdog starts runner, polls heartbeat, validates unified cgroup-v2, then writes cgroup.kill once; unavailable/unwritable is named fail-closed. External cancel remains control-env TERM/bounded KILL after revalidation.",
    allowed_moves: "Only the two TypeScript files and watchdog. No process-group fallback, executor bus access, or suffix-less unit. Probe options are disabled by default and accepted only in explicit probe mode.",
    stop_triggers: "Stop if systemd scope/cgroup-v2 cgroup.kill is unavailable or not delegated, systemctl Id differs from the full `.scope` name, control env contains credentials, executor env contains bus/credential values, strace is unavailable for the explicit inventory probe, or testing could touch a real unit.",
    manual_verification: "Run the scoped Vitest file and typecheck, then launch `/bin/sleep 2` through a harmless test scope and inspect selected unit properties. Remove that scope. Record exact accepted systemd-run argv in the ledger.",
  }),

  task("006", 1, "Create hint parsing and commit-grounded truth verification", {
    depends_on: ["005"],
    files: [
      "plugins/shohin/spike/src/evidence.ts",
      "plugins/shohin/spike/src/evidence.test.ts",
    ],
    scope_test: "plugins/shohin/spike/src/evidence.test.ts",
    allowed_change: "create",
    failing_test: "Create `evidence.test.ts` first with a temporary git repository and fake gate. Assert: malformed/duplicate/unknown-task notify and run-state entries are retained only as `{source:'executor',authoritative:false}` hints; forged terminal hints cannot produce success; runner exit 0 plus a complete expected task-to-commit map plus each gate exit 0 is required for verified success; missing task, non-ancestor commit, dirty manifest hash, runner nonzero or gate nonzero produces a named failure. Assert the gate is run in a temporary verifier worktree checked out at the exact task commit, with `task-gate.sh <topic> <id> --commit <same sha>`, restricted env, and the verifier worktree removed afterward.",
    change: "Create `evidence.ts` exports for bounded hint parsing, expected-task commit enumeration and authoritative outcome. Expected ids come from committed task files at external baseline. Accept only post-baseline commits ancestral to recorded branch. Verify each in a detached exact-SHA worktree by `/home/david/.agents/wai/scripts/task-gate.sh <topic> <id> --commit <same-sha>` with explicit credential-free env and literal WAI typecheck/test controls appropriate to that target; never run historical tests from final HEAD. Success requires runner exit 0, exact commit coverage, every independent gate green and manifest equality; all executor files remain provenance-tagged hints.",
    allowed_moves: "Only the two files. Do not treat `.wai-run-state.json`, `.wai-dag-plan-commit`, `.dag-passed-commits`, notify records, worker handoffs, commit messages or runner exit 0 alone as truth.",
    stop_triggers: "Stop if task ids cannot be derived from the baseline commit, a historical gate would execute against final HEAD, the gate requires operator credentials, or verification needs an unlisted file.",
    manual_verification: "Run the scoped Vitest file and typecheck. The forged-hint case must stay green only because the outcome remains failure; record this invariant in the ledger.",
  }),

  task("007", 1, "Create the durable spike supervisor and recovery sweep", {
    depends_on: ["006"],
    files: [
      "plugins/shohin/spike/src/supervisor.ts",
      "plugins/shohin/spike/src/supervisor.test.ts",
    ],
    scope_test: "plugins/shohin/spike/src/supervisor.test.ts",
    allowed_change: "create",
    failing_test: "Create `supervisor.test.ts` first with injected adapters/fake clock. Assert 0700 run dir and atomic durable record with repo/common-dir/topic/branch/external baseline, immutable runner generation and per-file hashes (run, executors, gate, cost, watch, VERSION), full scope/process identities, runtime allow-list, heartbeat and durable spend ledger. Start copies pristine bundle first, applies only named probe patch second, hashes third, launches that exact generation; never overwrites a selected generation. Before each dispatch reserve conservative USD by role and refuse when total+reservation exceeds 50; reconcile actual worker/validator/assessor/prewarm/terminal usage. Start is asynchronous and single-topic. Recovery's synchronous bounded phase revalidates active scope and refreshes heartbeat before any expensive work, then returns; exited-run truth gates run asynchronously. Lost/unknown never start/reset/retry. Cancel is idempotent.",
    change: "Create `SpikeSupervisor` with injected adapters. Authorize registered root or linked same-common-dir target. Per run: copy full WAI bundle; apply the fixed reviewed observability instrumentation patch (role/model/attempt/timing/token/stderr) and any closed named probe patch after copy; record exact diffs; hash required files; launch only immutable generation. Build fresh runtime allow-list. Set frozen success-path env including OpenCode, workers=1, WAI_DAG_MAX_ATTEMPTS=1, model IDs, wrapper/notify/assessor/report, no test mode and target cwd; report that MAX=1 permits one retry on failure but a successful baseline dispatches once. Add durable conservative USD reservations/reconciliation for all roles and refuse before cap. Recovery synchronously verifies active identities and refreshes heartbeat before bounded return, then asynchronously verifies exited truth. Journal; never auto-reset/retry; service stop leaves run to watchdog.",
    allowed_moves: "Only supervisor/test. No auto-reset/retry, executor truth, process.env inheritance, dirty/staged start, mutable runner reuse, post-hoc spend-only accounting, or external baseline solely in target.",
    stop_triggers: "Stop if bundle incomplete, named patch cannot be applied exactly after copy, daemon cannot reach required binaries via explicit env, spend reservation cannot be conservative/durable, recovery cannot refresh a verified live heartbeat before bounded start returns, pid reuse cannot be excluded, or executor files would become authority.",
    manual_verification: "Run the scoped Vitest file and typecheck. Inspect one fixture run directory mode and persisted record; expected 700 and no credential values.",
  }),

  task("008", 1, "Register synchronous service lifecycle and admin RPC handlers", {
    depends_on: ["007"],
    files: [
      "plugins/shohin/spike/index.ts",
      "plugins/shohin/spike/index.test.ts",
    ],
    scope_test: "plugins/shohin/spike/index.test.ts",
    allowed_change: "create",
    failing_test: "Create `index.test.ts` first. Assert synchronous register, exact service and three admin-default RPCs. Service start extracts/validates configured canonical repoRoot, runs only bounded recovery phase 1 before publishing ready, schedules expensive exited-run verification asynchronously, and reports recovering/ready/error. Run validates topic/repo/options including probe flags, rejects probes unless explicit probe mode, accepts linked targets only by common-dir identity, and promptly returns handle. Status/cancel validate runId; malformed params use SDK errors; no extra capabilities.",
    change: "Create synchronous plugin definition. Configure supervisor during service start from closed manifest `repoRoot`; log unique register/recovery phase markers. Register exactly run/cancel/status. Validate plain objects, required strings, finite ceilings and closed probe options; never wait for DAG completion. Status separates service readiness from run hints/truth. Export only default id shohin-spike.",
    allowed_moves: "Create only index and its test. No async register, HTTP route, tool, cron, custom scope declaration, direct config/session reads, or swallowing of invalid input.",
    stop_triggers: "Stop if installed SDK handler signatures differ from the core source, the plugin cannot load TypeScript through Jiti, a method collision exists, or service readiness cannot be represented without another file.",
    manual_verification: "Run index.test.ts, all spike tests, typecheck and build. Expected all green and dist contains only runtime code. `git diff --check` is clean.",
  }),

  task("009", 1, "Install the throwaway extension and prove daemon readiness", {
    depends_on: ["008"],
    files: [report],
    scope_test: "N/A",
    allowed_change: "edit",
    failing_test: "N/A — the daemon registry is the observable.",
    change: `**File:** \`${report}\`. Append under Development gateway redacted evidence for all tests/typecheck/build, absent target, managed-copy install, enable, and setting the closed plugin config \`repoRoot\` to this canonical outer checkout before restart. Poll daemon health/custom status to ready. Record \`SPIKE_INSTALL_DIR\` realpath, configured root/common-dir identity, and source-vs-installed hashes. From here runtime allow-list mutations occur only in per-run ignored data and probe patches only in a copied \`<runDir>/runner\` generation after copy-before-hash-before-launch; repo source is never assumed live. If source runtime code changes, require explicit reinstall/restart and new hash pair.`,
    allowed_moves: "Edit only the report in Git. Host writes are limited to the managed shohin-spike install/config and daemon restart. Never include the gateway token or raw daemon environment.",
    stop_triggers: "Stop if the install target already exists, install is reported untracked/linked, plugin is not explicitly enabled, daemon-side custom status never reaches ready, or restart breaks gateway health.",
    manual_verification: "`OPENCLAW_CATALOG_REMOTE=0 wednesdayai plugins info shohin-spike --json`, `wednesdayai gateway call plugins/health --json`, and `wednesdayai gateway call shohinSpike.status --params '{}' --json` all identify the installed plugin; status is ready. Record outputs after redaction.",
  }),

  task("010", 1, "Prepare the isolated two-task WAI target topic", {
    depends_on: ["009"],
    files: [report],
    scope_test: "N/A",
    allowed_change: "edit",
    failing_test: "N/A — the target's own precheck and plan lint are the gates.",
    change: `**File:** \`${report}\`. Append Target topic evidence. Create a mode-0700 sibling/runtime worktree outside both outer checkout and Git common-dir \`.git\`, branch \`spike/shohin-spike-target\`; record \`git worktree list --porcelain\`, canonical common dir and path. Prepare active target spec/precheck/plan via real submitters. Before target tasks, create and commit a throwaway targeted gate fixture under the target's own plan artifacts that exits nonzero unless Shohin manifest has closed \`storage.sqlitePath:string\`; it is planning/test evidence, not a product edit. T001 edits only the manifest and its scope test invokes that targeted fixture, so preimage is demonstrably RED and post-change GREEN; generic manifest validation is additional only. T002 creates only \`plugins/shohin/manifest.test.mjs\` and runs node:test. Exactly two sequential tasks, no test mode, committed/fresh/lint-clean. Record task paths, baseline and input externally.`,
    allowed_moves: "Only the report changes on the outer branch. All target artifacts live and commit only on the throwaway branch/worktree; do not merge or push it. Use submitters rather than hand-writing rendered target plan files. The target is a real WAI topic but its tiny breakdown review may be a recorded manual review because this outer plan already fixes both tasks exactly.",
    stop_triggers: "Stop if branch/worktree exists, target is inside outer checkout or `.git`, common-dir identity differs, outer checkout changes, targeted T001 gate is not RED on preimage/GREEN after intended edit, precheck/lint fails, product file sets exceed manifest+test, or target plan is dirty/uncommitted.",
    manual_verification: "In the target worktree run branch guard, freshness, readiness and plan lint; all pass. `git status --porcelain` is empty, current branch is spike/shohin-spike-target, and the two target task files have exact non-overlapping file lists and 002 depends on 001. In the outer checkout only the report is modified.",
  }),

  task("011", 2, "Run the cold baseline and derive the minimal ephemeral HOME", {
    depends_on: ["010"],
    files: [report],
    scope_test: "N/A",
    allowed_change: "edit",
    covers_criteria: ["SC2"],
    covers_tests: ["TS2"],
    failing_test: "N/A — each failed authentication run is the deliberate RED observation.",
    change: `**File:** \`${report}\`. Replace SC2 marker with iteration table and raw redacted evidence. Before every sample: prove prior full \`.scope\`/pids dead; invoke pinned runner \`--reset full\` in target; restore/verify external baseline; rotate probe logs/cost; assert pending expected ids and clean target; never reset outer tree. Start fresh ignored runtime allow-list from immutable empty default. For each exact auth/config error add only one harness path/XDG redirect and fresh HOME; never copy operator secrets/caches wholesale. Run frozen baseline cold/no attach/test mode, workers 1, WAI_DAG_MAX_ATTEMPTS=1, wrapper and pre-dispatch reservation; note actual off-by-one semantics and require successful first attempt for one-rung evidence. Completion executes and independently verifies at least one task. Embed runtime allow-list metadata only.`,
    allowed_moves: "Edit only SC2 evidence in the report. Runtime changes to ignored home.allow copy/run-data/runner artifacts are allowed and must be described, not committed. Do not weaken the explicit environment or use an operator HOME as fallback.",
    stop_triggers: "Stop on DP1, spend cap, 30-minute attempt, a request for non-harness credentials, a need to copy the whole HOME, or any evidence that the executor inherited a gateway/git/SSH/gh secret.",
    manual_verification: "The gateway run status plus supervisor truth shows at least one independently gate-verified target commit. Inspect `/proc/<pid>/environ` during the run and the ephemeral HOME after; only allowed entries exist. The SC2 table contains one preceding error for every copied item.",
  }),

  task("012", 2, "Measure model-id ladder dispatch and restricted warm attach", {
    depends_on: ["011"],
    files: [report],
    scope_test: "N/A",
    allowed_change: "edit",
    covers_criteria: ["SC3a", "SC3b"],
    covers_tests: ["TS3"],
    failing_test: "N/A — unsupported model/attach output is an accepted measured result.",
    change: `**File:** \`${report}\`. Replace SC3a/SC3b markers. Full reset before each sample. SC3a: successful frozen MAX_ATTEMPTS=1 first attempt, then separately reserved named controlled-worker-failure patch to exact generation with MAX_ATTEMPTS=2 reaching attempts 1-3/all model IDs; embed patch and restore. Report model IDs versus named-agent behavior before optional --agent copy experiment. SC3b compares same-baseline cold to separately scoped restricted-HOME serve with per-role accounting; never operator server; prove attach or stderr fallback; control prewarm/teardown.`,
    allowed_moves: "Edit only SC3a/SC3b report evidence. Ignored runtime runner-copy/run-data patches are allowed only after unpatched evidence and must be embedded as diffs. No external warm server with operator HOME is valid evidence.",
    stop_triggers: "Stop on DP1/spend/time cap, if cold and warm start from different externally verified baselines, if the warm server cannot be contained/restricted, or if argv/tokens/timing cannot be attributed by mode.",
    manual_verification: "Both tables name the same target plan baseline and task set. Wrapper records prove `-m <model-id>` and warm `--attach <url>` or capture the attach failure. Warm scope has no surviving processes after teardown.",
  }),

  task("013", 2, "Prove scope cancellation contains detached descendants", {
    depends_on: ["012"],
    files: [report],
    scope_test: "N/A",
    allowed_change: "edit",
    covers_criteria: ["SC1"],
    covers_tests: ["TS1"],
    failing_test: "N/A — the pre-cancel process/commit listing is the baseline.",
    change: `**File:** \`${report}\`. Replace SC1 marker. Run full pre-probe reset. Start explicit probe mode with tested setsid-descendant option; watchdog records PID/start-time/run marker. Confirm \`systemctl show Id\` equals full \`shohin-spike-<id>.scope\`, capture selected fields/cgroup.procs/recorded process identities and target git log. Invoke cancel; capture verified external TERM then bounded KILL. Recheck unit/cgroup, each recorded PID+start-time and git immediately/15s later. Do not use path grep as sole proof. Record no post-cancel commit. User-scope/cgroup.kill unavailability is a STOP/fail-closed finding, not a process-group fallback claim.`,
    allowed_moves: "Edit only SC1 report evidence. All process control goes through the recorded unit and identity checks. The deliberate sleep is created only inside the run scope and must be absent at task end.",
    stop_triggers: "Stop if the recorded unit identity does not match, a process would be signalled by pid without start-time check, a descendant survives SIGKILL, a post-cancel commit appears, or process output would expose secret argv/environment.",
    manual_verification: "Before cancel systemctl Id is exact `.scope`. After cancel scope/cgroup is absent/empty, every recorded PID is absent or has different start-time, and no commit follows cancel timestamp. Report includes full reset and before/after identities.",
  }),

  task("014", 2, "Prove attention and run-state files remain non-authoritative", {
    depends_on: ["013"],
    files: [report],
    scope_test: "N/A",
    allowed_change: "edit",
    covers_criteria: ["SC4"],
    covers_tests: ["TS4"],
    failing_test: "N/A — the deliberately impossible target gate creates the expected attention path.",
    change: `**File:** \`${report}\`. Replace SC4 marker. Run full reset, then commit a disposable probe-only mutation to the target's pre-existing targeted gate fixture so it deterministically exits nonzero; record this probe baseline. Start workers=1/MAX_ATTEMPTS=0. Document actual control flow: gate-fail enters \`_infra_retry\`, reaches bounded exhaustion, and does not claim assessor control; deterministic assessor remains correctly wired for assessor-routed kinds. Capture attention log/JSONL after bounded drain, run-state hint, exit, commits and independent failing gate. Forge valid done hints/state, call status, prove authoritative outcome unchanged. Restore original external target baseline and clean state.`,
    allowed_moves: "Edit only SC4 evidence. Disposable target mutation and forged ignored run-data are allowed, never committed to the outer branch. Do not make the supervisor consume or promote from either forged file.",
    stop_triggers: "Stop if forcing attention requires editing the frozen outer spec/plan, if a forged hint changes supervisor truth, if unknown task ids are accepted as authoritative, or if the target cannot be restored to its external baseline.",
    manual_verification: "Attention-file count matches emitted notify calls after bounded drain or discrepancy is explicitly recorded; state reaches a terminal label; independent truth remains failure before and after forged hints; target returns clean at baseline.",
  }),

  task("015", 2, "Observe real gateway death and both reset modes", {
    depends_on: ["014"],
    files: [report],
    scope_test: "N/A",
    allowed_change: "edit",
    covers_criteria: ["SC5"],
    covers_tests: ["TS5"],
    failing_test: "N/A — killing the gateway is the deliberate failure injection.",
    change: `**File:** \`${report}\`. Replace SC5 marker. First compare adopted gateway Id/FragmentPath/version/config against Task001 ownership baseline; otherwise STOP. Back up target refs/state externally. For each variant run full pre-probe reset, start a deliberately long run, capture exact scope identities/T0, SIGKILL only the confirmed dev \`openclaw-gateway.service\`, poll scope, and capture precise journal kill/restart/plugin/recovery timestamps plus worktree state. Variants: (1) original RestartSec with watchdog; (2) temporary delayed-restart drop-in with watchdog, ceiling far above watchdog threshold; (3) delayed restart with watchdog explicitly disabled in probe mode and a controlled short RuntimeMaxSec, isolating ceiling. Restore and verify exact drop-in/unit properties after every variant. Only with old scope dead, separately capture pinned partial \`--reset\` effects; restore external scratch/baseline; capture \`--reset full\`; name every discarded/preserved ref/file and executor-writable baseline risk.`,
    allowed_moves: "Edit only SC5 report. Temporary dev-unit drop-in is restored after each variant; gateway ends active at exact baseline. Target reset only after old full scope identity is dead; never reset outer or trust executor baseline alone.",
    stop_triggers: "Stop if ownership/unit identity differs, channels/production could be affected, backup absent, old scope uncertain, reset root is outer, gateway fails recovery, any drop-in property cannot be restored exactly, or watchdog-disabled probe can escape RuntimeMaxSec.",
    manual_verification: "All required timestamps and three isolation variants are present; default/delayed-watchdog/delayed-no-watchdog-ceiling each name termination mechanism. Reset tables are exact. Gateway active and selected properties byte-for-byte match Task001 baseline.",
  }),

  task("016", 2, "Inventory the runner bundle environment and complete cost accounting", {
    depends_on: ["015"],
    files: [report],
    scope_test: "N/A",
    allowed_change: "edit",
    covers_criteria: ["SC6"],
    covers_tests: ["TS6"],
    failing_test: "N/A — inventory is reconciled from observed exec and usage events.",
    change: `**File:** \`${report}\`. Replace SC6 marker with six reconciled tables: immutable runtime bundle path/file/hash including run, executors, gate, cost-report, watch, VERSION; complete executable path/version inventory from the Task005 probe-only \`strace -ff -e trace=execve\` prefix (not wrapper alone); variable names for control env, runner and child with all values redacted/classified; copied auth/config/cache roles; git preconditions; and durable per-call accounting task/role/model/attempt/start/end/elapsed/tokens/estimated-USD/reservation/source for worker, validator, prewarm, assessor (deterministic zero is labelled construction), terminal reviewer. Reconcile instrumented copied bundle/wrapper records against dag-cost.tsv's conflation/omissions. Include installed runner hash and read-only source drift. Assert running reservations prevented exceeding USD 50, not merely that post-hoc total is low.`,
    allowed_moves: "Edit only SC6 evidence. Read `/proc` only for recorded run identities while alive; never persist values of tokens/secrets. No new credential, package, runner or core changes.",
    stop_triggers: "Stop if observed executable/env/auth inventory is incomplete, values cannot be redacted safely, cost cannot be attributed at least by role/model/tokens/time, the cap is exceeded, or collecting data would require privileged tracing of unrelated processes.",
    manual_verification: "Reconcile observed execve names with `command -v`; every runner bundle hash verifies; environment table names forbidden credentials as absent; sum token/cost rows and compare with cap; report calls out built-in dag-cost.tsv gaps rather than presenting its flat estimate as truth.",
  }),

  task("017", 2, "Force lane-worktree failure and verify fail-closed patch", {
    depends_on: ["016"],
    files: [report],
    scope_test: "N/A",
    allowed_change: "edit",
    covers_criteria: ["SC7"],
    covers_tests: ["TS7"],
    failing_test: "N/A — the unpatched fallback is the expected unsafe observation.",
    change: "**File:** `" + report + "`. Replace SC7 marker with three reset-isolated observations. (1) Read-only TMPDIR proving prompt mktemp fails before lane creation. (2) Named post-copy probe patch to exact `<runDir>/runner/wai-dag-executors.sh`: force `_lane_worktree_add` failure and inject `_dispatch` marker written directly in resolved `dispatch_cwd` before OpenCode. Capture unsafe stock fallback stderr and marker in target root before coordinator handoff. (3) fresh pristine generation, same failure/marker hook plus exact fallback else patch changing shared-tree message to `refusing shared-tree dispatch` and returning nonzero; capture absent dispatch marker/target write. Pin and verify run/executors/gate/cost/watch/VERSION hashes, embed exact diffs, and restore target; never mutate repo/install/global runner.",
    allowed_moves: "Edit only SC7 report. All patches are named post-copy pre-hash changes to that run's immutable runner generation and embedded; source/installed/global scripts remain read-only.",
    stop_triggers: "Stop if failure occurs before `_lane_worktree_add`, direct dispatch marker is not captured before handoff, target baseline unknown, outer could be dispatch cwd, patch exceeds named symbols/else branch, or restoration/hash proof fails.",
    manual_verification: "Report distinguishes invalid TMPDIR, unsafe fallback marker in target, and fail-closed no-marker result. Final has nonzero launch, refusal text, no target diff/commit, and fresh pristine generation hashes.",
  }),

  task("018", 3, "Synthesize the Phase 1 Executor contract and recovery policy", {
    depends_on: ["017"],
    files: [report],
    scope_test: "N/A",
    allowed_change: "edit",
    failing_test: "N/A — this task interprets the already captured empirical evidence.",
    change: "**File:** `" + report + "`. **Anchors:** `<!-- conclusion:runner-changes -->`, `<!-- conclusion:executor-contract -->`, and `<!-- conclusion:recovery-policy -->`. Replace each marker. Runner changes: one row per observed gap with installed hash, exact script/symbol, evidence section, proposed patch and whether Phase 1 blocks on upstreaming; include lane fail-closed, optional --agent, notify escaping/coverage, MAX_ATTEMPTS semantics, baseline overwrite, historical-gate checkout and usage-accounting findings only when evidence supports them. Executor contract: print the final TypeScript interface with `id`, pinned `version:{path,sha256,bundleHashes}`, `start(manifest):Promise<RunHandle>`, `resume(handle,mode)`, `status(handle)`, `cancel(handle)`, `events(handle,cursor)`, and handle fields repo/topic/branch/externalBaseline/unit/process identities/runDir/startedAt/generation; state exact env, cwd, signal and truth contracts. Recovery: numbered algorithm for startup sweep, identity check, live reattach, dead/lost classification, old-scope confirmation, parent blocked, human retry only, same recorded worktree, chosen reset mode and evidence, attempts/approval consequences. End with one explicit GO / GO-WITH-RUNNER-PATCH / NO-GO recommendation for Phase 1, citing evidence not intuition.",
    allowed_moves: "Edit only the three conclusion regions. Do not invent successful observations, change the frozen Phase 1 architecture silently, or turn unresolved evidence into an implementer choice; label a blocker and recommendation.",
    stop_triggers: "Stop if any SC1-SC7 section is marker/empty, evidence conflicts, contract choice is undecidable, or recommendation contradicts evidence. Preserve `<!-- evidence:SC8 -->` for cleanup.",
    manual_verification: "Search: zero conclusion markers and zero evidence markers except exactly one SC8 marker. Cross-reference contracts and answer all seven exit questions; recommendation is one named verdict.",
  }),

  task("019", 3, "Remove all throwaway code and target artifacts", {
    depends_on: ["018"],
    files: [
      report,
      "plugins/shohin/spike/.gitignore",
      "plugins/shohin/spike/package.json",
      "plugins/shohin/spike/openclaw.plugin.json",
      "plugins/shohin/spike/tsconfig.json",
      "plugins/shohin/spike/tsconfig.build.json",
      "plugins/shohin/spike/package.test.ts",
      "plugins/shohin/spike/home.allow",
      "plugins/shohin/spike/env.allow",
      "plugins/shohin/spike/index.ts",
      "plugins/shohin/spike/index.test.ts",
      "plugins/shohin/spike/src/environment.ts",
      "plugins/shohin/spike/src/environment.test.ts",
      "plugins/shohin/spike/src/evidence-scripts.test.ts",
      "plugins/shohin/spike/src/scope.ts",
      "plugins/shohin/spike/src/scope.test.ts",
      "plugins/shohin/spike/src/evidence.ts",
      "plugins/shohin/spike/src/evidence.test.ts",
      "plugins/shohin/spike/src/supervisor.ts",
      "plugins/shohin/spike/src/supervisor.test.ts",
      "plugins/shohin/spike/scripts/notify.sh",
      "plugins/shohin/spike/scripts/report-append.sh",
      "plugins/shohin/spike/scripts/opencode-wrapper.sh",
      "plugins/shohin/spike/scripts/orchestrator-abort.sh",
      "plugins/shohin/spike/scripts/watchdog.sh",
    ],
    siblings: ["dev-docs/workstreams/shohin-phase-0-spike/README.md"],
    scope_test: "N/A",
    allowed_change: "mixed",
    irreversible: true,
    failing_test: "N/A — D9 requires an operator approval token before any deletion.",
    change: `Do nothing until the operator creates exact gate token \`docs/plans/shohin-phase-0-spike/reviews/019.approved\` containing approver, UTC timestamp and approved deletion scope; reference task-gate's exact path and never self-author it. Then prove no run/warm scope lives, capture ignored evidence/report backup externally, disable/uninstall managed plugin, explicitly remove leftover installed directory, restart/health-check gateway. Remove/prune target and lane worktrees, delete only branch \`spike/shohin-spike-target\`, remove ignored spike runtime/dependencies, then git-rm exactly listed tracked sources.\n\n**File:** \`${report}\`. **Anchor:** literal \`<!-- evidence:SC8 -->\` inside \`## SC8 — cleanup\`. **Before:** marker. **After:** replace with \`### Cleanup execution\` containing approval-token identifier, UTC results, stopped scopes, uninstall/restart, target worktree/branch removal and pre-spike SHA. Task020 appends verifier evidence beneath this subsection.`,
    allowed_moves: "Delete exactly the listed throwaway files and edit only the report. Do not delete the persistent gateway/config/database, Shohin shell, outer spike plan/spec/workstream, any non-spike branch, or any agent-plugins/core file. No wildcard branch deletion.",
    stop_triggers: "Stop with human_gate_required until exact operator-authored reviews/019.approved exists with approver/time/scope; also stop on live/unknown scope, missing backup, installed path mismatch, target branch still checked out, unlisted deletion, or non-spike Shohin drift.",
    manual_verification: "Before returning, `git diff --name-status` shows only D for every listed spike source and M for the report; `git worktree list` and branch list contain no target; installed extension absent; custom RPC absent after healthy restart; persistent gateway active. Do not claim SC8 final cleanliness until Task 020's verifier worktree.",
  }),

  task("020", 3, "Record post-cleanup verification from a clean verifier worktree", {
    depends_on: ["019"],
    files: [report],
    scope_test: "N/A",
    allowed_change: "edit",
    covers_criteria: ["SC8"],
    covers_tests: ["TS8"],
    failing_test: "N/A — Task019 commit supplies report/deletion preimage; final cleanliness is a read-only post-Task020-commit gate.",
    change: `**File:** \`${report}\`. Under SC8 after Cleanup execution, use a detached verifier at committed Task019 to append \`### Clean verifier evidence\` with literal command/output: empty status; tracked spike count computed with \`git ls-files ... | grep ... | wc -l\` (or grep plus \`|| true\`) and asserted zero; non-spike diff empty; target branch/plan/install/plugin absent; gateway active/healthy. Remove verifier. State explicitly this embedded evidence is Task019 tree and final SC8 cleanliness is established only after Task020 commit by the outer gate. Commit only report. After commit, run the same checks read-only against final HEAD with no repository/ledger writes; preserve output only in the executor's immutable external gate artifact/DAG log, not a file that dirties the repository.`,
    allowed_moves: "Edit only SC8's final evidence. The verifier is detached/read-only except normal worktree administrative files and is removed. Do not reinstall/delete anything to make a check pass; a failure is reported and halts.",
    stop_triggers: "Stop if Task019 uncommitted, verifier dirty, spike path/branch/install remains, non-spike diff exists, gateway unhealthy, a zero-count pipeline returns false failure, or post-commit proof would require writing inside repo.",
    manual_verification: "After Task020 commit, outer gate reruns status/count/diff/branch/worktree/install/plugin/gateway checks read-only. Expected all SC8 observables; external gate output is immutable evidence. Do not write decisions-ledger/report afterward.",
  }),
];

const envelope = {
  schema_version: 1,
  kind: "plan",
  topic,
  spec_path: specPath,
  approach: "Build the spike as a disposable but fully tested plugin inside the real development gateway, then drive one separately committed two-task WAI topic through controlled probes. The first phase establishes the durable gateway, narrow environment boundary, systemd scope controller, untrusted-hint parser, independent commit verifier, recovery sweep, and synchronous RPC surface. Code is split by contract so every test names one boundary and later tasks consume only already-fixed interfaces.\n\nThe second phase performs the probes in the frozen order and writes raw, redacted evidence directly into one report: cold HOME discovery; model-id and restricted warm attach; cancellation; attention forgery; real gateway death and reset; inventory/cost; lane-worktree failure. Runtime artifacts stay ignored and every destructive probe runs only against the throwaway target worktree. The final phase derives the Phase 1 Executor/recovery contracts, performs operator-approved cleanup, and proves SC8 from a clean verifier worktree after cleanup is committed.",
  phases: [
    { number: 1, name: "gateway-and-supervisor-harness", goal: "Adopt the operator-designated persistent dev gateway and build/install a tested throwaway supervisor around a real isolated WAI target." },
    { number: 2, name: "controlled-runner-probes", goal: "Run the seven empirical probes in order and capture complete redacted evidence for SC1-SC7." },
    { number: 3, name: "contract-and-cleanup", goal: "Derive the Phase 1 contract/recovery policy, remove every throwaway artifact behind a human gate, and prove SC8." },
  ],
  tasks,
};

process.stdout.write(`${JSON.stringify(envelope, null, 2)}\n`);
