import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SpikeSupervisor,
  SpikeSupervisorError,
  requiredWaiBundleFiles,
  type CostRole,
  type LaunchArtifacts,
  type ModelCostOracle,
  type ProbePatch,
  type RunIdentity,
  type SpikeSupervisorClock,
  type SpikeSupervisorDependencies,
  type SpikeSupervisorRecord,
} from "./supervisor.js";
import { enumerateExpectedTaskManifest } from "./evidence.js";
import type {
  ScopeCancelHandle,
  ScopeCancelResult,
  ScopeController,
  ScopeIdentity,
  ScopeLaunchOptions,
  ScopeWaitResult,
  ScopedRunHandle,
} from "./scope.js";

const tempRoots: string[] = [];

class FakeClock implements SpikeSupervisorClock {
  public current = "2026-09-13T12:00:00.000Z";
  public readonly sleeps: number[] = [];

  public nowIso(): string {
    return this.current;
  }

  public async sleep(ms: number): Promise<void> {
    this.sleeps.push(ms);
  }
}

class FakeScopeController implements ScopeController {
  public readonly launches: ScopeLaunchOptions[] = [];
  public readonly cancels: ScopeCancelHandle[] = [];
  public readonly inspections: Array<{
    readonly controlEnv: Readonly<Record<string, string>>;
    readonly scopeId: string;
  }> = [];
  public expectedControlEnv: Readonly<Record<string, string>> | undefined;
  public identity: ScopeIdentity = activeScopeIdentity();
  public cancelLeavesIdentity = false;
  public cancelResult: ScopeCancelResult = { sentKill: false, sentTerm: true };
  public cancelWait: Promise<void> | undefined;
  public launchWait: Promise<ScopeWaitResult> = new Promise<ScopeWaitResult>(() => undefined);
  public requireCancelIdentity = false;

  public async launch(options: ScopeLaunchOptions): Promise<ScopedRunHandle> {
    this.assertExpectedControlEnv(options.controlEnv);
    this.launches.push(cloneLaunchOptions(options));
    return {
      argv: ["systemd-run", "--user", "--scope"],
      command: "systemd-run",
      controlEnv: options.controlEnv,
      controlPid: 4242,
      controlStartTime: "777",
      scopeId: this.identity.id,
      wait: async () => this.launchWait,
    };
  }

  public async inspect(
    scopeId: string,
    controlEnv: Readonly<Record<string, string>>,
  ): Promise<ScopeIdentity> {
    this.assertExpectedControlEnv(controlEnv);
    this.inspections.push({ controlEnv: { ...controlEnv }, scopeId });
    return { ...this.identity, id: scopeId };
  }

  public async cancel(handle: ScopeCancelHandle): Promise<ScopeCancelResult> {
    this.assertExpectedControlEnv(handle.controlEnv);
    if (this.requireCancelIdentity) {
      expect(handle.identity).toMatchObject({
        controlGroup: "/user.slice/app.slice/shohin.scope",
        invocationId: "0123456789abcdef0123456789abcdef",
      });
    }
    this.cancels.push({ ...handle, controlEnv: { ...handle.controlEnv } });
    await this.cancelWait;
    if (!this.cancelLeavesIdentity) {
      this.identity = stoppedScopeIdentity();
    }
    return this.cancelResult;
  }

  private assertExpectedControlEnv(env: Readonly<Record<string, string>>): void {
    if (this.expectedControlEnv === undefined) {
      return;
    }
    expect(env).toEqual(this.expectedControlEnv);
  }
}

class FakeIdentityAdapter {
  public identity: RunIdentity | undefined;
  public dirty = false;
  public verifyActiveCalls = 0;

  public async resolveRunIdentity(): Promise<RunIdentity> {
    if (this.identity === undefined) {
      throw new Error("fixture identity missing");
    }
    return this.identity;
  }

  public async ensureCleanTarget(): Promise<void> {
    if (this.dirty) {
      throw new Error("target has dirty or staged changes");
    }
  }

  public async verifyActiveRunIdentity(record: SpikeSupervisorRecord): Promise<void> {
    this.verifyActiveCalls += 1;
    expect(record.identity.commonGitDir).toBe(this.identity?.commonGitDir);
  }
}

class FakeExecutableResolver {
  public readonly requests: Array<{ readonly command: string; readonly pathEnv: string }> =
    [];

  public resolve(command: string, pathEnv: string): string {
    this.requests.push({ command, pathEnv });
    if (command.startsWith("/")) {
      return command;
    }
    return `/resolved/${command}`;
  }
}

const makeTempRoot = (name: string): string => {
  const root = mkdtempSync(path.join(os.tmpdir(), `shohin-supervisor-${name}-`));
  tempRoots.push(root);
  return root;
};

const makeBundle = (root: string): string => {
  const bundle = path.join(root, "wai-bundle");
  mkdirSync(path.join(bundle, "fixtures"), { recursive: true });
  for (const relativePath of Object.values(requiredWaiBundleFiles)) {
    const absolutePath = path.join(bundle, relativePath);
    mkdirSync(path.dirname(absolutePath), { recursive: true });
    writeFileSync(
      absolutePath,
      relativePath === requiredWaiBundleFiles.executors
        ? waiExecutorsPatchFixture()
        : `fixture ${relativePath}\n`,
    );
    chmodSync(absolutePath, relativePath.endsWith(".sh") ? 0o755 : 0o644);
  }
  writeFileSync(path.join(bundle, "fixtures", "copied.txt"), "copied too\n");
  return bundle;
};


const waiExecutorsPatchFixture = (): string =>
  [
    "#!/usr/bin/env bash",
    "_prewarm() {",
    '  [ -n "${WAI_DAG_OPENCODE_SERVER:-}" ] || return 0',
    '  _probe_server || { echo "WAI dag: prewarm skipped" >&2; return 0; }',
    '  _maybe_timeout "$WAI_DAG_PREWARM_TIMEOUT" "$WAI_DAG_OPENCODE" run --format json \\',
    '    -m "${OC_MODEL:-$OC_MODEL_DEFAULT}" \\',
    '    --attach "$WAI_DAG_OPENCODE_SERVER" \\',
    '    "Reply with exactly the word OK and nothing else." >/dev/null 2>&1 || true',
    "}",
    "run_worker() {",
    '  raw="$(_dispatch "$WAI_DAG_EXECUTOR_TYPE" "$pfile" "$dispatch_cwd" -m "$(_resolve_model worker)")"',
    '  [ -n "$lane" ] && { _lane_worktree_remove "$root" "$lane"; WAI_DAG_LANE_ACTIVE=""; }',
    '  rm -f "$pfile"',
    '  local attempt="${WAI_DAG_ATTEMPT:-1}"',
    "}",
    "run_validator() {",
    '  raw="$(_dispatch "$WAI_DAG_EXECUTOR_TYPE" "$pfile" "$root" -m "$(_resolve_model validator)")"',
    '  rm -f "$pfile"',
    '  local attempt="${WAI_DAG_ATTEMPT:-1}"',
    "}",
    "run_terminal_reviewer() {",
    '  raw="$(_dispatch terminal_reviewer "$pfile" "$root" -m "$(_resolve_model terminal_reviewer)")"',
    '  rm -f "$pfile"',
    "}",
  ].join("\n") + "\n";

const makeOracle = (reservationUsd = 5): ModelCostOracle => ({
  capUsd: 50,
  roles: Object.fromEntries(
    (["worker", "validator", "assessor", "prewarm", "terminal"] satisfies CostRole[]).map(
      (role) => [
        role,
        {
          boundSource: `fixture-price-${role}`,
          ceiling: {
            enforcedBy: `fixture-wrapper-${role}`,
            maxInputTokens: 1_000,
            maxOutputTokens: Math.round(reservationUsd * 1_000),
          },
          model: `fixture-${role}-model`,
          pricing: {
            inputUsdPerMillionTokens: 0,
            outputUsdPerMillionTokens: 1_000,
            provider: "fixture-provider",
          },
        },
      ],
    ),
  ) as ModelCostOracle["roles"],
});

const makePatch = (relativePath = "wai-dag-executors.sh"): ProbePatch => ({
  closed: true,
  description: "fixture closed probe patch",
  name: "fixture-probe",
  apply(generationDir: string): LaunchArtifacts {
    const filePath = path.join(generationDir, relativePath);
    const before = readFileSync(filePath, "utf-8");
    const after = `${before}# patched ${relativePath}\n`;
    writeFileSync(filePath, after);
    return {
      diff: `--- a/${relativePath}\n+++ b/${relativePath}\n@@ fixture\n+# patched ${relativePath}\n`,
      filesChanged: [relativePath],
      name: "fixture-probe",
    };
  },
});


const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
};

const activeScopeIdentity = (): ScopeIdentity => ({
  controlGroup: "/user.slice/app.slice/shohin.scope",
  id: "shohin-shohin-phase-0-spike-run007.scope",
  invocationId: "0123456789abcdef0123456789abcdef",
  loadState: "loaded",
  mainPid: 5151,
  subState: "running",
});

const stoppedScopeIdentity = (): ScopeIdentity => ({
  id: "shohin-shohin-phase-0-spike-run007.scope",
  loadState: "not-found",
  subState: "dead",
});

const unknownScopeIdentity = (): ScopeIdentity => ({
  controlGroup: "/user.slice/app.slice/shohin.scope",
  id: "shohin-shohin-phase-0-spike-run007.scope",
  invocationId: "0123456789abcdef0123456789abcdef",
});

const populatedTerminalScopeIdentity = (): ScopeIdentity =>
  ({
    controlGroup: "/user.slice/app.slice/shohin.scope",
    cgroupMembership: "populated",
    id: "shohin-shohin-phase-0-spike-run007.scope",
    invocationId: "0123456789abcdef0123456789abcdef",
    loadState: "loaded",
    mainPid: 0,
    subState: "failed",
  }) as ScopeIdentity;

const runGit = (cwd: string, args: readonly string[]): string =>
  execFileSync(
    "git",
    [
      "-c",
      "commit.gpgsign=false",
      "-c",
      "core.hooksPath=/dev/null",
      "-c",
      "protocol.file.allow=never",
      "-c",
      "user.name=Shohin Test",
      "-c",
      "user.email=shohin-test@example.invalid",
      ...args,
    ],
    { cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] },
  ).trim();

const ensureCommittedTargetFixture = (targetRoot: string): string => {
  mkdirSync(targetRoot, { recursive: true });
  if (!existsSync(path.join(targetRoot, ".git"))) {
    execFileSync("git", ["init", "--quiet"], { cwd: targetRoot, stdio: "ignore" });
    runGit(targetRoot, ["checkout", "--quiet", "-b", "shohin/spike-fixture"]);
    const taskDir = path.join(targetRoot, "docs", "plans", "shohin-phase-0-spike", "phase-1");
    mkdirSync(taskDir, { recursive: true });
    for (const id of ["001", "002"]) {
      writeFileSync(
        path.join(taskDir, `${id}-fixture-task.md`),
        `---\nid: "${id}"\nphase: 1\ntitle: "Fixture task ${id}"\nstatus: ready\n---\n`,
      );
    }
    runGit(targetRoot, ["add", "docs/plans/shohin-phase-0-spike"]);
    runGit(targetRoot, ["commit", "--quiet", "--no-gpg-sign", "-m", "baseline tasks"]);
  }
  return runGit(targetRoot, ["rev-parse", "HEAD"]);
};

const makeSupervisor = (root: string) => {
  const clock = new FakeClock();
  const scope = new FakeScopeController();
  const identity = new FakeIdentityAdapter();
  const executables = new FakeExecutableResolver();
  const repoRoot = path.join(root, "repo");
  const targetRoot = path.join(root, "target");
  const commonGitDir = path.join(root, "repo", ".git");
  mkdirSync(repoRoot, { recursive: true });
  mkdirSync(commonGitDir, { recursive: true });
  const baseline = ensureCommittedTargetFixture(targetRoot);
  identity.identity = {
    branch: "shohin/spike-fixture",
    commonGitDir,
    externalBaseline: baseline,
    registeredRepoRoot: repoRoot,
    targetRepoRoot: targetRoot,
    topic: "shohin-phase-0-spike",
  };

  scope.expectedControlEnv = {
    DBUS_SESSION_BUS_ADDRESS: "unix:path=/run/user/1000/bus",
    PATH: "/usr/bin:/bin",
    XDG_RUNTIME_DIR: "/run/user/1000",
  };

  const dependencies: SpikeSupervisorDependencies = {
    clock,
    executables,
    identity,
    scope,
    truth: {
      verifyExitedRun: async () => ({
        expectedTasks: [],
        failures: [],
        gateResults: [],
        hints: [],
        manifestHash: "sha256:fixture",
        verified: true,
      }),
    },
  };

  return {
    clock,
    dependencies,
    executables,
    identity,
    repoRoot,
    scope,
    supervisor: new SpikeSupervisor(dependencies),
    targetRoot,
  };
};

const startOptions = (root: string, overrides: Record<string, unknown> = {}) => {
  const packageRoot = path.resolve(import.meta.dirname, "..");
  return {
    assessorScriptPath: path.join(packageRoot, "scripts", "orchestrator-abort.sh"),
    controlSourceEnv: {
      PATH: "/usr/bin:/bin",
      XDG_RUNTIME_DIR: "/run/user/1000",
      DBUS_SESSION_BUS_ADDRESS: "unix:path=/run/user/1000/bus",
    },
    costOracle: makeOracle(),
    envAllowListPath: path.join(packageRoot, "env.allow"),
    generationId: "generation007",
    heartbeatPollIntervalMs: 250,
    heartbeatStaleAfterMs: 5_000,
    homeAllowListPath: path.join(packageRoot, "home.allow"),
    maxAttempts: 1,
    modelIds: {
      assessor: "fixture-assessor-model",
      prewarm: "fixture-prewarm-model",
      terminal: "fixture-terminal-model",
      validator: "fixture-validator-model",
      worker: "fixture-worker-model",
    },
    namedProbePatches: ["fixture-probe"],
    notifyScriptPath: path.join(packageRoot, "scripts", "notify.sh"),
    opencodeCommand: "opencode",
    probePatches: {
      "fixture-probe": makePatch("wai-dag-run.sh"),
    },
    registeredRepoRoot: path.join(root, "repo"),
    reportAppendScriptPath: path.join(packageRoot, "scripts", "report-append.sh"),
    runId: "run007",
    runRoot: path.join(root, "run-data"),
    runnerTimeoutSec: 30,
    sourceHome: path.join(root, "source-home"),
    targetRepoRoot: path.join(root, "target"),
    topic: "shohin-phase-0-spike",
    waiBundleSourceDir: makeBundle(root),
    waiRunCommand: "bash",
    wrapperScriptPath: path.join(packageRoot, "scripts", "opencode-wrapper.sh"),
    ...overrides,
  };
};

const readRecord = (runRoot: string, runId = "run007"): SpikeSupervisorRecord =>
  JSON.parse(
    readFileSync(path.join(runRoot, runId, "run.json"), "utf-8"),
  ) as SpikeSupervisorRecord;

const cloneLaunchOptions = (options: ScopeLaunchOptions): ScopeLaunchOptions => ({
  ...options,
  controlEnv: { ...options.controlEnv },
  executorEnv: { ...options.executorEnv },
  heartbeat: { ...options.heartbeat },
  probes: options.probes === undefined ? undefined : { ...options.probes },
  runner: [...options.runner],
});

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    makeWritable(root);
    rmSync(root, { recursive: true, force: true });
  }
});

const makeWritable = (root: string): void => {
  if (!existsSync(root)) {
    return;
  }
  const stats = lstatSync(root);
  if (stats.isDirectory()) {
    chmodSync(root, 0o700);
    for (const entry of readdirSync(root)) {
      makeWritable(path.join(root, entry));
    }
    chmodSync(root, 0o700);
    return;
  }
  if (stats.isFile()) {
    chmodSync(root, 0o600);
  }
};

describe("SpikeSupervisor", () => {
  it("copies, patches, hashes, records and launches an immutable WAI generation", async () => {
    const root = makeTempRoot("start");
    mkdirSync(path.join(root, "source-home"), { recursive: true });
    const { executables, scope, supervisor } = makeSupervisor(root);

    const handle = await supervisor.start(startOptions(root, { costOracle: makeOracle(1) }));
    const runDir = path.join(root, "run-data", "run007");
    const record = readRecord(path.join(root, "run-data"));

    expect(statSync(runDir).mode & 0o777).toBe(0o700);
    expect(scope.launches).toHaveLength(1);
    expect(handle.maxAttemptsNote).toContain("one retry on failure");
    expect(executables.requests).toEqual(
      expect.arrayContaining([
        { command: "opencode", pathEnv: "/usr/bin:/bin" },
        { command: "bash", pathEnv: "/usr/bin:/bin" },
      ]),
    );

    const generationDir = path.join(runDir, "runner", "generation007");
    expect(readFileSync(path.join(generationDir, "fixtures", "copied.txt"), "utf-8")).toBe(
      "copied too\n",
    );
    expect(readFileSync(path.join(generationDir, "wai-dag-run.sh"), "utf-8")).toContain(
      "# patched wai-dag-run.sh",
    );
    expect(readFileSync(path.join(generationDir, "wai-dag-executors.sh"), "utf-8")).toContain(
      "Shohin observability patch",
    );
    expect(statSync(generationDir).mode & 0o222).toBe(0);

    expect(record.identity).toMatchObject({
      branch: "shohin/spike-fixture",
      commonGitDir: path.join(root, "repo", ".git"),
      externalBaseline: expect.stringMatching(/^[0-9a-f]{40}$/),
      registeredRepoRoot: path.join(root, "repo"),
      targetRepoRoot: path.join(root, "target"),
      topic: "shohin-phase-0-spike",
    });
    expect(record.runnerGeneration!).toMatchObject({
      id: "generation007",
      immutable: true,
      path: generationDir,
      requiredFiles: requiredWaiBundleFiles,
    });
    expect(Object.keys(record.runnerGeneration!.hashes).sort()).toEqual(
      Object.keys(requiredWaiBundleFiles).sort(),
    );
    expect(Object.values(record.runnerGeneration!.hashes)).toEqual(
      expect.arrayContaining([expect.stringMatching(/^sha256:[0-9a-f]{64}$/)]),
    );
    expect(record.runnerGeneration!.diffs.map((diff) => diff.name)).toEqual([
      "shohin-observability",
      "fixture-probe",
    ]);
    expect(record.controlEnv).toEqual({
      DBUS_SESSION_BUS_ADDRESS: "unix:path=/run/user/1000/bus",
      PATH: "/usr/bin:/bin",
      XDG_RUNTIME_DIR: "/run/user/1000",
    });
    expect(record.runtimeAllowList).toEqual({ env: ["PATH"], home: [] });
    expect(record.scope).toMatchObject({
      controlPid: 4242,
      controlStartTime: "777",
      identity: {
        controlGroup: "/user.slice/app.slice/shohin.scope",
        invocationId: "0123456789abcdef0123456789abcdef",
      },
      scopeId: "shohin-shohin-phase-0-spike-run007.scope",
    });
    expect(record.heartbeat.path).toBe(path.join(runDir, "heartbeat.json"));
    expect(record.spendLedger.reservations.map((entry) => entry.role).sort()).toEqual([
      "assessor",
      "prewarm",
      "terminal",
      "validator",
      "worker",
    ]);

    const launch = scope.launches[0];
    expect(launch.cwd).toBe(path.join(root, "target"));
    expect(launch.runner).toEqual(["/resolved/bash", path.join(generationDir, "wai-dag-run.sh"), "shohin-phase-0-spike"]);
    expect(launch.executorEnv).toMatchObject({
      WAI_DAG_EXECUTOR_TYPE: "opencode",
      WAI_DAG_MAX_ATTEMPTS: "1",
      WAI_DAG_WORKER_MODEL: "fixture-worker-model",
      WAI_DAG_WORKERS: "1",
      WAI_SHOHIN_CALL_LOG: path.join(runDir, "opencode-calls.jsonl"),
      WAI_SHOHIN_OPENCODE_BIN: "/resolved/opencode",
      WAI_SHOHIN_RUN_DIR: runDir,
    });
    expect(launch.executorEnv).not.toHaveProperty("WAI_DAG_TEST_MODE");
    expect(Object.keys(launch.controlEnv)).toEqual([
      "PATH",
      "XDG_RUNTIME_DIR",
      "DBUS_SESSION_BUS_ADDRESS",
    ]);

    await supervisor.reconcileUsage("run007", [
      { actualUsd: 0.25, model: "fixture-worker-model", role: "worker", source: "fixture-call-log", totalTokens: 321 },
      { actualUsd: 0.1, model: "fixture-validator-model", role: "validator", source: "fixture-call-log", totalTokens: 111 },
      { actualUsd: 0, model: "fixture-assessor-model", role: "assessor", source: "fixture-call-log", totalTokens: 0 },
      { actualUsd: 0.01, model: "fixture-prewarm-model", role: "prewarm", source: "fixture-call-log", totalTokens: 10 },
      { actualUsd: 0.05, model: "fixture-terminal-model", role: "terminal", source: "fixture-call-log", totalTokens: 50 },
    ]);
    const reconciled = readRecord(path.join(root, "run-data"));
    expect(reconciled.spendLedger.actualUsage.map((usage) => usage.role).sort()).toEqual([
      "assessor",
      "prewarm",
      "terminal",
      "validator",
      "worker",
    ]);
    expect(reconciled.spendLedger.totalActualUsd).toBe(0.41);
  });

  it("refuses missing, unknown, unbounded, restart and cap-edge budgets before dispatch", async () => {
    const root = makeTempRoot("budget");
    mkdirSync(path.join(root, "source-home"), { recursive: true });
    const { scope, supervisor } = makeSupervisor(root);

    await expect(
      supervisor.start(startOptions(root, { costOracle: undefined })),
    ).rejects.toMatchObject({
      code: "budget_oracle_missing",
    });
    expect(scope.launches).toHaveLength(0);
    expect(readRecord(path.join(root, "run-data")).spendLedger.refusals[0]).toMatchObject({
      code: "budget_oracle_missing",
      role: "worker",
    });

    const restarted = makeSupervisor(root).supervisor;
    await expect(
      restarted.start(
        startOptions(root, {
          costOracle: {
            capUsd: 50,
            roles: {
              ...makeOracle().roles,
              worker: undefined,
            },
          },
          runId: "run008",
        }),
      ),
    ).rejects.toMatchObject({ code: "budget_role_missing" });

    await expect(
      restarted.start(
        startOptions(root, {
          costOracle: {
            capUsd: 50,
            roles: {
              ...makeOracle().roles,
              worker: {
                ...makeOracle().roles.worker,
                ceiling: { enforcedBy: "fixture-wrapper", maxInputTokens: 1_000 },
              },
            },
          },
          runId: "run009",
        }),
      ),
    ).rejects.toMatchObject({ code: "budget_resource_unbounded" });

    const capRoot = makeTempRoot("cap");
    mkdirSync(path.join(capRoot, "source-home"), { recursive: true });
    const first = makeSupervisor(capRoot);
    await first.supervisor.start(startOptions(capRoot, { costOracle: makeOracle(9) }));

    const afterRestart = makeSupervisor(capRoot);
    await expect(
      afterRestart.supervisor.start(
        startOptions(capRoot, {
          costOracle: makeOracle(7),
          runId: "run010",
        }),
      ),
    ).rejects.toMatchObject({ code: "budget_cap_exceeded" });
    expect(afterRestart.scope.launches).toHaveLength(0);
    const ledger = readRecord(path.join(capRoot, "run-data"), "run010").spendLedger;
    expect(ledger.totalReservedUsd).toBe(45);
    expect(ledger.refusals[0]).toMatchObject({
      capUsd: 50,
      code: "budget_cap_exceeded",
      requestedUsd: 35,
    });

    const concurrentRoot = makeTempRoot("concurrent");
    mkdirSync(path.join(concurrentRoot, "source-home"), { recursive: true });
    const concurrentA = makeSupervisor(concurrentRoot);
    const concurrentB = makeSupervisor(concurrentRoot);
    const results = await Promise.allSettled([
      concurrentA.supervisor.start(
        startOptions(concurrentRoot, {
          costOracle: makeOracle(6),
          generationId: "generation011",
          runId: "run011",
        }),
      ),
      concurrentB.supervisor.start(
        startOptions(concurrentRoot, {
          costOracle: makeOracle(6),
          generationId: "generation012",
          runId: "run012",
        }),
      ),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected).toMatchObject({
      reason: expect.objectContaining({ code: "budget_cap_exceeded" }),
      status: "rejected",
    });
  });

  it("rejects dirty targets and pre-existing immutable generation selections", async () => {
    const root = makeTempRoot("identity");
    mkdirSync(path.join(root, "source-home"), { recursive: true });
    const { identity, scope, supervisor } = makeSupervisor(root);

    identity.dirty = true;
    await expect(supervisor.start(startOptions(root))).rejects.toThrow(
      /dirty or staged/,
    );
    expect(scope.launches).toHaveLength(0);

    const cleanRoot = makeTempRoot("generation");
    mkdirSync(path.join(cleanRoot, "source-home"), { recursive: true });
    const clean = makeSupervisor(cleanRoot);
    mkdirSync(
      path.join(cleanRoot, "run-data", "run007", "runner", "generation007"),
      { recursive: true },
    );
    await expect(clean.supervisor.start(startOptions(cleanRoot))).rejects.toMatchObject({
      code: "immutable_generation_exists",
    });
    expect(clean.scope.launches).toHaveLength(0);
  });

  it("schedules completion truth and refreshes active runs on recovery", async () => {
    const root = makeTempRoot("recover");
    mkdirSync(path.join(root, "source-home"), { recursive: true });
    const truthCalls: string[] = [];
    let truthStarted!: () => void;
    const truthStartedPromise = new Promise<void>((resolve) => {
      truthStarted = resolve;
    });
    const fixture = makeSupervisor(root);
    const dependencies: SpikeSupervisorDependencies = {
      ...fixture.dependencies,
      truth: {
        verifyExitedRun: async (record) => {
          truthCalls.push(record.runId);
          truthStarted();
          return {
            expectedTasks: [],
            failures: [],
            gateResults: [],
            hints: [],
            manifestHash: "sha256:fixture",
            verified: true,
          };
        },
      },
    };
    const supervisor = new SpikeSupervisor(dependencies);
    await supervisor.start(startOptions(root, { costOracle: makeOracle(1) }));
    fixture.scope.identity = stoppedScopeIdentity();
    await supervisor.recordRunnerExit("run007", 0);
    await truthStartedPromise;
    expect(truthCalls).toEqual(["run007"]);
    fixture.scope.identity = activeScopeIdentity();
    await supervisor.start(
      startOptions(root, {
        costOracle: makeOracle(1),
        generationId: "generation008",
        runId: "run008",
      }),
    );
    await supervisor.writeRunStatus("run008", "unknown");
    fixture.scope.identity = activeScopeIdentity();
    await supervisor.start(
      startOptions(root, {
        costOracle: makeOracle(1),
        generationId: "generation009",
        runId: "run009",
      }),
    );

    const before = scopeHeartbeat(path.join(root, "run-data"), "run009");
    fixture.clock.current = "2026-09-13T12:01:00.000Z";
    const restartedSupervisor = new SpikeSupervisor(dependencies);
    const result = await restartedSupervisor.recover({ runRoot: path.join(root, "run-data") });

    expect(result.refreshedActiveRunIds).toEqual(["run009"]);
    expect(scopeHeartbeat(path.join(root, "run-data"), "run009")).not.toBe(before);
    expect(result.scheduledTruthRunIds).toEqual([]);
    expect(truthCalls).toEqual(["run007"]);
    expect(fixture.identity.verifyActiveCalls).toBe(1);
    expect(fixture.scope.inspections.at(-1)?.controlEnv).toEqual(
      fixture.scope.expectedControlEnv,
    );
    expect(fixture.scope.launches).toHaveLength(3);
  });

  it("refuses approved no-provider manifest and argv mismatches before dispatch", async () => {
    const root = makeTempRoot("approved-profile-supervisor");
    mkdirSync(path.join(root, "source-home"), { recursive: true });
    const fixture = makeSupervisor(root);
    const manifest = enumerateExpectedTaskManifest({
      baselineCommit: fixture.identity.identity!.externalBaseline,
      repoRoot: fixture.targetRoot,
      taskDirectory: "docs/plans/shohin-phase-0-spike",
    });
    const baseProfile = {
      classification: "zero-provider" as const,
      digest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      expectedArgv: ["/resolved/bash", "wai-dag-run.sh", "shohin-phase-0-spike"],
      expectedManifestHash: manifest.hash,
      id: "approved-profile",
    };

    await expect(
      fixture.supervisor.start(
        startOptions(root, {
          approvedNoProviderProfile: {
            ...baseProfile,
            expectedManifestHash: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          },
          costOracle: undefined,
          modelIds: undefined,
        }),
      ),
    ).rejects.toMatchObject({ code: "invalid_option" });
    expect(fixture.scope.launches).toHaveLength(0);

    const argvRoot = makeTempRoot("approved-profile-argv");
    mkdirSync(path.join(argvRoot, "source-home"), { recursive: true });
    const argvFixture = makeSupervisor(argvRoot);
    const argvManifest = enumerateExpectedTaskManifest({
      baselineCommit: argvFixture.identity.identity!.externalBaseline,
      repoRoot: argvFixture.targetRoot,
      taskDirectory: "docs/plans/shohin-phase-0-spike",
    });
    await expect(
      argvFixture.supervisor.start(
        startOptions(argvRoot, {
          approvedNoProviderProfile: {
            ...baseProfile,
            expectedArgv: ["/resolved/other", "wai-dag-run.sh", "shohin-phase-0-spike"],
            expectedManifestHash: argvManifest.hash,
          },
          costOracle: undefined,
          modelIds: undefined,
        }),
      ),
    ).rejects.toMatchObject({ code: "invalid_option" });
    expect(argvFixture.scope.launches).toHaveLength(0);
  });

  it("refuses approved no-provider starting identity, verifier and generation binding mismatches before dispatch", async () => {
    const root = makeTempRoot("approved-profile-bindings");
    mkdirSync(path.join(root, "source-home"), { recursive: true });
    const fixture = makeSupervisor(root);
    const manifest = enumerateExpectedTaskManifest({
      baselineCommit: fixture.identity.identity!.externalBaseline,
      repoRoot: fixture.targetRoot,
      taskDirectory: "docs/plans/shohin-phase-0-spike",
    });
    const baseProfile = {
      classification: "zero-provider" as const,
      digest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      expectedArgv: ["/resolved/bash", "wai-dag-run.sh", "shohin-phase-0-spike"],
      expectedManifestHash: manifest.hash,
      id: "approved-profile",
    };

    for (const approvedNoProviderProfile of [
      { ...baseProfile, expectedCommonGitDir: path.join(root, "other-git") },
      { ...baseProfile, expectedEnvPath: "/tmp/shadow:/usr/bin:/bin" },
      { ...baseProfile, expectedStartingHead: "f".repeat(40) },
      {
        ...baseProfile,
        expectedVerifier: {
          gateScriptBasename: "task-gate.sh",
          gateTimeoutMs: 30 * 60 * 1000,
          taskDirectory: "docs/plans/other-topic",
          testCommand: "npm --prefix plugins/shohin/spike exec -- vitest run {scope}",
          typecheckCommand: "npm --prefix plugins/shohin/spike run typecheck",
        },
      },
      {
        ...baseProfile,
        expectedGenerationHashes: {
          VERSION: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          cost: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          executors: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          gate: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          run: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          watch: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        },
      },
    ]) {
      const isolatedRoot = makeTempRoot("approved-profile-binding");
      mkdirSync(path.join(isolatedRoot, "source-home"), { recursive: true });
      const isolated = makeSupervisor(isolatedRoot);
      const isolatedManifest = enumerateExpectedTaskManifest({
        baselineCommit: isolated.identity.identity!.externalBaseline,
        repoRoot: isolated.targetRoot,
        taskDirectory: "docs/plans/shohin-phase-0-spike",
      });
      await expect(
        isolated.supervisor.start(
          startOptions(isolatedRoot, {
            approvedNoProviderProfile: {
              ...approvedNoProviderProfile,
              expectedManifestHash: isolatedManifest.hash,
            },
            costOracle: undefined,
            modelIds: undefined,
          }),
        ),
      ).rejects.toMatchObject({ code: "invalid_option" });
      expect(isolated.scope.launches).toHaveLength(0);
    }
  });

  it("publishes native WAI run-state and attention observations through public status", async () => {
    const root = makeTempRoot("observations");
    mkdirSync(path.join(root, "source-home"), { recursive: true });
    const fixture = makeSupervisor(root);
    const topicDir = path.join(fixture.targetRoot, "docs", "plans", "shohin-phase-0-spike");
    writeFileSync(
      path.join(topicDir, ".wai-run-state.json"),
      JSON.stringify({
        blockedTaskIds: [],
        completedTaskIds: ["001"],
        currentTaskId: null,
        failedTaskIds: [],
        lastUpdated: "2026-09-13T11:59:00.000Z",
        pendingTaskIds: [],
        phase: "terminal",
        repoRoot: fixture.targetRoot,
        runId: "prior-native-run",
        topic: "shohin-phase-0-spike",
      }),
    );
    await fixture.supervisor.start(startOptions(root, { costOracle: makeOracle(1) }));

    const runRoot = path.join(root, "run-data");
    const runDir = path.join(runRoot, "run007");
    const prelaunchSnapshot = fixture.supervisor.readRunSnapshot("run007", runRoot);
    expect(prelaunchSnapshot.hints.items.some((hint) => hint.runId === "prior-native-run")).toBe(false);
    expect(readRecord(runRoot).observations?.sources.runStateJson.status).toBe("stale_prelaunch");
    writeFileSync(
      path.join(runDir, "attention.jsonl"),
      `${JSON.stringify({
        at: "2026-09-13T12:00:02.000Z",
        id: "001",
        reason: "operator review",
        runId: "run007",
        state: "blocked",
        topic: "shohin-phase-0-spike",
      })}\n`,
    );
    writeFileSync(
      path.join(topicDir, ".wai-run-state.json"),
      JSON.stringify(
        {
          attentionItems: [{ kind: "needs_review", reason: "gate failed", task_id: "002" }],
          blockedTaskIds: [],
          completedTaskIds: ["001"],
          currentTaskId: "002",
          failedTaskIds: [],
          lastUpdated: "2026-09-13T12:00:03.000Z",
          pendingTaskIds: [],
          phase: "worker",
          repoRoot: fixture.targetRoot,
          runId: "native-wai-run-001",
          topic: "shohin-phase-0-spike",
        },
        null,
        2,
      ),
    );

    const snapshot = fixture.supervisor.readRunSnapshot("run007", runRoot);

    expect(snapshot.activity).toBe("active");
    expect(snapshot.hints).toMatchObject({
      authoritative: false,
      available: true,
      source: "executor",
    });
    expect(snapshot.hints.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          authoritative: false,
          file: "notify",
          reason: "operator review",
          runId: "run007",
          source: "executor",
          state: "blocked",
          taskId: "001",
          topic: "shohin-phase-0-spike",
        }),
        expect.objectContaining({
          authoritative: false,
          file: "run_state",
          runId: "native-wai-run-001",
          source: "executor",
          state: "completed",
          taskId: "001",
          terminal: true,
        }),
        expect.objectContaining({
          authoritative: false,
          file: "run_state",
          reason: "gate failed",
          runId: "native-wai-run-001",
          source: "executor",
          state: "attention",
          taskId: "002",
        }),
      ]),
    );
    expect(snapshot.hints.items.every((hint) => hint.authoritative === false)).toBe(true);

    writeFileSync(
      path.join(topicDir, ".wai-run-state.json"),
      JSON.stringify({
        attentionItems: [],
        blockedTaskIds: [],
        completedTaskIds: ["001"],
        currentTaskId: "002",
        failedTaskIds: [],
        lastUpdated: "2026-09-13T12:00:04.000Z",
        pendingTaskIds: [],
        phase: "worker",
        repoRoot: fixture.targetRoot,
        runId: "native-wai-run-002",
        topic: "shohin-phase-0-spike",
      }),
    );
    const changedIdSnapshot = fixture.supervisor.readRunSnapshot("run007", runRoot);
    expect(changedIdSnapshot.hints.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          authoritative: false,
          file: "run_state",
          kind: "malformed",
          raw: "native_run_id_changed",
          reason: "native_run_id_changed",
          runId: "native-wai-run-002",
        }),
      ]),
    );
  });

  it("rejects wrong-topic and wrong-repo native run-state in public observations", async () => {
    const root = makeTempRoot("wrong-observations");
    mkdirSync(path.join(root, "source-home"), { recursive: true });
    const fixture = makeSupervisor(root);
    await fixture.supervisor.start(startOptions(root, { costOracle: makeOracle(1) }));
    const topicDir = path.join(fixture.targetRoot, "docs", "plans", "shohin-phase-0-spike");

    for (const override of [
      { topic: "other-topic" },
      { repoRoot: path.join(root, "other-repo") },
    ]) {
      writeFileSync(
        path.join(topicDir, ".wai-run-state.json"),
        JSON.stringify({
          attentionItems: [],
          blockedTaskIds: [],
          completedTaskIds: ["001"],
          currentTaskId: null,
          failedTaskIds: [],
          lastUpdated: "2026-09-13T12:00:03.000Z",
          pendingTaskIds: [],
          phase: "worker",
          repoRoot: fixture.targetRoot,
          runId: "native-wai-run",
          topic: "shohin-phase-0-spike",
          ...override,
        }),
      );
      const snapshot = fixture.supervisor.readRunSnapshot("run007", path.join(root, "run-data"));
      expect(snapshot.hints.items).toEqual([
        expect.objectContaining({ file: "run_state", kind: "malformed" }),
      ]);
    }
  });

  it.each([
    { code: "runner_nonzero", exitStatus: 7, status: "failed" },
    { code: "gate_nonzero", exitStatus: 0, status: "exited" },
    { code: "missing_task_commit", exitStatus: 0, status: "exited" },
  ] as const)(
    "persists terminal exit and named $code verifier failure asynchronously",
    async ({ code, exitStatus, status }) => {
      const root = makeTempRoot(`truth-${code}`);
      mkdirSync(path.join(root, "source-home"), { recursive: true });
      const fixture = makeSupervisor(root);
      const supervisor = new SpikeSupervisor({
        ...fixture.dependencies,
        truth: {
          verifyExitedRun: async () => ({
            expectedTasks: [],
            failures: [{ code, message: code }],
            gateResults: [],
            hints: [],
            manifestHash: "sha256:fixture",
            verified: false,
          }),
        },
      });
      await supervisor.start(startOptions(root, { costOracle: makeOracle(1) }));
      fixture.scope.identity = stoppedScopeIdentity();
      await supervisor.recordRunnerExit("run007", exitStatus);
      const runRoot = path.join(root, "run-data");

      await vi.waitFor(() => {
        const record = readRecord(runRoot);
        expect(record.status).toBe(status);
        expect(record.runnerExit).toMatchObject({ status: exitStatus });
        expect(record.truth).toMatchObject({
          available: true,
          failureCodes: [code],
          state: "failure",
          verified: false,
        });
      });
    },
  );

  it("prefers independently discovered branch task commits over forged executor candidates", async () => {
    const root = makeTempRoot("branch-discovery");
    mkdirSync(path.join(root, "source-home"), { recursive: true });
    const fixture = makeSupervisor(root);
    const supervisor = new SpikeSupervisor({
      clock: fixture.clock,
      executables: fixture.executables,
      identity: fixture.identity,
      scope: fixture.scope,
    });
    const options = startOptions(root, { costOracle: makeOracle(1) });
    const bundle = options.waiBundleSourceDir as string;
    writeFileSync(path.join(bundle, "task-gate.sh"), "#!/usr/bin/env bash\nexit 0\n");
    chmodSync(path.join(bundle, "task-gate.sh"), 0o755);

    await supervisor.start(options);
    const topicDir = path.join(fixture.targetRoot, "docs", "plans", "shohin-phase-0-spike");
    const outputOne = path.join(topicDir, "outputs", "001.txt");
    mkdirSync(path.dirname(outputOne), { recursive: true });
    writeFileSync(outputOne, "valid branch task 001\n");
    runGit(fixture.targetRoot, ["add", "docs/plans/shohin-phase-0-spike/outputs/001.txt"]);
    runGit(fixture.targetRoot, ["commit", "--quiet", "--no-gpg-sign", "-m", "dag-worker: 001"]);
    const taskOneCommit = runGit(fixture.targetRoot, ["rev-parse", "HEAD"]);

    const outputTwo = path.join(topicDir, "outputs", "002.txt");
    writeFileSync(outputTwo, "valid branch task 002\n");
    runGit(fixture.targetRoot, ["add", "docs/plans/shohin-phase-0-spike/outputs/002.txt"]);
    runGit(fixture.targetRoot, ["commit", "--quiet", "--no-gpg-sign", "-m", "dag-worker: 002"]);
    const taskTwoCommit = runGit(fixture.targetRoot, ["rev-parse", "HEAD"]);

    const forgedCommit = "f".repeat(40);
    writeFileSync(
      path.join(topicDir, ".dag-passed-commits"),
      `001 ${forgedCommit}\n002 ${taskTwoCommit}\n`,
    );
    fixture.scope.identity = stoppedScopeIdentity();
    await supervisor.recordRunnerExit("run007", 0);

    await vi.waitFor(() => {
      const record = readRecord(path.join(root, "run-data"));
      expect(record.truth).toMatchObject({ available: true, state: "success", verified: true });
      expect(record.truth?.outcome?.gateResults.map((gate) => gate.commit).sort()).toEqual([
        taskOneCommit,
        taskTwoCommit,
      ].sort());
    });
  });

  it("recovers pending completion verification after the first process is gone", async () => {
    const root = makeTempRoot("truth-recovery");
    mkdirSync(path.join(root, "source-home"), { recursive: true });
    const fixture = makeSupervisor(root);
    const firstSupervisor = new SpikeSupervisor({
      ...fixture.dependencies,
      truth: {
        verifyExitedRun: async () => new Promise<never>(() => undefined),
      },
    });
    await firstSupervisor.start(startOptions(root, { costOracle: makeOracle(1) }));
    fixture.scope.identity = stoppedScopeIdentity();
    await firstSupervisor.recordRunnerExit("run007", 0);
    const runRoot = path.join(root, "run-data");
    expect(readRecord(runRoot).truth).toMatchObject({ state: "pending" });

    const truthCalls: string[] = [];
    const restartedSupervisor = new SpikeSupervisor({
      ...fixture.dependencies,
      truth: {
        verifyExitedRun: async (record) => {
          truthCalls.push(record.runId);
          return {
            expectedTasks: [],
            failures: [],
            gateResults: [],
            hints: [],
            manifestHash: "sha256:fixture",
            verified: true,
          };
        },
      },
    });
    const result = await restartedSupervisor.recover({ runRoot });

    expect(result.scheduledTruthRunIds).toEqual(["run007"]);
    await vi.waitFor(() => {
      expect(readRecord(runRoot).truth).toMatchObject({
        available: true,
        state: "success",
        verified: true,
      });
    });
    expect(truthCalls).toEqual(["run007"]);
  });

  it("does not refresh recovery heartbeat when an active record's scope is stopped", async () => {
    const root = makeTempRoot("recover-stopped");
    mkdirSync(path.join(root, "source-home"), { recursive: true });
    const fixture = makeSupervisor(root);
    const supervisor = new SpikeSupervisor(fixture.dependencies);
    await supervisor.start(startOptions(root, { costOracle: makeOracle(1) }));
    const runRoot = path.join(root, "run-data");
    const before = scopeHeartbeat(runRoot, "run007");
    fixture.scope.identity = stoppedScopeIdentity();
    fixture.clock.current = "2026-09-13T12:01:00.000Z";

    const restartedSupervisor = new SpikeSupervisor(fixture.dependencies);
    const result = await restartedSupervisor.recover({ runRoot });
    const record = readRecord(runRoot);

    expect(result).toEqual({
      ignoredRunIds: ["run007"],
      refreshedActiveRunIds: [],
      scheduledTruthRunIds: [],
    });
    expect(scopeHeartbeat(runRoot, "run007")).toBe(before);
    expect(record.status).toBe("unknown");
    expect(record.journal.at(-1)?.event).toBe("recovery_scope_stopped_without_exit");
    expect(fixture.identity.verifyActiveCalls).toBe(1);
    expect(fixture.scope.inspections).toHaveLength(2);
    expect(fixture.scope.inspections.at(-1)?.controlEnv).toEqual(
      fixture.scope.expectedControlEnv,
    );
  });

  it("cancels active runs idempotently without reset or retry", async () => {
    const root = makeTempRoot("cancel");
    mkdirSync(path.join(root, "source-home"), { recursive: true });
    const fixture = makeSupervisor(root);
    const { scope, supervisor } = fixture;
    scope.requireCancelIdentity = true;
    await supervisor.start(startOptions(root, { costOracle: makeOracle(1) }));
    const runRoot = path.join(root, "run-data");
    const activeRecord = readRecord(runRoot);

    const restartedSupervisor = new SpikeSupervisor(fixture.dependencies);
    await expect(restartedSupervisor.cancel("run007", runRoot)).resolves.toEqual({
      alreadyStopped: false,
      result: { sentKill: false, sentTerm: true },
      runId: "run007",
    });
    await expect(restartedSupervisor.cancel("run007", runRoot)).resolves.toEqual({
      alreadyStopped: true,
      runId: "run007",
    });
    expect(scope.cancels).toHaveLength(1);
    expect(scope.cancels[0].controlEnv).toEqual(scope.expectedControlEnv);
    expect(scope.cancels[0].identity).toEqual(activeRecord.scope!.identity);
    expect(scope.launches).toHaveLength(1);
    expect(readRecord(runRoot).status).toBe("canceled");
  });

  it("coalesces concurrent cancellation of the same active run", async () => {
    const root = makeTempRoot("concurrent-cancel");
    mkdirSync(path.join(root, "source-home"), { recursive: true });
    const fixture = makeSupervisor(root);
    const { scope, supervisor } = fixture;
    let releaseCancel!: () => void;
    scope.cancelWait = new Promise<void>((resolve) => {
      releaseCancel = resolve;
    });
    await supervisor.start(startOptions(root, { costOracle: makeOracle(1) }));
    const restartedSupervisor = new SpikeSupervisor(fixture.dependencies);
    const runRoot = path.join(root, "run-data");

    const first = restartedSupervisor.cancel("run007", runRoot);
    const second = restartedSupervisor.cancel("run007", runRoot);
    await Promise.resolve();
    expect(scope.cancels).toHaveLength(1);
    releaseCancel();

    await expect(Promise.all([first, second])).resolves.toEqual([
      {
        alreadyStopped: false,
        result: { sentKill: false, sentTerm: true },
        runId: "run007",
      },
      {
        alreadyStopped: false,
        result: { sentKill: false, sentTerm: true },
        runId: "run007",
      },
    ]);
    expect(scope.cancels).toHaveLength(1);
    expect(readRecord(runRoot).status).toBe("canceled");
  });

  it("does not persist canceled when post-cancel scope state is unknown or populated", async () => {
    const root = makeTempRoot("cancel-unknown-state");
    mkdirSync(path.join(root, "source-home"), { recursive: true });
    const fixture = makeSupervisor(root);
    const { scope, supervisor } = fixture;
    await supervisor.start(startOptions(root, { costOracle: makeOracle(1) }));
    const runRoot = path.join(root, "run-data");

    scope.cancelLeavesIdentity = true;
    scope.identity = unknownScopeIdentity();
    await expect(supervisor.cancel("run007", runRoot)).rejects.toMatchObject({
      code: "scope_state_unknown",
    });
    expect(readRecord(runRoot).status).toBe("active");

    scope.identity = populatedTerminalScopeIdentity();
    await expect(supervisor.cancel("run007", runRoot)).rejects.toMatchObject({
      code: "scope_not_stopped",
    });
    expect(readRecord(runRoot).status).toBe("active");
  });

  it("does not persist runner terminal status while the recorded scope is unknown or populated", async () => {
    const root = makeTempRoot("exit-unknown-state");
    mkdirSync(path.join(root, "source-home"), { recursive: true });
    const fixture = makeSupervisor(root);
    const { scope, supervisor } = fixture;
    await supervisor.start(startOptions(root, { costOracle: makeOracle(1) }));
    const runRoot = path.join(root, "run-data");

    scope.identity = unknownScopeIdentity();
    await expect(supervisor.recordRunnerExit("run007", 0, runRoot)).rejects.toMatchObject({
      code: "scope_state_unknown",
    });
    expect(readRecord(runRoot).status).toBe("active");

    scope.identity = populatedTerminalScopeIdentity();
    await expect(supervisor.recordRunnerExit("run007", 0, runRoot)).rejects.toMatchObject({
      code: "scope_not_stopped",
    });
    expect(readRecord(runRoot).status).toBe("active");
  });

  it("fails closed for legacy active records without a persisted control env", async () => {
    const root = makeTempRoot("legacy-control");
    mkdirSync(path.join(root, "source-home"), { recursive: true });
    const fixture = makeSupervisor(root);
    await fixture.supervisor.start(startOptions(root, { costOracle: makeOracle(1) }));

    const runRoot = path.join(root, "run-data");
    const recordPath = path.join(runRoot, "run007", "run.json");
    const legacyRecord = readRecord(runRoot);
    delete (legacyRecord as { controlEnv?: unknown }).controlEnv;
    writeFileSync(recordPath, JSON.stringify(legacyRecord, null, 2));

    const restartedSupervisor = new SpikeSupervisor(fixture.dependencies);
    await expect(restartedSupervisor.recover({ runRoot })).rejects.toMatchObject({
      code: "record_unavailable",
    });
    await expect(restartedSupervisor.cancel("run007", runRoot)).rejects.toMatchObject({
      code: "record_unavailable",
    });
    expect(fixture.scope.inspections).toHaveLength(1);
    expect(fixture.scope.cancels).toHaveLength(0);
    expect(readRecord(runRoot).status).toBe("active");
  });

  it("refreshes active heartbeat every 10 seconds after verified start and does not duplicate on recovery", async () => {
    vi.useFakeTimers();
    try {
      const root = makeTempRoot("heartbeat-maintenance");
      mkdirSync(path.join(root, "source-home"), { recursive: true });
      const fixture = makeSupervisor(root);
      const { clock, scope, supervisor } = fixture;
      await supervisor.start(startOptions(root, { costOracle: makeOracle(1) }));
      const runRoot = path.join(root, "run-data");
      const before = scopeHeartbeat(runRoot, "run007");
      const inspectionsAfterStart = scope.inspections.length;

      clock.current = "2026-09-13T12:00:09.999Z";
      await vi.advanceTimersByTimeAsync(9_999);
      expect(scopeHeartbeat(runRoot, "run007")).toBe(before);

      clock.current = "2026-09-13T12:00:10.000Z";
      await vi.advanceTimersByTimeAsync(1);
      expect(scopeHeartbeat(runRoot, "run007")).toBe("2026-09-13T12:00:10.000Z");
      expect(scope.inspections).toHaveLength(inspectionsAfterStart + 1);
      expect(readRecord(runRoot).journal.at(-1)?.event).toBe("maintenance_heartbeat_refreshed");

      clock.current = "2026-09-13T12:00:12.000Z";
      await supervisor.recover({ runRoot });
      expect(scopeHeartbeat(runRoot, "run007")).toBe("2026-09-13T12:00:12.000Z");
      const journalAfterRecovery = readRecord(runRoot).journal.length;

      clock.current = "2026-09-13T12:00:20.000Z";
      await vi.advanceTimersByTimeAsync(8_000);
      expect(readRecord(runRoot).journal).toHaveLength(journalAfterRecovery);

      clock.current = "2026-09-13T12:00:22.000Z";
      await vi.advanceTimersByTimeAsync(2_000);
      const events = readRecord(runRoot).journal.map((entry) => entry.event);
      expect(events.filter((event) => event === "maintenance_heartbeat_refreshed")).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("disposes maintenance on cancel and service dispose without late heartbeat writes", async () => {
    vi.useFakeTimers();
    try {
      const cancelRoot = makeTempRoot("heartbeat-cancel");
      mkdirSync(path.join(cancelRoot, "source-home"), { recursive: true });
      const cancelFixture = makeSupervisor(cancelRoot);
      await cancelFixture.supervisor.start(startOptions(cancelRoot, { costOracle: makeOracle(1) }));
      const cancelRunRoot = path.join(cancelRoot, "run-data");
      cancelFixture.clock.current = "2026-09-13T12:00:10.000Z";
      await cancelFixture.supervisor.cancel("run007", cancelRunRoot);
      const canceledHeartbeat = scopeHeartbeat(cancelRunRoot, "run007");
      const canceledJournalLength = readRecord(cancelRunRoot).journal.length;

      cancelFixture.clock.current = "2026-09-13T12:01:00.000Z";
      await vi.advanceTimersByTimeAsync(50_000);
      expect(scopeHeartbeat(cancelRunRoot, "run007")).toBe(canceledHeartbeat);
      expect(readRecord(cancelRunRoot).journal).toHaveLength(canceledJournalLength);

      const stopRoot = makeTempRoot("heartbeat-stop");
      mkdirSync(path.join(stopRoot, "source-home"), { recursive: true });
      const stopFixture = makeSupervisor(stopRoot);
      await stopFixture.supervisor.start(startOptions(stopRoot, { costOracle: makeOracle(1) }));
      const stopRunRoot = path.join(stopRoot, "run-data");
      const activeHeartbeat = scopeHeartbeat(stopRunRoot, "run007");
      stopFixture.supervisor.dispose();

      stopFixture.clock.current = "2026-09-13T12:01:00.000Z";
      await vi.advanceTimersByTimeAsync(60_000);
      expect(scopeHeartbeat(stopRunRoot, "run007")).toBe(activeHeartbeat);
      expect(readRecord(stopRunRoot).status).toBe("active");
      expect(stopFixture.scope.cancels).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops maintenance and records unknown when an active scope can no longer be verified", async () => {
    vi.useFakeTimers();
    try {
      const root = makeTempRoot("heartbeat-unknown");
      mkdirSync(path.join(root, "source-home"), { recursive: true });
      const fixture = makeSupervisor(root);
      await fixture.supervisor.start(startOptions(root, { costOracle: makeOracle(1) }));
      const runRoot = path.join(root, "run-data");
      fixture.scope.identity = unknownScopeIdentity();
      fixture.clock.current = "2026-09-13T12:00:10.000Z";

      await vi.advanceTimersByTimeAsync(10_000);
      const unknownRecord = readRecord(runRoot);
      expect(unknownRecord.status).toBe("unknown");
      expect(unknownRecord.journal.at(-1)?.event).toBe("maintenance_failed");
      const journalLength = unknownRecord.journal.length;

      fixture.clock.current = "2026-09-13T12:01:00.000Z";
      await vi.advanceTimersByTimeAsync(50_000);
      expect(readRecord(runRoot).journal).toHaveLength(journalLength);
    } finally {
      vi.useRealTimers();
    }
  });

  it("records sanitized scope wait exit without claiming success as truth", async () => {
    const stoppedRoot = makeTempRoot("wait-stopped");
    mkdirSync(path.join(stoppedRoot, "source-home"), { recursive: true });
    const stoppedFixture = makeSupervisor(stoppedRoot);
    const stoppedSupervisor = new SpikeSupervisor({
      ...stoppedFixture.dependencies,
      truth: {
        verifyExitedRun: async () => new Promise<never>(() => undefined),
      },
    });
    const stoppedWait = deferred<ScopeWaitResult>();
    stoppedFixture.scope.launchWait = stoppedWait.promise;
    await stoppedSupervisor.start(startOptions(stoppedRoot, { costOracle: makeOracle(1) }));
    const stoppedRunRoot = path.join(stoppedRoot, "run-data");
    stoppedFixture.scope.identity = stoppedScopeIdentity();
    stoppedFixture.clock.current = "2026-09-13T12:00:01.000Z";
    stoppedWait.resolve({
      status: 137,
      stderr: "watchdog.sh: heartbeat stale now_ms=1789326610000 mtime_ms=1789326600000 age_ms=10000 stale_ms=5000\n",
      stderrTruncated: false,
    });
    await vi.waitFor(() => {
      expect(readRecord(stoppedRunRoot).status).toBe("failed");
    });

    const stoppedRecord = readRecord(stoppedRunRoot);
    expect(stoppedRecord.scopeLaunchExit).toMatchObject({
      status: 137,
      stderrTruncated: false,
    });
    expect(stoppedRecord.scopeLaunchExit?.stderr).toContain("heartbeat stale");
    expect(stoppedRecord.runnerExit).toMatchObject({ source: "scope_wait", status: 137 });
    expect(stoppedRecord.truth).toMatchObject({ available: false, state: "pending" });
    expect(stoppedRecord.journal.at(-1)?.event).toBe("runner_exit_observed");

    const activeRoot = makeTempRoot("wait-active");
    mkdirSync(path.join(activeRoot, "source-home"), { recursive: true });
    const activeFixture = makeSupervisor(activeRoot);
    const activeWait = deferred<ScopeWaitResult>();
    activeFixture.scope.launchWait = activeWait.promise;
    await activeFixture.supervisor.start(startOptions(activeRoot, { costOracle: makeOracle(1) }));
    const activeRunRoot = path.join(activeRoot, "run-data");
    activeFixture.clock.current = "2026-09-13T12:00:02.000Z";
    activeWait.resolve({ status: 143, stderr: "", stderrTruncated: false });
    await vi.waitFor(() => {
      expect(readRecord(activeRunRoot).scopeLaunchExit).toMatchObject({ status: 143 });
    });

    const activeRecord = readRecord(activeRunRoot);
    expect(activeRecord.status).toBe("active");
    expect(activeRecord.scopeLaunchExit).toMatchObject({ status: 143 });
    expect(activeRecord.journal.at(-1)?.event).toBe("scope_wait_observed_active");
    activeFixture.supervisor.dispose();
  });

});

const scopeHeartbeat = (runRoot: string, runId: string): string =>
  readRecord(runRoot, runId).heartbeat.refreshedAt;
