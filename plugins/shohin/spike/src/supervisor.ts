import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  accessSync,
  chmodSync,
  closeSync,
  constants,
  copyFileSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { setTimeout as sleepTimeout } from "node:timers/promises";
import {
  buildControlEnvironment,
  buildExecutorEnvironment,
  copyAllowedHome,
  readAllowList,
  resolveLinkedWorktree,
  resolveRegisteredRepoRoot,
  validateTopic,
  type BuiltEnvironment,
  type SourceEnvironment,
} from "./environment.js";
import {
  createScopeController,
  scopeIdentityIsRunning,
  verifyScopeIdentityBinding,
  type ScopeCancelHandle,
  type ScopeCancelResult,
  type ScopeController,
  type ScopeIdentity,
  type ScopeWaitResult,
  type ScopedRunHandle,
} from "./scope.js";
import {
  type AuthoritativeOutcome,
} from "./evidence.js";

export const requiredWaiBundleFiles = {
  VERSION: "VERSION",
  cost: "wai-dag-cost-report.sh",
  executors: "wai-dag-executors.sh",
  gate: "task-gate.sh",
  run: "wai-dag-run.sh",
  watch: "wai-dag-watch.sh",
} as const;

export type RequiredWaiBundleFile = keyof typeof requiredWaiBundleFiles;
export type CostRole = "worker" | "validator" | "assessor" | "prewarm" | "terminal";
export type SpikeRunStatus =
  | "active"
  | "budget_refused"
  | "canceled"
  | "exited"
  | "failed"
  | "lost"
  | "recovered"
  | "reserved"
  | "starting"
  | "unknown";

export type SpikeSupervisorErrorCode =
  | "active_topic_exists"
  | "budget_cap_exceeded"
  | "budget_model_mismatch"
  | "budget_oracle_missing"
  | "budget_resource_unbounded"
  | "budget_role_missing"
  | "bundle_incomplete"
  | "immutable_generation_exists"
  | "invalid_option"
  | "patch_not_closed"
  | "patch_unknown"
  | "record_unavailable"
  | "scope_not_active"
  | "scope_not_stopped";

export class SpikeSupervisorError extends Error {
  public constructor(
    public readonly code: SpikeSupervisorErrorCode,
    message: string,
    public readonly detail: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
    this.name = "SpikeSupervisorError";
  }
}

export interface SpikeSupervisorClock {
  nowIso(): string;
  sleep(ms: number): Promise<void>;
}

export interface RunIdentity {
  readonly branch: string;
  readonly commonGitDir: string;
  readonly externalBaseline: string;
  readonly registeredRepoRoot: string;
  readonly targetRepoRoot: string;
  readonly topic: string;
}

export interface ResolveRunIdentityOptions {
  readonly externalBaseline?: string;
  readonly registeredRepoRoot: string;
  readonly targetRepoRoot: string;
  readonly topic: string;
}

export interface SpikeIdentityAdapter {
  resolveRunIdentity(options: ResolveRunIdentityOptions): Promise<RunIdentity>;
  ensureCleanTarget(identity: RunIdentity): Promise<void>;
  verifyActiveRunIdentity(record: SpikeSupervisorRecord): Promise<void>;
}

export interface ExecutableResolver {
  resolve(command: string, pathEnv: string): string;
}

export interface LaunchArtifacts {
  readonly diff: string;
  readonly filesChanged: readonly string[];
  readonly name: string;
}

export interface ProbePatch {
  readonly closed: boolean;
  readonly description: string;
  readonly name: string;
  apply(generationDir: string): LaunchArtifacts | Promise<LaunchArtifacts>;
}

export interface ModelPricing {
  readonly inputUsdPerMillionTokens: number;
  readonly outputUsdPerMillionTokens: number;
  readonly provider: string;
}

export interface ModelResourceCeiling {
  readonly enforcedBy: string;
  readonly maxInputTokens?: number;
  readonly maxOutputTokens?: number;
}

export interface ModelRoleBound {
  readonly boundSource: string;
  readonly ceiling: ModelResourceCeiling;
  readonly model: string;
  readonly pricing: ModelPricing;
}

export interface ModelCostOracle {
  readonly capUsd: number;
  readonly roles: Readonly<Record<CostRole, ModelRoleBound | undefined>>;
}

export type ModelIdMap = Readonly<Record<CostRole, string>>;

export interface SpendReservation {
  readonly at: string;
  readonly boundSource: string;
  readonly ceiling: ModelResourceCeiling;
  readonly dispatchId: string;
  readonly model: string;
  readonly provider: string;
  readonly reservedUsd: number;
  readonly role: CostRole;
  readonly runId: string;
}

export interface SpendUsage {
  readonly actualUsd: number;
  readonly at: string;
  readonly model: string;
  readonly role: CostRole;
  readonly source: string;
  readonly totalTokens: number;
}

export interface SpendRefusal {
  readonly at: string;
  readonly capUsd: number;
  readonly code: SpikeSupervisorErrorCode;
  readonly message: string;
  readonly requestedUsd: number;
  readonly role: CostRole;
  readonly runId: string;
  readonly totalReservedUsd: number;
}

export interface DurableSpendLedger {
  readonly actualUsage: readonly SpendUsage[];
  readonly capUsd: number;
  readonly refusals: readonly SpendRefusal[];
  readonly reservations: readonly SpendReservation[];
  readonly totalActualUsd: number;
  readonly totalReservedUsd: number;
  readonly updatedAt: string;
}

export interface RunnerGenerationRecord {
  readonly diffs: readonly LaunchArtifacts[];
  readonly hashes: Readonly<Record<RequiredWaiBundleFile, string>>;
  readonly id: string;
  readonly immutable: true;
  readonly path: string;
  readonly requiredFiles: typeof requiredWaiBundleFiles;
}

export interface RuntimeAllowListRecord {
  readonly env: readonly string[];
  readonly home: readonly string[];
}

export interface HeartbeatRecord {
  readonly path: string;
  readonly refreshedAt: string;
}

export interface ScopeRecord {
  readonly controlPid: number;
  readonly controlStartTime: string;
  readonly handleArgv: readonly string[];
  readonly identity?: ScopeIdentity;
  readonly scopeId: string;
}

export interface ScopeLaunchExitRecord {
  readonly observedAt: string;
  readonly status: number;
  readonly stderr: string;
  readonly stderrTruncated: boolean;
}

export interface JournalEntry {
  readonly at: string;
  readonly event: string;
  readonly detail?: Readonly<Record<string, unknown>>;
}

export interface SpikeSupervisorRecord {
  readonly controlEnv: Readonly<Record<string, string>>;
  readonly createdAt: string;
  readonly heartbeat: HeartbeatRecord;
  readonly identity: RunIdentity;
  readonly journal: readonly JournalEntry[];
  readonly launchEnv: Readonly<Record<string, string>>;
  readonly maxAttemptsNote: string;
  readonly recordPath: string;
  readonly runDir: string;
  readonly runId: string;
  readonly runnerGeneration?: RunnerGenerationRecord;
  readonly runtimeAllowList: RuntimeAllowListRecord;
  readonly scope?: ScopeRecord;
  readonly scopeLaunchExit?: ScopeLaunchExitRecord;
  readonly spendLedger: DurableSpendLedger;
  readonly status: SpikeRunStatus;
  readonly topic: string;
  readonly updatedAt: string;
}

export interface SpikeStartOptions {
  readonly assessorScriptPath: string;
  readonly budgetLedgerPath?: string;
  readonly controlSourceEnv: SourceEnvironment;
  readonly costOracle?: ModelCostOracle;
  readonly envAllowListPath: string;
  readonly externalBaseline?: string;
  readonly generationId?: string;
  readonly heartbeatPollIntervalMs: number;
  readonly heartbeatStaleAfterMs: number;
  readonly homeAllowListPath: string;
  readonly maxAttempts?: number;
  readonly modelIds?: Partial<ModelIdMap>;
  readonly namedProbePatches?: readonly string[];
  readonly notifyScriptPath: string;
  readonly opencodeCommand: string;
  readonly probePatches?: Readonly<Record<string, ProbePatch | undefined>>;
  readonly registeredRepoRoot: string;
  readonly reportAppendScriptPath: string;
  readonly runId?: string;
  readonly runRoot: string;
  readonly runnerTimeoutSec: number;
  readonly sourceHome: string;
  readonly targetRepoRoot: string;
  readonly topic: string;
  readonly waiBundleSourceDir: string;
  readonly waiRunCommand: string;
  readonly wrapperScriptPath: string;
}

export interface SpikeStartResult {
  readonly maxAttemptsNote: string;
  readonly record: SpikeSupervisorRecord;
  readonly runId: string;
  readonly scopeHandle: ScopedRunHandle;
}

export interface SpikeRecoverOptions {
  readonly runRoot: string;
}

export interface SpikeRecoverResult {
  readonly ignoredRunIds: readonly string[];
  readonly refreshedActiveRunIds: readonly string[];
  readonly scheduledTruthRunIds: readonly string[];
}

export interface SpikeCancelResult {
  readonly alreadyStopped: boolean;
  readonly result?: ScopeCancelResult;
  readonly runId: string;
}

export interface SpikeTruthAdapter {
  verifyExitedRun(record: SpikeSupervisorRecord): Promise<AuthoritativeOutcome>;
}

export interface SpikeSupervisorDependencies {
  readonly clock?: SpikeSupervisorClock;
  readonly executables?: ExecutableResolver;
  readonly identity?: SpikeIdentityAdapter;
  readonly scope?: ScopeController;
  readonly truth?: SpikeTruthAdapter;
}

const costRoles = ["worker", "validator", "assessor", "prewarm", "terminal"] as const;
const defaultCapUsd = 50;
const componentPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const commitPattern = /^[0-9a-f]{40}$/i;
const terminalStatuses = new Set<SpikeRunStatus>([
  "budget_refused",
  "canceled",
  "exited",
  "failed",
  "lost",
  "recovered",
  "unknown",
]);
const controlEnvironmentKeys = [
  "PATH",
  "XDG_RUNTIME_DIR",
  "DBUS_SESSION_BUS_ADDRESS",
] as const;
const allowedRecordedControlEnvironment = new Set<string>(controlEnvironmentKeys);
const heartbeatRefreshIntervalMs = 10_000;

interface ActiveRunMaintenance {
  disposed: boolean;
  timer?: NodeJS.Timeout;
}

const nodeClock: SpikeSupervisorClock = {
  nowIso: () => new Date().toISOString(),
  sleep: (ms: number) => sleepTimeout(ms).then(() => undefined),
};

const defaultTruthAdapter: SpikeTruthAdapter = {
  async verifyExitedRun() {
    return {
      expectedTasks: [],
      failures: [
        {
          code: "expected_tasks_unavailable",
          message: "No injected truth adapter or committed manifest equality inputs were configured",
        },
      ],
      gateResults: [],
      hints: [],
      manifestHash: "",
      verified: false,
    };
  },
};

const defaultExecutableResolver: ExecutableResolver = {
  resolve(command, pathEnv) {
    validateArg(command, "executable command");
    if (path.isAbsolute(command)) {
      assertExecutable(command);
      return realpathSync.native(command);
    }
    for (const entry of pathEnv.split(path.delimiter).filter((part) => part.length > 0)) {
      const candidate = path.join(entry, command);
      if (!existsSync(candidate)) {
        continue;
      }
      assertExecutable(candidate);
      return realpathSync.native(candidate);
    }
    throw new SpikeSupervisorError(
      "invalid_option",
      `Required executable is not reachable via explicit PATH: ${command}`,
      { command },
    );
  },
};

const defaultIdentityAdapter: SpikeIdentityAdapter = {
  async resolveRunIdentity(options) {
    const topic = validateTopic(options.topic);
    const registeredRepoRoot = resolveRegisteredRepoRoot(options.registeredRepoRoot);
    const targetRepoRoot =
      path.resolve(options.targetRepoRoot) === registeredRepoRoot
        ? registeredRepoRoot
        : resolveLinkedWorktree(options.targetRepoRoot, registeredRepoRoot);
    const commonGitDir = git(targetRepoRoot, ["rev-parse", "--git-common-dir"]);
    const absoluteCommonGitDir = path.isAbsolute(commonGitDir)
      ? commonGitDir
      : path.resolve(targetRepoRoot, commonGitDir);
    const branch = git(targetRepoRoot, ["rev-parse", "--abbrev-ref", "HEAD"]);
    const externalBaseline = options.externalBaseline?.toLowerCase();
    if (externalBaseline === undefined || !commitPattern.test(externalBaseline)) {
      throw new SpikeSupervisorError(
        "invalid_option",
        "An externally verified baseline commit is required before dispatch",
      );
    }
    return {
      branch,
      commonGitDir: realpathSync.native(absoluteCommonGitDir),
      externalBaseline,
      registeredRepoRoot,
      targetRepoRoot,
      topic,
    };
  },
  async ensureCleanTarget(identity) {
    const status = git(identity.targetRepoRoot, ["status", "--porcelain=v1"]);
    if (status.length > 0) {
      throw new SpikeSupervisorError(
        "invalid_option",
        "Target worktree has dirty or staged changes; refusing dispatch",
      );
    }
  },
  async verifyActiveRunIdentity(record) {
    const current = await this.resolveRunIdentity({
      externalBaseline: record.identity.externalBaseline,
      registeredRepoRoot: record.identity.registeredRepoRoot,
      targetRepoRoot: record.identity.targetRepoRoot,
      topic: record.identity.topic,
    });
    for (const key of [
      "branch",
      "commonGitDir",
      "externalBaseline",
      "registeredRepoRoot",
      "targetRepoRoot",
      "topic",
    ] as const) {
      if (current[key] !== record.identity[key]) {
        throw new SpikeSupervisorError(
          "invalid_option",
          `Active run identity changed: ${key}`,
          { current: current[key], recorded: record.identity[key] },
        );
      }
    }
  },
};

export class SpikeSupervisor {
  private readonly activeTopics = new Set<string>();
  private readonly clock: SpikeSupervisorClock;
  private readonly executables: ExecutableResolver;
  private readonly cancelRequests = new Map<string, Promise<SpikeCancelResult>>();
  private readonly identity: SpikeIdentityAdapter;
  private readonly maintenance = new Map<string, ActiveRunMaintenance>();
  private readonly runRoots = new Map<string, string>();
  private readonly scope: ScopeController;
  private readonly truth: SpikeTruthAdapter;

  public constructor({
    clock = nodeClock,
    executables = defaultExecutableResolver,
    identity = defaultIdentityAdapter,
    scope = createScopeController(),
    truth = defaultTruthAdapter,
  }: SpikeSupervisorDependencies = {}) {
    this.clock = clock;
    this.executables = executables;
    this.identity = identity;
    this.scope = scope;
    this.truth = truth;
  }

  public async start(options: SpikeStartOptions): Promise<SpikeStartResult> {
    const topic = validateTopic(options.topic);
    if (this.activeTopics.has(topic)) {
      throw new SpikeSupervisorError(
        "active_topic_exists",
        `A Shohin run is already active for topic ${topic}`,
      );
    }
    this.activeTopics.add(topic);

    try {
      const runId = validateComponent(options.runId ?? `run-${randomUUID()}`, "run id");
      const generationId = validateComponent(
        options.generationId ?? `generation-${randomUUID()}`,
        "generation id",
      );
      const runRoot = ensureAbsoluteDirectory(options.runRoot, "run root", 0o700);
      const runDir = path.join(runRoot, runId);
      ensureContained(runRoot, runDir, "run directory");
      mkdirSync(runDir, { recursive: true, mode: 0o700 });
      chmodSync(runDir, 0o700);
      this.runRoots.set(runId, runRoot);

      const identity = await this.identity.resolveRunIdentity({
        externalBaseline: options.externalBaseline,
        registeredRepoRoot: options.registeredRepoRoot,
        targetRepoRoot: options.targetRepoRoot,
        topic,
      });
      await this.identity.ensureCleanTarget(identity);

      const heartbeat = this.refreshHeartbeat(runDir);
      const record = this.makeInitialRecord({
        heartbeat,
        identity,
        runDir,
        runId,
        runRoot,
        topic,
      });
      this.writeRecord({
        ...record,
        journal: appendJournal(record, this.clock, "start_requested"),
      });

      const generationDir = path.join(runDir, "runner", generationId);
      if (existsSync(generationDir)) {
        throw new SpikeSupervisorError(
          "immutable_generation_exists",
          "Selected WAI runner generation already exists; refusing to overwrite it",
          { generationDir },
        );
      }

      const runtimeAllowList = this.prepareRuntimeAllowLists(options, runDir);
      const home = path.join(runDir, "HOME");
      const tmpdir = path.join(runDir, "tmp");
      mkdirSync(tmpdir, { recursive: true, mode: 0o700 });
      chmodSync(tmpdir, 0o700);
      copyAllowedHome({
        allowList: runtimeAllowList.home,
        destinationHome: home,
        sourceHome: options.sourceHome,
      });

      this.copyPristineBundle(options.waiBundleSourceDir, generationDir);
      const diffs = await this.applyPatches(generationDir, options);
      const hashes = hashRequiredBundleFiles(generationDir);
      freezeTree(generationDir);

      const runnerGeneration: RunnerGenerationRecord = {
        diffs,
        hashes,
        id: generationId,
        immutable: true,
        path: generationDir,
        requiredFiles: requiredWaiBundleFiles,
      };

      const readyRecord = this.readRecord(runRoot, runId);
      this.writeRecord({
        ...readyRecord,
        heartbeat,
        runnerGeneration,
        runtimeAllowList,
        status: "starting",
        updatedAt: this.clock.nowIso(),
        journal: appendJournal(readyRecord, this.clock, "runner_generation_ready", {
          generationId,
        }),
      });

      const dispatchId = `dispatch-${runId}`;
      const spendLedger = await this.reserveBudget({
        dispatchId,
        identity,
        modelIds: options.modelIds,
        oracle: options.costOracle,
        runDir,
        runId,
        runRoot,
      });
      const launch = this.buildLaunch(options, {
        generationDir,
        home,
        runDir,
        runtimeAllowList,
        tmpdir,
      });
      const reservedRecord = this.readRecord(runRoot, runId);
      this.writeRecord({
        ...reservedRecord,
        controlEnv: launch.controlEnv,
        launchEnv: launch.executorEnv,
        spendLedger,
        status: "reserved",
        updatedAt: this.clock.nowIso(),
        journal: appendJournal(reservedRecord, this.clock, "budget_reserved", {
          dispatchId,
        }),
      });

      const scopeHandle = await this.scope.launch({
        controlEnv: launch.controlEnv,
        cwd: identity.targetRepoRoot,
        executorEnv: launch.executorEnv,
        heartbeat: {
          path: heartbeat.path,
          pollIntervalMs: options.heartbeatPollIntervalMs,
          staleAfterMs: options.heartbeatStaleAfterMs,
        },
        killAfterMs: 2_000,
        runDir,
        runId,
        runner: launch.runner,
        runtimeMaxSec: options.runnerTimeoutSec,
        topic,
      });
      const scopeIdentity = await this.scope.inspect(scopeHandle.scopeId, scopeHandle.controlEnv);
      if (!scopeIdentityIsRunning(scopeIdentity)) {
        throw new SpikeSupervisorError(
          "scope_not_active",
          `Scope ${scopeHandle.scopeId} was not running after launch`,
          { runId, scopeId: scopeHandle.scopeId },
        );
      }
      const activeRecord = this.readRecord(runRoot, runId);
      const finalRecord: SpikeSupervisorRecord = {
        ...activeRecord,
        controlEnv: launch.controlEnv,
        heartbeat: this.refreshHeartbeat(runDir),
        launchEnv: launch.executorEnv,
        runnerGeneration,
        scope: {
          controlPid: scopeHandle.controlPid,
          controlStartTime: scopeHandle.controlStartTime,
          handleArgv: scopeHandle.argv,
          identity: scopeIdentity,
          scopeId: scopeHandle.scopeId,
        },
        status: "active",
        updatedAt: this.clock.nowIso(),
        journal: appendJournal(activeRecord, this.clock, "scope_launched", {
          scopeId: scopeHandle.scopeId,
        }),
      };
      this.writeRecord(finalRecord);
      this.attachActiveMaintenance(finalRecord, scopeHandle);
      return {
        maxAttemptsNote: finalRecord.maxAttemptsNote,
        record: finalRecord,
        runId,
        scopeHandle,
      };
    } catch (error) {
      this.activeTopics.delete(topic);
      throw error;
    }
  }

  public async reconcileUsage(
    runId: string,
    usage: readonly Omit<SpendUsage, "at">[],
    runRootInput?: string,
  ): Promise<DurableSpendLedger> {
    const runRoot = this.resolveRunRoot(runId, runRootInput);
    const record = this.readRecord(runRoot, runId);
    const at = this.clock.nowIso();
    const usageRecords = usage.map((entry) => validateUsage({ ...entry, at }));
    const ledgerPath = this.ledgerPathFor(runRoot);
    const ledger = await withLock(ledgerPath, this.clock, async () => {
      const current = readLedger(ledgerPath, record.spendLedger.capUsd, at);
      const next = summarizeLedger({
        ...current,
        actualUsage: [...current.actualUsage, ...usageRecords],
        updatedAt: at,
      });
      atomicWriteJson(ledgerPath, next);
      return next;
    });
    this.writeRecord({
      ...record,
      spendLedger: ledger,
      updatedAt: at,
      journal: appendJournal(record, this.clock, "usage_reconciled"),
    });
    return ledger;
  }

  public async recover(options: SpikeRecoverOptions): Promise<SpikeRecoverResult> {
    const runRoot = path.resolve(options.runRoot);
    const refreshedActiveRunIds: string[] = [];
    const ignoredRunIds: string[] = [];
    const scheduledTruthRunIds: string[] = [];

    for (const runId of listRunIds(runRoot)) {
      const record = this.readRecord(runRoot, runId);
      this.runRoots.set(runId, runRoot);
      if (record.status === "active") {
        if (record.scope === undefined) {
          throw new SpikeSupervisorError(
            "record_unavailable",
            `Active run ${runId} is missing scope identity`,
          );
        }
        const controlEnv = readRecordedControlEnvironment(record);
        await this.identity.verifyActiveRunIdentity(record);
        const scopeIdentity = await this.scope.inspect(
          record.scope.scopeId,
          controlEnv,
          record.scope.identity,
        );
        if (!scopeIdentityIsRunning(scopeIdentity)) {
          verifyScopeIdentityBinding(record.scope.scopeId, scopeIdentity, record.scope.identity);
          this.disposeRunMaintenance(runRoot, runId);
          this.activeTopics.delete(record.topic);
          this.writeRecord({
            ...record,
            status: "unknown",
            updatedAt: this.clock.nowIso(),
            journal: appendJournal(record, this.clock, "recovery_scope_stopped_without_exit"),
          });
          ignoredRunIds.push(runId);
          continue;
        }
        verifyScopeIdentityBinding(record.scope.scopeId, scopeIdentity, record.scope.identity);
        const updated = {
          ...record,
          heartbeat: this.refreshHeartbeat(record.runDir),
          updatedAt: this.clock.nowIso(),
          journal: appendJournal(record, this.clock, "recovery_heartbeat_refreshed"),
        };
        this.writeRecord(updated);
        this.attachActiveMaintenance(updated);
        refreshedActiveRunIds.push(runId);
        continue;
      }
      if (record.status === "exited") {
        scheduledTruthRunIds.push(runId);
        const scheduled = {
          ...record,
          updatedAt: this.clock.nowIso(),
          journal: appendJournal(record, this.clock, "recovery_truth_scheduled"),
        };
        this.writeRecord(scheduled);
        setTimeout(() => {
          void this.truth.verifyExitedRun(scheduled);
        }, 0);
        continue;
      }
      ignoredRunIds.push(runId);
      if (record.status === "lost" || record.status === "unknown") {
        this.writeRecord({
          ...record,
          updatedAt: this.clock.nowIso(),
          journal: appendJournal(record, this.clock, "recovery_ignored_terminal_state", {
            status: record.status,
          }),
        });
      }
    }

    return { ignoredRunIds, refreshedActiveRunIds, scheduledTruthRunIds };
  }

  public async cancel(runId: string, runRootInput?: string): Promise<SpikeCancelResult> {
    const runRoot = this.resolveRunRoot(runId, runRootInput);
    const key = `${runRoot}\0${runId}`;
    const existing = this.cancelRequests.get(key);
    if (existing !== undefined) {
      return existing;
    }
    const request = this.cancelActiveRun(runId, runRoot);
    this.cancelRequests.set(key, request);
    try {
      return await request;
    } finally {
      if (this.cancelRequests.get(key) === request) {
        this.cancelRequests.delete(key);
      }
    }
  }

  private async cancelActiveRun(
    runId: string,
    runRoot: string,
  ): Promise<SpikeCancelResult> {
    const record = this.readRecord(runRoot, runId);
    if (record.status !== "active" || record.scope === undefined) {
      return { alreadyStopped: true, runId };
    }
    const controlEnv = readRecordedControlEnvironment(record);
    const handle: ScopeCancelHandle = {
      controlEnv,
      controlPid: record.scope.controlPid,
      controlStartTime: record.scope.controlStartTime,
      identity: record.scope.identity,
      scopeId: record.scope.scopeId,
    };
    const result = await this.scope.cancel(handle);
    await this.verifyScopeStoppedBeforeTerminalPersistence(record, controlEnv);
    const alreadyStopped = !result.sentKill && !result.sentTerm;
    this.disposeRunMaintenance(runRoot, runId);
    this.activeTopics.delete(record.topic);
    this.writeRecord({
      ...record,
      status: "canceled",
      updatedAt: this.clock.nowIso(),
      journal: appendJournal(
        record,
        this.clock,
        alreadyStopped ? "cancel_already_stopped" : "cancel_requested",
      ),
    });
    return alreadyStopped
      ? { alreadyStopped: true, runId }
      : { alreadyStopped: false, result, runId };
  }

  private async verifyScopeStoppedBeforeTerminalPersistence(
    record: SpikeSupervisorRecord,
    controlEnv: Readonly<Record<string, string>>,
  ): Promise<void> {
    if (record.scope === undefined) {
      return;
    }
    const scopeIdentity = await this.scope.inspect(
      record.scope.scopeId,
      controlEnv,
      record.scope.identity,
    );
    if (scopeIdentityIsRunning(scopeIdentity)) {
      throw new SpikeSupervisorError(
        "scope_not_stopped",
        `Refusing to persist terminal status for ${record.runId}: scope ${record.scope.scopeId} still has live membership`,
        { runId: record.runId, scopeId: record.scope.scopeId },
      );
    }
    verifyScopeIdentityBinding(record.scope.scopeId, scopeIdentity, record.scope.identity);
  }

  public async recordRunnerExit(
    runId: string,
    exitStatus: number,
    runRootInput?: string,
  ): Promise<void> {
    const runRoot = this.resolveRunRoot(runId, runRootInput);
    const record = this.readRecord(runRoot, runId);
    if (record.status === "active") {
      if (record.scope === undefined) {
        throw new SpikeSupervisorError(
          "record_unavailable",
          `Active run ${runId} is missing scope identity`,
        );
      }
      await this.verifyScopeStoppedBeforeTerminalPersistence(
        record,
        readRecordedControlEnvironment(record),
      );
    }
    this.disposeRunMaintenance(runRoot, runId);
    this.activeTopics.delete(record.topic);
    this.writeRecord({
      ...record,
      status: exitStatus === 0 ? "exited" : "failed",
      updatedAt: this.clock.nowIso(),
      journal: appendJournal(record, this.clock, "runner_exited", { exitStatus }),
    });
  }

  public async writeRunStatus(
    runId: string,
    status: SpikeRunStatus,
    runRootInput?: string,
  ): Promise<void> {
    const runRoot = this.resolveRunRoot(runId, runRootInput);
    const record = this.readRecord(runRoot, runId);
    if (terminalStatuses.has(status)) {
      this.disposeRunMaintenance(runRoot, runId);
      this.activeTopics.delete(record.topic);
    }
    this.writeRecord({
      ...record,
      status,
      updatedAt: this.clock.nowIso(),
      journal: appendJournal(record, this.clock, "status_overridden", { status }),
    });
  }

  public dispose(): void {
    for (const key of [...this.maintenance.keys()]) {
      this.disposeMaintenanceKey(key);
    }
    this.activeTopics.clear();
  }

  private attachActiveMaintenance(
    record: SpikeSupervisorRecord,
    scopeHandle?: ScopedRunHandle,
  ): void {
    const runRoot = runRootForRecord(record);
    const key = maintenanceKey(runRoot, record.runId);
    if (this.maintenance.has(key)) {
      return;
    }
    const entry: ActiveRunMaintenance = { disposed: false };
    this.maintenance.set(key, entry);
    this.activeTopics.add(record.topic);
    this.scheduleHeartbeatRefresh(entry, runRoot, record.runId);
    if (scopeHandle !== undefined) {
      this.observeScopeExit(entry, runRoot, record.runId, scopeHandle);
    }
  }

  private scheduleHeartbeatRefresh(
    entry: ActiveRunMaintenance,
    runRoot: string,
    runId: string,
  ): void {
    entry.timer = setTimeout(() => {
      void this.refreshMaintainedHeartbeat(entry, runRoot, runId);
    }, heartbeatRefreshIntervalMs);
    entry.timer.unref?.();
  }

  private async refreshMaintainedHeartbeat(
    entry: ActiveRunMaintenance,
    runRoot: string,
    runId: string,
  ): Promise<void> {
    if (entry.disposed) {
      return;
    }
    try {
      const record = this.readRecord(runRoot, runId);
      if (record.status !== "active") {
        this.disposeRunMaintenance(runRoot, runId);
        return;
      }
      if (record.scope === undefined) {
        throw new SpikeSupervisorError(
          "record_unavailable",
          `Active run ${runId} is missing scope identity`,
        );
      }
      const controlEnv = readRecordedControlEnvironment(record);
      await this.identity.verifyActiveRunIdentity(record);
      const scopeIdentity = await this.scope.inspect(
        record.scope.scopeId,
        controlEnv,
        record.scope.identity,
      );
      if (!scopeIdentityIsRunning(scopeIdentity)) {
        verifyScopeIdentityBinding(record.scope.scopeId, scopeIdentity, record.scope.identity);
        if (!entry.disposed) {
          this.markActiveRunUnknown(runRoot, runId, "maintenance_scope_stopped_without_exit");
        }
        return;
      }
      verifyScopeIdentityBinding(record.scope.scopeId, scopeIdentity, record.scope.identity);
      if (entry.disposed) {
        return;
      }
      const current = this.readRecord(runRoot, runId);
      if (current.status !== "active" || current.scope === undefined) {
        this.disposeRunMaintenance(runRoot, runId);
        return;
      }
      const heartbeat = this.refreshHeartbeat(current.runDir);
      this.writeRecord({
        ...current,
        heartbeat,
        scope: {
          ...current.scope,
          identity: scopeIdentity,
        },
        updatedAt: heartbeat.refreshedAt,
        journal: appendJournal(current, this.clock, "maintenance_heartbeat_refreshed"),
      });
    } catch (error) {
      if (!entry.disposed) {
        this.markActiveRunUnknown(runRoot, runId, "maintenance_failed", {
          message: publicErrorMessage(error),
        });
      }
      return;
    } finally {
      if (!entry.disposed) {
        this.scheduleHeartbeatRefresh(entry, runRoot, runId);
      }
    }
  }

  private observeScopeExit(
    entry: ActiveRunMaintenance,
    runRoot: string,
    runId: string,
    scopeHandle: ScopedRunHandle,
  ): void {
    void (async () => {
      const exit = await waitForScopeExit(scopeHandle);
      if (entry.disposed) {
        return;
      }
      let record: SpikeSupervisorRecord;
      try {
        record = this.readRecord(runRoot, runId);
      } catch {
        this.disposeRunMaintenance(runRoot, runId);
        return;
      }
      if (record.status !== "active") {
        this.disposeRunMaintenance(runRoot, runId);
        return;
      }
      const scopeLaunchExit = scopeLaunchExitRecord(exit, this.clock.nowIso());
      if (record.scope === undefined) {
        this.writeRecord({
          ...record,
          scopeLaunchExit,
          status: "unknown",
          updatedAt: scopeLaunchExit.observedAt,
          journal: appendJournal(record, this.clock, "scope_wait_observed_without_scope", {
            status: exit.status,
            stderrTruncated: exit.stderrTruncated,
          }),
        });
        this.activeTopics.delete(record.topic);
        this.disposeRunMaintenance(runRoot, runId);
        return;
      }
      try {
        const controlEnv = readRecordedControlEnvironment(record);
        const scopeIdentity = await this.scope.inspect(
          record.scope.scopeId,
          controlEnv,
          record.scope.identity,
        );
        if (scopeIdentityIsRunning(scopeIdentity)) {
          verifyScopeIdentityBinding(record.scope.scopeId, scopeIdentity, record.scope.identity);
          if (entry.disposed) {
            return;
          }
          const current = this.readRecord(runRoot, runId);
          if (current.status !== "active" || current.scope === undefined) {
            this.disposeRunMaintenance(runRoot, runId);
            return;
          }
          this.writeRecord({
            ...current,
            scope: {
              ...current.scope,
              identity: scopeIdentity,
            },
            scopeLaunchExit,
            updatedAt: scopeLaunchExit.observedAt,
            journal: appendJournal(current, this.clock, "scope_wait_observed_active", {
              status: exit.status,
              stderrTruncated: exit.stderrTruncated,
            }),
          });
          return;
        }
        verifyScopeIdentityBinding(record.scope.scopeId, scopeIdentity, record.scope.identity);
        if (!entry.disposed) {
          this.markActiveRunUnknown(runRoot, runId, "scope_wait_observed_stopped", {
            scopeLaunchExit,
          });
        }
      } catch (error) {
        if (!entry.disposed) {
          this.markActiveRunUnknown(runRoot, runId, "scope_wait_observed_unknown", {
            message: publicErrorMessage(error),
            scopeLaunchExit,
          });
        }
      }
    })();
  }

  private markActiveRunUnknown(
    runRoot: string,
    runId: string,
    event: string,
    detail?: Readonly<Record<string, unknown>>,
  ): void {
    let record: SpikeSupervisorRecord;
    try {
      record = this.readRecord(runRoot, runId);
    } catch {
      this.disposeRunMaintenance(runRoot, runId);
      return;
    }
    if (record.status !== "active") {
      this.disposeRunMaintenance(runRoot, runId);
      return;
    }
    const scopeLaunchExit = isScopeLaunchExitRecord(detail?.scopeLaunchExit)
      ? detail.scopeLaunchExit
      : record.scopeLaunchExit;
    this.writeRecord({
      ...record,
      ...(scopeLaunchExit === undefined ? {} : { scopeLaunchExit }),
      status: "unknown",
      updatedAt: this.clock.nowIso(),
      journal: appendJournal(record, this.clock, event, detail),
    });
    this.activeTopics.delete(record.topic);
    this.disposeRunMaintenance(runRoot, runId);
  }

  private disposeRunMaintenance(runRoot: string, runId: string): void {
    this.disposeMaintenanceKey(maintenanceKey(runRoot, runId));
  }

  private disposeMaintenanceKey(key: string): void {
    const entry = this.maintenance.get(key);
    if (entry === undefined) {
      return;
    }
    entry.disposed = true;
    if (entry.timer !== undefined) {
      clearTimeout(entry.timer);
    }
    this.maintenance.delete(key);
  }

  private makeInitialRecord({
    heartbeat,
    identity,
    runDir,
    runId,
    runRoot,
    topic,
  }: {
    readonly heartbeat: HeartbeatRecord;
    readonly identity: RunIdentity;
    readonly runDir: string;
    readonly runId: string;
    readonly runRoot: string;
    readonly topic: string;
  }): SpikeSupervisorRecord {
    const at = this.clock.nowIso();
    return {
      controlEnv: {},
      createdAt: at,
      heartbeat,
      identity,
      journal: [],
      launchEnv: {},
      maxAttemptsNote:
        "WAI_DAG_MAX_ATTEMPTS=1 permits one retry on failure; a successful baseline dispatches once.",
      recordPath: recordPathFor(runRoot, runId),
      runDir,
      runId,
      runtimeAllowList: { env: [], home: [] },
      spendLedger: emptyLedger(defaultCapUsd, at),
      status: "starting",
      topic,
      updatedAt: at,
    };
  }

  private async reserveBudget({
    dispatchId,
    identity,
    modelIds,
    oracle,
    runDir,
    runId,
    runRoot,
  }: {
    readonly dispatchId: string;
    readonly identity: RunIdentity;
    readonly modelIds?: Partial<ModelIdMap>;
    readonly oracle?: ModelCostOracle;
    readonly runDir: string;
    readonly runId: string;
    readonly runRoot: string;
  }): Promise<DurableSpendLedger> {
    const ledgerPath = this.ledgerPathFor(runRoot);
    return withLock(ledgerPath, this.clock, async () => {
      const at = this.clock.nowIso();
      const current = readLedger(ledgerPath, oracle?.capUsd ?? defaultCapUsd, at);
      try {
        const reservations = this.planReservations({
          dispatchId,
          modelIds,
          oracle,
          runId,
          at,
        });
        const requestedUsd = roundUsd(
          reservations.reduce((sum, reservation) => sum + reservation.reservedUsd, 0),
        );
        if (roundUsd(current.totalReservedUsd + requestedUsd) > current.capUsd) {
          throw new SpikeSupervisorError(
            "budget_cap_exceeded",
            "Conservative budget reservation would exceed the spike-day cap",
            {
              capUsd: current.capUsd,
              requestedUsd,
              totalReservedUsd: current.totalReservedUsd,
            },
          );
        }
        const next = summarizeLedger({
          ...current,
          reservations: [...current.reservations, ...reservations],
          updatedAt: at,
        });
        atomicWriteJson(ledgerPath, next);
        return next;
      } catch (error) {
        const refusal = refusalFromError(error, {
          at,
          capUsd: current.capUsd,
          runId,
          totalReservedUsd: current.totalReservedUsd,
        });
        const next = summarizeLedger({
          ...current,
          refusals: [...current.refusals, refusal],
          updatedAt: at,
        });
        atomicWriteJson(ledgerPath, next);
        const record = this.readRecord(runRoot, runId);
        this.writeRecord({
          ...record,
          identity,
          spendLedger: next,
          status: "budget_refused",
          updatedAt: at,
          journal: appendJournal(record, this.clock, "budget_refused", {
            code: refusal.code,
            role: refusal.role,
          }),
        });
        throw error;
      }
    });
  }

  private planReservations({
    at,
    dispatchId,
    modelIds,
    oracle,
    runId,
  }: {
    readonly at: string;
    readonly dispatchId: string;
    readonly modelIds?: Partial<ModelIdMap>;
    readonly oracle?: ModelCostOracle;
    readonly runId: string;
  }): SpendReservation[] {
    if (oracle === undefined) {
      throw new SpikeSupervisorError(
        "budget_oracle_missing",
        "Missing pinned role/model pricing and enforced resource ceilings",
        { role: "worker" },
      );
    }
    validateMoney(oracle.capUsd, "cost oracle cap");
    if (oracle.capUsd > defaultCapUsd) {
      throw new SpikeSupervisorError(
        "budget_cap_exceeded",
        "Cost oracle cap cannot exceed the Shohin spike-day cap",
        { capUsd: oracle.capUsd, role: "worker" },
      );
    }

    return costRoles.map((role) => {
      const bound = oracle.roles[role];
      if (bound === undefined) {
        throw new SpikeSupervisorError(
          "budget_role_missing",
          `Missing conservative model bound for ${role}`,
          { role },
        );
      }
      assertBoundedRole(role, bound);
      const configuredModel = modelIds?.[role];
      if (configuredModel === undefined || configuredModel.length === 0) {
        throw new SpikeSupervisorError(
          "budget_role_missing",
          `Missing frozen model id for ${role}`,
          { role },
        );
      }
      if (configuredModel !== bound.model) {
        throw new SpikeSupervisorError(
          "budget_model_mismatch",
          `Frozen ${role} model id does not match the pinned cost oracle`,
          { model: configuredModel, oracleModel: bound.model, role },
        );
      }
      return {
        at,
        boundSource: bound.boundSource,
        ceiling: bound.ceiling,
        dispatchId,
        model: bound.model,
        provider: bound.pricing.provider,
        reservedUsd: conservativeUsd(bound),
        role,
        runId,
      };
    });
  }

  private prepareRuntimeAllowLists(
    options: SpikeStartOptions,
    runDir: string,
  ): RuntimeAllowListRecord {
    const allowDir = path.join(runDir, "allow");
    mkdirSync(allowDir, { recursive: true, mode: 0o700 });
    chmodSync(allowDir, 0o700);
    const runtimeEnvPath = path.join(allowDir, "env.allow");
    const runtimeHomePath = path.join(allowDir, "home.allow");
    copyFileSync(options.envAllowListPath, runtimeEnvPath);
    copyFileSync(options.homeAllowListPath, runtimeHomePath);
    chmodSync(runtimeEnvPath, 0o600);
    chmodSync(runtimeHomePath, 0o600);
    return {
      env: readAllowList(runtimeEnvPath),
      home: readAllowList(runtimeHomePath),
    };
  }

  private copyPristineBundle(sourceDir: string, generationDir: string): void {
    const source = realDirectory(sourceDir, "WAI bundle source");
    cpSync(source, generationDir, {
      errorOnExist: true,
      force: false,
      preserveTimestamps: true,
      recursive: true,
    });
    validateBundleComplete(generationDir);
  }

  private async applyPatches(
    generationDir: string,
    options: SpikeStartOptions,
  ): Promise<LaunchArtifacts[]> {
    const diffs: LaunchArtifacts[] = [applyReviewedObservabilityPatch(generationDir)];
    for (const name of options.namedProbePatches ?? []) {
      const patch = options.probePatches?.[name];
      if (patch === undefined) {
        throw new SpikeSupervisorError("patch_unknown", `Unknown named probe patch: ${name}`, {
          name,
        });
      }
      if (!patch.closed || patch.name !== name) {
        throw new SpikeSupervisorError(
          "patch_not_closed",
          `Named probe patch is not closed and exact: ${name}`,
          { name },
        );
      }
      diffs.push(await patch.apply(generationDir));
    }
    return diffs;
  }

  private buildLaunch(
    options: SpikeStartOptions,
    paths: {
      readonly generationDir: string;
      readonly home: string;
      readonly runDir: string;
      readonly runtimeAllowList: RuntimeAllowListRecord;
      readonly tmpdir: string;
    },
  ): {
    readonly controlEnv: BuiltEnvironment;
    readonly executorEnv: BuiltEnvironment;
    readonly runner: readonly string[];
  } {
    const pathEnv = readRequiredSourceValue(options.controlSourceEnv, "PATH");
    const opencode = this.executables.resolve(options.opencodeCommand, pathEnv);
    const runnerCommand = this.executables.resolve(options.waiRunCommand, pathEnv);
    const wrapper = executablePath(options.wrapperScriptPath, "OpenCode wrapper");
    const notify = executablePath(options.notifyScriptPath, "notify script");
    const assessor = executablePath(options.assessorScriptPath, "assessor script");
    const reportAppend = executablePath(options.reportAppendScriptPath, "report append script");
    const maxAttempts = options.maxAttempts ?? 1;
    if (maxAttempts !== 1) {
      throw new SpikeSupervisorError(
        "invalid_option",
        "The saved success-path supervisor run is frozen to WAI_DAG_MAX_ATTEMPTS=1",
      );
    }
    const modelIds = assertModelIds(options.modelIds);
    const reportDir = path.join(paths.runDir, "report");
    mkdirSync(reportDir, { recursive: true, mode: 0o700 });
    chmodSync(reportDir, 0o700);

    const frozenRunnerEnv: Record<string, string> = {
      OC_MODEL: modelIds.prewarm,
      WAI_DAG_EXECUTOR_SH: path.join(paths.generationDir, requiredWaiBundleFiles.executors),
      WAI_DAG_EXECUTOR_TYPE: "opencode",
      WAI_DAG_MAX_ATTEMPTS: "1",
      WAI_DAG_NOTIFY_CMD: notify,
      WAI_DAG_OPENCODE: wrapper,
      WAI_DAG_ORCHESTRATOR_MODEL: modelIds.assessor,
      WAI_DAG_ORCHESTRATOR_SH: assessor,
      WAI_DAG_REPORT_DIR: reportDir,
      WAI_DAG_TERMINAL_REVIEWER_MODEL: modelIds.terminal,
      WAI_DAG_VALIDATOR_MODEL: modelIds.validator,
      WAI_DAG_WORKER_MODEL: modelIds.worker,
      WAI_DAG_WORKERS: "1",
      WAI_SHOHIN_ASSESSOR_CMD: assessor,
      WAI_SHOHIN_ATTENTION_LOG: path.join(paths.runDir, "attention.jsonl"),
      WAI_SHOHIN_CALL_LOG: path.join(paths.runDir, "opencode-calls.jsonl"),
      WAI_SHOHIN_OPENCODE_BIN: opencode,
      WAI_SHOHIN_REPORT_APPEND_CMD: reportAppend,
      WAI_SHOHIN_RUN_DIR: paths.runDir,
    };
    const executorSourceEnv = {
      PATH: pathEnv,
      ...frozenRunnerEnv,
    } satisfies SourceEnvironment;
    const runnerKeys = Object.keys(frozenRunnerEnv).sort();
    return {
      controlEnv: buildControlEnvironment({ sourceEnv: options.controlSourceEnv }),
      executorEnv: buildExecutorEnvironment({
        envAllowList: paths.runtimeAllowList.env,
        home: paths.home,
        runnerEnvKeys: runnerKeys,
        sourceEnv: executorSourceEnv,
        tmpdir: paths.tmpdir,
      }),
      runner: [runnerCommand, path.join(paths.generationDir, requiredWaiBundleFiles.run), options.topic],
    };
  }

  private refreshHeartbeat(runDir: string): HeartbeatRecord {
    const heartbeatPath = path.join(runDir, "heartbeat.json");
    const heartbeat = {
      refreshedAt: this.clock.nowIso(),
      runDir,
    };
    atomicWriteJson(heartbeatPath, heartbeat);
    return {
      path: heartbeatPath,
      refreshedAt: heartbeat.refreshedAt,
    };
  }

  private writeRecord(record: SpikeSupervisorRecord): void {
    atomicWriteJson(record.recordPath, record);
  }

  private readRecord(runRoot: string, runId: string): SpikeSupervisorRecord {
    const recordPath = recordPathFor(runRoot, runId);
    if (!existsSync(recordPath)) {
      throw new SpikeSupervisorError("record_unavailable", `Run record is missing: ${runId}`);
    }
    const parsed = JSON.parse(readFileSync(recordPath, "utf-8")) as SpikeSupervisorRecord;
    this.runRoots.set(runId, runRoot);
    return parsed;
  }

  private ledgerPathFor(runRoot: string): string {
    return path.join(runRoot, "spend-ledger.json");
  }

  private resolveRunRoot(runId: string, runRootInput?: string): string {
    const runRoot = runRootInput ?? this.runRoots.get(runId);
    if (runRoot === undefined) {
      throw new SpikeSupervisorError(
        "record_unavailable",
        `Run root is unknown for ${runId}`,
      );
    }
    return runRoot;
  }
}

const applyReviewedObservabilityPatch = (generationDir: string): LaunchArtifacts => {
  const executorsPath = path.join(generationDir, requiredWaiBundleFiles.executors);
  const before = readFileSync(executorsPath, "utf-8");
  let after = before;
  const appliedHunks: Array<{ readonly before: string; readonly after: string }> = [];
  const replacements: Array<readonly [string, string]> = [
    [
      '  _maybe_timeout "$WAI_DAG_PREWARM_TIMEOUT" "$WAI_DAG_OPENCODE" run --format json \\\n    -m "${OC_MODEL:-$OC_MODEL_DEFAULT}" \\\n    --attach "$WAI_DAG_OPENCODE_SERVER" \\\n    "Reply with exactly the word OK and nothing else." >/dev/null 2>&1 || true',
      '  local shohin_prewarm_model="${OC_MODEL:-$OC_MODEL_DEFAULT}"\n  WAI_SHOHIN_ROLE=prewarm WAI_SHOHIN_MODEL="$shohin_prewarm_model" WAI_SHOHIN_ATTEMPT=0\n  export WAI_SHOHIN_ROLE WAI_SHOHIN_MODEL WAI_SHOHIN_ATTEMPT\n  _maybe_timeout "$WAI_DAG_PREWARM_TIMEOUT" "$WAI_DAG_OPENCODE" run --format json \\\n    -m "$shohin_prewarm_model" \\\n    --attach "$WAI_DAG_OPENCODE_SERVER" \\\n    "Reply with exactly the word OK and nothing else." >/dev/null 2>&1 || true',
    ],
    [
      '  raw="$(_dispatch "$WAI_DAG_EXECUTOR_TYPE" "$pfile" "$dispatch_cwd" -m "$(_resolve_model worker)")"\n  [ -n "$lane" ] && { _lane_worktree_remove "$root" "$lane"; WAI_DAG_LANE_ACTIVE=""; }\n  rm -f "$pfile"\n  local attempt="${WAI_DAG_ATTEMPT:-1}"',
      '  local attempt="${WAI_DAG_ATTEMPT:-1}" shohin_worker_model\n  shohin_worker_model="$(_resolve_model worker)"\n  WAI_SHOHIN_ROLE=worker WAI_SHOHIN_MODEL="$shohin_worker_model" WAI_SHOHIN_ATTEMPT="$attempt"\n  export WAI_SHOHIN_ROLE WAI_SHOHIN_MODEL WAI_SHOHIN_ATTEMPT\n  raw="$(_dispatch "$WAI_DAG_EXECUTOR_TYPE" "$pfile" "$dispatch_cwd" -m "$shohin_worker_model")"\n  [ -n "$lane" ] && { _lane_worktree_remove "$root" "$lane"; WAI_DAG_LANE_ACTIVE=""; }\n  rm -f "$pfile"',
    ],
    [
      '  raw="$(_dispatch "$WAI_DAG_EXECUTOR_TYPE" "$pfile" "$root" -m "$(_resolve_model validator)")"\n  rm -f "$pfile"\n  local attempt="${WAI_DAG_ATTEMPT:-1}"',
      '  local attempt="${WAI_DAG_ATTEMPT:-1}" shohin_validator_model\n  shohin_validator_model="$(_resolve_model validator)"\n  WAI_SHOHIN_ROLE=validator WAI_SHOHIN_MODEL="$shohin_validator_model" WAI_SHOHIN_ATTEMPT="$attempt"\n  export WAI_SHOHIN_ROLE WAI_SHOHIN_MODEL WAI_SHOHIN_ATTEMPT\n  raw="$(_dispatch "$WAI_DAG_EXECUTOR_TYPE" "$pfile" "$root" -m "$shohin_validator_model")"\n  rm -f "$pfile"',
    ],
    [
      '  raw="$(_dispatch terminal_reviewer "$pfile" "$root" -m "$(_resolve_model terminal_reviewer)")"\n  rm -f "$pfile"',
      '  local shohin_terminal_model\n  shohin_terminal_model="$(_resolve_model terminal_reviewer)"\n  WAI_SHOHIN_ROLE=terminal WAI_SHOHIN_MODEL="$shohin_terminal_model" WAI_SHOHIN_ATTEMPT="${WAI_DAG_ATTEMPT:-1}"\n  export WAI_SHOHIN_ROLE WAI_SHOHIN_MODEL WAI_SHOHIN_ATTEMPT\n  raw="$(_dispatch terminal_reviewer "$pfile" "$root" -m "$shohin_terminal_model")"\n  rm -f "$pfile"',
    ],
  ];
  for (const [needle, replacement] of replacements) {
    if (!after.includes(needle)) {
      throw new SpikeSupervisorError(
        "patch_not_closed",
        "Reviewed observability patch anchor not found in copied WAI executors",
        { needle: needle.slice(0, 80) },
      );
    }
    after = after.replace(needle, replacement);
    appliedHunks.push({ before: needle, after: replacement });
  }
  const marker = "# Shohin observability patch: role/model/attempt/timing/token/stderr captured by opencode-wrapper.sh";
  after = `${after}\n${marker}\n`;
  appliedHunks.push({ before: "", after: marker });
  writeFileSync(executorsPath, after, "utf-8");
  return {
    diff: makeReplacementDiff(requiredWaiBundleFiles.executors, before, after, appliedHunks),
    filesChanged: [requiredWaiBundleFiles.executors],
    name: "shohin-observability",
  };
};

const hashRequiredBundleFiles = (
  generationDir: string,
): Readonly<Record<RequiredWaiBundleFile, string>> => {
  const hashes = {} as Record<RequiredWaiBundleFile, string>;
  for (const [key, relativePath] of Object.entries(requiredWaiBundleFiles) as Array<
    [RequiredWaiBundleFile, string]
  >) {
    hashes[key] = `sha256:${sha256(readFileSync(path.join(generationDir, relativePath)))}`;
  }
  return hashes;
};

const validateBundleComplete = (generationDir: string): void => {
  for (const relativePath of Object.values(requiredWaiBundleFiles)) {
    const absolutePath = path.join(generationDir, relativePath);
    if (!existsSync(absolutePath) || !statSync(absolutePath).isFile()) {
      throw new SpikeSupervisorError(
        "bundle_incomplete",
        `Copied WAI bundle is missing required file: ${relativePath}`,
        { relativePath },
      );
    }
  }
};

const readRecordedControlEnvironment = (record: SpikeSupervisorRecord): BuiltEnvironment => {
  if (!isStringRecord(record.controlEnv) || Object.keys(record.controlEnv).length === 0) {
    throw new SpikeSupervisorError(
      "record_unavailable",
      `Active run ${record.runId} is missing persisted control environment`,
    );
  }
  const unexpectedKey = Object.keys(record.controlEnv).find(
    (key) => !allowedRecordedControlEnvironment.has(key),
  );
  if (unexpectedKey !== undefined) {
    throw new SpikeSupervisorError(
      "record_unavailable",
      `Active run ${record.runId} has invalid persisted control environment`,
      { key: unexpectedKey },
    );
  }
  try {
    return buildControlEnvironment({ sourceEnv: record.controlEnv });
  } catch (error) {
    throw new SpikeSupervisorError(
      "record_unavailable",
      `Active run ${record.runId} has invalid persisted control environment`,
      { reason: error instanceof Error ? error.message : String(error) },
    );
  }
};

const isStringRecord = (value: unknown): value is Readonly<Record<string, string>> =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  Object.values(value).every((entry) => typeof entry === "string");

const publicErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const waitForScopeExit = async (scopeHandle: ScopedRunHandle): Promise<ScopeWaitResult> => {
  try {
    return await scopeHandle.wait();
  } catch (error) {
    void error;
    return {
      status: 127,
      stderr: "[scope wait rejected before diagnostics could be collected]\n",
      stderrTruncated: false,
    };
  }
};

const scopeLaunchExitRecord = (
  exit: ScopeWaitResult,
  observedAt: string,
): ScopeLaunchExitRecord => ({
  observedAt,
  status: exit.status,
  stderr: exit.stderr,
  stderrTruncated: exit.stderrTruncated,
});

const isScopeLaunchExitRecord = (value: unknown): value is ScopeLaunchExitRecord =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as ScopeLaunchExitRecord).observedAt === "string" &&
  typeof (value as ScopeLaunchExitRecord).status === "number" &&
  typeof (value as ScopeLaunchExitRecord).stderr === "string" &&
  typeof (value as ScopeLaunchExitRecord).stderrTruncated === "boolean";

const runRootForRecord = (record: SpikeSupervisorRecord): string =>
  path.dirname(record.runDir);

const maintenanceKey = (runRoot: string, runId: string): string => `${runRoot}\u0000${runId}`;

const appendJournal = (
  record: SpikeSupervisorRecord,
  clock: SpikeSupervisorClock,
  event: string,
  detail?: Readonly<Record<string, unknown>>,
): JournalEntry[] => [
  ...record.journal,
  {
    at: clock.nowIso(),
    event,
    ...(detail === undefined ? {} : { detail }),
  },
];

const emptyLedger = (capUsd: number, at: string): DurableSpendLedger => ({
  actualUsage: [],
  capUsd,
  refusals: [],
  reservations: [],
  totalActualUsd: 0,
  totalReservedUsd: 0,
  updatedAt: at,
});

const readLedger = (ledgerPath: string, capUsd: number, at: string): DurableSpendLedger => {
  if (!existsSync(ledgerPath)) {
    return emptyLedger(capUsd, at);
  }
  const parsed = JSON.parse(readFileSync(ledgerPath, "utf-8")) as DurableSpendLedger;
  return summarizeLedger({ ...parsed, capUsd: Math.min(parsed.capUsd, capUsd) });
};

const summarizeLedger = (ledger: DurableSpendLedger): DurableSpendLedger => ({
  ...ledger,
  totalActualUsd: roundUsd(
    ledger.actualUsage.reduce((sum, usage) => sum + usage.actualUsd, 0),
  ),
  totalReservedUsd: roundUsd(
    ledger.reservations.reduce((sum, reservation) => sum + reservation.reservedUsd, 0),
  ),
});

const refusalFromError = (
  error: unknown,
  context: {
    readonly at: string;
    readonly capUsd: number;
    readonly runId: string;
    readonly totalReservedUsd: number;
  },
): SpendRefusal => {
  if (error instanceof SpikeSupervisorError) {
    return {
      at: context.at,
      capUsd: context.capUsd,
      code: error.code,
      message: error.message,
      requestedUsd: numberDetail(error.detail.requestedUsd),
      role: costRoleDetail(error.detail.role),
      runId: context.runId,
      totalReservedUsd: context.totalReservedUsd,
    };
  }
  return {
    at: context.at,
    capUsd: context.capUsd,
    code: "budget_oracle_missing",
    message: error instanceof Error ? error.message : String(error),
    requestedUsd: 0,
    role: "worker",
    runId: context.runId,
    totalReservedUsd: context.totalReservedUsd,
  };
};

const assertBoundedRole = (role: CostRole, bound: ModelRoleBound): void => {
  validateIdentifier(bound.model, `${role} model`);
  validateIdentifier(bound.pricing.provider, `${role} provider`);
  validateIdentifier(bound.boundSource, `${role} bound source`);
  validateIdentifier(bound.ceiling.enforcedBy, `${role} ceiling enforcer`);
  validateMoney(bound.pricing.inputUsdPerMillionTokens, `${role} input price`);
  validateMoney(bound.pricing.outputUsdPerMillionTokens, `${role} output price`);
  const maxInputTokens = bound.ceiling.maxInputTokens;
  const maxOutputTokens = bound.ceiling.maxOutputTokens;
  if (
    maxInputTokens === undefined ||
    maxOutputTokens === undefined ||
    !Number.isSafeInteger(maxInputTokens) ||
    !Number.isSafeInteger(maxOutputTokens) ||
    maxInputTokens <= 0 ||
    maxOutputTokens <= 0
  ) {
    throw new SpikeSupervisorError(
      "budget_resource_unbounded",
      `Missing enforceable token ceilings for ${role}`,
      { role },
    );
  }
};

const conservativeUsd = (bound: ModelRoleBound): number =>
  roundUsd(
    (bound.ceiling.maxInputTokens! * bound.pricing.inputUsdPerMillionTokens +
      bound.ceiling.maxOutputTokens! * bound.pricing.outputUsdPerMillionTokens) /
      1_000_000,
  );


const assertModelIds = (modelIds: Partial<ModelIdMap> | undefined): ModelIdMap => {
  const output = {} as Record<CostRole, string>;
  for (const role of costRoles) {
    const model = modelIds?.[role];
    if (model === undefined || model.length === 0) {
      throw new SpikeSupervisorError(
        "budget_role_missing",
        `Missing frozen model id for ${role}`,
        { role },
      );
    }
    validateIdentifier(model, `${role} model`);
    output[role] = model;
  }
  return output;
};

const validateUsage = (usage: SpendUsage): SpendUsage => {
  if (!costRoles.includes(usage.role)) {
    throw new SpikeSupervisorError("budget_role_missing", `Unknown usage role: ${usage.role}`);
  }
  validateIdentifier(usage.model, "usage model");
  validateIdentifier(usage.source, "usage source");
  validateMoney(usage.actualUsd, "actual USD");
  if (!Number.isSafeInteger(usage.totalTokens) || usage.totalTokens < 0) {
    throw new SpikeSupervisorError("invalid_option", "Usage total tokens must be bounded");
  }
  return usage;
};

const withLock = async <T>(
  ledgerPath: string,
  clock: SpikeSupervisorClock,
  work: () => Promise<T>,
): Promise<T> => {
  mkdirSync(path.dirname(ledgerPath), { recursive: true, mode: 0o700 });
  const lockPath = `${ledgerPath}.lock`;
  let fd: number | undefined;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      fd = openSync(lockPath, "wx", 0o600);
      break;
    } catch (error) {
      if (isNodeError(error) && error.code === "EEXIST") {
        await clock.sleep(10);
        continue;
      }
      throw error;
    }
  }
  if (fd === undefined) {
    throw new SpikeSupervisorError("invalid_option", "Timed out acquiring spend ledger lock");
  }
  try {
    return await work();
  } finally {
    closeSync(fd);
    rmSync(lockPath, { force: true });
  }
};

const atomicWriteJson = (filePath: string, value: unknown): void => {
  mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporary = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`,
  );
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf-8",
    flag: "wx",
    mode: 0o600,
  });
  renameSync(temporary, filePath);
};

const listRunIds = (runRoot: string): string[] => {
  if (!existsSync(runRoot)) {
    return [];
  }
  return readdirSync(runRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(path.join(runRoot, entry.name, "run.json")))
    .map((entry) => entry.name)
    .sort();
};

const freezeTree = (root: string): void => {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const child = path.join(root, entry.name);
    if (entry.isDirectory()) {
      freezeTree(child);
      chmodSync(child, 0o555);
    } else if (entry.isFile()) {
      const mode = statSync(child).mode & 0o777;
      chmodSync(child, mode & 0o555);
    }
  }
  chmodSync(root, 0o555);
};

const executablePath = (inputPath: string, label: string): string => {
  const absolute = validateAbsolutePath(inputPath, label);
  assertExecutable(absolute);
  return realpathSync.native(absolute);
};

const assertExecutable = (inputPath: string): void => {
  accessSync(inputPath, constants.X_OK);
};

const ensureAbsoluteDirectory = (inputPath: string, label: string, mode: number): string => {
  const absolute = validateAbsolutePath(inputPath, label);
  mkdirSync(absolute, { recursive: true, mode });
  chmodSync(absolute, mode);
  return realDirectory(absolute, label);
};

const realDirectory = (inputPath: string, label: string): string => {
  const absolute = validateAbsolutePath(inputPath, label);
  const stats = lstatSync(absolute);
  if (!stats.isDirectory()) {
    throw new SpikeSupervisorError("invalid_option", `${label} must be a directory`);
  }
  return realpathSync.native(absolute);
};

const validateAbsolutePath = (inputPath: string, label: string): string => {
  validateArg(inputPath, label);
  const absolute = path.resolve(inputPath);
  if (!path.isAbsolute(inputPath) || absolute !== inputPath) {
    throw new SpikeSupervisorError(
      "invalid_option",
      `${label} must be an absolute normalized path`,
    );
  }
  return absolute;
};

const validateComponent = (value: string, label: string): string => {
  validateArg(value, label);
  if (!componentPattern.test(value) || value === "." || value === "..") {
    throw new SpikeSupervisorError("invalid_option", `Invalid ${label}: ${value}`);
  }
  return value;
};

const validateArg = (value: string, label: string): void => {
  if (value.length === 0 || value.includes("\0")) {
    throw new SpikeSupervisorError("invalid_option", `${label} must be non-empty`);
  }
};

const validateIdentifier = (value: string, label: string): void => {
  validateArg(value, label);
  if (/flat haiku|timeout/i.test(value)) {
    throw new SpikeSupervisorError(
      "budget_resource_unbounded",
      `${label} does not identify a real model/pricing/resource bound`,
    );
  }
};

const validateMoney = (value: number, label: string): void => {
  if (!Number.isFinite(value) || value < 0) {
    throw new SpikeSupervisorError("budget_resource_unbounded", `${label} must be finite`);
  }
};

const ensureContained = (root: string, candidate: string, label: string): void => {
  const relative = path.relative(root, candidate);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new SpikeSupervisorError("invalid_option", `${label} must stay under run root`);
  }
};

const recordPathFor = (runRoot: string, runId: string): string =>
  path.join(runRoot, validateComponent(runId, "run id"), "run.json");

const readRequiredSourceValue = (sourceEnv: SourceEnvironment, key: string): string => {
  const value = sourceEnv[key];
  if (value === undefined || value.length === 0 || value.includes("\0")) {
    throw new SpikeSupervisorError("invalid_option", `Required env value is missing: ${key}`);
  }
  return value;
};

const git = (cwd: string, args: readonly string[]): string =>
  execFileSync("git", [...args], {
    cwd,
    encoding: "utf-8",
    env: { PATH: "/usr/bin:/bin" },
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();

const roundUsd = (value: number): number => Number(value.toFixed(6));

const sha256 = (content: Buffer): string => createHash("sha256").update(content).digest("hex");

const makeReplacementDiff = (
  relativePath: string,
  before: string,
  after: string,
  hunks: readonly { readonly before: string; readonly after: string }[],
): string => {
  const lines = [
    `--- a/${relativePath}`,
    `+++ b/${relativePath}`,
    `@@ file sha256:${sha256(Buffer.from(before))}..sha256:${sha256(Buffer.from(after))}`,
  ];
  hunks.forEach((hunk, index) => {
    lines.push(`@@ shohin-observability-${index + 1}`);
    lines.push(...splitPatchLines(hunk.before).map((line) => `-${line}`));
    lines.push(...splitPatchLines(hunk.after).map((line) => `+${line}`));
  });
  return lines.join("\n");
};

const splitPatchLines = (content: string): string[] => {
  if (content.length === 0) {
    return [];
  }
  const lines = content.split("\n");
  return lines.at(-1) === "" ? lines.slice(0, -1) : lines;
};

const numberDetail = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;

const costRoleDetail = (value: unknown): CostRole =>
  typeof value === "string" && costRoles.includes(value as CostRole)
    ? (value as CostRole)
    : "worker";

const isNodeError = (error: unknown): error is NodeJS.ErrnoException =>
  error instanceof Error && "code" in error;
