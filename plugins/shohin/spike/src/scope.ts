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
  | "process_identity_unavailable"
  | "probe_option_requires_probe_mode"
  | "scope_id_mismatch"
  | "scope_identity_mismatch"
  | "scope_identity_unverified"
  | "scope_membership_unavailable"
  | "scope_state_unknown"
  | "scope_stop_timeout"
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
  wait(): Promise<ScopeWaitResult>;
}

export interface ScopeWaitResult {
  readonly status: number;
  readonly stderr: string;
  readonly stderrTruncated: boolean;
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
  readonly identity?: ScopeIdentity;
  readonly scopeId: string;
}

export interface ScopedRunHandle extends ScopeCancelHandle {
  readonly argv: readonly string[];
  readonly command: string;
  wait(): Promise<ScopeWaitResult>;
}

export interface ScopeCancelOptions {
  readonly killAfterMs?: number;
  readonly pollIntervalMs?: number;
}

export interface ScopeCancelResult {
  readonly sentKill: boolean;
  readonly sentTerm: boolean;
}

export type ScopeCgroupMembership = "absent" | "empty" | "populated";

export interface ScopeIdentity {
  readonly cgroupEventsPath?: string;
  readonly cgroupMembership?: ScopeCgroupMembership;
  readonly cgroupMembershipControlGroup?: string;
  readonly controlGroup?: string;
  readonly id: string;
  readonly invocationId?: string;
  readonly loadState?: string;
  readonly mainPid?: number;
  readonly subState?: string;
}

export interface ScopeController {
  launch(options: ScopeLaunchOptions): Promise<ScopedRunHandle>;
  inspect(
    scopeId: string,
    controlEnv: Readonly<Record<string, string>>,
    recordedIdentity?: ScopeIdentity,
  ): Promise<ScopeIdentity>;
  cancel(
    handle: ScopeCancelHandle,
    options?: ScopeCancelOptions,
  ): Promise<ScopeCancelResult>;
}

export interface ScopeControllerDependencies {
  readonly cgroupRoot?: string;
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
const activeScopeSubStates = new Set([
  "abandoned",
  "running",
  "start-chown",
  "stop-sigkill",
  "stop-sigterm",
]);
const terminalScopeSubStates = new Set(["dead", "failed"]);
const defaultCancelKillAfterMs = 2_000;
const defaultCancelPollIntervalMs = 50;
const maxRuntimeMaxSec = 30 * 60;
const maxCancelKillAfterMs = 30_000;
const maxLaunchStderrBytes = 8_192;

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
      stdio: ["ignore", "ignore", "pipe"],
    });
    if (child.pid === undefined) {
      throw new ScopeControllerError(
        "command_failed",
        `Failed to spawn ${command}: missing child pid`,
      );
    }
    const stderr = createBoundedStderrBuffer();
    child.stderr?.on("data", (chunk: Buffer | string) => {
      stderr.append(chunk);
    });
    const wait = new Promise<ScopeWaitResult>((resolve) => {
      let settled = false;
      const settle = (status: number, extraStderr = "") => {
        if (settled) {
          return;
        }
        settled = true;
        if (extraStderr.length > 0) {
          stderr.append(extraStderr);
        }
        resolve({
          status,
          stderr: sanitizeLaunchStderr(stderr.content()),
          stderrTruncated: stderr.truncated(),
        });
      };
      child.once("error", (error) => {
        settle(127, error instanceof Error ? error.message : String(error));
      });
      child.once("close", (code, signal) => {
        settle(code ?? signalExitStatus(signal));
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

const createBoundedStderrBuffer = () => {
  const chunks: string[] = [];
  let bytes = 0;
  let truncated = false;
  return {
    append(chunk: Buffer | string) {
      if (truncated) {
        return;
      }
      const text = typeof chunk === "string" ? chunk : chunk.toString("utf-8");
      const nextBytes = Buffer.byteLength(text);
      if (bytes + nextBytes <= maxLaunchStderrBytes) {
        chunks.push(text);
        bytes += nextBytes;
        return;
      }
      const remaining = Math.max(0, maxLaunchStderrBytes - bytes);
      if (remaining > 0) {
        chunks.push(Buffer.from(text).subarray(0, remaining).toString("utf-8"));
      }
      bytes = maxLaunchStderrBytes;
      truncated = true;
    },
    content: () => chunks.join(""),
    truncated: () => truncated,
  };
};

const sanitizeLaunchStderr = (stderr: string): string =>
  stderr
    .replace(/\0/g, "")
    .replace(/[^\x09\x0a\x0d\x20-\x7e]/g, "?")
    .replace(
      /\b([A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|PRIVATE_KEY|API_KEY|AUTH)[A-Z0-9_]*)=([^\s]+)/gi,
      "$1=[redacted]",
    )
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/-]+=*/gi, "$1 [redacted]");

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

type ProcessIdentityRead =
  | { readonly kind: "absent" }
  | { readonly kind: "error"; readonly error: unknown }
  | { readonly kind: "present"; readonly startTime: string };

const readProcessStartTimeForCancel = (
  filesystem: ScopeFilesystem,
  pid: number,
): ProcessIdentityRead => {
  try {
    return { kind: "present", startTime: readProcessStartTime(filesystem, pid) };
  } catch (error) {
    if (isKnownMissingProcessError(error)) {
      return { kind: "absent" };
    }
    return { kind: "error", error };
  }
};

export const createScopeController = ({
  cgroupRoot = "/sys/fs/cgroup",
  clock = nodeClock,
  command = nodeCommandAdapter,
  envCommand = "env",
  filesystem = nodeFilesystem,
  process: processAdapter = nodeProcessAdapter,
  systemctlCommand = "systemctl",
  systemdRunCommand = "systemd-run",
  watchdogPath = path.resolve(import.meta.dirname, "..", "scripts", "watchdog.sh"),
}: ScopeControllerDependencies = {}): ScopeController => {
  const trustedCgroupRoot = validateAbsoluteNormalizedPath(cgroupRoot, "cgroup root");

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
    recordedIdentity?: ScopeIdentity,
  ): Promise<ScopeIdentity> =>
    inspectScope(
      scopeId,
      controlEnv,
      command,
      systemctlCommand,
      filesystem,
      trustedCgroupRoot,
      recordedIdentity,
    );

  const cancel = async (
    handle: ScopeCancelHandle,
    options: ScopeCancelOptions = {},
  ): Promise<ScopeCancelResult> => {
    assertScopeId(handle.scopeId);
    const controlEnv = assertControlEnvironment(handle.controlEnv);
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

    const initialIdentity = await inspectScope(
      handle.scopeId,
      controlEnv,
      command,
      systemctlCommand,
      filesystem,
      trustedCgroupRoot,
      handle.identity,
    );
    if (
      scopeIdentityIsStopped(
        handle.scopeId,
        initialIdentity,
        handle.identity,
        filesystem,
        trustedCgroupRoot,
      )
    ) {
      return { sentKill: false, sentTerm: false };
    }
    verifyScopeIdentityBinding(handle.scopeId, initialIdentity, handle.identity);

    const launcherPresent = verifyProcessIdentityForCancel(
      filesystem,
      handle.controlPid,
      handle.controlStartTime,
    );
    if (launcherPresent) {
      try {
        processAdapter.signal(handle.controlPid, "SIGTERM");
      } catch (error) {
        if (!isKnownMissingProcessError(error)) {
          throw processIdentityUnavailable(handle.controlPid, error);
        }
        await sendScopeSignal(handle.scopeId, "SIGTERM", controlEnv, command, systemctlCommand);
      }
    } else {
      await sendScopeSignal(handle.scopeId, "SIGTERM", controlEnv, command, systemctlCommand);
    }

    if (
      await waitForStoppedScope({
        clock,
        command,
        controlEnv,
        killAfterMs,
        pollIntervalMs,
        cgroupRoot: trustedCgroupRoot,
        filesystem,
        recordedIdentity: handle.identity,
        scopeId: handle.scopeId,
        systemctlCommand,
      })
    ) {
      return { sentKill: false, sentTerm: true };
    }

    const escalationIdentity = await inspectScope(
      handle.scopeId,
      controlEnv,
      command,
      systemctlCommand,
      filesystem,
      trustedCgroupRoot,
      handle.identity,
    );
    if (
      scopeIdentityIsStopped(
        handle.scopeId,
        escalationIdentity,
        handle.identity,
        filesystem,
        trustedCgroupRoot,
      )
    ) {
      return { sentKill: false, sentTerm: true };
    }
    verifyScopeIdentityBinding(handle.scopeId, escalationIdentity, handle.identity);
    verifyProcessIdentityForEscalation(
      filesystem,
      handle.controlPid,
      handle.controlStartTime,
    );
    await sendScopeSignal(handle.scopeId, "SIGKILL", controlEnv, command, systemctlCommand);

    if (
      await waitForStoppedScope({
        clock,
        command,
        controlEnv,
        killAfterMs,
        pollIntervalMs,
        cgroupRoot: trustedCgroupRoot,
        filesystem,
        recordedIdentity: handle.identity,
        scopeId: handle.scopeId,
        systemctlCommand,
      })
    ) {
      return { sentKill: true, sentTerm: true };
    }

    throw new ScopeControllerError(
      "scope_stop_timeout",
      `Scope ${handle.scopeId} was still running after SIGKILL observation window`,
    );
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

const verifyProcessIdentityForCancel = (
  filesystem: ScopeFilesystem,
  pid: number,
  expectedStartTime: string,
): boolean => {
  const current = readProcessStartTimeForCancel(filesystem, pid);
  if (current.kind === "absent") {
    return false;
  }
  if (current.kind === "error") {
    throw processIdentityUnavailable(pid, current.error);
  }
  if (current.startTime !== expectedStartTime) {
    throw new ScopeControllerError(
      "process_identity_mismatch",
      `Refusing to signal PID ${pid}: start time changed`,
    );
  }
  return true;
};

const verifyProcessIdentityForEscalation = (
  filesystem: ScopeFilesystem,
  pid: number,
  expectedStartTime: string,
): void => {
  const current = readProcessStartTimeForCancel(filesystem, pid);
  if (current.kind === "absent") {
    return;
  }
  if (current.kind === "error") {
    throw processIdentityUnavailable(pid, current.error);
  }
  if (current.startTime !== expectedStartTime) {
    throw new ScopeControllerError(
      "process_identity_mismatch",
      `Refusing to escalate PID ${pid}: start time changed`,
    );
  }
};

const waitForStoppedScope = async ({
  cgroupRoot,
  clock,
  command,
  controlEnv,
  filesystem,
  killAfterMs,
  pollIntervalMs,
  recordedIdentity,
  scopeId,
  systemctlCommand,
}: {
  readonly cgroupRoot: string;
  readonly clock: ScopeClock;
  readonly command: CommandAdapter;
  readonly controlEnv: Readonly<Record<string, string>>;
  readonly filesystem: ScopeFilesystem;
  readonly killAfterMs: number;
  readonly pollIntervalMs: number;
  readonly recordedIdentity: ScopeIdentity | undefined;
  readonly scopeId: string;
  readonly systemctlCommand: string;
}): Promise<boolean> => {
  let elapsedMs = 0;
  while (elapsedMs < killAfterMs) {
    const identity = await inspectScope(
      scopeId,
      controlEnv,
      command,
      systemctlCommand,
      filesystem,
      cgroupRoot,
      recordedIdentity,
    );
    if (scopeIdentityIsStopped(scopeId, identity, recordedIdentity, filesystem, cgroupRoot)) {
      return true;
    }
    verifyScopeIdentityBinding(scopeId, identity, recordedIdentity);
    const sleepMs = Math.min(pollIntervalMs, killAfterMs - elapsedMs);
    await clock.sleep(sleepMs);
    elapsedMs += sleepMs;
  }
  return false;
};

const scopeIdentityIsStopped = (
  scopeId: string,
  identity: ScopeIdentity,
  recordedIdentity: ScopeIdentity | undefined,
  filesystem: ScopeFilesystem,
  cgroupRoot: string,
): boolean => {
  const labels = classifyScopeLabels(identity);
  if (labels === "active") {
    return false;
  }
  if (labels === "terminal") {
    if (terminalScopeMembership(identity) === "populated") {
      return false;
    }
    verifyScopeIdentityBinding(scopeId, identity, recordedIdentity);
    return true;
  }

  if (recordedIdentity !== undefined && recordedIdentity.id !== scopeId) {
    throw new ScopeControllerError(
      "scope_identity_mismatch",
      `Recorded scope identity mismatch: expected ${scopeId}, got ${recordedIdentity.id}`,
    );
  }
  const recordedControlGroup = trustedControlGroup(recordedIdentity?.controlGroup);
  if (recordedControlGroup === undefined) {
    return true;
  }
  return readCgroupMembership(filesystem, recordedControlGroup, cgroupRoot).kind !== "populated";
};

const sendScopeSignal = async (
  scopeId: string,
  signal: ScopeSignal,
  controlEnv: Readonly<Record<string, string>>,
  command: CommandAdapter,
  systemctlCommand: string,
): Promise<void> => {
  const output = await command.execFile(
    systemctlCommand,
    ["--user", "kill", "--kill-whom=all", `--signal=${signal}`, scopeId],
    { env: controlEnv },
  );
  if (output.status !== 0) {
    throw new ScopeControllerError(
      "command_failed",
      `systemctl kill failed for ${scopeId}: ${output.stderr.trim()}`,
    );
  }
};

export const scopeIdentityIsRunning = (identity: ScopeIdentity): boolean => {
  const labels = classifyScopeLabels(identity);
  if (labels === "active") {
    return true;
  }
  if (labels === "collected") {
    return false;
  }
  return terminalScopeMembership(identity) === "populated";
};

export const verifyScopeIdentityBinding = (
  scopeId: string,
  current: ScopeIdentity,
  recorded: ScopeIdentity | undefined,
): void => {
  assertScopeId(scopeId);
  if (classifyScopeLabels(current) === "collected") {
    return;
  }
  if (recorded === undefined) {
    throw new ScopeControllerError(
      "scope_identity_unverified",
      `Refusing to signal ${scopeId}: missing recorded scope identity`,
    );
  }
  if (recorded.id !== scopeId) {
    throw new ScopeControllerError(
      "scope_identity_mismatch",
      `Recorded scope identity mismatch: expected ${scopeId}, got ${recorded.id}`,
    );
  }

  const recordedInvocationId = trustedInvocationId(recorded.invocationId);
  const currentInvocationId = trustedInvocationId(current.invocationId);
  if (recordedInvocationId === undefined || currentInvocationId === undefined) {
    throw new ScopeControllerError(
      "scope_identity_unverified",
      `Refusing to signal ${scopeId}: missing trustworthy systemd invocation identity`,
    );
  }
  if (recordedInvocationId !== currentInvocationId) {
    throw new ScopeControllerError(
      "scope_identity_mismatch",
      `Refusing to signal ${scopeId}: systemd invocation identity changed`,
    );
  }

  const recordedControlGroup = trustedControlGroup(recorded.controlGroup);
  const currentControlGroup = trustedControlGroup(current.controlGroup);
  if (recordedControlGroup === undefined) {
    throw new ScopeControllerError(
      "scope_identity_unverified",
      `Refusing to signal ${scopeId}: missing trustworthy cgroup identity`,
    );
  }
  if (currentControlGroup === undefined) {
    if (releasedTerminalBindingMatches(current, recordedControlGroup)) {
      return;
    }
    throw new ScopeControllerError(
      "scope_identity_unverified",
      `Refusing to signal ${scopeId}: missing trustworthy cgroup identity`,
    );
  }
  if (recordedControlGroup !== currentControlGroup) {
    throw new ScopeControllerError(
      "scope_identity_mismatch",
      `Refusing to signal ${scopeId}: cgroup identity changed`,
    );
  }
};

const releasedTerminalBindingMatches = (
  current: ScopeIdentity,
  recordedControlGroup: string,
): boolean => {
  if (current.controlGroup !== undefined || classifyScopeLabels(current) !== "terminal") {
    return false;
  }
  if (terminalScopeMembership(current) === "populated") {
    return false;
  }
  return current.cgroupMembershipControlGroup === recordedControlGroup;
};

type ScopeLabelClassification = "active" | "collected" | "terminal";

const classifyScopeLabels = (identity: ScopeIdentity): ScopeLabelClassification => {
  const loadState = stateProperty(identity.loadState);
  const subState = stateProperty(identity.subState);
  if (loadState === undefined || subState === undefined) {
    throw scopeStateUnknown(identity, "missing LoadState or SubState");
  }
  if (loadState === "not-found") {
    if (
      subState === "dead" &&
      identity.mainPid === undefined &&
      trustedControlGroup(identity.controlGroup) === undefined &&
      trustedInvocationId(identity.invocationId) === undefined
    ) {
      return "collected";
    }
    throw scopeStateUnknown(identity, "conflicting not-found scope properties");
  }
  if (loadState !== "loaded") {
    throw scopeStateUnknown(identity, `unsupported LoadState=${loadState}`);
  }
  if (activeScopeSubStates.has(subState)) {
    return "active";
  }
  if (terminalScopeSubStates.has(subState)) {
    return "terminal";
  }
  throw scopeStateUnknown(identity, `unsupported scope SubState=${subState}`);
};

const stateProperty = (value: string | undefined): string | undefined => {
  if (value === undefined || value.length === 0) {
    return undefined;
  }
  return value.toLowerCase();
};

const terminalScopeMembership = (identity: ScopeIdentity): ScopeCgroupMembership => {
  if (
    identity.cgroupMembership === "absent" ||
    identity.cgroupMembership === "empty" ||
    identity.cgroupMembership === "populated"
  ) {
    return identity.cgroupMembership;
  }
  throw new ScopeControllerError(
    "scope_membership_unavailable",
    `Scope ${identity.id} has terminal state without hierarchical cgroup membership proof`,
  );
};

const scopeStateUnknown = (identity: ScopeIdentity, reason: string): ScopeControllerError =>
  new ScopeControllerError(
    "scope_state_unknown",
    `Scope ${identity.id} state is unknown; refusing to infer cancellation safety: ${reason}`,
  );

interface CgroupMembershipObservation {
  readonly eventsPath: string;
  readonly kind: ScopeCgroupMembership;
}

const terminalMembershipControlGroup = (
  scopeId: string,
  identity: ScopeIdentity,
  recordedIdentity: ScopeIdentity | undefined,
): string | undefined => {
  const currentControlGroup = trustedControlGroup(identity.controlGroup);
  if (currentControlGroup !== undefined) {
    return currentControlGroup;
  }
  if (identity.controlGroup !== undefined) {
    throw new ScopeControllerError(
      "scope_membership_unavailable",
      `Scope ${scopeId} has an unsafe cgroup path`,
    );
  }
  if (recordedIdentity === undefined) {
    return undefined;
  }
  if (recordedIdentity.id !== scopeId) {
    throw new ScopeControllerError(
      "scope_identity_mismatch",
      `Recorded scope identity mismatch: expected ${scopeId}, got ${recordedIdentity.id}`,
    );
  }

  const recordedControlGroup = trustedControlGroup(recordedIdentity.controlGroup);
  if (recordedControlGroup === undefined) {
    return undefined;
  }
  const currentInvocationId = trustedInvocationId(identity.invocationId);
  const recordedInvocationId = trustedInvocationId(recordedIdentity.invocationId);
  if (currentInvocationId === undefined || recordedInvocationId === undefined) {
    throw new ScopeControllerError(
      "scope_identity_unverified",
      `Refusing to inspect ${scopeId}: missing trustworthy systemd invocation identity`,
    );
  }
  if (currentInvocationId !== recordedInvocationId) {
    throw new ScopeControllerError(
      "scope_identity_mismatch",
      `Refusing to inspect ${scopeId}: systemd invocation identity changed`,
    );
  }
  return recordedControlGroup;
};

const readCgroupMembership = (
  filesystem: ScopeFilesystem,
  controlGroup: string | undefined,
  cgroupRoot: string,
): CgroupMembershipObservation => {
  const trustedGroup = trustedControlGroup(controlGroup);
  if (trustedGroup === undefined) {
    throw new ScopeControllerError(
      "scope_membership_unavailable",
      "Scope terminal state lacks a trustworthy cgroup path",
    );
  }
  const eventsPath = path.join(cgroupRoot, trustedGroup.slice(1), "cgroup.events");
  try {
    return {
      eventsPath,
      kind: parseCgroupEvents(filesystem.readTextFile(eventsPath), eventsPath),
    };
  } catch (error) {
    if (isKnownMissingProcessError(error)) {
      return { eventsPath, kind: "absent" };
    }
    throw cgroupMembershipUnavailable(eventsPath, error);
  }
};

const parseCgroupEvents = (content: string, eventsPath: string): ScopeCgroupMembership => {
  let populated: boolean | undefined;
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0) {
      continue;
    }
    const [key, value, extra] = line.split(/\s+/);
    if (key !== "populated") {
      continue;
    }
    if (extra !== undefined || (value !== "0" && value !== "1")) {
      throw new ScopeControllerError(
        "scope_membership_unavailable",
        `Malformed cgroup.events populated entry at ${eventsPath}`,
      );
    }
    const next = value === "1";
    if (populated !== undefined && populated !== next) {
      throw new ScopeControllerError(
        "scope_membership_unavailable",
        `Conflicting cgroup.events populated entries at ${eventsPath}`,
      );
    }
    populated = next;
  }
  if (populated === undefined) {
    throw new ScopeControllerError(
      "scope_membership_unavailable",
      `Missing cgroup.events populated entry at ${eventsPath}`,
    );
  }
  return populated ? "populated" : "empty";
};

const inspectScope = async (
  scopeId: string,
  controlEnvInput: Readonly<Record<string, string>>,
  command: CommandAdapter,
  systemctlCommand: string,
  filesystem: ScopeFilesystem,
  cgroupRoot: string,
  recordedIdentity?: ScopeIdentity,
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
      "--property=InvocationID",
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

  const identity: ScopeIdentity = {
    controlGroup: optionalNonEmptyProperty(properties.ControlGroup),
    id: properties.Id,
    invocationId: optionalNonEmptyProperty(properties.InvocationID),
    loadState: optionalNonEmptyProperty(properties.LoadState),
    mainPid: parseOptionalPositiveInteger(properties.MainPID),
    subState: optionalNonEmptyProperty(properties.SubState),
  };
  if (classifyScopeLabels(identity) !== "terminal") {
    return identity;
  }

  const membershipControlGroup = terminalMembershipControlGroup(
    scopeId,
    identity,
    recordedIdentity,
  );
  if (membershipControlGroup === undefined) {
    return identity;
  }

  const membership = readCgroupMembership(
    filesystem,
    membershipControlGroup,
    cgroupRoot,
  );
  return {
    ...identity,
    cgroupEventsPath: membership.eventsPath,
    cgroupMembership: membership.kind,
    cgroupMembershipControlGroup: membershipControlGroup,
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

const optionalNonEmptyProperty = (value: string | undefined): string | undefined => {
  if (value === undefined || value.length === 0 || value === "n/a") {
    return undefined;
  }
  return value;
};

const trustedInvocationId = (value: string | undefined): string | undefined => {
  if (value === undefined) {
    return undefined;
  }
  const compact = value.replace(/-/g, "").toLowerCase();
  return /^[0-9a-f]{32}$/.test(compact) ? compact : undefined;
};

const trustedControlGroup = (value: string | undefined): string | undefined => {
  if (
    value === undefined ||
    value.length === 0 ||
    value === "/" ||
    value.includes("\0") ||
    !value.startsWith("/") ||
    value.split("/").includes("..") ||
    path.posix.normalize(value) !== value
  ) {
    return undefined;
  }
  return value;
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

const isKnownMissingProcessError = (error: unknown): boolean =>
  isNodeError(error) && (error.code === "ENOENT" || error.code === "ESRCH");

const processIdentityUnavailable = (pid: number, error: unknown): ScopeControllerError => {
  if (error instanceof ScopeControllerError) {
    return error;
  }
  const reason = error instanceof Error ? error.message : String(error);
  return new ScopeControllerError(
    "process_identity_unavailable",
    `Refusing to signal PID ${pid}: process identity unavailable: ${reason}`,
  );
};

const cgroupMembershipUnavailable = (
  eventsPath: string,
  error: unknown,
): ScopeControllerError => {
  if (error instanceof ScopeControllerError) {
    return error;
  }
  const reason = error instanceof Error ? error.message : String(error);
  return new ScopeControllerError(
    "scope_membership_unavailable",
    `Scope membership unavailable at ${eventsPath}: ${reason}`,
  );
};

const isNodeError = (error: unknown): error is NodeJS.ErrnoException =>
  error instanceof Error && "code" in error;

const failClosedCgroup = (reason: string): ScopeControllerError =>
  new ScopeControllerError(
    "cgroup_kill_unavailable",
    `cgroup.kill unavailable; fail-closed: ${reason}`,
  );
