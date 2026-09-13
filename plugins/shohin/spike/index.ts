import { realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ErrorCodes,
  errorShape,
  type GatewayRequestHandler,
  type GatewayRequestHandlerOptions,
  type OpenClawPluginApi,
  type OpenClawPluginServiceContext,
} from "wednesdayai/plugin-sdk";
import manifest from "./openclaw.plugin.json" with { type: "json" };
import {
  resolveRegisteredRepoRoot,
  validateTopic,
  type SourceEnvironment,
} from "./src/environment.js";
import {
  resolveApprovedNoProviderProfile,
} from "./src/profile-registry.js";
import type { ScopeProbeOptions } from "./src/scope.js";
import {
  SpikeSupervisor,
  type CostRole,
  type ModelCostOracle,
  type ModelIdMap,
  type SpikeRecoverResult,
  type SpikePublicRunSnapshot,
  type SpikeStartOptions,
} from "./src/supervisor.js";

const pluginId = "shohin-spike";
const serviceId = "shohin-spike-supervisor";
const methodNames = {
  cancel: "shohinSpike.cancel",
  run: "shohinSpike.run",
  status: "shohinSpike.status",
} as const;
const costRoles = ["worker", "validator", "assessor", "prewarm", "terminal"] as const;
const componentPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const commitPattern = /^[0-9a-f]{40}$/i;
const recoveryPhase1TimeoutMs = 5_000;
const defaultRunnerTimeoutSec = 30 * 60;
const defaultHeartbeatPollIntervalMs = 250;
const defaultHeartbeatStaleAfterMs = 60_000;
const defaultWaiBundleSourceDir = "/home/david/.agents/wai/scripts";

type ServiceReadiness = "recovering" | "ready" | "error";
type ProbeForwarding = {
  readonly probeMode?: true;
  readonly probes?: ScopeProbeOptions;
};
type SupervisorStartInput = SpikeStartOptions & ProbeForwarding;

interface RuntimeState {
  readonly rawPluginConfig: unknown;
  error?: {
    readonly message: string;
  };
  recovery?: SpikeRecoverResult;
  readiness: ServiceReadiness;
  repoRoot?: string;
  runRoot?: string;
  supervisor?: SpikeSupervisor;
}

class RpcInputError extends Error {}

class RpcUnavailableError extends Error {}

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = realpathSync.native(
  path.basename(moduleDir) === "dist" ? path.dirname(moduleDir) : moduleDir,
);

const createState = (rawPluginConfig: unknown): RuntimeState => ({
  rawPluginConfig,
  readiness: "recovering",
});

const plugin = {
  id: manifest.id,
  name: manifest.name,
  description: manifest.description,
  configSchema: manifest.configSchema,

  register(api: OpenClawPluginApi) {
    api.logger.info("shohin-spike.register.start");
    const state = createState(api.pluginConfig ?? {});

    api.registerService({
      id: serviceId,
      start: (ctx) => startService(state, ctx),
      stop: (ctx) => {
        state.supervisor?.dispose();
        ctx.logger.info("shohin-spike.service.stop");
      },
    });
    api.registerGatewayMethod(methodNames.run, createRunHandler(state));
    api.registerGatewayMethod(methodNames.cancel, createCancelHandler(state));
    api.registerGatewayMethod(methodNames.status, createStatusHandler(state));
    api.logger.info("shohin-spike.register.complete");
  },
};

const startService = async (
  state: RuntimeState,
  ctx: OpenClawPluginServiceContext,
): Promise<void> => {
  state.readiness = "recovering";
  state.error = undefined;
  state.recovery = undefined;
  ctx.logger.info("shohin-spike.recovery.phase1.start");
  try {
    const repoRoot = resolveRegisteredRepoRoot(readConfiguredRepoRoot(state.rawPluginConfig));
    const runRoot = path.join(path.resolve(ctx.stateDir), pluginId, "run-data");
    const supervisor = new SpikeSupervisor();
    state.repoRoot = repoRoot;
    state.runRoot = runRoot;
    state.supervisor = supervisor;
    state.recovery = await withTimeout(
      supervisor.recover({ runRoot }),
      recoveryPhase1TimeoutMs,
      "Shohin recovery phase 1 timed out",
    );
    state.readiness = "ready";
    ctx.logger.info("shohin-spike.recovery.phase1.ready");
  } catch (error) {
    state.readiness = "error";
    state.error = { message: publicErrorMessage(error) };
    ctx.logger.error(`shohin-spike.recovery.phase1.error: ${publicErrorMessage(error)}`);
    throw error;
  }
};

const createRunHandler =
  (state: RuntimeState): GatewayRequestHandler =>
  async ({ params, respond }) => {
    await respondFromHandler(respond, async () => {
      const runtime = requireReadyRuntime(state);
      const startOptions = readRunRequest(params, runtime);
      const result = await runtime.supervisor.start(startOptions);
      return {
        id: pluginId,
        maxAttemptsNote: result.maxAttemptsNote,
        runId: result.runId,
        scopeId: result.scopeHandle.scopeId,
        service: serviceSnapshot(state),
        status: "accepted",
      };
    });
  };

const createCancelHandler =
  (state: RuntimeState): GatewayRequestHandler =>
  async ({ params, respond }) => {
    await respondFromHandler(respond, async () => {
      const runtime = requireReadyRuntime(state);
      const request = readCancelRequest(params);
      try {
        const result = await runtime.supervisor.cancel(request.runId, runtime.runRoot);
        return {
          id: pluginId,
          ...result,
          service: serviceSnapshot(state),
          status: result.alreadyStopped ? "stopped" : "cancel_requested",
        };
      } catch (error) {
        if (errorCode(error) === "record_unavailable") {
          return {
            alreadyStopped: true,
            id: pluginId,
            runId: request.runId,
            service: serviceSnapshot(state),
            status: "unknown",
          };
        }
        throw error;
      }
    });
  };

const createStatusHandler =
  (state: RuntimeState): GatewayRequestHandler =>
  async ({ params, respond }) => {
    await respondFromHandler(respond, async () => {
      const request = readStatusRequest(params);
      return {
        id: pluginId,
        service: serviceSnapshot(state),
        ...(request.runId === undefined ? {} : { run: readRunSnapshot(state, request.runId) }),
      };
    });
  };

const respondFromHandler = async (
  respond: GatewayRequestHandlerOptions["respond"],
  work: () => Promise<unknown>,
): Promise<void> => {
  try {
    respond(true, await work());
  } catch (error) {
    respond(
      false,
      undefined,
      errorShape(
        error instanceof RpcUnavailableError ? ErrorCodes.UNAVAILABLE : ErrorCodes.INVALID_REQUEST,
        publicErrorMessage(error),
      ),
    );
  }
};

const readConfiguredRepoRoot = (rawConfig: unknown): string => {
  const config = requirePlainObject(rawConfig, "shohin-spike config");
  assertOnlyKeys(config, ["repoRoot"], "shohin-spike config");
  return readRequiredString(config.repoRoot, "repoRoot");
};

const requireReadyRuntime = (
  state: RuntimeState,
): { readonly repoRoot: string; readonly runRoot: string; readonly supervisor: SpikeSupervisor } => {
  if (state.readiness !== "ready" || !state.repoRoot || !state.runRoot || !state.supervisor) {
    throw new RpcUnavailableError(`Shohin spike service is ${state.readiness}`);
  }
  return {
    repoRoot: state.repoRoot,
    runRoot: state.runRoot,
    supervisor: state.supervisor,
  };
};

const readRunRequest = (
  rawParams: unknown,
  runtime: { readonly repoRoot: string; readonly runRoot: string },
): SupervisorStartInput => {
  const params = requirePlainObject(rawParams, "run params");
  assertOnlyKeys(params, ["options", "repoRoot", "topic"], "run params");
  const topic = validateTopic(readRequiredString(params.topic, "topic"));
  const targetRepoRoot = readAbsolutePath(params.repoRoot, "repoRoot");
  const options = requirePlainObject(params.options, "options");
  assertOnlyKeys(
    options,
    [
      "controlEnv",
      "approvedProfileId",
      "costOracle",
      "externalBaseline",
      "generationId",
      "heartbeatPollIntervalMs",
      "heartbeatStaleAfterMs",
      "maxAttempts",
      "modelIds",
      "opencodeCommand",
      "probeMode",
      "probes",
      "runId",
      "runRoot",
      "runnerTimeoutSec",
      "sourceHome",
      "waiBundleSourceDir",
      "waiRunCommand",
    ],
    "run options",
  );
  const probeForwarding = readProbeForwarding(options);
  const approvedProfileId = readOptionalComponent(options.approvedProfileId, "approvedProfileId");
  const maxAttempts = readOptionalInteger(options.maxAttempts, "maxAttempts", 1, 1, 1);
  const shared = {
    assessorScriptPath: path.join(packageRoot, "scripts", "orchestrator-abort.sh"),
    controlSourceEnv: readControlEnv(options.controlEnv),
    envAllowListPath: path.join(packageRoot, "env.allow"),
    homeAllowListPath: path.join(packageRoot, "home.allow"),
    notifyScriptPath: path.join(packageRoot, "scripts", "notify.sh"),
    opencodeCommand: readOptionalString(options.opencodeCommand, "opencodeCommand", "opencode")!,
    registeredRepoRoot: runtime.repoRoot,
    reportAppendScriptPath: path.join(packageRoot, "scripts", "report-append.sh"),
    runRoot: readOptionalAbsolutePath(options.runRoot, "runRoot", runtime.runRoot),
    topic,
    wrapperScriptPath: path.join(packageRoot, "scripts", "opencode-wrapper.sh"),
    ...probeForwarding,
  } satisfies Partial<SupervisorStartInput> & Pick<
    SupervisorStartInput,
    | "assessorScriptPath"
    | "controlSourceEnv"
    | "envAllowListPath"
    | "homeAllowListPath"
    | "notifyScriptPath"
    | "opencodeCommand"
    | "registeredRepoRoot"
    | "reportAppendScriptPath"
    | "runRoot"
    | "topic"
    | "wrapperScriptPath"
  >;

  if (approvedProfileId !== undefined) {
    rejectNoProviderSubstitutions(options);
    if (probeForwarding.probeMode !== true) {
      throw new RpcInputError("Approved no-provider profiles require explicit probeMode=true");
    }
    const approved = resolveApprovedNoProviderProfile({
      profileId: approvedProfileId,
      request: {
        generationId: readOptionalComponent(options.generationId, "generationId"),
        runId: readOptionalComponent(options.runId, "runId"),
        targetRepoRoot,
        topic,
      },
    });
    return {
      ...shared,
      ...approved,
      runRoot: shared.runRoot,
    };
  }

  return {
    ...shared,
    costOracle: readCostOracle(options.costOracle),
    externalBaseline: readCommit(options.externalBaseline, "externalBaseline"),
    generationId: readOptionalComponent(options.generationId, "generationId"),
    heartbeatPollIntervalMs: readOptionalInteger(
      options.heartbeatPollIntervalMs,
      "heartbeatPollIntervalMs",
      defaultHeartbeatPollIntervalMs,
      1,
      60_000,
    ),
    heartbeatStaleAfterMs: readOptionalInteger(
      options.heartbeatStaleAfterMs,
      "heartbeatStaleAfterMs",
      defaultHeartbeatStaleAfterMs,
      1,
      3_600_000,
    ),
    maxAttempts,
    modelIds: readModelIds(options.modelIds),
    runId: readOptionalComponent(options.runId, "runId"),
    runnerTimeoutSec: readOptionalInteger(
      options.runnerTimeoutSec,
      "runnerTimeoutSec",
      defaultRunnerTimeoutSec,
      1,
      defaultRunnerTimeoutSec,
    ),
    sourceHome: readOptionalAbsolutePath(options.sourceHome, "sourceHome", defaultSourceHome()),
    targetRepoRoot,
    topic,
    waiBundleSourceDir: readOptionalAbsolutePath(
      options.waiBundleSourceDir,
      "waiBundleSourceDir",
      defaultWaiBundleSourceDir,
    ),
    waiRunCommand: readOptionalString(options.waiRunCommand, "waiRunCommand", "bash")!,
    ...probeForwarding,
  };
};

const rejectNoProviderSubstitutions = (options: Record<string, unknown>): void => {
  const forbidden = [
    "controlEnv",
    "costOracle",
    "externalBaseline",
    "heartbeatPollIntervalMs",
    "heartbeatStaleAfterMs",
    "maxAttempts",
    "modelIds",
    "opencodeCommand",
    "probes",
    "runRoot",
    "runnerTimeoutSec",
    "sourceHome",
    "waiBundleSourceDir",
    "waiRunCommand",
  ];
  const present = forbidden.find((key) => options[key] !== undefined);
  if (present !== undefined) {
    throw new RpcInputError(
      `Approved no-provider profile cannot be combined with caller supplied ${present}`,
    );
  }
};

const readStatusRequest = (rawParams: unknown): { readonly runId?: string } => {
  const params = requirePlainObject(rawParams, "status params");
  assertOnlyKeys(params, ["runId"], "status params");
  return { runId: readOptionalComponent(params.runId, "runId") };
};

const readCancelRequest = (rawParams: unknown): { readonly runId: string } => {
  const params = requirePlainObject(rawParams, "cancel params");
  assertOnlyKeys(params, ["runId"], "cancel params");
  return { runId: readRequiredComponent(params.runId, "runId") };
};

const readRunSnapshot = (
  state: RuntimeState,
  runId: string,
): SpikePublicRunSnapshot => {
  if (state.supervisor === undefined || state.runRoot === undefined) {
    return {
      activity: "unknown",
      hints: { authoritative: false, available: false, items: [], source: "executor" },
      runId,
      status: "unknown",
      truth: {
        authoritative: true,
        available: false,
        state: "unavailable",
        updatedAt: new Date().toISOString(),
      },
    };
  }
  return state.supervisor.readRunSnapshot(runId, state.runRoot);
};

const serviceSnapshot = (state: RuntimeState) => ({
  id: serviceId,
  recovery: state.recovery,
  repoRoot: state.repoRoot,
  runRoot: state.runRoot,
  status: state.readiness,
  ...(state.error === undefined ? {} : { error: state.error }),
});

const readProbeForwarding = (options: Record<string, unknown>): ProbeForwarding => {
  const probeMode = readOptionalBoolean(options.probeMode, "probeMode", false);
  const probes = readOptionalProbes(options.probes);
  const hasEnabledProbe = Object.values(probes ?? {}).some((value) => value === true);
  if (hasEnabledProbe && !probeMode) {
    throw new RpcInputError("Probe controls require explicit probeMode=true");
  }
  return {
    ...(probeMode ? { probeMode: true } : {}),
    ...(probes === undefined ? {} : { probes }),
  };
};

const readOptionalProbes = (rawValue: unknown): ScopeProbeOptions | undefined => {
  if (rawValue === undefined) {
    return undefined;
  }
  const probes = requirePlainObject(rawValue, "probes");
  assertOnlyKeys(
    probes,
    ["disableWatchdog", "recordSetsidDescendant", "straceExecve"],
    "probes",
  );
  return {
    disableWatchdog: readOptionalBoolean(probes.disableWatchdog, "disableWatchdog", false),
    recordSetsidDescendant: readOptionalBoolean(
      probes.recordSetsidDescendant,
      "recordSetsidDescendant",
      false,
    ),
    straceExecve: readOptionalBoolean(probes.straceExecve, "straceExecve", false),
  };
};

const readControlEnv = (rawValue: unknown): SourceEnvironment => {
  if (rawValue === undefined) {
    return defaultControlEnv();
  }
  const env = requirePlainObject(rawValue, "controlEnv");
  assertOnlyKeys(env, ["DBUS_SESSION_BUS_ADDRESS", "PATH", "XDG_RUNTIME_DIR"], "controlEnv");
  return {
    DBUS_SESSION_BUS_ADDRESS: readOptionalString(
      env.DBUS_SESSION_BUS_ADDRESS,
      "DBUS_SESSION_BUS_ADDRESS",
      undefined,
    ),
    PATH: readRequiredString(env.PATH, "PATH"),
    XDG_RUNTIME_DIR: readRequiredString(env.XDG_RUNTIME_DIR, "XDG_RUNTIME_DIR"),
  };
};

const defaultControlEnv = (): SourceEnvironment => ({
  DBUS_SESSION_BUS_ADDRESS: readOptionalString(
    process.env.DBUS_SESSION_BUS_ADDRESS,
    "DBUS_SESSION_BUS_ADDRESS",
    undefined,
  ),
  PATH: readRequiredString(process.env.PATH, "PATH"),
  XDG_RUNTIME_DIR: readRequiredString(process.env.XDG_RUNTIME_DIR, "XDG_RUNTIME_DIR"),
});

const defaultSourceHome = (): string => readRequiredString(process.env.HOME, "HOME");

const readModelIds = (rawValue: unknown): ModelIdMap => {
  const raw = requirePlainObject(rawValue, "modelIds");
  assertOnlyKeys(raw, [...costRoles], "modelIds");
  const modelIds = {} as Record<CostRole, string>;
  for (const role of costRoles) {
    modelIds[role] = readRequiredString(raw[role], `${role} modelId`);
  }
  return modelIds;
};

const readCostOracle = (rawValue: unknown): ModelCostOracle => {
  const raw = requirePlainObject(rawValue, "costOracle");
  assertOnlyKeys(raw, ["capUsd", "roles"], "costOracle");
  const rawRoles = requirePlainObject(raw.roles, "costOracle.roles");
  assertOnlyKeys(rawRoles, [...costRoles], "costOracle.roles");
  const roles = {} as Record<CostRole, ModelCostOracle["roles"][CostRole]>;
  for (const role of costRoles) {
    roles[role] = readRoleBound(rawRoles[role], role);
  }
  return {
    capUsd: readFiniteNumber(raw.capUsd, "costOracle.capUsd", 0, 50),
    roles,
  };
};

const readRoleBound = (
  rawValue: unknown,
  role: CostRole,
): Exclude<ModelCostOracle["roles"][CostRole], undefined> => {
  const raw = requirePlainObject(rawValue, `${role} bound`);
  assertOnlyKeys(raw, ["boundSource", "ceiling", "model", "pricing"], `${role} bound`);
  const pricing = requirePlainObject(raw.pricing, `${role} pricing`);
  assertOnlyKeys(
    pricing,
    ["inputUsdPerMillionTokens", "outputUsdPerMillionTokens", "provider"],
    `${role} pricing`,
  );
  const ceiling = requirePlainObject(raw.ceiling, `${role} ceiling`);
  assertOnlyKeys(
    ceiling,
    ["enforcedBy", "maxInputTokens", "maxOutputTokens"],
    `${role} ceiling`,
  );
  return {
    boundSource: readRequiredString(raw.boundSource, `${role} boundSource`),
    ceiling: {
      enforcedBy: readRequiredString(ceiling.enforcedBy, `${role} ceiling.enforcedBy`),
      maxInputTokens: readInteger(ceiling.maxInputTokens, `${role} maxInputTokens`, 1),
      maxOutputTokens: readInteger(ceiling.maxOutputTokens, `${role} maxOutputTokens`, 1),
    },
    model: readRequiredString(raw.model, `${role} model`),
    pricing: {
      inputUsdPerMillionTokens: readFiniteNumber(
        pricing.inputUsdPerMillionTokens,
        `${role} inputUsdPerMillionTokens`,
        0,
      ),
      outputUsdPerMillionTokens: readFiniteNumber(
        pricing.outputUsdPerMillionTokens,
        `${role} outputUsdPerMillionTokens`,
        0,
      ),
      provider: readRequiredString(pricing.provider, `${role} provider`),
    },
  };
};

const requirePlainObject = (value: unknown, label: string): Record<string, unknown> => {
  if (!isPlainObject(value)) {
    throw new RpcInputError(`${label} must be a plain object`);
  }
  return value;
};

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const assertOnlyKeys = (
  value: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
): void => {
  const allowedKeys = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      throw new RpcInputError(`Unknown ${label} key: ${key}`);
    }
  }
};

const readRequiredString = (value: unknown, label: string): string => {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0")) {
    throw new RpcInputError(`${label} must be a non-empty string`);
  }
  return value;
};

const readOptionalString = (
  value: unknown,
  label: string,
  fallback: string | undefined,
): string | undefined => {
  if (value === undefined) {
    return fallback;
  }
  return readRequiredString(value, label);
};

const readAbsolutePath = (value: unknown, label: string): string =>
  assertAbsoluteNormalized(readRequiredString(value, label), label);

const readOptionalAbsolutePath = (
  value: unknown,
  label: string,
  fallback: string,
): string => assertAbsoluteNormalized(readOptionalString(value, label, fallback)!, label);

const assertAbsoluteNormalized = (value: string, label: string): string => {
  if (!path.isAbsolute(value) || path.resolve(value) !== value) {
    throw new RpcInputError(`${label} must be an absolute normalized path`);
  }
  return value;
};

const readRequiredComponent = (value: unknown, label: string): string =>
  validateComponent(readRequiredString(value, label), label);

const readOptionalComponent = (value: unknown, label: string): string | undefined =>
  value === undefined ? undefined : readRequiredComponent(value, label);

const validateComponent = (value: string, label: string): string => {
  if (!componentPattern.test(value) || value === "." || value === "..") {
    throw new RpcInputError(`Invalid ${label}: ${value}`);
  }
  return value;
};

const readCommit = (value: unknown, label: string): string => {
  const commit = readRequiredString(value, label).toLowerCase();
  if (!commitPattern.test(commit)) {
    throw new RpcInputError(`${label} must be a 40-character commit SHA`);
  }
  return commit;
};

const readOptionalInteger = (
  value: unknown,
  label: string,
  fallback: number,
  min: number,
  max: number,
): number => {
  if (value === undefined) {
    return fallback;
  }
  const integer = readInteger(value, label, min);
  if (integer > max) {
    throw new RpcInputError(`${label} must be <= ${max}`);
  }
  return integer;
};

const readInteger = (value: unknown, label: string, min: number): number => {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min) {
    throw new RpcInputError(`${label} must be a finite integer >= ${min}`);
  }
  return value;
};

const readFiniteNumber = (
  value: unknown,
  label: string,
  min: number,
  max = Number.POSITIVE_INFINITY,
): number => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    throw new RpcInputError(`${label} must be a finite number`);
  }
  return value;
};

const readOptionalBoolean = (
  value: unknown,
  label: string,
  fallback: boolean,
): boolean => {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== "boolean") {
    throw new RpcInputError(`${label} must be boolean`);
  }
  return value;
};

const withTimeout = async <T>(
  work: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> => {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new RpcUnavailableError(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
};

const publicErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const errorCode = (error: unknown): string | undefined =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  typeof (error as { readonly code?: unknown }).code === "string"
    ? (error as { readonly code: string }).code
    : undefined;

export default plugin;
