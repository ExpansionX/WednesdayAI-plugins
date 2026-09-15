import {
  chmodSync,
  closeSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import {
  createScopeController,
  deriveUnifiedCgroupKillPath,
  writeOwnCgroupKill,
  type CommandAdapter,
  type CommandOutput,
  type ScopeClock,
  type ScopeFilesystem,
  type ScopeProcessAdapter,
  type ScopeWaitResult,
  type SpawnedCommand,
} from "./scope.js";

const packageRoot = path.resolve(import.meta.dirname, "..");
const watchdogPath = path.join(packageRoot, "scripts", "watchdog.sh");
const tempRoots: string[] = [];

interface SpawnRecord {
  readonly command: string;
  readonly argv: readonly string[];
  readonly env: Readonly<Record<string, string>>;
}

interface ExecRecord {
  readonly command: string;
  readonly argv: readonly string[];
  readonly env: Readonly<Record<string, string>>;
}

class FakeSpawnedCommand implements SpawnedCommand {
  public constructor(
    public readonly pid: number,
    private readonly status: number,
  ) {}

  public async wait(): Promise<ScopeWaitResult> {
    return { status: this.status, stderr: "", stderrTruncated: false };
  }
}

class FakeCommandAdapter implements CommandAdapter {
  public readonly spawns: SpawnRecord[] = [];
  public readonly execs: ExecRecord[] = [];
  public execOutputs: CommandOutput[] = [];
  public nextPid = 1234;
  public nextStatus = 0;

  public spawn(
    command: string,
    argv: readonly string[],
    options: { readonly env: Readonly<Record<string, string>> },
  ): SpawnedCommand {
    this.spawns.push({
      command,
      argv: [...argv],
      env: { ...options.env },
    });
    return new FakeSpawnedCommand(this.nextPid, this.nextStatus);
  }

  public async execFile(
    command: string,
    argv: readonly string[],
    options: { readonly env: Readonly<Record<string, string>> },
  ): Promise<CommandOutput> {
    this.execs.push({
      command,
      argv: [...argv],
      env: { ...options.env },
    });
    return this.execOutputs.shift() ?? { status: 0, stdout: "", stderr: "" };
  }
}

class FakeFilesystem implements ScopeFilesystem {
  public readonly errors = new Map<string, unknown>();
  public readonly files = new Map<string, string>();
  public readonly readLog: string[] = [];
  public readonly reads = new Map<string, unknown[]>();
  public readonly writable = new Set<string>();
  public readonly writes: Array<{ readonly filePath: string; readonly content: string }> =
    [];

  public readTextFile(filePath: string): string {
    this.readLog.push(filePath);
    const readQueue = this.reads.get(filePath);
    if (readQueue !== undefined && readQueue.length > 0) {
      const next = readQueue.shift();
      if (next instanceof Error) {
        throw next;
      }
      if (typeof next !== "string") {
        throw new Error(`invalid fake file read: ${filePath}`);
      }
      return next;
    }
    const error = this.errors.get(filePath);
    if (error !== undefined) {
      throw error;
    }
    const content = this.files.get(filePath);
    if (content === undefined) {
      throw Object.assign(new Error(`missing fake file: ${filePath}`), {
        code: "ENOENT",
      });
    }
    return content;
  }

  public writeTextFile(filePath: string, content: string): void {
    this.writes.push({ filePath, content });
    this.files.set(filePath, content);
  }

  public isWritableFile(filePath: string): boolean {
    return this.writable.has(filePath);
  }
}

class FakeClock implements ScopeClock {
  public readonly sleeps: number[] = [];

  public async sleep(ms: number): Promise<void> {
    this.sleeps.push(ms);
  }
}

class FakeProcessAdapter implements ScopeProcessAdapter {
  public readonly signals: Array<{ readonly pid: number; readonly signal: "SIGTERM" | "SIGKILL" }> =
    [];
  public running = new Map<number, boolean>();

  public signal(pid: number, signal: "SIGTERM" | "SIGKILL"): void {
    this.signals.push({ pid, signal });
    if (signal === "SIGKILL") {
      this.running.set(pid, false);
    }
  }

  public isRunning(pid: number): boolean {
    return this.running.get(pid) ?? false;
  }
}

const makeTempRoot = (name: string): string => {
  const root = mkdtempSync(path.join(os.tmpdir(), `shohin-${name}-`));
  tempRoots.push(root);
  return root;
};

const makeProcStat = (pid: number, startTime: string): string =>
  `${pid} (systemd-run) S 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 ${startTime} 21 22\n`;

const scopeId = "shohin-shohin-phase-0-spike-run005.scope";
const invocationId = "0123456789abcdef0123456789abcdef";
const controlGroup = "/user.slice/user-1000.slice/app.slice/shohin.scope";
const cgroupEventsPath = (group = controlGroup) =>
  path.join("/sys/fs/cgroup", group.slice(1), "cgroup.events");
const cgroupProcsPath = (group = controlGroup) =>
  path.join("/sys/fs/cgroup", group.slice(1), "cgroup.procs");

const showArgs = () => [
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
];

const unitSignalArgs = (signal: "SIGTERM" | "SIGKILL") => [
  "--user",
  "kill",
  "--kill-whom=all",
  `--signal=${signal}`,
  scopeId,
];

const runningIdentity = (overrides: Record<string, string | number | undefined> = {}) => ({
  controlGroup,
  id: scopeId,
  invocationId,
  loadState: "loaded",
  mainPid: 77,
  subState: "running",
  ...overrides,
});

const stoppedIdentity = (overrides: Record<string, string | number | undefined> = {}) => ({
  controlGroup: undefined,
  id: scopeId,
  invocationId: undefined,
  loadState: "not-found",
  mainPid: undefined,
  subState: "dead",
  ...overrides,
});

const showOutput = (
  identity: ReturnType<typeof runningIdentity> | ReturnType<typeof stoppedIdentity>,
): string =>
  [
    `Id=${identity.id}`,
    `MainPID=${identity.mainPid ?? 0}`,
    ...(identity.controlGroup === undefined ? [] : [`ControlGroup=${identity.controlGroup}`]),
    `SubState=${identity.subState ?? ""}`,
    `LoadState=${identity.loadState ?? ""}`,
    ...(identity.invocationId === undefined ? [] : [`InvocationID=${identity.invocationId}`]),
    "",
  ].join("\n");

const successOutput = (
  identity: ReturnType<typeof runningIdentity> | ReturnType<typeof stoppedIdentity>,
): CommandOutput => ({ status: 0, stdout: showOutput(identity), stderr: "" });

const cancelHandle = (overrides: Record<string, unknown> = {}) => ({
  controlEnv: baseLaunchOptions().controlEnv,
  controlPid: 4242,
  controlStartTime: "998877",
  identity: runningIdentity(),
  scopeId,
  ...overrides,
});

const makeFixture = () => {
  const command = new FakeCommandAdapter();
  const filesystem = new FakeFilesystem();
  const clock = new FakeClock();
  const process = new FakeProcessAdapter();
  command.nextPid = 4242;
  filesystem.files.set("/proc/4242/stat", makeProcStat(4242, "998877"));
  const controller = createScopeController({
    clock,
    command,
    filesystem,
    process,
    watchdogPath,
  });
  return { clock, command, controller, filesystem, process };
};

const baseLaunchOptions = () => ({
  controlEnv: {
    PATH: "/usr/bin:/bin",
    XDG_RUNTIME_DIR: "/run/user/1000",
    DBUS_SESSION_BUS_ADDRESS: "unix:path=/run/user/1000/bus",
  },
  executorEnv: {
    PATH: "/usr/bin:/bin",
    HOME: "/tmp/shohin-run/HOME",
    TMPDIR: "/tmp/shohin-run/tmp",
    WAI_RUN_ID: "run005",
  },
  heartbeat: {
    path: "/tmp/shohin-run/heartbeat",
    pollIntervalMs: 250,
    staleAfterMs: 5_000,
  },
  killAfterMs: 2_000,
  runDir: "/tmp/shohin-run",
  runId: "run005",
  runner: ["/bin/sleep", "2"],
  runtimeMaxSec: 30,
  topic: "shohin-phase-0-spike",
});


// `--property=User`/`--property=Group` are deliberately NOT requested here:
// live host verification (missions/mission-001/evidence/val-spend-001-r7a-
// root-scope-preflight-*) confirmed `systemctl show` omits them entirely for
// transient scope units on this systemd version, so the product does not
// request or rely on them either.
const rootShowArgs = () => [
  "-n",
  "systemctl",
  "show",
  scopeId,
  "--property=Id",
  "--property=MainPID",
  "--property=ControlGroup",
  "--property=SubState",
  "--property=LoadState",
  "--property=InvocationID",
  "--property=IPAddressDeny",
  "--property=IPAddressAllow",
  "--no-pager",
];

const rootUnitSignalArgs = (signal: "SIGTERM" | "SIGKILL") => [
  "-n",
  "systemctl",
  "kill",
  "--kill-whom=all",
  `--signal=${signal}`,
  scopeId,
];

// Values match the actual normalized form `systemctl show` reports on this
// host for a requested `IPAddressDeny=any` /
// `IPAddressAllow=localhost,127.0.0.0/8,::1` (frozen in the r7a preflight
// evidence), not the literal requested strings.
const rootRunningIdentity = (overrides: Record<string, string | number | undefined> = {}) => ({
  ...runningIdentity(),
  ipAddressAllow: "127.0.0.0/8 ::1/128",
  ipAddressDeny: "0.0.0.0/0 ::/0",
  ...overrides,
});

const rootStoppedIdentity = (overrides: Record<string, string | number | undefined> = {}) => ({
  ...stoppedIdentity(),
  ipAddressAllow: undefined,
  ipAddressDeny: undefined,
  ...overrides,
});

const rootShowOutput = (
  identity: ReturnType<typeof rootRunningIdentity> | ReturnType<typeof rootStoppedIdentity>,
): CommandOutput => ({
  status: 0,
  stdout: [
    `Id=${identity.id}`,
    `MainPID=${identity.mainPid ?? 0}`,
    ...(identity.controlGroup === undefined ? [] : [`ControlGroup=${identity.controlGroup}`]),
    `SubState=${identity.subState ?? ""}`,
    `LoadState=${identity.loadState ?? ""}`,
    ...(identity.invocationId === undefined ? [] : [`InvocationID=${identity.invocationId}`]),
    ...(identity.ipAddressDeny === undefined ? [] : [`IPAddressDeny=${identity.ipAddressDeny}`]),
    ...(identity.ipAddressAllow === undefined ? [] : [`IPAddressAllow=${identity.ipAddressAllow}`]),
    "",
  ].join("\n"),
  stderr: "",
});

const sudoOkOutput: CommandOutput = { status: 0, stdout: "", stderr: "" };

const makeRootFixture = () => {
  const command = new FakeCommandAdapter();
  const filesystem = new FakeFilesystem();
  const clock = new FakeClock();
  const process = new FakeProcessAdapter();
  command.nextPid = 4242;
  filesystem.files.set("/proc/4242/stat", makeProcStat(4242, "998877"));
  const controller = createScopeController({
    clock,
    command,
    filesystem,
    manager: "root",
    payloadGroup: "david",
    payloadUser: "david",
    process,
    watchdogPath,
  });
  return { clock, command, controller, filesystem, process };
};

const rootLaunchOptions = () => ({
  ...baseLaunchOptions(),
  networkAccess: "loopback-only" as const,
});

const makeWatchdogScriptFixture = (temp: string) => {
  const runDir = path.join(temp, "run");
  const fakeCgroupRoot = path.join(temp, "cgroup");
  const fakeProc = path.join(temp, "self-cgroup");
  const relativeGroup = "/user.slice/user-1000.slice/app.slice/shohin-test.scope";
  const groupDir = path.join(fakeCgroupRoot, relativeGroup.slice(1));
  const killFile = path.join(groupDir, "cgroup.kill");
  mkdirSync(groupDir, { recursive: true });
  mkdirSync(runDir, { recursive: true });
  writeFileSync(fakeProc, `0::${relativeGroup}\n`);
  writeFileSync(killFile, "");
  return {
    env: {
      PATH: "/usr/bin:/bin",
      WAI_SHOHIN_WATCHDOG_CGROUP_ROOT: fakeCgroupRoot,
      WAI_SHOHIN_WATCHDOG_PROC_CGROUP: fakeProc,
    },
    killFile,
    runDir,
  };
};

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("Shohin systemd scope controller", () => {
  it("launches the exact .scope Id with split control and executor environments", async () => {
    const { command, controller } = makeFixture();
    const handle = await controller.launch(baseLaunchOptions());

    expect(handle.scopeId).toBe(scopeId);
    expect(handle.controlPid).toBe(4242);
    expect(handle.controlStartTime).toBe("998877");
    expect(command.spawns).toHaveLength(1);

    const spawn = command.spawns[0];
    expect(spawn.command).toBe("systemd-run");
    expect(spawn.env).toEqual({
      PATH: "/usr/bin:/bin",
      XDG_RUNTIME_DIR: "/run/user/1000",
      DBUS_SESSION_BUS_ADDRESS: "unix:path=/run/user/1000/bus",
    });
    expect(Object.keys(spawn.env)).toEqual([
      "PATH",
      "XDG_RUNTIME_DIR",
      "DBUS_SESSION_BUS_ADDRESS",
    ]);

    expect(spawn.argv).toContain("--scope");
    expect(spawn.argv).toContain("--collect");
    expect(spawn.argv).toContain("RuntimeMaxSec=30s");
    expect(spawn.argv).toContain("TimeoutStopSec=2s");
    expect(spawn.argv).toContain("KillMode=mixed");
    expect(spawn.argv).toContain("SendSIGKILL=yes");
    expect(spawn.argv.slice(spawn.argv.indexOf("--unit"), spawn.argv.indexOf("--unit") + 2)).toEqual([
      "--unit",
      scopeId,
    ]);

    const executorBoundary = spawn.argv.indexOf("--");
    expect(executorBoundary).toBeGreaterThan(0);
    const executorArgv = spawn.argv.slice(executorBoundary + 1);
    expect(executorArgv.slice(0, 2)).toEqual(["env", "-i"]);
    expect(executorArgv).toEqual(
      expect.arrayContaining([
        "PATH=/usr/bin:/bin",
        "HOME=/tmp/shohin-run/HOME",
        "TMPDIR=/tmp/shohin-run/tmp",
        "WAI_RUN_ID=run005",
        watchdogPath,
        "--scope-id",
        scopeId,
        "--",
        "/bin/sleep",
        "2",
      ]),
    );
    expect(executorArgv).not.toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^XDG_RUNTIME_DIR=/),
        expect.stringMatching(/^DBUS_SESSION_BUS_ADDRESS=/),
      ]),
    );
  });

  // Loopback-only network access is refused on the ordinary `--user`
  // manager rather than emitted: live host verification (decision069/070,
  // AGENTS.md "Disproven isolation approach") found that user-manager
  // `IPAddressDeny=any`/`IPAddressAllow=...` is recorded by `systemctl
  // --user show` but is NOT enforced -- non-loopback TCP still succeeds.
  // Asserting those properties in launch argv here would be exactly the
  // fake-isolation shape this mission's contract requires validators to
  // reject; only the root-managed scope controller may request it (see
  // "requests loopback-only network properties in root scope launch argv"
  // below).
  it("refuses loopback-only network access on the user-managed scope controller (not enforced on this host)", async () => {
    const { command, controller } = makeFixture();
    await expect(
      controller.launch({
        ...baseLaunchOptions(),
        networkAccess: "loopback-only",
      }),
    ).rejects.toMatchObject({ code: "invalid_scope_option" });

    expect(command.spawns).toHaveLength(0);
  });

  it("keeps only closed launcher diagnostics on the wait handle", async () => {
    const temp = makeTempRoot("launcher-stderr");
    const launcher = path.join(temp, "fake-systemd-run.sh");
    const runDir = path.join(temp, "run");
    mkdirSync(runDir, { recursive: true });
    writeFileSync(
      launcher,
      [
        "#!/usr/bin/env bash",
        "set -euo pipefail",
        "printf 'Running as unit: shohin-shohin-phase-0-spike-run005.scope; invocation ID: 0123456789abcdef0123456789abcdef\\n' >&2",
        "printf 'OPENCLAW_GATEWAY_TOKEN=super-secret\\n' >&2",
        "printf 'Bearer abc.def\\n' >&2",
        "printf 'watchdog.sh: heartbeat stale now_ms=1789326610000 mtime_ms=1789326600000 age_ms=10000 stale_ms=5000\\n' >&2",
        "sleep 0.1",
        "exit 42",
        "",
      ].join("\n"),
      { mode: 0o600 },
    );
    chmodSync(launcher, 0o755);

    const controller = createScopeController({ systemdRunCommand: launcher, watchdogPath });
    const handle = await controller.launch({
      ...baseLaunchOptions(),
      heartbeat: { ...baseLaunchOptions().heartbeat, path: path.join(runDir, "heartbeat.json") },
      runDir,
    });
    const result = await handle.wait();

    expect(result.status).toBe(42);
    expect(result.stderrTruncated).toBe(false);
    expect(result.stderr).toContain(
      "systemd-run: started shohin-shohin-phase-0-spike-run005.scope invocation=0123456789abcdef0123456789abcdef",
    );
    expect(result.stderr).toContain(
      "watchdog.sh: heartbeat stale now_ms=1789326610000 mtime_ms=1789326600000 age_ms=10000 stale_ms=5000",
    );
    expect(result.stderr).toContain("[unrecognized launch stderr suppressed]");
    expect(result.stderr).not.toContain("OPENCLAW_GATEWAY_TOKEN");
    expect(result.stderr).not.toContain("Bearer");
    expect(result.stderr).not.toContain("super-secret");
    expect(result.stderr).not.toContain("abc.def");
  });

  it("rejects probe-only controls unless explicit probe mode is enabled", async () => {
    for (const probes of [
      { straceExecve: true },
      { recordSetsidDescendant: true },
      { disableWatchdog: true },
    ]) {
      const { command, controller } = makeFixture();
      await expect(
        controller.launch({
          ...baseLaunchOptions(),
          probes,
        }),
      ).rejects.toMatchObject({ code: "probe_option_requires_probe_mode" });
      expect(command.spawns).toHaveLength(0);
    }
  });

  it("checks strace availability before accepting the explicit inventory probe", async () => {
    const { command, controller } = makeFixture();
    command.execOutputs = [{ status: 0, stdout: "strace -- version\n", stderr: "" }];

    await controller.launch({
      ...baseLaunchOptions(),
      probeMode: true,
      probes: { straceExecve: true },
    });

    expect(command.execs[0]).toMatchObject({
      command: "strace",
      argv: ["-V"],
    });
    expect(command.spawns[0].argv).toEqual(
      expect.arrayContaining(["--probe-mode", "--strace-execve"]),
    );

    const failing = makeFixture();
    failing.command.execOutputs = [{ status: 127, stdout: "", stderr: "missing\n" }];
    await expect(
      failing.controller.launch({
        ...baseLaunchOptions(),
        probeMode: true,
        probes: { straceExecve: true },
      }),
    ).rejects.toMatchObject({ code: "strace_unavailable" });
    expect(failing.command.spawns).toHaveLength(0);
  });

  it("refuses credential or bus leakage in controller-owned launch environments", async () => {
    await expect(
      makeFixture().controller.launch({
        ...baseLaunchOptions(),
        controlEnv: {
          ...baseLaunchOptions().controlEnv,
          OPENCLAW_GATEWAY_TOKEN: "blocked",
        },
      }),
    ).rejects.toMatchObject({ code: "forbidden_control_environment" });

    await expect(
      makeFixture().controller.launch({
        ...baseLaunchOptions(),
        executorEnv: {
          ...baseLaunchOptions().executorEnv,
          XDG_RUNTIME_DIR: "/run/user/1000",
        },
      }),
    ).rejects.toMatchObject({ code: "forbidden_executor_environment" });
  });

  it("refuses malformed or inaccessible launcher identity without unit fallback", async () => {
    for (const setup of [
      (fixture: ReturnType<typeof makeFixture>) => {
        fixture.filesystem.files.set("/proc/4242/stat", "malformed stat\n");
      },
      (fixture: ReturnType<typeof makeFixture>) => {
        fixture.filesystem.errors.set(
          "/proc/4242/stat",
          Object.assign(new Error("permission denied"), { code: "EACCES" }),
        );
      },
      (fixture: ReturnType<typeof makeFixture>) => {
        fixture.filesystem.errors.set(
          "/proc/4242/stat",
          Object.assign(new Error("transient read failure"), { code: "EIO" }),
        );
      },
    ]) {
      const fixture = makeFixture();
      setup(fixture);
      fixture.command.execOutputs = [successOutput(runningIdentity())];

      await expect(
        fixture.controller.cancel(cancelHandle(), { killAfterMs: 20, pollIntervalMs: 10 }),
      ).rejects.toMatchObject({ code: expect.stringMatching(/^process_identity_/) });

      expect(fixture.process.signals).toEqual([]);
      expect(fixture.command.execs.map((entry) => entry.argv)).toEqual([showArgs()]);
    }
  });

  it("refuses missing, conflicting or unsupported scope states without signaling", async () => {
    for (const identity of [
      runningIdentity({ loadState: undefined }),
      runningIdentity({ subState: undefined }),
      runningIdentity({ subState: "maintenance" }),
      runningIdentity({ subState: "exited" }),
      runningIdentity({ loadState: "not-found", subState: "running" }),
    ]) {
      const fixture = makeFixture();
      fixture.command.execOutputs = [successOutput(identity)];

      await expect(
        fixture.controller.cancel(cancelHandle(), { killAfterMs: 20, pollIntervalMs: 10 }),
      ).rejects.toMatchObject({ code: "scope_state_unknown" });

      expect(fixture.process.signals).toEqual([]);
      expect(fixture.command.execs.map((entry) => entry.argv)).toEqual([showArgs()]);
      expect(fixture.filesystem.readLog).toEqual([]);
    }
  });

  it("refuses malformed or inaccessible terminal cgroup membership without signaling", async () => {
    for (const setup of [
      (fixture: ReturnType<typeof makeFixture>) => {
        fixture.filesystem.files.set(cgroupEventsPath(), "populated maybe\n");
      },
      (fixture: ReturnType<typeof makeFixture>) => {
        fixture.filesystem.errors.set(
          cgroupEventsPath(),
          Object.assign(new Error("permission denied"), { code: "EACCES" }),
        );
      },
    ]) {
      const fixture = makeFixture();
      setup(fixture);
      fixture.command.execOutputs = [
        successOutput(runningIdentity({ mainPid: 0, subState: "failed" })),
      ];

      await expect(
        fixture.controller.cancel(cancelHandle(), { killAfterMs: 20, pollIntervalMs: 10 }),
      ).rejects.toMatchObject({ code: "scope_membership_unavailable" });

      expect(fixture.process.signals).toEqual([]);
      expect(fixture.command.execs.map((entry) => entry.argv)).toEqual([showArgs()]);
      expect(fixture.filesystem.readLog).toEqual([cgroupEventsPath()]);
    }
  });

  it("does not complete failed or dead scopes while hierarchical cgroup membership is populated", async () => {
    for (const subState of ["failed", "dead"]) {
      const fixture = makeFixture();
      fixture.filesystem.files.delete("/proc/4242/stat");
      fixture.filesystem.files.set(cgroupEventsPath(), "populated 1\n");
      fixture.command.execOutputs = [
        successOutput(runningIdentity({ mainPid: 0, subState })),
        { status: 0, stdout: "", stderr: "" },
        successOutput(runningIdentity({ mainPid: 0, subState })),
        successOutput(runningIdentity({ mainPid: 0, subState })),
        successOutput(runningIdentity({ mainPid: 0, subState })),
        { status: 0, stdout: "", stderr: "" },
        successOutput(runningIdentity({ mainPid: 0, subState })),
        successOutput(runningIdentity({ mainPid: 0, subState })),
      ];

      await expect(
        fixture.controller.cancel(cancelHandle(), { killAfterMs: 20, pollIntervalMs: 10 }),
      ).rejects.toMatchObject({ code: "scope_stop_timeout" });

      expect(fixture.process.signals).toEqual([]);
      expect(fixture.command.execs.map((entry) => entry.argv)).toEqual([
        showArgs(),
        unitSignalArgs("SIGTERM"),
        showArgs(),
        showArgs(),
        showArgs(),
        unitSignalArgs("SIGKILL"),
        showArgs(),
        showArgs(),
      ]);
    }
  });

  it("honors nested-only cgroup.events population instead of root cgroup.procs emptiness", async () => {
    const { command, controller, filesystem, process } = makeFixture();
    filesystem.files.delete("/proc/4242/stat");
    filesystem.files.set(cgroupEventsPath(), "populated 1\n");
    filesystem.files.set(cgroupProcsPath(), "");
    command.execOutputs = [
      successOutput(runningIdentity({ mainPid: 0, subState: "failed" })),
      { status: 0, stdout: "", stderr: "" },
      successOutput(runningIdentity({ mainPid: 0, subState: "failed" })),
      successOutput(runningIdentity({ mainPid: 0, subState: "failed" })),
      successOutput(runningIdentity({ mainPid: 0, subState: "failed" })),
      { status: 0, stdout: "", stderr: "" },
      successOutput(runningIdentity({ mainPid: 0, subState: "failed" })),
      successOutput(runningIdentity({ mainPid: 0, subState: "failed" })),
    ];

    await expect(
      controller.cancel(cancelHandle(), { killAfterMs: 20, pollIntervalMs: 10 }),
    ).rejects.toMatchObject({ code: "scope_stop_timeout" });

    expect(process.signals).toEqual([]);
    expect(filesystem.readLog).toContain(cgroupEventsPath());
    expect(filesystem.readLog).not.toContain(cgroupProcsPath());
  });

  it("accepts empty terminal membership as a no-signal stopped scope", async () => {
    const { command, controller, filesystem, process } = makeFixture();
    filesystem.files.set(cgroupEventsPath(), "populated 0\nfrozen 0\n");
    command.execOutputs = [
      successOutput(runningIdentity({ mainPid: 0, subState: "failed" })),
    ];

    await expect(
      controller.cancel(cancelHandle(), { killAfterMs: 20, pollIntervalMs: 10 }),
    ).resolves.toEqual({ sentKill: false, sentTerm: false });

    expect(process.signals).toEqual([]);
    expect(command.execs.map((entry) => entry.argv)).toEqual([showArgs()]);
    expect(filesystem.readLog).toEqual([cgroupEventsPath()]);
  });

  it("accepts released terminal scopes when the recorded cgroup disappeared", async () => {
    const { command, controller, filesystem, process } = makeFixture();
    command.execOutputs = [
      successOutput(
        runningIdentity({ controlGroup: undefined, mainPid: 0, subState: "dead" }),
      ),
    ];

    await expect(
      controller.cancel(cancelHandle(), { killAfterMs: 20, pollIntervalMs: 10 }),
    ).resolves.toEqual({ sentKill: false, sentTerm: false });

    expect(process.signals).toEqual([]);
    expect(command.execs.map((entry) => entry.argv)).toEqual([showArgs()]);
    expect(filesystem.readLog).toEqual([cgroupEventsPath()]);
  });

  it("refuses released terminal scopes when recorded membership is populated or unreadable", async () => {
    for (const { expectedCode, setup } of [
      {
        expectedCode: "scope_identity_unverified",
        setup: (fixture: ReturnType<typeof makeFixture>) => {
          fixture.filesystem.files.set(cgroupEventsPath(), "populated 1\n");
        },
      },
      {
        expectedCode: "scope_membership_unavailable",
        setup: (fixture: ReturnType<typeof makeFixture>) => {
          fixture.filesystem.files.set(cgroupEventsPath(), "populated maybe\n");
        },
      },
      {
        expectedCode: "scope_membership_unavailable",
        setup: (fixture: ReturnType<typeof makeFixture>) => {
          fixture.filesystem.errors.set(
            cgroupEventsPath(),
            Object.assign(new Error("permission denied"), { code: "EACCES" }),
          );
        },
      },
    ]) {
      const fixture = makeFixture();
      setup(fixture);
      fixture.command.execOutputs = [
        successOutput(
          runningIdentity({ controlGroup: undefined, mainPid: 0, subState: "failed" }),
        ),
      ];

      await expect(
        fixture.controller.cancel(cancelHandle(), { killAfterMs: 20, pollIntervalMs: 10 }),
      ).rejects.toMatchObject({ code: expectedCode });

      expect(fixture.process.signals).toEqual([]);
      expect(fixture.command.execs.map((entry) => entry.argv)).toEqual([showArgs()]);
      expect(fixture.filesystem.readLog).toEqual([cgroupEventsPath()]);
    }
  });

  it("uses verified unit TERM for known missing launcher identity and waits for scope stop", async () => {
    const { clock, command, controller, filesystem, process } = makeFixture();
    filesystem.files.delete("/proc/4242/stat");
    command.execOutputs = [
      successOutput(runningIdentity()),
      { status: 0, stdout: "", stderr: "" },
      successOutput(runningIdentity()),
      successOutput(stoppedIdentity()),
    ];

    await expect(
      controller.cancel(cancelHandle(), { killAfterMs: 20, pollIntervalMs: 10 }),
    ).resolves.toEqual({ sentKill: false, sentTerm: true });

    expect(command.execs.map((entry) => entry.argv)).toEqual([
      showArgs(),
      unitSignalArgs("SIGTERM"),
      showArgs(),
      showArgs(),
    ]);
    expect(process.signals).toEqual([]);
    expect(filesystem.readLog).toEqual(["/proc/4242/stat", cgroupEventsPath()]);
    expect(clock.sleeps).toEqual([10]);
  });

  it("refuses reused PID start time before signaling", async () => {
    const { command, controller, filesystem, process } = makeFixture();
    command.execOutputs = [successOutput(runningIdentity())];
    filesystem.files.set("/proc/4242/stat", makeProcStat(4242, "111"));

    await expect(
      controller.cancel(cancelHandle(), { killAfterMs: 20, pollIntervalMs: 10 }),
    ).rejects.toMatchObject({ code: "process_identity_mismatch" });

    expect(process.signals).toEqual([]);
    expect(command.execs.map((entry) => entry.argv)).toEqual([showArgs()]);
  });

  it("refuses changed or unverifiable live unit generation before signaling", async () => {
    const changed = makeFixture();
    changed.command.execOutputs = [
      successOutput(runningIdentity({ invocationId: "fedcba9876543210fedcba9876543210" })),
    ];
    await expect(
      changed.controller.cancel(cancelHandle(), { killAfterMs: 20, pollIntervalMs: 10 }),
    ).rejects.toMatchObject({ code: "scope_identity_mismatch" });
    expect(changed.process.signals).toEqual([]);
    expect(changed.command.execs.map((entry) => entry.argv)).toEqual([showArgs()]);

    const unverifiable = makeFixture();
    unverifiable.command.execOutputs = [
      successOutput(runningIdentity({ invocationId: undefined })),
    ];
    await expect(
      unverifiable.controller.cancel(cancelHandle(), { killAfterMs: 20, pollIntervalMs: 10 }),
    ).rejects.toMatchObject({ code: "scope_identity_unverified" });
    expect(unverifiable.process.signals).toEqual([]);
    expect(unverifiable.command.execs.map((entry) => entry.argv)).toEqual([showArgs()]);
  });

  it("treats an already stopped or collected scope as a stable no-op", async () => {
    const { command, controller, filesystem, process } = makeFixture();
    command.execOutputs = [successOutput(stoppedIdentity())];

    await expect(
      controller.cancel(cancelHandle({ identity: undefined }), { killAfterMs: 20, pollIntervalMs: 10 }),
    ).resolves.toEqual({ sentKill: false, sentTerm: false });

    expect(process.signals).toEqual([]);
    expect(command.execs.map((entry) => entry.argv)).toEqual([showArgs()]);
    expect(filesystem.readLog).toEqual([]);
  });

  it("requires the recorded identity to survive terminal stop observation", async () => {
    const { command, controller, filesystem, process } = makeFixture();
    filesystem.files.set(cgroupEventsPath(), "populated 0\n");
    process.running.set(4242, false);
    command.execOutputs = [
      successOutput(runningIdentity()),
      successOutput(
        runningIdentity({
          invocationId: "fedcba9876543210fedcba9876543210",
          mainPid: 0,
          subState: "failed",
        }),
      ),
    ];

    await expect(
      controller.cancel(cancelHandle(), { killAfterMs: 20, pollIntervalMs: 10 }),
    ).rejects.toMatchObject({ code: "scope_identity_mismatch" });

    expect(process.signals).toEqual([{ pid: 4242, signal: "SIGTERM" }]);
    expect(command.execs.map((entry) => entry.argv)).toEqual([showArgs(), showArgs()]);
  });

  it("does not treat launcher exit as whole-scope stop", async () => {
    const { clock, command, controller, process } = makeFixture();
    process.running.set(4242, false);
    command.execOutputs = [
      successOutput(runningIdentity()),
      successOutput(runningIdentity()),
      successOutput(runningIdentity()),
      successOutput(runningIdentity()),
      { status: 0, stdout: "", stderr: "" },
      successOutput(stoppedIdentity()),
    ];

    await expect(
      controller.cancel(cancelHandle(), { killAfterMs: 20, pollIntervalMs: 10 }),
    ).resolves.toEqual({ sentKill: true, sentTerm: true });

    expect(process.signals).toEqual([{ pid: 4242, signal: "SIGTERM" }]);
    expect(command.execs.map((entry) => entry.argv)).toEqual([
      showArgs(),
      showArgs(),
      showArgs(),
      showArgs(),
      unitSignalArgs("SIGKILL"),
      showArgs(),
    ]);
    expect(clock.sleeps).toEqual([10, 10]);
  });

  it("revalidates scope and launcher identity before KILL escalation", async () => {
    const changedScope = makeFixture();
    changedScope.process.running.set(4242, true);
    changedScope.command.execOutputs = [
      successOutput(runningIdentity()),
      successOutput(runningIdentity()),
      successOutput(runningIdentity()),
      successOutput(runningIdentity({ invocationId: "fedcba9876543210fedcba9876543210" })),
    ];

    await expect(
      changedScope.controller.cancel(cancelHandle(), { killAfterMs: 20, pollIntervalMs: 10 }),
    ).rejects.toMatchObject({ code: "scope_identity_mismatch" });
    expect(changedScope.command.execs.map((entry) => entry.argv)).toEqual([
      showArgs(),
      showArgs(),
      showArgs(),
      showArgs(),
    ]);
    expect(changedScope.process.signals).toEqual([{ pid: 4242, signal: "SIGTERM" }]);

    const changedPid = makeFixture();
    changedPid.process.running.set(4242, true);
    changedPid.command.execOutputs = [
      successOutput(runningIdentity()),
      successOutput(runningIdentity()),
      successOutput(runningIdentity()),
      successOutput(runningIdentity()),
    ];
    changedPid.filesystem.reads.set("/proc/4242/stat", [
      makeProcStat(4242, "998877"),
      makeProcStat(4242, "111"),
    ]);
    await expect(
      changedPid.controller.cancel(cancelHandle(), { killAfterMs: 20, pollIntervalMs: 10 }),
    ).rejects.toMatchObject({ code: "process_identity_mismatch" });
    expect(changedPid.process.signals).toEqual([{ pid: 4242, signal: "SIGTERM" }]);
    expect(changedPid.command.execs.map((entry) => entry.argv)).toEqual([
      showArgs(),
      showArgs(),
      showArgs(),
      showArgs(),
    ]);
  });

  it("fails instead of reporting canceled when scope remains after KILL", async () => {
    const { command, controller, filesystem, process } = makeFixture();
    filesystem.files.delete("/proc/4242/stat");
    command.execOutputs = [
      successOutput(runningIdentity()),
      { status: 0, stdout: "", stderr: "" },
      successOutput(runningIdentity()),
      successOutput(runningIdentity()),
      successOutput(runningIdentity()),
      { status: 0, stdout: "", stderr: "" },
      successOutput(runningIdentity()),
      successOutput(runningIdentity()),
    ];

    await expect(
      controller.cancel(cancelHandle(), { killAfterMs: 20, pollIntervalMs: 10 }),
    ).rejects.toMatchObject({ code: "scope_stop_timeout" });

    expect(process.signals).toEqual([]);
    expect(command.execs.map((entry) => entry.argv)).toEqual([
      showArgs(),
      unitSignalArgs("SIGTERM"),
      showArgs(),
      showArgs(),
      showArgs(),
      unitSignalArgs("SIGKILL"),
      showArgs(),
      showArgs(),
    ]);
  });

  it("makes repeated cancellation of a stopped scope a no-op without extra signals", async () => {
    const { command, controller, filesystem, process } = makeFixture();
    filesystem.files.delete("/proc/4242/stat");
    command.execOutputs = [
      successOutput(runningIdentity()),
      { status: 0, stdout: "", stderr: "" },
      successOutput(stoppedIdentity()),
      successOutput(stoppedIdentity()),
    ];

    await expect(
      controller.cancel(cancelHandle(), { killAfterMs: 20, pollIntervalMs: 10 }),
    ).resolves.toEqual({ sentKill: false, sentTerm: true });
    await expect(
      controller.cancel(cancelHandle({ identity: undefined }), { killAfterMs: 20, pollIntervalMs: 10 }),
    ).resolves.toEqual({ sentKill: false, sentTerm: false });

    expect(process.signals).toEqual([]);
    expect(command.execs.map((entry) => entry.argv)).toEqual([
      showArgs(),
      unitSignalArgs("SIGTERM"),
      showArgs(),
      showArgs(),
    ]);
  });
});

describe("Shohin root-managed scope controller (decision069/070)", () => {
  it("builds root scope launch argv as arrays, nesting setpriv/env/watchdog/runner behind a single sudo systemd-run invocation", async () => {
    const { command, controller } = makeRootFixture();
    command.execOutputs = [
      sudoOkOutput,
      successOutput(rootStoppedIdentity()),
      rootShowOutput(rootRunningIdentity()),
    ];

    const handle = await controller.launch(rootLaunchOptions());

    expect(handle.command).toBe("sudo");
    expect(command.spawns).toHaveLength(1);
    const spawn = command.spawns[0];
    expect(spawn.command).toBe("sudo");
    expect(spawn.argv[0]).toBe("-n");
    expect(spawn.argv[1]).toBe("systemd-run");
    expect(spawn.argv).toEqual(
      expect.arrayContaining(["--uid", "david", "--gid", "david", "IPAccounting=yes"]),
    );
    expect(spawn.argv).not.toContain("--user");
    expect(spawn.argv).not.toContain("NoNewPrivileges=yes");

    const setprivIndex = spawn.argv.indexOf("setpriv");
    expect(setprivIndex).toBeGreaterThan(0);
    expect(spawn.argv[setprivIndex - 1]).toBe("--");
    expect(spawn.argv.slice(setprivIndex, setprivIndex + 3)).toEqual([
      "setpriv",
      "--no-new-privs",
      "--",
    ]);
    expect(spawn.argv.slice(setprivIndex + 3, setprivIndex + 5)).toEqual(["env", "-i"]);
    expect(spawn.argv).toEqual(
      expect.arrayContaining([watchdogPath, "--", "/bin/sleep", "2"]),
    );

    // A single argv array is spawned once; every descendant (setpriv, env,
    // watchdog, runner) is nested inside it rather than launched separately.
    expect(command.spawns).toHaveLength(1);
  });

  it("requests loopback-only network properties in root scope launch argv (only the root manager may request enforcement)", async () => {
    const { command, controller } = makeRootFixture();
    command.execOutputs = [
      sudoOkOutput,
      successOutput(rootStoppedIdentity()),
      rootShowOutput(rootRunningIdentity()),
    ];

    await controller.launch(rootLaunchOptions());

    const spawn = command.spawns[0];
    const executorBoundary = spawn.argv.indexOf("--");
    const systemdArgv = spawn.argv.slice(0, executorBoundary);
    expect(systemdArgv).toEqual(
      expect.arrayContaining([
        "IPAddressDeny=any",
        "IPAddressAllow=localhost",
        "IPAddressAllow=127.0.0.0/8",
        "IPAddressAllow=::1",
      ]),
    );
  });

  it("refuses shell-unsafe topic/run id components before any argv is constructed", async () => {
    const { command, controller } = makeRootFixture();
    await expect(
      controller.launch({ ...rootLaunchOptions(), runId: "run005; rm -rf /" }),
    ).rejects.toMatchObject({ code: "invalid_scope_id" });
    expect(command.spawns).toHaveLength(0);
  });

  it("requires an explicit payload user and group to construct a root controller", () => {
    expect(() => createScopeController({ manager: "root" })).toThrow();
    expect(() => createScopeController({ manager: "root", payloadUser: "david" })).toThrow();
  });

  it("requires loopback-only network access for root scope launches", async () => {
    const { command, controller } = makeRootFixture();
    command.execOutputs = [sudoOkOutput, successOutput(rootStoppedIdentity())];
    await expect(
      controller.launch({ ...baseLaunchOptions(), networkAccess: "inherit" }),
    ).rejects.toMatchObject({ code: "invalid_scope_option" });
    expect(command.spawns).toHaveLength(0);
  });

  it("fails closed before any systemd-run invocation when noninteractive root is unavailable or refused", async () => {
    const { command, controller } = makeRootFixture();
    command.execOutputs = [{ status: 1, stdout: "", stderr: "sudo: a password is required\n" }];

    await expect(controller.launch(rootLaunchOptions())).rejects.toMatchObject({
      code: "root_scope_sudo_unavailable",
    });

    expect(command.spawns).toHaveLength(0);
    expect(command.execs).toHaveLength(1);
    expect(command.execs[0]).toMatchObject({ command: "sudo", argv: ["-n", "true"] });
  });

  it("refuses to launch when the root-managed unit name already exists (collision)", async () => {
    const { command, controller } = makeRootFixture();
    command.execOutputs = [sudoOkOutput, rootShowOutput(rootRunningIdentity())];

    await expect(controller.launch(rootLaunchOptions())).rejects.toMatchObject({
      code: "root_scope_unit_collision",
    });

    expect(command.spawns).toHaveLength(0);
    expect(command.execs.map((entry) => entry.argv)).toEqual([
      ["-n", "true"],
      rootShowArgs(),
    ]);
  });

  it("fails closed after launch when the reported network properties are entirely missing (property/identity mismatch)", async () => {
    const { command, controller } = makeRootFixture();
    command.execOutputs = [
      sudoOkOutput,
      successOutput(rootStoppedIdentity()),
      // Simulates systemd silently failing to apply/record the requested
      // IPAddressDeny/IPAddressAllow properties at all.
      rootShowOutput(rootRunningIdentity({ ipAddressAllow: undefined, ipAddressDeny: undefined })),
    ];

    await expect(controller.launch(rootLaunchOptions())).rejects.toMatchObject({
      code: "root_scope_property_mismatch",
    });
  });

  it("fails closed after launch when loopback-restriction properties are recorded but do not match what was requested (recorded-but-ineffective)", async () => {
    for (const mismatch of [
      { ipAddressDeny: "no" },
      { ipAddressAllow: "0.0.0.0/0" },
    ]) {
      const { command, controller } = makeRootFixture();
      command.execOutputs = [
        sudoOkOutput,
        successOutput(rootStoppedIdentity()),
        rootShowOutput(rootRunningIdentity(mismatch)),
      ];

      await expect(controller.launch(rootLaunchOptions())).rejects.toMatchObject({
        code: "root_scope_property_mismatch",
      });
    }
  });

  it("launches successfully once sudo, collision and property checks all pass", async () => {
    const { command, controller } = makeRootFixture();
    command.execOutputs = [
      sudoOkOutput,
      successOutput(rootStoppedIdentity()),
      rootShowOutput(rootRunningIdentity()),
    ];

    const handle = await controller.launch(rootLaunchOptions());
    expect(handle.scopeId).toBe(scopeId);
    expect(handle.controlPid).toBe(4242);
    expect(command.execs).toHaveLength(3);
  });

  it("refuses to cancel a reused control PID whose start time no longer matches (PID reuse)", async () => {
    const { command, controller, filesystem } = makeRootFixture();
    filesystem.files.set("/proc/4242/stat", makeProcStat(4242, "111111"));
    command.execOutputs = [rootShowOutput(rootRunningIdentity())];

    await expect(
      controller.cancel(cancelHandle(), { killAfterMs: 20, pollIntervalMs: 10 }),
    ).rejects.toMatchObject({ code: "process_identity_mismatch" });
  });

  it("refuses to cancel a root scope whose live invocation identity no longer matches the recorded one (unit/generation reuse)", async () => {
    const { command, controller } = makeRootFixture();
    command.execOutputs = [
      rootShowOutput(
        rootRunningIdentity({ invocationId: "ffffffffffffffffffffffffffffffff" }),
      ),
    ];

    await expect(
      controller.cancel(cancelHandle(), { killAfterMs: 20, pollIntervalMs: 10 }),
    ).rejects.toMatchObject({ code: "scope_identity_mismatch" });

    expect(command.execs.map((entry) => entry.argv)).toEqual([rootShowArgs()]);
  });

  it("makes repeated cancellation of a stopped root scope a no-op without extra signals (idempotence)", async () => {
    const { command, controller, filesystem, process } = makeRootFixture();
    filesystem.files.delete("/proc/4242/stat");
    command.execOutputs = [
      rootShowOutput(rootRunningIdentity()),
      sudoOkOutput,
      rootShowOutput(rootStoppedIdentity()),
      rootShowOutput(rootStoppedIdentity()),
    ];

    await expect(
      controller.cancel(cancelHandle(), { killAfterMs: 20, pollIntervalMs: 10 }),
    ).resolves.toEqual({ sentKill: false, sentTerm: true });
    await expect(
      controller.cancel(cancelHandle({ identity: undefined }), {
        killAfterMs: 20,
        pollIntervalMs: 10,
      }),
    ).resolves.toEqual({ sentKill: false, sentTerm: false });

    expect(process.signals).toEqual([]);
    expect(command.execs.map((entry) => entry.argv)).toEqual([
      rootShowArgs(),
      rootUnitSignalArgs("SIGTERM"),
      rootShowArgs(),
      rootShowArgs(),
    ]);
  });

  it("fails instead of reporting canceled when the root scope remains after SIGKILL (cleanup failure)", async () => {
    const { command, controller, filesystem, process } = makeRootFixture();
    filesystem.files.delete("/proc/4242/stat");
    command.execOutputs = [
      rootShowOutput(rootRunningIdentity()),
      sudoOkOutput,
      rootShowOutput(rootRunningIdentity()),
      rootShowOutput(rootRunningIdentity()),
      rootShowOutput(rootRunningIdentity()),
      sudoOkOutput,
      rootShowOutput(rootRunningIdentity()),
      rootShowOutput(rootRunningIdentity()),
    ];

    await expect(
      controller.cancel(cancelHandle(), { killAfterMs: 20, pollIntervalMs: 10 }),
    ).rejects.toMatchObject({ code: "scope_stop_timeout" });

    expect(process.signals).toEqual([]);
    expect(command.execs.map((entry) => entry.argv)).toEqual([
      rootShowArgs(),
      rootUnitSignalArgs("SIGTERM"),
      rootShowArgs(),
      rootShowArgs(),
      rootShowArgs(),
      rootUnitSignalArgs("SIGKILL"),
      rootShowArgs(),
      rootShowArgs(),
    ]);
  });

  it("cancels a running root scope via the direct control PID before falling back to systemctl kill", async () => {
    const { command, controller, process } = makeRootFixture();
    // /proc/4242/stat is left present (matching controlStartTime "998877"),
    // so the launcher PID is signaled directly instead of via systemctl kill.
    command.execOutputs = [
      rootShowOutput(rootRunningIdentity()),
      rootShowOutput(rootStoppedIdentity()),
    ];

    const result = await controller.cancel(
      cancelHandle({ controlPid: 4242, controlStartTime: "998877" }),
      { killAfterMs: 20, pollIntervalMs: 10 },
    );

    expect(result).toEqual({ sentKill: false, sentTerm: true });
    expect(process.signals).toEqual([{ pid: 4242, signal: "SIGTERM" }]);
    expect(command.execs.map((entry) => entry.argv)).toEqual([rootShowArgs(), rootShowArgs()]);
  });

  // The argv-nesting assertion in the first test above proves command
  // construction, not containment: it never observes whether a descendant
  // process actually shares the scope's cgroup. This test proves it via the
  // real signal: `cgroup.events` "populated" stays 1 while a descendant is
  // still alive inside the scope's cgroup even after the scope unit itself
  // has gone terminal, and only drops to 0 once that descendant exits. The
  // only signal ever sent is the exact-identity `systemctl kill
  // --kill-whom=all` for this unit (`rootUnitSignalArgs`) -- no broad root
  // process signal is used to reach it.
  it("contains a descendant process in the root scope cgroup and terminates it via exact-identity systemctl kill --kill-whom=all (descendant containment)", async () => {
    const { command, controller, filesystem, process } = makeRootFixture();
    filesystem.files.delete("/proc/4242/stat");
    filesystem.reads.set(cgroupEventsPath(), [
      "populated 1\n", // initial inspect: the payload's descendant is still alive
      "populated 1\n", // first post-SIGTERM poll: descendant still alive
      "populated 0\n", // descendant has exited; the cgroup is now empty
    ]);
    command.execOutputs = [
      rootShowOutput(rootRunningIdentity({ mainPid: 0, subState: "failed" })),
      sudoOkOutput,
      rootShowOutput(rootRunningIdentity({ mainPid: 0, subState: "failed" })),
      rootShowOutput(rootRunningIdentity({ mainPid: 0, subState: "dead" })),
    ];

    const result = await controller.cancel(cancelHandle(), {
      killAfterMs: 20,
      pollIntervalMs: 10,
    });

    expect(result).toEqual({ sentKill: false, sentTerm: true });
    expect(process.signals).toEqual([]);
    expect(command.execs.map((entry) => entry.argv)).toEqual([
      rootShowArgs(),
      rootUnitSignalArgs("SIGTERM"),
      rootShowArgs(),
      rootShowArgs(),
    ]);
    expect(
      filesystem.readLog.filter((entry) => entry === cgroupEventsPath()),
    ).toHaveLength(3);
  });
});

describe("Shohin root-managed scope live IP accounting (decision070 gotcha 2)", () => {
  const rootAccountingShowArgs = () => [
    "-n",
    "systemctl",
    "show",
    scopeId,
    "--property=Id",
    "--property=SubState",
    "--property=LoadState",
    "--property=InvocationID",
    "--property=IPIngressBytes",
    "--property=IPEgressBytes",
    "--no-pager",
  ];

  const rootAccountingShowOutput = ({
    id = scopeId,
    invocationId: invocation = invocationId,
    ipEgressBytes,
    ipIngressBytes,
    loadState = "loaded",
    subState = "running",
  }: {
    readonly id?: string;
    readonly invocationId?: string;
    readonly ipEgressBytes?: string;
    readonly ipIngressBytes?: string;
    readonly loadState?: string;
    readonly subState?: string;
  } = {}): CommandOutput => ({
    status: 0,
    stdout: [
      `Id=${id}`,
      `SubState=${subState}`,
      `LoadState=${loadState}`,
      `InvocationID=${invocation}`,
      ...(ipIngressBytes === undefined ? [] : [`IPIngressBytes=${ipIngressBytes}`]),
      ...(ipEgressBytes === undefined ? [] : [`IPEgressBytes=${ipEgressBytes}`]),
      "",
    ].join("\n"),
    stderr: "",
  });

  it("captures a live IPIngressBytes/IPEgressBytes sample bound to the exact unit/InvocationID identity", async () => {
    const { command, controller } = makeRootFixture();
    command.execOutputs = [
      rootAccountingShowOutput({ ipEgressBytes: "2048", ipIngressBytes: "4096" }),
    ];

    const sample = await controller.sampleAccounting(cancelHandle());

    expect(sample).toMatchObject({
      invocationId,
      ipEgressBytes: 2048,
      ipIngressBytes: 4096,
      scopeId,
    });
    expect(typeof sample.capturedAt).toBe("string");
    expect(command.execs.map((entry) => entry.argv)).toEqual([rootAccountingShowArgs()]);
  });

  it("refuses a [no data] accounting read instead of silently recording zero bytes", async () => {
    const { command, controller } = makeRootFixture();
    command.execOutputs = [
      rootAccountingShowOutput({ ipEgressBytes: "[no data]", ipIngressBytes: "[no data]" }),
    ];

    await expect(controller.sampleAccounting(cancelHandle())).rejects.toMatchObject({
      code: "scope_accounting_unavailable",
    });
  });

  it("refuses a post-exit accounting sample instead of trusting a stale terminal-state read", async () => {
    const { command, controller } = makeRootFixture();
    command.execOutputs = [
      rootAccountingShowOutput({
        ipEgressBytes: "2048",
        ipIngressBytes: "4096",
        subState: "dead",
      }),
    ];

    await expect(controller.sampleAccounting(cancelHandle())).rejects.toMatchObject({
      code: "scope_accounting_unavailable",
    });
  });

  it("rejects an accounting sample whose invocation identity does not match the bound scope (reused unit)", async () => {
    const { command, controller } = makeRootFixture();
    command.execOutputs = [
      rootAccountingShowOutput({
        invocationId: "ffffffffffffffffffffffffffffffff",
        ipEgressBytes: "2048",
        ipIngressBytes: "4096",
      }),
    ];

    await expect(controller.sampleAccounting(cancelHandle())).rejects.toMatchObject({
      code: "scope_identity_mismatch",
    });
  });

  it("refuses an unbound accounting sample with no recorded identity to bind against", async () => {
    const { command, controller } = makeRootFixture();
    command.execOutputs = [
      rootAccountingShowOutput({ ipEgressBytes: "2048", ipIngressBytes: "4096" }),
    ];

    await expect(
      controller.sampleAccounting(cancelHandle({ identity: undefined })),
    ).rejects.toMatchObject({ code: "scope_identity_unverified" });
  });

  it("refuses accounting sampling on the ordinary user-managed scope controller", async () => {
    const { command, controller } = makeFixture();

    await expect(controller.sampleAccounting(cancelHandle())).rejects.toMatchObject({
      code: "invalid_scope_option",
    });
    expect(command.execs).toHaveLength(0);
  });
});

describe("Shohin in-scope watchdog safety helpers", () => {
  it("derives the cgroup-v2 kill path and writes cgroup.kill once", () => {
    const filesystem = new FakeFilesystem();
    const killPath =
      "/tmp/fake-cgroup/user.slice/user-1000.slice/app.slice/shohin.scope/cgroup.kill";
    filesystem.files.set(
      "/proc/self/cgroup",
      "0::/user.slice/user-1000.slice/app.slice/shohin.scope\n",
    );
    filesystem.writable.add(killPath);

    expect(
      deriveUnifiedCgroupKillPath(
        filesystem.readTextFile("/proc/self/cgroup"),
        "/tmp/fake-cgroup",
      ),
    ).toBe(killPath);
    expect(
      writeOwnCgroupKill({
        filesystem,
        procSelfCgroupPath: "/proc/self/cgroup",
        sysFsCgroupRoot: "/tmp/fake-cgroup",
      }),
    ).toBe(killPath);
    expect(filesystem.writes).toEqual([{ filePath: killPath, content: "1\n" }]);
  });

  it("fails closed by name when unified cgroup-v2 kill is unavailable", () => {
    const filesystem = new FakeFilesystem();
    filesystem.files.set("/proc/self/cgroup", "1:name=systemd:/legacy\n");

    expect(() =>
      writeOwnCgroupKill({
        filesystem,
        procSelfCgroupPath: "/proc/self/cgroup",
        sysFsCgroupRoot: "/tmp/fake-cgroup",
      }),
    ).toThrow(/cgroup.kill unavailable/);
    expect(filesystem.writes).toEqual([]);
  });

  it("runs a watchdog-disabled probe without heartbeat polling", () => {
    const temp = makeTempRoot("watchdog-disabled");
    const marker = path.join(temp, "runner-ran");
    const heartbeat = path.join(temp, "missing-heartbeat");
    const runner = path.join(temp, "runner.sh");
    writeFileSync(
      runner,
      ["#!/usr/bin/env bash", "set -euo pipefail", "printf ran > \"$1\"", "exit 23", ""].join(
        "\n",
      ),
      { mode: 0o600 },
    );
    chmodSync(runner, 0o755);

    const result = spawnSync(
      watchdogPath,
      [
        "--scope-id",
        "shohin-test-run.scope",
        "--run-dir",
        temp,
        "--heartbeat",
        heartbeat,
        "--heartbeat-stale-ms",
        "1",
        "--heartbeat-poll-ms",
        "1",
        "--probe-mode",
        "--disable-watchdog",
        "--",
        runner,
        marker,
      ],
      {
        encoding: "utf-8",
        env: { PATH: process.env.PATH ?? "/usr/bin:/bin" },
      },
    );

    expect(result.status).toBe(23);
    expect(result.stderr).toBe("");
  });

  it("keeps a fresh heartbeat alive without relying on date width modifiers", () => {
    const temp = makeTempRoot("watchdog-fresh");
    const fixture = makeWatchdogScriptFixture(temp);
    const heartbeat = path.join(fixture.runDir, "heartbeat.json");
    const runner = path.join(temp, "runner.sh");
    writeFileSync(heartbeat, "{}\n");
    writeFileSync(
      runner,
      ["#!/usr/bin/env bash", "set -euo pipefail", "sleep 0.2", "exit 0", ""].join("\n"),
      { mode: 0o600 },
    );
    chmodSync(runner, 0o755);

    const result = spawnSync(
      watchdogPath,
      [
        "--scope-id",
        "shohin-test-fresh.scope",
        "--run-dir",
        fixture.runDir,
        "--heartbeat",
        heartbeat,
        "--heartbeat-stale-ms",
        "30000",
        "--heartbeat-poll-ms",
        "50",
        "--probe-mode",
        "--",
        runner,
      ],
      {
        encoding: "utf-8",
        env: fixture.env,
      },
    );

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(readFileSync(fixture.killFile, "utf-8")).toBe("");
  });

  it("kills on a genuinely stale heartbeat and reports comparable millisecond clocks", () => {
    const temp = makeTempRoot("watchdog-stale");
    const fixture = makeWatchdogScriptFixture(temp);
    const heartbeat = path.join(fixture.runDir, "heartbeat.json");
    const runner = path.join(temp, "runner.sh");
    const runnerPid = path.join(temp, "runner.pid");
    writeFileSync(heartbeat, "{}\n");
    const old = new Date(Date.now() - 5_000);
    utimesSync(heartbeat, old, old);
    writeFileSync(
      runner,
      [
        "#!/usr/bin/env bash",
        "set -euo pipefail",
        "printf '%s\\n' \"$$\" > \"$1\"",
        "sleep 10",
        "",
      ].join("\n"),
      { mode: 0o600 },
    );
    chmodSync(runner, 0o755);

    const result = spawnSync(
      watchdogPath,
      [
        "--scope-id",
        "shohin-test-stale.scope",
        "--run-dir",
        fixture.runDir,
        "--heartbeat",
        heartbeat,
        "--heartbeat-stale-ms",
        "1000",
        "--heartbeat-poll-ms",
        "50",
        "--probe-mode",
        "--",
        runner,
        runnerPid,
      ],
      {
        encoding: "utf-8",
        env: fixture.env,
        timeout: 2_500,
      },
    );

    try {
      const pid = Number(readFileSync(runnerPid, "utf-8"));
      if (Number.isSafeInteger(pid) && pid > 0) {
        process.kill(pid, "SIGKILL");
      }
    } catch {
      // The fake cgroup.kill file cannot kill the child; cleanup is best-effort.
    }

    expect(result.status).toBe(124);
    expect(result.stderr).toMatch(
      /^watchdog\.sh: heartbeat stale now_ms=\d{13} mtime_ms=\d{13} age_ms=\d+ stale_ms=1000\n$/,
    );
    expect(result.stderr).not.toContain("%3N");
    expect(readFileSync(fixture.killFile, "utf-8")).toBe("1\n");
  });

  it("still writes cgroup.kill when stale diagnostics cannot write to stderr", () => {
    const temp = makeTempRoot("watchdog-full-stderr");
    const fixture = makeWatchdogScriptFixture(temp);
    const heartbeat = path.join(fixture.runDir, "heartbeat.json");
    const runner = path.join(temp, "runner.sh");
    const runnerPid = path.join(temp, "runner.pid");
    writeFileSync(heartbeat, "{}\n");
    const old = new Date(Date.now() - 5_000);
    utimesSync(heartbeat, old, old);
    writeFileSync(
      runner,
      [
        "#!/usr/bin/env bash",
        "set -euo pipefail",
        `printf '%s\\n' "$$" > "$1"`,
        "sleep 10",
        "",
      ].join("\n"),
      { mode: 0o600 },
    );
    chmodSync(runner, 0o755);

    const stderrFd = openSync("/dev/full", "w");
    const result = spawnSync(
      watchdogPath,
      [
        "--scope-id",
        "shohin-test-full-stderr.scope",
        "--run-dir",
        fixture.runDir,
        "--heartbeat",
        heartbeat,
        "--heartbeat-stale-ms",
        "1000",
        "--heartbeat-poll-ms",
        "50",
        "--probe-mode",
        "--",
        runner,
        runnerPid,
      ],
      {
        encoding: "utf-8",
        env: fixture.env,
        stdio: ["ignore", "pipe", stderrFd],
        timeout: 2_500,
      },
    );
    closeSync(stderrFd);

    try {
      const pid = Number(readFileSync(runnerPid, "utf-8"));
      if (Number.isSafeInteger(pid) && pid > 0) {
        process.kill(pid, "SIGKILL");
      }
    } catch {
      // The fake cgroup.kill file cannot kill the child; cleanup is best-effort.
    }

    expect(result.status).toBe(124);
    expect(readFileSync(fixture.killFile, "utf-8")).toBe("1\n");
  });

  it("rejects watchdog cgroup test overrides outside explicit probe mode", () => {
    const temp = makeTempRoot("watchdog-override-denied");
    const fixture = makeWatchdogScriptFixture(temp);
    const heartbeat = path.join(fixture.runDir, "heartbeat.json");
    const runner = path.join(temp, "runner.sh");
    writeFileSync(heartbeat, "{}\n");
    writeFileSync(runner, "#!/usr/bin/env bash\nexit 0\n", { mode: 0o600 });
    chmodSync(runner, 0o755);

    const result = spawnSync(
      watchdogPath,
      [
        "--scope-id",
        "shohin-test-denied.scope",
        "--run-dir",
        fixture.runDir,
        "--heartbeat",
        heartbeat,
        "--heartbeat-stale-ms",
        "30000",
        "--heartbeat-poll-ms",
        "50",
        "--",
        runner,
      ],
      {
        encoding: "utf-8",
        env: fixture.env,
      },
    );

    expect(result.status).toBe(2);
    expect(result.stderr).toContain("watchdog cgroup test overrides require explicit probe mode");
    expect(readFileSync(fixture.killFile, "utf-8")).toBe("");
  });

});
