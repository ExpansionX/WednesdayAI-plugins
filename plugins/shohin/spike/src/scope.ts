import { execFile as execFileCallback, spawn as spawnChild } from "node:child_process";
import { accessSync, constants, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { setTimeout as sleepTimeout } from "node:timers/promises";

export type ScopeSignal = "SIGTERM" | "SIGKILL";

export type ScopeErrorCode =
  | "cgroup_kill_unavailable"
  | "command_failed"
  | "forbidden_control_environment"
  | "forbidden_executor_environment"
  | "invalid_scope_option"
  | "invalid_scope_id"
  | "process_identity_mismatch"
  | "probe_option_requires_probe_mode"
  | "scope_id_mismatch"
  | "strace_unavailable";

export class ScopeControllerError extends Error {
  public constructor(
    public readonly code: ScopeErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ScopeControllerError";
  }
}

export interface CommandOutput {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface CommandExecutionOptions {
  readonly env: Readonly<Record<string, string>>;
  readonly cwd?: string;
}

export interface SpawnedCommand {
  readonly pid: number;
  wait(): Promise<number>;
}

export interface CommandAdapter {
  spawn(
    command: string,
    argv: readonly string[],
    options: CommandExecutionOptions,
  ): SpawnedCommand;
  execFile(
    command: string,
    argv: readonly string[],
    options: CommandExecutionOptions,
  ): Promise<CommandOutput>;
}

export interface ScopeFilesystem {
  readTextFile(filePath: string): string;
  writeTextFile(filePath: string, content: string): void;
  isWritableFile(filePath: string): boolean;
}

export interface ScopeClock {
  sleep(ms: number): Promise<void>;
}

export interface ScopeProcessAdapter {
  signal(pid: number, signal: ScopeSignal): void;
  isRunning(pid: number): boolean;
}

export interface ScopeHeartbeatOptions {
  readonly path: string;
  readonly pollIntervalMs: number;
  readonly staleAfterMs: number;
}

export interface ScopeProbeOptions {
  readonly disableWatchdog?: boolean;
  readonly recordSetsidDescendant?: boolean;
  readonly straceExecve?: boolean;
}

export interface ScopeLaunchOptions {
  readonly controlEnv: Readonly<Record<string, string>>;
  readonly cwd?: string;
  readonly executorEnv: Readonly<Record<string, string>>;
  readonly heartbeat: ScopeHeartbeatOptions;
  readonly killAfterMs: number;
  readonly probeMode?: boolean;
  readonly probes?: ScopeProbeOptions;
  readonly runDir: string;
  readonly runId: string;
  readonly runner: readonly string[];
  readonly runtimeMaxSec: number;
  readonly topic: string;
}

export interface ScopeCancelHandle {
  readonly controlEnv: Readonly<Record<string, string>>;
  readonly controlPid: number;
  readonly controlStartTime: string;
  readonly scopeId: string;
}

export interface ScopedRunHandle extends ScopeCancelHandle {
  readonly argv: readonly string[];
  readonly command: string;
  wait(): Promise<number>;
}

export interface ScopeCancelOptions {
  readonly killAfterMs?: number;
  readonly pollIntervalMs?: number;
}

export interface ScopeCancelResult {
  readonly sentKill: boolean;
  readonly sentTerm: boolean;
}

export interface ScopeIdentity {
  readonly controlGroup?: string;
  readonly id: string;
  readonly loadState?: string;
  readonly mainPid?: number;
  readonly subState?: string;
}

export interface ScopeController {
  launch(options: ScopeLaunchOptions): Promise<ScopedRunHandle>;
  inspect(
    scopeId: string,
    controlEnv: Readonly<Record<string, string>>,
  ): Promise<ScopeIdentity>;
  cancel(
    handle: ScopeCancelHandle,
    options?: ScopeCancelOptions,
  ): Promise<ScopeCancelResult>;
}

export interface ScopeControllerDependencies {
  readonly clock?: ScopeClock;
  readonly command?: CommandAdapter;
  readonly envCommand?: string;
  readonly filesystem?: ScopeFilesystem;
  readonly process?: ScopeProcessAdapter;
  readonly systemctlCommand?: string;
  readonly systemdRunCommand?: string;
  readonly watchdogPath?: string;
}

export interface WriteOwnCgroupKillOptions {
  readonly filesystem?: ScopeFilesystem;
  readonly procSelfCgroupPath?: string;
  readonly sysFsCgroupRoot?: string;
}

const componentPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const environmentNamePattern = /^[A-Z_][A-Z0-9_]*$/;
const controlEnvironmentOrder = [
  "PATH",
  "XDG_RUNTIME_DIR",
  "DBUS_SESSION_BUS_ADDRESS",
] as const;
const allowedControlEnvironment = new Set<string>(controlEnvironmentOrder);
const defaultCancelKillAfterMs = 2_000;
const defaultCancelPollIntervalMs = 50;
const maxRuntimeMaxSec = 30 * 60;
const maxCancelKillAfterMs = 30_000;

const signalExitStatus = (signal: NodeJS.Signals | null): number => {
  switch (signal) {
    case "SIGHUP":
      return 129;
    case "SIGINT":
      return 130;
    case "SIGTERM":
      return 143;
    case "SIGKILL":
      return 137;
    default:
      return 128;
  }
};

const nodeCommandAdapter: CommandAdapter = {
  spawn(command, argv, options) {
    const child = spawnChild(command, [...argv], {
      cwd: options.cwd,
      env: { ...options.env },
      shell: false,
      stdio: "ignore",
    });
    if (child.pid === undefined) {
      throw new ScopeControllerError(
        "command_failed",
        `Failed to spawn ${command}: missing child pid`,
      );
    }
    const wait = new Promise<number>((resolve) => {
      child.once("error", () => resolve(127));
      child.once("close", (code, signal) => {
        resolve(code ?? signalExitStatus(signal));
      });
    });
    return {
      pid: child.pid,
      wait: () => wait,
    };
  },
  execFile(command, argv, options) {
    return new Promise<CommandOutput>((resolve) => {
      execFileCallback(
        command,
        [...argv],
        {
          cwd: options.cwd,
          encoding: "utf-8",
          env: { ...options.env },
          windowsHide: true,
        },
        (error, stdout, stderr) => {
          const code =
            error === null
              ? 0
              : typeof error.code === "number"
                ? error.code
                : 127;
          resolve({
            status: code,
            stdout: String(stdout),
            stderr: String(stderr),
          });
        },
      );
    });
  },
};

const nodeFilesystem: ScopeFilesystem = {
  readTextFile(filePath) {
    return readFileSync(filePath, "utf-8");
  },
  writeTextFile(filePath, content) {
    writeFileSync(filePath, content, { encoding: "utf-8", flag: "w" });
  },
  isWritableFile(filePath) {
    try {
      accessSync(filePath, constants.W_OK);
      return true;
    } catch {
      return false;
    }
  },
};

const nodeClock: ScopeClock = {
  sleep(ms) {
    return sleepTimeout(ms);
  },
};

const nodeProcessAdapter: ScopeProcessAdapter = {
  signal(pid, signal) {
    process.kill(pid, signal);
  },
  isRunning(pid) {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  },
};

export const buildScopeId = ({
  runId,
  topic,
}: {
  readonly runId: string;
  readonly topic: string;
}): string => {
  assertComponent(topic, "topic");
  assertComponent(runId, "run id");
  const scopeId = `shohin-${topic}-${runId}.scope`;
  assertScopeId(scopeId);
  return scopeId;
};

export const deriveUnifiedCgroupKillPath = (
  procSelfCgroup: string,
  sysFsCgroupRoot = "/sys/fs/cgroup",
): string => {
  const root = validateAbsoluteNormalizedPath(sysFsCgroupRoot, "cgroup root");
  const unifiedLine = procSelfCgroup
    .split(/\r?\n/)
    .find((line) => line.startsWith("0::/"));
  if (unifiedLine === undefined) {
    throw failClosedCgroup("unified cgroup-v2 entry missing");
  }

  const cgroupPath = unifiedLine.slice("0::".length);
  if (cgroupPath.length === 0 || !cgroupPath.startsWith("/")) {
    throw failClosedCgroup("invalid unified cgroup-v2 path");
  }
  if (cgroupPath.includes("\0") || cgroupPath.split("/").includes("..")) {
    throw failClosedCgroup("unsafe unified cgroup-v2 path");
  }

  return path.join(root, cgroupPath.slice(1), "cgroup.kill");
};

export const writeOwnCgroupKill = ({
  filesystem = nodeFilesystem,
  procSelfCgroupPath = "/proc/self/cgroup",
  sysFsCgroupRoot = "/sys/fs/cgroup",
}: WriteOwnCgroupKillOptions): string => {
  const killPath = deriveUnifiedCgroupKillPath(
    filesystem.readTextFile(procSelfCgroupPath),
    sysFsCgroupRoot,
  );
  if (!filesystem.isWritableFile(killPath)) {
    throw failClosedCgroup(`not writable: ${killPath}`);
  }
  filesystem.writeTextFile(killPath, "1\n");
  return killPath;
};

export const readProcessStartTime = (
  filesystem: ScopeFilesystem,
  pid: number,
): string => parseProcStatStartTime(filesystem.readTextFile(`/proc/${pid}/stat`));

export const createScopeController = ({
  clock = nodeClock,
  command = nodeCommandAdapter,
  envCommand = "env",
  filesystem = nodeFilesystem,
  process: processAdapter = nodeProcessAdapter,
  systemctlCommand = "systemctl",
  systemdRunCommand = "systemd-run",
  watchdogPath = path.resolve(import.meta.dirname, "..", "scripts", "watchdog.sh"),
}: ScopeControllerDependencies = {}): ScopeController => {
  const launch = async (
    options: ScopeLaunchOptions,
  ): Promise<ScopedRunHandle> => {
    const spec = await buildLaunchSpec(options, {
      command,
      envCommand,
      systemdRunCommand,
      watchdogPath,
    });
    const spawned = command.spawn(spec.command, spec.argv, {
      cwd: options.cwd,
      env: spec.controlEnv,
    });
    const controlStartTime = readProcessStartTime(filesystem, spawned.pid);
    return {
      argv: spec.argv,
      command: spec.command,
      controlEnv: spec.controlEnv,
      controlPid: spawned.pid,
      controlStartTime,
      scopeId: spec.scopeId,
      wait: () => spawned.wait(),
    };
  };

  const inspect = async (
    scopeId: string,
    controlEnv: Readonly<Record<string, string>>,
  ): Promise<ScopeIdentity> => inspectScope(scopeId, controlEnv, command, systemctlCommand);

  const cancel = async (
    handle: ScopeCancelHandle,
    options: ScopeCancelOptions = {},
  ): Promise<ScopeCancelResult> => {
    assertScopeId(handle.scopeId);
    const controlEnv = assertControlEnvironment(handle.controlEnv);
    await inspectScope(handle.scopeId, controlEnv, command, systemctlCommand);
    const currentStartTime = readProcessStartTime(filesystem, handle.controlPid);
    if (currentStartTime !== handle.controlStartTime) {
      throw new ScopeControllerError(
        "process_identity_mismatch",
        `Refusing to signal PID ${handle.controlPid}: start time changed`,
      );
    }

    const killAfterMs = validateIntegerRange(
      options.killAfterMs ?? defaultCancelKillAfterMs,
      "cancel killAfterMs",
      1,
      maxCancelKillAfterMs,
    );
    const pollIntervalMs = validateIntegerRange(
      options.pollIntervalMs ?? defaultCancelPollIntervalMs,
      "cancel pollIntervalMs",
      1,
      killAfterMs,
    );

    processAdapter.signal(handle.controlPid, "SIGTERM");
    let elapsedMs = 0;
    while (elapsedMs < killAfterMs) {
      if (!processAdapter.isRunning(handle.controlPid)) {
        return { sentKill: false, sentTerm: true };
      }
      const sleepMs = Math.min(pollIntervalMs, killAfterMs - elapsedMs);
      await clock.sleep(sleepMs);
      elapsedMs += sleepMs;
    }

    if (processAdapter.isRunning(handle.controlPid)) {
      processAdapter.signal(handle.controlPid, "SIGKILL");
      return { sentKill: true, sentTerm: true };
    }
    return { sentKill: false, sentTerm: true };
  };

  return { cancel, inspect, launch };
};

const buildLaunchSpec = async (
  options: ScopeLaunchOptions,
  dependencies: {
    readonly command: CommandAdapter;
    readonly envCommand: string;
    readonly systemdRunCommand: string;
    readonly watchdogPath: string;
  },
): Promise<{
  readonly argv: readonly string[];
  readonly command: string;
  readonly controlEnv: Readonly<Record<string, string>>;
  readonly scopeId: string;
}> => {
  const scopeId = buildScopeId({ runId: options.runId, topic: options.topic });
  const controlEnv = assertControlEnvironment(options.controlEnv);
  const executorEnv = assertExecutorEnvironment(options.executorEnv);
  const runDir = validateAbsoluteNormalizedPath(options.runDir, "run directory");
  const heartbeatPath = validateAbsoluteNormalizedPath(
    options.heartbeat.path,
    "heartbeat path",
  );
  ensureInside(runDir, heartbeatPath, "heartbeat path");
  const watchdog = validateAbsoluteNormalizedPath(
    dependencies.watchdogPath,
    "watchdog path",
  );
  const runtimeMaxSec = validateIntegerRange(
    options.runtimeMaxSec,
    "RuntimeMaxSec",
    1,
    maxRuntimeMaxSec,
  );
  const timeoutStopSec = Math.ceil(
    validateIntegerRange(options.killAfterMs, "killAfterMs", 1, maxCancelKillAfterMs) /
      1_000,
  );
  const staleAfterMs = validateIntegerRange(
    options.heartbeat.staleAfterMs,
    "heartbeat staleAfterMs",
    1,
    Number.MAX_SAFE_INTEGER,
  );
  const pollIntervalMs = validateIntegerRange(
    options.heartbeat.pollIntervalMs,
    "heartbeat pollIntervalMs",
    1,
    staleAfterMs,
  );
  const runner = validateArgv(options.runner, "runner");
  const probes = options.probes ?? {};
  assertProbeMode(options.probeMode === true, probes);

  if (probes.straceExecve === true) {
    const strace = await dependencies.command.execFile("strace", ["-V"], {
      cwd: options.cwd,
      env: controlEnv,
    });
    if (strace.status !== 0) {
      throw new ScopeControllerError(
        "strace_unavailable",
        "strace is unavailable for the explicit execve inventory probe",
      );
    }
  }

  const watchdogArgv = [
    "--scope-id",
    scopeId,
    "--run-dir",
    runDir,
    "--heartbeat",
    heartbeatPath,
    "--heartbeat-stale-ms",
    String(staleAfterMs),
    "--heartbeat-poll-ms",
    String(pollIntervalMs),
    ...(options.probeMode === true ? ["--probe-mode"] : []),
    ...(probes.straceExecve === true ? ["--strace-execve"] : []),
    ...(probes.recordSetsidDescendant === true
      ? ["--record-setsid-descendant"]
      : []),
    ...(probes.disableWatchdog === true ? ["--disable-watchdog"] : []),
    "--",
    ...runner,
  ];

  const argv = [
    "--user",
    "--scope",
    "--unit",
    scopeId,
    "--property",
    `RuntimeMaxSec=${runtimeMaxSec}s`,
    "--property",
    `TimeoutStopSec=${timeoutStopSec}s`,
    "--property",
    "KillMode=mixed",
    "--property",
    "SendSIGKILL=yes",
    "--collect",
    "--",
    dependencies.envCommand,
    "-i",
    ...serializeExecutorEnvironment(executorEnv),
    watchdog,
    ...watchdogArgv,
  ];

  return {
    argv,
    command: dependencies.systemdRunCommand,
    controlEnv,
    scopeId,
  };
};

const inspectScope = async (
  scopeId: string,
  controlEnvInput: Readonly<Record<string, string>>,
  command: CommandAdapter,
  systemctlCommand: string,
): Promise<ScopeIdentity> => {
  assertScopeId(scopeId);
  const controlEnv = assertControlEnvironment(controlEnvInput);
  const output = await command.execFile(
    systemctlCommand,
    [
      "--user",
      "show",
      scopeId,
      "--property=Id",
      "--property=MainPID",
      "--property=ControlGroup",
      "--property=SubState",
      "--property=LoadState",
      "--no-pager",
    ],
    { env: controlEnv },
  );
  if (output.status !== 0) {
    throw new ScopeControllerError(
      "command_failed",
      `systemctl show failed for ${scopeId}: ${output.stderr.trim()}`,
    );
  }

  const properties = parseSystemctlProperties(output.stdout);
  if (properties.Id !== scopeId) {
    throw new ScopeControllerError(
      "scope_id_mismatch",
      `systemctl Id mismatch: expected ${scopeId}, got ${properties.Id ?? "<missing>"}`,
    );
  }

  return {
    controlGroup: properties.ControlGroup,
    id: properties.Id,
    loadState: properties.LoadState,
    mainPid: parseOptionalPositiveInteger(properties.MainPID),
    subState: properties.SubState,
  };
};

const assertProbeMode = (
  probeMode: boolean,
  probes: ScopeProbeOptions,
): void => {
  if (
    !probeMode &&
    (probes.disableWatchdog === true ||
      probes.recordSetsidDescendant === true ||
      probes.straceExecve === true)
  ) {
    throw new ScopeControllerError(
      "probe_option_requires_probe_mode",
      "Probe-only scope controls require explicit probe mode",
    );
  }
};

const assertControlEnvironment = (
  env: Readonly<Record<string, string>>,
): Record<string, string> => {
  const output: Record<string, string> = {};
  for (const key of Object.keys(env)) {
    assertEnvironmentName(key, "control environment");
    if (!allowedControlEnvironment.has(key) || isCredentialEnvironmentName(key)) {
      throw new ScopeControllerError(
        "forbidden_control_environment",
        `Forbidden control environment variable: ${key}`,
      );
    }
    assertEnvironmentValue(key, env[key]);
  }
  for (const key of ["PATH", "XDG_RUNTIME_DIR"] as const) {
    if (env[key] === undefined) {
      throw new ScopeControllerError(
        "forbidden_control_environment",
        `Required control environment variable is missing: ${key}`,
      );
    }
  }

  output.PATH = env.PATH;
  output.XDG_RUNTIME_DIR = validateAbsoluteNormalizedPath(
    env.XDG_RUNTIME_DIR,
    "XDG_RUNTIME_DIR",
  );
  if (env.DBUS_SESSION_BUS_ADDRESS !== undefined) {
    output.DBUS_SESSION_BUS_ADDRESS = validateDbusAddress(
      env.DBUS_SESSION_BUS_ADDRESS,
      output.XDG_RUNTIME_DIR,
    );
  }
  return output;
};

const assertExecutorEnvironment = (
  env: Readonly<Record<string, string>>,
): Record<string, string> => {
  const output: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    assertEnvironmentName(key, "executor environment");
    if (isBusEnvironmentName(key) || isCredentialEnvironmentName(key)) {
      throw new ScopeControllerError(
        "forbidden_executor_environment",
        `Forbidden executor environment variable: ${key}`,
      );
    }
    assertEnvironmentValue(key, value);
    output[key] = value;
  }
  for (const key of ["PATH", "HOME", "TMPDIR"] as const) {
    if (output[key] === undefined) {
      throw new ScopeControllerError(
        "forbidden_executor_environment",
        `Required executor environment variable is missing: ${key}`,
      );
    }
  }
  output.HOME = validateAbsoluteNormalizedPath(output.HOME, "executor HOME");
  output.TMPDIR = validateAbsoluteNormalizedPath(output.TMPDIR, "executor TMPDIR");
  return output;
};

const serializeExecutorEnvironment = (
  env: Readonly<Record<string, string>>,
): string[] => {
  const keys = [
    "PATH",
    "HOME",
    "TMPDIR",
    ...Object.keys(env)
      .filter((key) => key !== "PATH" && key !== "HOME" && key !== "TMPDIR")
      .sort(),
  ];
  return keys.map((key) => `${key}=${env[key]}`);
};

const parseSystemctlProperties = (stdout: string): Record<string, string> => {
  const properties: Record<string, string> = {};
  for (const line of stdout.split(/\r?\n/)) {
    if (line.length === 0) {
      continue;
    }
    const separator = line.indexOf("=");
    if (separator <= 0) {
      continue;
    }
    properties[line.slice(0, separator)] = line.slice(separator + 1);
  }
  return properties;
};

const parseOptionalPositiveInteger = (value: string | undefined): number | undefined => {
  if (value === undefined || value === "" || value === "0") {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
};

const parseProcStatStartTime = (stat: string): string => {
  const commandEnd = stat.lastIndexOf(") ");
  if (commandEnd < 0) {
    throw new ScopeControllerError(
      "process_identity_mismatch",
      "Cannot parse process start time from /proc stat",
    );
  }
  const rest = stat.slice(commandEnd + 2).trim().split(/\s+/);
  const startTime = rest[19];
  if (startTime === undefined || !/^[0-9]+$/.test(startTime)) {
    throw new ScopeControllerError(
      "process_identity_mismatch",
      "Cannot parse process start time from /proc stat",
    );
  }
  return startTime;
};

const validateArgv = (argv: readonly string[], label: string): string[] => {
  if (argv.length === 0) {
    throw new ScopeControllerError("invalid_scope_option", `${label} argv is empty`);
  }
  return argv.map((arg, index) => {
    if (arg.length === 0 || arg.includes("\0")) {
      throw new ScopeControllerError(
        "invalid_scope_option",
        `${label} argv contains an invalid argument at index ${index}`,
      );
    }
    return arg;
  });
};

const validateIntegerRange = (
  value: number,
  label: string,
  min: number,
  max: number,
): number => {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new ScopeControllerError(
      "invalid_scope_option",
      `${label} must be an integer from ${min} through ${max}`,
    );
  }
  return value;
};

const assertComponent = (value: string, label: string): void => {
  if (!componentPattern.test(value) || value === "." || value === "..") {
    throw new ScopeControllerError("invalid_scope_id", `Invalid scope ${label}: ${value}`);
  }
};

const assertScopeId = (scopeId: string): void => {
  if (
    scopeId.length > 255 ||
    !scopeId.startsWith("shohin-") ||
    !scopeId.endsWith(".scope") ||
    scopeId.includes("/") ||
    scopeId.includes("\\") ||
    scopeId.includes("\0") ||
    /\s/.test(scopeId)
  ) {
    throw new ScopeControllerError(
      "invalid_scope_id",
      `Invalid full systemd scope Id: ${scopeId}`,
    );
  }
};

const validateAbsoluteNormalizedPath = (value: string, label: string): string => {
  if (
    value.length === 0 ||
    value.includes("\0") ||
    !path.isAbsolute(value) ||
    path.resolve(value) !== value
  ) {
    throw new ScopeControllerError(
      "invalid_scope_option",
      `${label} must be an absolute normalized path`,
    );
  }
  return value;
};

const ensureInside = (root: string, candidate: string, label: string): void => {
  const relative = path.relative(root, candidate);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new ScopeControllerError(
      "invalid_scope_option",
      `${label} must stay inside the run directory`,
    );
  }
};

const assertEnvironmentName = (key: string, label: string): void => {
  if (!environmentNamePattern.test(key)) {
    throw new ScopeControllerError(
      "invalid_scope_option",
      `${label} contains an invalid environment variable name: ${key}`,
    );
  }
};

const assertEnvironmentValue = (key: string, value: string): void => {
  if (value.includes("\0")) {
    throw new ScopeControllerError(
      "invalid_scope_option",
      `Environment variable contains a NUL byte: ${key}`,
    );
  }
};

const validateDbusAddress = (address: string, runtimeDir: string): string => {
  const prefix = "unix:path=";
  if (!address.startsWith(prefix) || address.includes(",")) {
    throw new ScopeControllerError(
      "forbidden_control_environment",
      "DBUS_SESSION_BUS_ADDRESS must be a single unix:path value",
    );
  }
  const busPath = validateAbsoluteNormalizedPath(
    address.slice(prefix.length),
    "DBUS_SESSION_BUS_ADDRESS",
  );
  const relative = path.relative(runtimeDir, busPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new ScopeControllerError(
      "forbidden_control_environment",
      "DBUS_SESSION_BUS_ADDRESS must stay under XDG_RUNTIME_DIR",
    );
  }
  return `${prefix}${busPath}`;
};

const isBusEnvironmentName = (key: string): boolean => {
  const upperKey = key.toUpperCase();
  return upperKey === "XDG_RUNTIME_DIR" || upperKey.startsWith("DBUS_");
};

const isCredentialEnvironmentName = (key: string): boolean => {
  const upperKey = key.toUpperCase();
  return (
    upperKey.startsWith("SSH_") ||
    upperKey.startsWith("GIT_") ||
    upperKey.startsWith("GH_") ||
    upperKey.startsWith("GITHUB_") ||
    upperKey.startsWith("OPENCLAW_GATEWAY") ||
    upperKey.includes("TOKEN") ||
    upperKey.includes("SECRET") ||
    upperKey.includes("PASSWORD") ||
    upperKey.includes("PASSWD") ||
    upperKey.includes("CREDENTIAL") ||
    upperKey.includes("PRIVATE_KEY") ||
    upperKey.includes("API_KEY") ||
    upperKey.endsWith("_KEY") ||
    upperKey.includes("AUTH")
  );
};

const failClosedCgroup = (reason: string): ScopeControllerError =>
  new ScopeControllerError(
    "cgroup_kill_unavailable",
    `cgroup.kill unavailable; fail-closed: ${reason}`,
  );
