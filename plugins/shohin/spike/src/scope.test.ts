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
  public readonly files = new Map<string, string>();
  public readonly writable = new Set<string>();
  public readonly writes: Array<{ readonly filePath: string; readonly content: string }> =
    [];

  public readTextFile(filePath: string): string {
    const content = this.files.get(filePath);
    if (content === undefined) {
      throw new Error(`missing fake file: ${filePath}`);
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

    expect(handle.scopeId).toBe("shohin-shohin-phase-0-spike-run005.scope");
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
      "shohin-shohin-phase-0-spike-run005.scope",
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
        "shohin-shohin-phase-0-spike-run005.scope",
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

  it("revalidates Id and PID start time before TERM and bounded KILL", async () => {
    const { clock, command, controller, process } = makeFixture();
    command.execOutputs = [
      {
        status: 0,
        stdout:
          "Id=shohin-shohin-phase-0-spike-run005.scope\nMainPID=77\nControlGroup=/user.slice/app.scope\nSubState=running\n",
        stderr: "",
      },
    ];
    process.running.set(4242, true);

    await controller.cancel(
      {
        controlEnv: baseLaunchOptions().controlEnv,
        controlPid: 4242,
        controlStartTime: "998877",
        scopeId: "shohin-shohin-phase-0-spike-run005.scope",
      },
      { killAfterMs: 20, pollIntervalMs: 10 },
    );

    expect(command.execs[0].argv).toEqual([
      "--user",
      "show",
      "shohin-shohin-phase-0-spike-run005.scope",
      "--property=Id",
      "--property=MainPID",
      "--property=ControlGroup",
      "--property=SubState",
      "--property=LoadState",
      "--no-pager",
    ]);
    expect(process.signals).toEqual([
      { pid: 4242, signal: "SIGTERM" },
      { pid: 4242, signal: "SIGKILL" },
    ]);
    expect(clock.sleeps).toEqual([10, 10]);
  });

  it("uses verified systemctl unit kill when the control pid has exited", async () => {
    const { clock, command, controller, filesystem, process } = makeFixture();
    filesystem.files.delete("/proc/4242/stat");
    command.execOutputs = [
      {
        status: 0,
        stdout:
          "Id=shohin-shohin-phase-0-spike-run005.scope\nMainPID=77\nControlGroup=/user.slice/app.scope\nSubState=running\nLoadState=loaded\n",
        stderr: "",
      },
      { status: 0, stdout: "", stderr: "" },
      {
        status: 0,
        stdout:
          "Id=shohin-shohin-phase-0-spike-run005.scope\nMainPID=77\nControlGroup=/user.slice/app.scope\nSubState=running\nLoadState=loaded\n",
        stderr: "",
      },
      {
        status: 0,
        stdout:
          "Id=shohin-shohin-phase-0-spike-run005.scope\nMainPID=0\nSubState=dead\nLoadState=not-found\n",
        stderr: "",
      },
    ];

    await expect(
      controller.cancel(
        {
          controlEnv: baseLaunchOptions().controlEnv,
          controlPid: 4242,
          controlStartTime: "998877",
          scopeId: "shohin-shohin-phase-0-spike-run005.scope",
        },
        { killAfterMs: 20, pollIntervalMs: 10 },
      ),
    ).resolves.toEqual({ sentKill: false, sentTerm: true });

    expect(command.execs.map((entry) => entry.argv)).toEqual([
      [
        "--user",
        "show",
        "shohin-shohin-phase-0-spike-run005.scope",
        "--property=Id",
        "--property=MainPID",
        "--property=ControlGroup",
        "--property=SubState",
        "--property=LoadState",
        "--no-pager",
      ],
      [
        "--user",
        "kill",
        "--kill-whom=all",
        "--signal=SIGTERM",
        "shohin-shohin-phase-0-spike-run005.scope",
      ],
      [
        "--user",
        "show",
        "shohin-shohin-phase-0-spike-run005.scope",
        "--property=Id",
        "--property=MainPID",
        "--property=ControlGroup",
        "--property=SubState",
        "--property=LoadState",
        "--no-pager",
      ],
      [
        "--user",
        "show",
        "shohin-shohin-phase-0-spike-run005.scope",
        "--property=Id",
        "--property=MainPID",
        "--property=ControlGroup",
        "--property=SubState",
        "--property=LoadState",
        "--no-pager",
      ],
    ]);
    expect(process.signals).toEqual([]);
    expect(clock.sleeps).toEqual([10]);
  });

  it("rejects Id mismatch or reused PID start time before signaling", async () => {
    const mismatch = makeFixture();
    mismatch.command.execOutputs = [
      {
        status: 0,
        stdout: "Id=other.scope\nMainPID=77\nControlGroup=/wrong\n",
        stderr: "",
      },
    ];
    await expect(
      mismatch.controller.cancel({
        controlEnv: baseLaunchOptions().controlEnv,
        controlPid: 4242,
        controlStartTime: "998877",
        scopeId: "shohin-shohin-phase-0-spike-run005.scope",
      }),
    ).rejects.toMatchObject({ code: "scope_id_mismatch" });
    expect(mismatch.process.signals).toEqual([]);

    const reusedPid = makeFixture();
    reusedPid.command.execOutputs = [
      {
        status: 0,
        stdout:
          "Id=shohin-shohin-phase-0-spike-run005.scope\nMainPID=77\nControlGroup=/user.slice/app.scope\n",
        stderr: "",
      },
    ];
    reusedPid.filesystem.files.set("/proc/4242/stat", makeProcStat(4242, "111"));
    await expect(
      reusedPid.controller.cancel({
        controlEnv: baseLaunchOptions().controlEnv,
        controlPid: 4242,
        controlStartTime: "998877",
        scopeId: "shohin-shohin-phase-0-spike-run005.scope",
      }),
    ).rejects.toMatchObject({ code: "process_identity_mismatch" });
    expect(reusedPid.process.signals).toEqual([]);
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
