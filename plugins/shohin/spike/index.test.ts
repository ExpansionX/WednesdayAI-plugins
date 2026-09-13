import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";
import type {
  GatewayRequestHandler,
  OpenClawPluginApi,
  OpenClawPluginService,
  OpenClawPluginServiceContext,
  PluginLogger,
  RespondFn,
} from "wednesdayai/plugin-sdk";

const supervisorMockState = vi.hoisted(() => {
  class FakeSpikeSupervisorError extends Error {
    public constructor(
      public readonly code: string,
      message: string,
    ) {
      super(message);
      this.name = "SpikeSupervisorError";
    }
  }

  const state = {
    cancelImpl: undefined as undefined | ((runId: string, runRoot?: string) => Promise<unknown>),
    instances: [] as Array<{
      cancel: Mock;
      dispose: Mock;
      recover: Mock;
      start: Mock;
    }>,
    recoverImpl: undefined as undefined | ((options: { runRoot: string }) => Promise<unknown>),
    startImpl: undefined as undefined | ((options: Record<string, unknown>) => Promise<unknown>),
  };

  class FakeSpikeSupervisor {
    public readonly dispose = vi.fn();

    public readonly cancel = vi.fn(async (runId: string, runRoot?: string) => {
      if (state.cancelImpl) {
        return state.cancelImpl(runId, runRoot);
      }
      return { alreadyStopped: false, runId };
    });

    public readonly recover = vi.fn(async (options: { runRoot: string }) => {
      if (state.recoverImpl) {
        return state.recoverImpl(options);
      }
      return {
        ignoredRunIds: [],
        refreshedActiveRunIds: [],
        scheduledTruthRunIds: [],
      };
    });

    public readonly start = vi.fn(async (options: Record<string, unknown>) => {
      if (state.startImpl) {
        return state.startImpl(options);
      }
      return {
        maxAttemptsNote: "bounded fixture",
        record: { runId: options.runId, status: "active" },
        runId: options.runId ?? "run-generated",
        scopeHandle: {
          scopeId: "shohin-shohin-phase-0-spike-run-generated.scope",
          wait: vi.fn(async () => 0),
        },
      };
    });

    public constructor() {
      state.instances.push(this);
    }
  }

  return {
    FakeSpikeSupervisor,
    FakeSpikeSupervisorError,
    state,
  };
});

vi.mock("./src/supervisor.js", () => ({
  SpikeSupervisor: supervisorMockState.FakeSpikeSupervisor,
  SpikeSupervisorError: supervisorMockState.FakeSpikeSupervisorError,
}));

const tempRoots: string[] = [];

type RegisteredApi = {
  readonly api: OpenClawPluginApi;
  readonly logger: PluginLogger & Record<"debug", Mock>;
  readonly methods: Map<string, GatewayRequestHandler>;
  readonly services: OpenClawPluginService[];
};

const makeTempRoot = (name: string): string => {
  const root = mkdtempSync(path.join(os.tmpdir(), `shohin-index-${name}-`));
  tempRoots.push(root);
  return root;
};

const makeGitRepo = (name: string): string => {
  const root = makeTempRoot(name);
  execFileSync("git", ["init", "--quiet"], { cwd: root, stdio: "ignore" });
  return realpathSync.native(root);
};

const makeLogger = (): PluginLogger & Record<"debug", Mock> => ({
  debug: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
});

const makeApi = (pluginConfig: Record<string, unknown> = {}): RegisteredApi => {
  const logger = makeLogger();
  const methods = new Map<string, GatewayRequestHandler>();
  const services: OpenClawPluginService[] = [];
  const api = {
    id: "shohin-spike",
    name: "Shohin Phase 0 Spike",
    source: "fixture",
    config: {},
    pluginConfig,
    runtime: {},
    logger,
    registerChannel: vi.fn(),
    registerCli: vi.fn(),
    registerCommand: vi.fn(),
    registerGatewayMethod: vi.fn((method: string, handler: GatewayRequestHandler) => {
      methods.set(method, handler);
    }),
    registerHook: vi.fn(),
    registerHttpRoute: vi.fn(),
    registerMediaUnderstandingProvider: vi.fn(),
    registerProvider: vi.fn(),
    registerRealtimeVoiceProvider: vi.fn(),
    registerService: vi.fn((service: OpenClawPluginService) => {
      services.push(service);
    }),
    registerTaskPass: vi.fn(),
    registerTool: vi.fn(),
    registerWebSearchProvider: vi.fn(),
    resolvePath: vi.fn((input: string) => input),
  } as unknown as OpenClawPluginApi;

  return { api, logger, methods, services };
};

const serviceContext = (
  stateDir: string,
  logger: PluginLogger = makeLogger(),
): OpenClawPluginServiceContext =>
  ({
    config: {},
    logger,
    stateDir,
  }) as OpenClawPluginServiceContext;

const invoke = async (
  handler: GatewayRequestHandler,
  params: unknown,
): Promise<{
  readonly error: Parameters<RespondFn>[2];
  readonly ok: boolean;
  readonly payload: unknown;
}> => {
  let response:
    | {
        readonly error: Parameters<RespondFn>[2];
        readonly ok: boolean;
        readonly payload: unknown;
      }
    | undefined;
  await handler({
    client: {
      connect: { role: "operator", scopes: ["operator.admin"] },
    } as never,
    context: {} as never,
    isWebchatConnect: () => false,
    params: params as Record<string, unknown>,
    req: { id: "fixture", method: "fixture.method", params } as never,
    respond: (ok, payload, error) => {
      response = { error, ok, payload };
    },
  });
  expect(response, "handler must respond").toBeDefined();
  return response!;
};

const loadPlugin = async () => {
  const mod = await import("./index.js");
  return mod;
};

const registerReadyPlugin = async () => {
  const repoRoot = makeGitRepo("repo");
  const stateDir = makeTempRoot("state");
  const mod = await loadPlugin();
  const registered = makeApi({ repoRoot });
  mod.default.register(registered.api);
  await registered.services[0].start(serviceContext(stateDir));
  return {
    ...registered,
    repoRoot,
    stateDir,
    supervisor: supervisorMockState.state.instances[0],
  };
};

const validRoleBound = (role: string) => ({
  boundSource: `fixture-price-${role}`,
  ceiling: {
    enforcedBy: `fixture-wrapper-${role}`,
    maxInputTokens: 1000,
    maxOutputTokens: 1000,
  },
  model: `fixture-${role}-model`,
  pricing: {
    inputUsdPerMillionTokens: 1,
    outputUsdPerMillionTokens: 2,
    provider: "fixture-provider",
  },
});

const validOptions = (root: string): Record<string, unknown> => ({
  controlEnv: {
    DBUS_SESSION_BUS_ADDRESS: "unix:path=/run/user/1000/bus",
    PATH: "/usr/bin:/bin",
    XDG_RUNTIME_DIR: "/run/user/1000",
  },
  costOracle: {
    capUsd: 50,
    roles: {
      assessor: validRoleBound("assessor"),
      prewarm: validRoleBound("prewarm"),
      terminal: validRoleBound("terminal"),
      validator: validRoleBound("validator"),
      worker: validRoleBound("worker"),
    },
  },
  externalBaseline: "0123456789abcdef0123456789abcdef01234567",
  heartbeatPollIntervalMs: 250,
  heartbeatStaleAfterMs: 5000,
  modelIds: {
    assessor: "fixture-assessor-model",
    prewarm: "fixture-prewarm-model",
    terminal: "fixture-terminal-model",
    validator: "fixture-validator-model",
    worker: "fixture-worker-model",
  },
  runnerTimeoutSec: 30,
  runRoot: path.join(root, "run-data"),
  sourceHome: root,
  waiBundleSourceDir: root,
});

beforeEach(() => {
  vi.resetModules();
  supervisorMockState.state.cancelImpl = undefined;
  supervisorMockState.state.instances.splice(0);
  supervisorMockState.state.recoverImpl = undefined;
  supervisorMockState.state.startImpl = undefined;
});

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("Shohin spike plugin registration", () => {
  it("exports only the default shohin-spike plugin and registers exact synchronous capabilities", async () => {
    const mod = await loadPlugin();
    expect(Object.keys(mod)).toEqual(["default"]);
    expect(mod.default.id).toBe("shohin-spike");

    const registered = makeApi({ repoRoot: "/tmp/not-started" });
    const result = mod.default.register(registered.api);

    expect(result).toBeUndefined();
    expect(registered.services.map((service) => service.id)).toEqual([
      "shohin-spike-supervisor",
    ]);
    expect([...registered.methods.keys()]).toEqual([
      "shohinSpike.run",
      "shohinSpike.cancel",
      "shohinSpike.status",
    ]);
    expect(registered.api.registerTool).not.toHaveBeenCalled();
    expect(registered.api.registerHttpRoute).not.toHaveBeenCalled();
    expect(registered.api.registerCli).not.toHaveBeenCalled();
    expect(registered.api.registerTaskPass).not.toHaveBeenCalled();
    expect(registered.api.registerCommand).not.toHaveBeenCalled();
    expect(registered.api.registerHook).not.toHaveBeenCalled();
    expect(registered.api.registerChannel).not.toHaveBeenCalled();
    expect(registered.api.registerProvider).not.toHaveBeenCalled();
    expect(registered.logger.info).toHaveBeenCalledWith("shohin-spike.register.start");
    expect(registered.logger.info).toHaveBeenCalledWith("shohin-spike.register.complete");
  });

  it("validates configured canonical repoRoot and publishes ready only after bounded phase-1 recovery", async () => {
    const repoRoot = makeGitRepo("canonical");
    const stateDir = makeTempRoot("state");
    const serviceLogger = makeLogger();
    const registered = makeApi({ repoRoot });
    const mod = await loadPlugin();
    mod.default.register(registered.api);

    let releaseRecovery!: () => void;
    supervisorMockState.state.recoverImpl = vi.fn(
      async () =>
        new Promise((resolve) => {
          releaseRecovery = () => {
            resolve({
              ignoredRunIds: ["ignored-run"],
              refreshedActiveRunIds: ["active-run"],
              scheduledTruthRunIds: ["exited-run"],
            });
          };
        }),
    );

    const serviceStart = registered.services[0].start(
      serviceContext(stateDir, serviceLogger),
    );
    await Promise.resolve();

    const recovering = await invoke(registered.methods.get("shohinSpike.status")!, {});
    expect(recovering.ok).toBe(true);
    expect(recovering.payload).toMatchObject({
      id: "shohin-spike",
      service: {
        id: "shohin-spike-supervisor",
        repoRoot,
        status: "recovering",
      },
    });

    releaseRecovery();
    await serviceStart;

    const ready = await invoke(registered.methods.get("shohinSpike.status")!, {});
    expect(ready.ok).toBe(true);
    expect(ready.payload).toMatchObject({
      service: {
        recovery: {
          ignoredRunIds: ["ignored-run"],
          refreshedActiveRunIds: ["active-run"],
          scheduledTruthRunIds: ["exited-run"],
        },
        repoRoot,
        runRoot: path.join(stateDir, "shohin-spike", "run-data"),
        status: "ready",
      },
    });
    expect(supervisorMockState.state.instances).toHaveLength(1);
    expect(supervisorMockState.state.instances[0].recover).toHaveBeenCalledWith({
      runRoot: path.join(stateDir, "shohin-spike", "run-data"),
    });
    expect(supervisorMockState.state.instances[0].start).not.toHaveBeenCalled();
    expect(supervisorMockState.state.instances[0].cancel).not.toHaveBeenCalled();
    expect(serviceLogger.info).toHaveBeenCalledWith("shohin-spike.recovery.phase1.start");
    expect(serviceLogger.info).toHaveBeenCalledWith("shohin-spike.recovery.phase1.ready");
  });


  it("disposes supervisor maintenance on service stop without changing readiness", async () => {
    const ready = await registerReadyPlugin();
    const logger = makeLogger();

    ready.services[0].stop?.(serviceContext(ready.stateDir, logger));

    expect(ready.supervisor.dispose).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith("shohin-spike.service.stop");
    const status = await invoke(ready.methods.get("shohinSpike.status")!, {});
    expect(status.ok).toBe(true);
    expect(status.payload).toMatchObject({ service: { status: "ready" } });
  });

  it("reports service errors and does not swallow malformed closed config", async () => {
    const repoRoot = makeGitRepo("bad-config");
    const stateDir = makeTempRoot("state");
    const registered = makeApi({ repoRoot, unexpected: true });
    const mod = await loadPlugin();
    mod.default.register(registered.api);

    await expect(
      registered.services[0].start(serviceContext(stateDir)),
    ).rejects.toThrow(/unknown shohin-spike config key/i);

    const status = await invoke(registered.methods.get("shohinSpike.status")!, {});
    expect(status.ok).toBe(true);
    expect(status.payload).toMatchObject({
      service: {
        error: {
          message: expect.stringMatching(/unknown shohin-spike config key/i),
        },
        status: "error",
      },
    });
  });

  it("rejects malformed run params, unbounded ceilings and probe flags outside probe mode with SDK errors", async () => {
    const ready = await registerReadyPlugin();
    const run = ready.methods.get("shohinSpike.run")!;
    const root = makeTempRoot("run-options");
    const base = validOptions(root);

    const cases: unknown[] = [
      [],
      { options: base, repoRoot: ready.repoRoot, topic: "../escape" },
      { options: base, repoRoot: "relative", topic: "topic008" },
      {
        options: { ...base, extra: true },
        repoRoot: ready.repoRoot,
        topic: "topic008",
      },
      {
        options: { ...base, runnerTimeoutSec: Number.POSITIVE_INFINITY },
        repoRoot: ready.repoRoot,
        topic: "topic008",
      },
      {
        options: { ...base, probes: { straceExecve: true } },
        repoRoot: ready.repoRoot,
        topic: "topic008",
      },
      {
        options: {
          ...base,
          probeMode: true,
          probes: { straceExecve: true, unknownProbe: true },
        },
        repoRoot: ready.repoRoot,
        topic: "topic008",
      },
      {
        options: {
          ...base,
          costOracle: {
            ...(base.costOracle as Record<string, unknown>),
            roles: {
              ...((base.costOracle as { roles: Record<string, unknown> }).roles),
              worker: {
                ...validRoleBound("worker"),
                ceiling: { enforcedBy: "fixture-wrapper-worker" },
              },
            },
          },
        },
        repoRoot: ready.repoRoot,
        topic: "topic008",
      },
    ];

    for (const params of cases) {
      const response = await invoke(run, params);
      expect(response.ok).toBe(false);
      expect(response.error).toMatchObject({ code: "INVALID_REQUEST" });
    }
    expect(ready.supervisor.start).not.toHaveBeenCalled();
  });


  it("uses the normal 60 second heartbeat stale default when run options omit it", async () => {
    const ready = await registerReadyPlugin();
    const root = makeTempRoot("default-heartbeat");
    const options = validOptions(root);
    delete options.heartbeatStaleAfterMs;

    const response = await invoke(ready.methods.get("shohinSpike.run")!, {
      options,
      repoRoot: ready.repoRoot,
      topic: "topic008",
    });

    expect(response.ok).toBe(true);
    expect(ready.supervisor.start).toHaveBeenCalledTimes(1);
    expect(ready.supervisor.start.mock.calls[0][0]).toMatchObject({
      heartbeatPollIntervalMs: 250,
      heartbeatStaleAfterMs: 60_000,
    });
  });

  it("accepts linked target roots by delegating common-dir identity to the supervisor and never waits for DAG completion", async () => {
    const ready = await registerReadyPlugin();
    const root = makeTempRoot("linked");
    const linkedTarget = path.join(root, "target-worktree");
    mkdirSync(linkedTarget);
    const wait = vi.fn(async () => 0);

    supervisorMockState.state.startImpl = vi.fn(async (options) => ({
      maxAttemptsNote: "bounded fixture",
      record: { runId: options.runId, status: "active" },
      runId: "run008",
      scopeHandle: {
        scopeId: "shohin-topic008-run008.scope",
        wait,
      },
    }));

    const response = await invoke(ready.methods.get("shohinSpike.run")!, {
      options: {
        ...validOptions(root),
        generationId: "generation008",
        probeMode: true,
        probes: {
          disableWatchdog: false,
          recordSetsidDescendant: true,
          straceExecve: true,
        },
        runId: "run008",
      },
      repoRoot: linkedTarget,
      topic: "topic008",
    });

    expect(response.ok).toBe(true);
    expect(response.payload).toMatchObject({
      runId: "run008",
      scopeId: "shohin-topic008-run008.scope",
      status: "accepted",
    });
    expect(ready.supervisor.start).toHaveBeenCalledTimes(1);
    expect(ready.supervisor.start.mock.calls[0][0]).toMatchObject({
      generationId: "generation008",
      probeMode: true,
      probes: {
        disableWatchdog: false,
        recordSetsidDescendant: true,
        straceExecve: true,
      },
      registeredRepoRoot: ready.repoRoot,
      runId: "run008",
      targetRepoRoot: linkedTarget,
      topic: "topic008",
    });
    expect(wait).not.toHaveBeenCalled();
  });

  it("validates status and cancel runId while keeping service readiness distinct from run hints and truth", async () => {
    const ready = await registerReadyPlugin();
    const runRoot = path.join(ready.stateDir, "shohin-spike", "run-data");
    mkdirSync(path.join(runRoot, "run-known"), { recursive: true });
    writeFileSync(
      path.join(runRoot, "run-known", "run.json"),
      JSON.stringify({ runId: "run-known", status: "exited", topic: "topic008" }),
    );

    const badStatus = await invoke(ready.methods.get("shohinSpike.status")!, {
      runId: "../bad",
    });
    expect(badStatus.ok).toBe(false);
    expect(badStatus.error).toMatchObject({ code: "INVALID_REQUEST" });

    const status = await invoke(ready.methods.get("shohinSpike.status")!, {
      runId: "run-known",
    });
    expect(status.ok).toBe(true);
    expect(status.payload).toMatchObject({
      run: {
        hints: { authoritative: false, source: "executor" },
        runId: "run-known",
        status: "exited",
        truth: { authoritative: true, available: false },
      },
      service: { status: "ready" },
    });

    const badCancel = await invoke(ready.methods.get("shohinSpike.cancel")!, {});
    expect(badCancel.ok).toBe(false);
    expect(badCancel.error).toMatchObject({ code: "INVALID_REQUEST" });

    supervisorMockState.state.cancelImpl = vi.fn(async () => {
      throw new supervisorMockState.FakeSpikeSupervisorError(
        "record_unavailable",
        "missing run",
      );
    });
    const cancel = await invoke(ready.methods.get("shohinSpike.cancel")!, {
      runId: "run-missing",
    });
    expect(cancel.ok).toBe(true);
    expect(cancel.payload).toMatchObject({
      alreadyStopped: true,
      runId: "run-missing",
      status: "unknown",
    });
  });
});
