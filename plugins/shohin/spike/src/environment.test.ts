import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildControlEnvironment,
  buildExecutorEnvironment,
  copyAllowedHome,
  readAllowList,
  resolveLinkedWorktree,
  resolveRegisteredRepoRoot,
  validateTopic,
} from "./environment.js";

const packageRoot = path.resolve(import.meta.dirname, "..");
const repoRoot = path.resolve(packageRoot, "../../..");
const tempRoots: string[] = [];

const makeTempRoot = (name: string): string => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), `shohin-${name}-`));
  tempRoots.push(tempRoot);
  return tempRoot;
};

const makeGitRepo = (name: string): string => {
  const root = path.join(makeTempRoot(name), "repo");
  mkdirSync(root, { recursive: true, mode: 0o700 });
  execFileSync("git", ["init", "--initial-branch=main"], { cwd: root });
  execFileSync("git", ["config", "user.email", "shohin@example.invalid"], {
    cwd: root,
  });
  execFileSync("git", ["config", "user.name", "Shohin Test"], { cwd: root });
  writeFileSync(path.join(root, "README.md"), "fixture\n", { mode: 0o600 });
  execFileSync("git", ["add", "README.md"], { cwd: root });
  execFileSync("git", ["commit", "-m", "fixture"], { cwd: root });
  return root;
};

const makeRunnerEnv = (overrides: Record<string, string> = {}) => ({
  PATH: "/usr/bin:/bin",
  WAI_RUN_ID: "run-003",
  WAI_RUN_DIR: "/tmp/shohin-run-003",
  WAI_TOPIC: "shohin-phase-0-spike",
  ...overrides,
});

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("Shohin environment builder", () => {
  it("validates topic names without accepting traversal or shell metacharacters", () => {
    expect(validateTopic("shohin-phase-0-spike")).toBe(
      "shohin-phase-0-spike",
    );
    expect(validateTopic("phase_0.topic")).toBe("phase_0.topic");

    for (const topic of [
      "",
      ".",
      "..",
      "../escape",
      "escape/child",
      "escape child",
      "escape$child",
    ]) {
      expect(() => validateTopic(topic)).toThrow(/topic/i);
    }
  });

  it("resolves registered roots canonically and rejects traversal or symlink aliases", () => {
    const outside = makeTempRoot("outside");
    const linkedRoot = path.join(outside, "repo-link");
    symlinkSync(repoRoot, linkedRoot, "dir");

    expect(resolveRegisteredRepoRoot(repoRoot, repoRoot)).toBe(repoRoot);
    expect(resolveRegisteredRepoRoot(`${repoRoot}/.`, repoRoot)).toBe(repoRoot);

    expect(() =>
      resolveRegisteredRepoRoot(path.join(repoRoot, ".."), repoRoot),
    ).toThrow(/registered repo root/i);
    expect(() => resolveRegisteredRepoRoot(linkedRoot, repoRoot)).toThrow(
      /registered repo root/i,
    );
  });

  it("accepts linked worktrees only when their Git common directory matches", () => {
    const sourceRepo = makeGitRepo("same-common");
    const worktree = path.join(makeTempRoot("linked"), "linked-worktree");
    execFileSync("git", ["worktree", "add", worktree], { cwd: sourceRepo });

    expect(resolveLinkedWorktree(worktree, sourceRepo)).toBe(
      path.resolve(worktree),
    );
  });

  it("rejects child directories, traversal, symlinks, and different repositories as worktrees", () => {
    const sourceRepo = makeGitRepo("source");
    const otherRepo = makeGitRepo("other");
    const child = path.join(sourceRepo, "child");
    mkdirSync(child, { mode: 0o700 });
    const link = path.join(makeTempRoot("worktree-link"), "source-link");
    symlinkSync(sourceRepo, link, "dir");

    expect(() => resolveLinkedWorktree(child, sourceRepo)).toThrow(
      /worktree/i,
    );
    expect(() =>
      resolveLinkedWorktree(`${sourceRepo}/../${path.basename(sourceRepo)}`, sourceRepo),
    ).toThrow(/traversal/i);
    expect(() => resolveLinkedWorktree(link, sourceRepo)).toThrow(
      /canonical/i,
    );
    expect(() => resolveLinkedWorktree(otherRepo, sourceRepo)).toThrow(
      /common git directory/i,
    );
  });

  it("keeps tracked allow lists minimal immutable defaults", () => {
    expect(readFileSync(path.join(packageRoot, "home.allow"), "utf-8")).toBe("");
    expect(readAllowList(path.join(packageRoot, "home.allow"))).toEqual([]);
    expect(readAllowList(path.join(packageRoot, "env.allow"))).toEqual([
      "PATH",
    ]);
  });

  it("copies only contained regular home files into a mode-0700 HOME", () => {
    const sourceHome = path.join(makeTempRoot("home-source"), "home");
    const runHome = path.join(makeTempRoot("run-home"), "HOME");
    mkdirSync(path.join(sourceHome, ".config", "opencode"), {
      recursive: true,
      mode: 0o700,
    });
    writeFileSync(
      path.join(sourceHome, ".config", "opencode", "auth.json"),
      '{"auth":"owned-harness-token"}\n',
      { mode: 0o600 },
    );

    const copied = copyAllowedHome({
      sourceHome,
      destinationHome: runHome,
      allowList: [".config/opencode/auth.json"],
    });

    expect(lstatSync(runHome).mode & 0o777).toBe(0o700);
    expect(copied).toEqual([".config/opencode/auth.json"]);
    expect(
      readFileSync(path.join(runHome, ".config", "opencode", "auth.json"), "utf-8"),
    ).toBe('{"auth":"owned-harness-token"}\n');
  });

  it("rejects unsafe home allowlist entries and source file types", () => {
    const temp = makeTempRoot("hostile-home");
    const sourceHome = path.join(temp, "home");
    const destinationHome = path.join(temp, "run", "HOME");
    const outside = path.join(temp, "outside-secret");
    mkdirSync(path.join(sourceHome, "safe"), { recursive: true, mode: 0o700 });
    writeFileSync(path.join(sourceHome, "safe", "ok"), "ok\n", { mode: 0o600 });
    writeFileSync(outside, "secret\n", { mode: 0o600 });
    symlinkSync(outside, path.join(sourceHome, "safe", "escape"));
    mkdirSync(path.join(sourceHome, "safe", "dir"), { mode: 0o700 });

    for (const entry of ["/absolute", "../escape", "safe/../../escape"]) {
      expect(() =>
        copyAllowedHome({
          sourceHome,
          destinationHome,
          allowList: [entry],
        }),
      ).toThrow(/allowlist/i);
    }

    expect(() =>
      copyAllowedHome({
        sourceHome,
        destinationHome,
        allowList: ["safe/escape"],
      }),
    ).toThrow(/symlink/i);
    expect(() =>
      copyAllowedHome({
        sourceHome,
        destinationHome,
        allowList: ["safe/dir"],
      }),
    ).toThrow(/regular file/i);
  });

  it("builds a minimal executor env without bus or credential variables", () => {
    const env = buildExecutorEnvironment({
      sourceEnv: makeRunnerEnv({
        HOME: "/home/david",
        TMPDIR: "/tmp/source",
      }),
      home: "/tmp/shohin-run/HOME",
      tmpdir: "/tmp/shohin-run/tmp",
      runnerEnvKeys: ["WAI_RUN_ID", "WAI_RUN_DIR", "WAI_TOPIC"],
    });

    expect(env).toEqual({
      PATH: "/usr/bin:/bin",
      HOME: "/tmp/shohin-run/HOME",
      TMPDIR: "/tmp/shohin-run/tmp",
      WAI_RUN_ID: "run-003",
      WAI_RUN_DIR: "/tmp/shohin-run-003",
      WAI_TOPIC: "shohin-phase-0-spike",
    });
    expect(Object.keys(env)).toEqual([
      "PATH",
      "HOME",
      "TMPDIR",
      "WAI_RUN_ID",
      "WAI_RUN_DIR",
      "WAI_TOPIC",
    ]);
  });

  it("rejects executor inputs and runner variables with forbidden credential or bus names", () => {
    expect(() =>
      buildExecutorEnvironment({
        sourceEnv: makeRunnerEnv(),
        home: "/tmp/shohin-run/HOME",
        tmpdir: "/tmp/shohin-run/tmp",
        runnerEnvKeys: ["WAI_RUN_ID", "GH_TOKEN"],
      }),
    ).toThrow(/credential/i);

    for (const key of [
      "SSH_AUTH_SOCK",
      "OPENCLAW_GATEWAY_TOKEN",
      "GIT_ASKPASS",
      "GH_TOKEN",
      "DBUS_SESSION_BUS_ADDRESS",
      "XDG_RUNTIME_DIR",
    ]) {
      expect(() =>
        buildExecutorEnvironment({
          sourceEnv: makeRunnerEnv({ [key]: "blocked" }),
          home: "/tmp/shohin-run/HOME",
          tmpdir: "/tmp/shohin-run/tmp",
          runnerEnvKeys: ["WAI_RUN_ID"],
        }),
      ).toThrow(/credential|bus/i);
    }
  });

  it("builds a distinct control env with only validated user-bus access", () => {
    const executor = buildExecutorEnvironment({
      sourceEnv: makeRunnerEnv(),
      home: "/tmp/shohin-run/HOME",
      tmpdir: "/tmp/shohin-run/tmp",
      runnerEnvKeys: ["WAI_RUN_ID"],
    });
    const control = buildControlEnvironment({
      sourceEnv: {
        PATH: "/usr/bin:/bin",
        XDG_RUNTIME_DIR: "/run/user/1000",
        DBUS_SESSION_BUS_ADDRESS: "unix:path=/run/user/1000/bus",
      },
    });

    expect(control).toEqual({
      PATH: "/usr/bin:/bin",
      XDG_RUNTIME_DIR: "/run/user/1000",
      DBUS_SESSION_BUS_ADDRESS: "unix:path=/run/user/1000/bus",
    });
    expect(control).not.toBe(executor);
    expect(executor).not.toHaveProperty("XDG_RUNTIME_DIR");
  });

  it("rejects invalid control paths, addresses, and forbidden input keys", () => {
    for (const runtimeDir of ["relative", "/tmp/../tmp", ""]) {
      expect(() =>
        buildControlEnvironment({
          sourceEnv: {
            PATH: "/usr/bin:/bin",
            XDG_RUNTIME_DIR: runtimeDir,
          },
        }),
      ).toThrow(/XDG_RUNTIME_DIR/i);
    }

    for (const address of [
      "tcp:host=localhost,port=1234",
      "unix:path=relative/bus",
      "unix:path=/tmp/../bus",
      "unix:abstract=/tmp/bus",
    ]) {
      expect(() =>
        buildControlEnvironment({
          sourceEnv: {
            PATH: "/usr/bin:/bin",
            XDG_RUNTIME_DIR: "/run/user/1000",
            DBUS_SESSION_BUS_ADDRESS: address,
          },
        }),
      ).toThrow(/DBUS_SESSION_BUS_ADDRESS/i);
    }

    expect(() =>
      buildControlEnvironment({
        sourceEnv: {
          PATH: "/usr/bin:/bin",
          XDG_RUNTIME_DIR: "/run/user/1000",
          SSH_AUTH_SOCK: "/tmp/ssh-agent",
        },
      }),
    ).toThrow(/credential/i);
  });

  it("does not spread process.env into executor or control outputs", () => {
    const originalSecret = process.env.SHOHIN_PROCESS_ENV_SHOULD_NOT_LEAK;
    process.env.SHOHIN_PROCESS_ENV_SHOULD_NOT_LEAK = "secret";
    try {
      const executor = buildExecutorEnvironment({
        sourceEnv: { PATH: "/usr/bin:/bin", WAI_RUN_ID: "run-003" },
        home: "/tmp/home",
        tmpdir: "/tmp/tmp",
        runnerEnvKeys: ["WAI_RUN_ID"],
      });
      const control = buildControlEnvironment({
        sourceEnv: {
          PATH: "/usr/bin:/bin",
          XDG_RUNTIME_DIR: "/run/user/1000",
        },
      });

      expect(executor).not.toHaveProperty("SHOHIN_PROCESS_ENV_SHOULD_NOT_LEAK");
      expect(control).not.toHaveProperty("SHOHIN_PROCESS_ENV_SHOULD_NOT_LEAK");
    } finally {
      if (originalSecret === undefined) {
        delete process.env.SHOHIN_PROCESS_ENV_SHOULD_NOT_LEAK;
      } else {
        process.env.SHOHIN_PROCESS_ENV_SHOULD_NOT_LEAK = originalSecret;
      }
    }
  });
});
