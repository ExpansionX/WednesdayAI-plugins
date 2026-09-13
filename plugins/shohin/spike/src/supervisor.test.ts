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
import { afterEach, describe, expect, it } from "vitest";
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
import type {
  ScopeCancelHandle,
  ScopeCancelResult,
  ScopeController,
  ScopeIdentity,
  ScopeLaunchOptions,
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
      wait: async () => 0,
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

const makeSupervisor = (root: string) => {
  const clock = new FakeClock();
  const scope = new FakeScopeController();
  const identity = new FakeIdentityAdapter();
  const executables = new FakeExecutableResolver();
  const repoRoot = path.join(root, "repo");
  const targetRoot = path.join(root, "target");
  const commonGitDir = path.join(root, "repo", ".git");
  mkdirSync(repoRoot, { recursive: true });
  mkdirSync(targetRoot, { recursive: true });
  mkdirSync(commonGitDir, { recursive: true });
  identity.identity = {
    branch: "shohin/spike-fixture",
    commonGitDir,
    externalBaseline: "0123456789abcdef0123456789abcdef01234567",
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
      externalBaseline: "0123456789abcdef0123456789abcdef01234567",
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

  it("recovers active runs with heartbeat refresh before asynchronous truth checks", async () => {
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
    expect(truthCalls).toEqual([]);
    await truthStartedPromise;
    expect(truthCalls).toEqual(["run007"]);
    expect(fixture.identity.verifyActiveCalls).toBe(1);
    expect(fixture.scope.inspections.at(-1)?.controlEnv).toEqual(
      fixture.scope.expectedControlEnv,
    );
    expect(fixture.scope.launches).toHaveLength(3);
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
});

const scopeHeartbeat = (runRoot: string, runId: string): string =>
  readRecord(runRoot, runId).heartbeat.refreshedAt;
