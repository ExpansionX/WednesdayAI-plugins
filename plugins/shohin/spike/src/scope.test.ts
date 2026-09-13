import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

  public async wait(): Promise<number> {
    return this.status;
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
});
