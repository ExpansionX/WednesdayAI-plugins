import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  enumerateExpectedTaskManifest,
  parseExecutorHints,
  verifyAuthoritativeOutcome,
  type ExecutorHint,
} from "./evidence.js";

const tempRoots: string[] = [];

interface FixtureRepo {
  readonly baseline: string;
  readonly branchHead: string;
  readonly gateLog: string;
  readonly gateScript: string;
  readonly manifestHash: string;
  readonly repoRoot: string;
  readonly taskCommits: Readonly<Record<string, string>>;
  readonly verifierRoot: string;
}

const makeTempRoot = (name: string): string => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), `shohin-${name}-`));
  tempRoots.push(tempRoot);
  return tempRoot;
};

const git = (cwd: string, args: readonly string[]): string =>
  execFileSync("git", [...args], {
    cwd,
    encoding: "utf-8",
    env: { PATH: process.env.PATH ?? "/usr/bin:/bin" },
  }).trim();

const commitAll = (repoRoot: string, message: string): string => {
  git(repoRoot, ["add", "."]);
  git(repoRoot, ["commit", "-m", message]);
  return git(repoRoot, ["rev-parse", "HEAD"]);
};

const writeTaskFile = (
  repoRoot: string,
  id: string,
  extra = "body",
): void => {
  const filePath = path.join(
    repoRoot,
    "docs",
    "plans",
    "shohin-phase-0-spike",
    "phase-1",
    `${id}-task.md`,
  );
  mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  writeFileSync(
    filePath,
    [
      "---",
      `id: "${id}"`,
      "phase: 1",
      `title: "Task ${id}"`,
      "---",
      extra,
      "",
    ].join("\n"),
    { mode: 0o600 },
  );
};

const writeMarkdown = (
  repoRoot: string,
  relativePath: string,
  content: string,
): void => {
  const filePath = path.join(repoRoot, relativePath);
  mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  writeFileSync(filePath, content, { mode: 0o600 });
};

const writeFakeGate = (
  root: string,
  gateLog: string,
  failTask?: string,
): string => {
  const gateScript = path.join(root, "task-gate.cjs");
  writeFileSync(
    gateScript,
    [
      "#!/usr/bin/env node",
      "const fs = require('node:fs');",
      "const cp = require('node:child_process');",
      `const failTask = ${JSON.stringify(failTask ?? null)};`,
      `const gateLog = ${JSON.stringify(gateLog)};`,
      "const [topic, id, flag, commit] = process.argv.slice(2);",
      "const head = cp.execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf-8' }).trim();",
      "fs.appendFileSync(gateLog, JSON.stringify({",
      "  argv: process.argv.slice(2),",
      "  cwd: process.cwd(),",
      "  env: process.env,",
      "  head,",
      "}) + '\\n');",
      "if (topic !== 'shohin-phase-0-spike' || flag !== '--commit' || commit !== head) process.exit(21);",
      "if (id === failTask) process.exit(17);",
      "process.exit(0);",
      "",
    ].join("\n"),
    { mode: 0o600 },
  );
  chmodSync(gateScript, 0o755);
  return gateScript;
};

const makeFixtureRepo = (name: string, failTask?: string): FixtureRepo => {
  const root = makeTempRoot(name);
  const repoRoot = path.join(root, "repo");
  const verifierRoot = path.join(root, "verifiers");
  mkdirSync(repoRoot, { recursive: true, mode: 0o700 });
  mkdirSync(verifierRoot, { mode: 0o700 });
  git(repoRoot, ["init", "--initial-branch=main"]);
  git(repoRoot, ["config", "user.email", "shohin@example.invalid"]);
  git(repoRoot, ["config", "user.name", "Shohin Test"]);

  writeTaskFile(repoRoot, "001");
  writeTaskFile(repoRoot, "002");
  const baseline = commitAll(repoRoot, "baseline tasks");
  const manifest = enumerateExpectedTaskManifest({
    baselineCommit: baseline,
    repoRoot,
    taskDirectory: "docs/plans/shohin-phase-0-spike/phase-1",
  });

  writeFileSync(path.join(repoRoot, "one.txt"), "task 001\n", { mode: 0o600 });
  const task001 = commitAll(repoRoot, "task 001");
  writeFileSync(path.join(repoRoot, "two.txt"), "task 002\n", { mode: 0o600 });
  const task002 = commitAll(repoRoot, "task 002");

  const gateLog = path.join(root, "gate.jsonl");
  writeFileSync(gateLog, "", { mode: 0o600 });
  const gateScript = writeFakeGate(root, gateLog, failTask);

  return {
    baseline,
    branchHead: task002,
    gateLog,
    gateScript,
    manifestHash: manifest.hash,
    repoRoot,
    taskCommits: { "001": task001, "002": task002 },
    verifierRoot,
  };
};

const baseVerifyOptions = (fixture: FixtureRepo) => ({
  baselineCommit: fixture.baseline,
  expectedManifestHash: fixture.manifestHash,
  gateScript: fixture.gateScript,
  gateTimeoutMs: 10_000,
  repoRoot: fixture.repoRoot,
  recordedBranchRef: fixture.branchHead,
  runnerExitStatus: 0,
  taskCommits: fixture.taskCommits,
  taskDirectory: "docs/plans/shohin-phase-0-spike/phase-1",
  testCommand: "npm --prefix plugins/shohin/spike exec -- vitest run {scope}",
  topic: "shohin-phase-0-spike",
  typecheckCommand: "npm --prefix plugins/shohin/spike run typecheck",
  verifierRoot: fixture.verifierRoot,
});

const failureCodes = (
  outcome: ReturnType<typeof verifyAuthoritativeOutcome>,
): string[] => outcome.failures.map((failure) => failure.code);

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("Shohin executor hint parsing", () => {
  it("retains malformed duplicate and unknown notify/run-state records only as executor hints", () => {
    const result = parseExecutorHints({
      expectedTaskIds: ["001"],
      inputs: {
        notifyJsonl: [
          "{not json",
          '{"id":"001","commit":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","reason":"done"}',
          '{"id":"001","commit":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","reason":"done"}',
          '{"id":"999","commit":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","reason":"done"}',
        ].join("\n"),
        runStateJson: JSON.stringify({
          tasks: {
            "001": {
              commit: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
              terminal: true,
            },
            "404": {
              commit: "cccccccccccccccccccccccccccccccccccccccc",
              status: "success",
            },
          },
        }),
      },
    });

    expect(result.hints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ file: "notify", kind: "malformed" }),
        expect.objectContaining({ file: "notify", kind: "duplicate" }),
        expect.objectContaining({
          file: "notify",
          kind: "unknown_task",
          taskId: "999",
        }),
        expect.objectContaining({
          file: "run_state",
          kind: "unknown_task",
          taskId: "404",
        }),
      ]),
    );
    expect(
      result.hints.every(
        (hint: ExecutorHint) =>
          hint.source === "executor" && hint.authoritative === false,
      ),
    ).toBe(true);
    expect(result.proposedTaskCommits).toEqual({
      "001": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    });
  });

  it("parses the native WAI run-state schema with run identity and task states", () => {
    const result = parseExecutorHints({
      expectedRepoRoot: "/tmp/shohin-native-repo",
      expectedTaskIds: ["001", "002", "003", "004", "005", "006"],
      expectedTopic: "shohin-native",
      inputs: {
        runStateJson: JSON.stringify({
          attentionItems: [
            { kind: "gate-fail", reason: "fixture sentinel", task_id: "006" },
          ],
          blockedTaskIds: ["005"],
          completedTaskIds: ["001"],
          currentTaskId: "004",
          failedTaskIds: ["002"],
          lastUpdated: "2026-09-13T20:55:00Z",
          pendingTaskIds: ["003"],
          phase: "Running",
          repoRoot: "/tmp/shohin-native-repo",
          runId: "run-native",
          topic: "shohin-native",
        }),
      },
    });

    expect(result.hints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          file: "run_state",
          kind: "run_state",
          runId: "run-native",
          state: "completed",
          taskId: "001",
          terminal: true,
          topic: "shohin-native",
        }),
        expect.objectContaining({
          file: "run_state",
          kind: "run_state",
          runId: "run-native",
          state: "failed",
          taskId: "002",
          terminal: true,
        }),
        expect.objectContaining({
          file: "run_state",
          kind: "run_state",
          runId: "run-native",
          state: "pending",
          taskId: "003",
          terminal: false,
        }),
        expect.objectContaining({
          file: "run_state",
          kind: "run_state",
          runId: "run-native",
          state: "current",
          taskId: "004",
          terminal: false,
        }),
        expect.objectContaining({
          file: "run_state",
          kind: "run_state",
          runId: "run-native",
          state: "blocked",
          taskId: "005",
          terminal: false,
        }),
        expect.objectContaining({
          file: "run_state",
          kind: "run_state",
          reason: "fixture sentinel",
          runId: "run-native",
          state: "attention",
          taskId: "006",
          terminal: false,
        }),
      ]),
    );
    expect(result.hints.every((hint) => hint.authoritative === false)).toBe(true);
  });

  it("rejects native WAI run-state from a different topic or repo", () => {
    const baseState = {
      blockedTaskIds: [],
      completedTaskIds: ["001"],
      currentTaskId: null,
      failedTaskIds: [],
      lastUpdated: "2026-09-13T20:55:00Z",
      pendingTaskIds: [],
      phase: "Running",
      repoRoot: "/tmp/right-repo",
      runId: "native-run",
      topic: "right-topic",
    };

    for (const runStateJson of [
      JSON.stringify({ ...baseState, topic: "wrong-topic" }),
      JSON.stringify({ ...baseState, repoRoot: "/tmp/wrong-repo" }),
    ]) {
      const result = parseExecutorHints({
        expectedRepoRoot: "/tmp/right-repo",
        expectedTaskIds: ["001"],
        expectedTopic: "right-topic",
        inputs: { runStateJson },
      });

      expect(result.hints).toEqual([
        expect.objectContaining({ file: "run_state", kind: "malformed" }),
      ]);
      expect(result.proposedTaskCommits).toEqual({});
    }
  });

  it("rejects malformed native WAI run-state records instead of falling through", () => {
    const result = parseExecutorHints({
      expectedTaskIds: ["001"],
      inputs: {
        runStateJson: JSON.stringify({
          completedTaskIds: "001",
          phase: "Running",
          runId: "run-native",
        }),
      },
    });

    expect(result.hints).toEqual([
      expect.objectContaining({ file: "run_state", kind: "malformed" }),
    ]);
    expect(result.proposedTaskCommits).toEqual({});
  });

  it("does not let forged terminal hints produce verified success", () => {
    const fixture = makeFixtureRepo("forged-hints");
    const hints = parseExecutorHints({
      expectedTaskIds: ["001", "002"],
      inputs: {
        notifyJsonl: '{"id":"001","commit":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","reason":"done"}\n',
        runStateJson: JSON.stringify({
          tasks: {
            "001": { status: "success", terminal: true },
            "002": { status: "success", terminal: true },
          },
        }),
      },
    });

    const outcome = verifyAuthoritativeOutcome({
      ...baseVerifyOptions(fixture),
      executorHints: hints.hints,
      runnerExitStatus: 1,
      taskCommits: {},
    });

    expect(outcome.verified).toBe(false);
    expect(failureCodes(outcome)).toEqual(
      expect.arrayContaining([
        "runner_nonzero",
        "missing_task_commit",
      ]),
    );
    expect(outcome.hints).toHaveLength(hints.hints.length);
    expect(outcome.hints.every((hint) => !hint.authoritative)).toBe(true);
    expect(readFileSync(fixture.gateLog, "utf-8")).toBe("");
  });
});

describe("Shohin committed task manifest authority", () => {
  it("enumerates only committed phase task files and ignores supporting topic markdown", () => {
    const root = makeTempRoot("manifest-boundary");
    const repoRoot = path.join(root, "repo");
    mkdirSync(repoRoot, { recursive: true, mode: 0o700 });
    git(repoRoot, ["init", "--initial-branch=main"]);
    git(repoRoot, ["config", "user.email", "shohin@example.invalid"]);
    git(repoRoot, ["config", "user.name", "Shohin Test"]);
    writeTaskFile(repoRoot, "001", "first task\n");
    writeTaskFile(repoRoot, "002", "second task\n");
    writeMarkdown(
      repoRoot,
      "docs/plans/shohin-phase-0-spike/plan.md",
      "# Plan\n",
    );
    writeMarkdown(
      repoRoot,
      "docs/plans/shohin-phase-0-spike/decisions-ledger.md",
      "# Decisions\n",
    );
    writeMarkdown(
      repoRoot,
      "docs/plans/shohin-phase-0-spike/phase-1-summary.md",
      "# Phase summary\n",
    );
    writeMarkdown(
      repoRoot,
      "docs/plans/shohin-phase-0-spike/phase-1/README.md",
      "# Phase 1\n",
    );
    writeMarkdown(
      repoRoot,
      "docs/plans/shohin-phase-0-spike/reviews/review.md",
      "# Review\n",
    );
    writeMarkdown(
      repoRoot,
      "docs/plans/shohin-phase-0-spike/reports/report.md",
      "# Report\n",
    );
    const baseline = commitAll(repoRoot, "baseline with supporting docs");

    const manifest = enumerateExpectedTaskManifest({
      baselineCommit: baseline,
      repoRoot,
      taskDirectory: "docs/plans/shohin-phase-0-spike",
    });
    const phaseManifest = enumerateExpectedTaskManifest({
      baselineCommit: baseline,
      repoRoot,
      taskDirectory: "docs/plans/shohin-phase-0-spike/phase-1",
    });

    expect(manifest.tasks.map((task) => task.id)).toEqual(["001", "002"]);
    expect(manifest.tasks.map((task) => task.path)).toEqual([
      "docs/plans/shohin-phase-0-spike/phase-1/001-task.md",
      "docs/plans/shohin-phase-0-spike/phase-1/002-task.md",
    ]);
    expect(manifest.hash).toBe(phaseManifest.hash);
    expect(manifest).toEqual(
      enumerateExpectedTaskManifest({
        baselineCommit: baseline,
        repoRoot,
        taskDirectory: "docs/plans/shohin-phase-0-spike",
      }),
    );
  });

  it("derives expected ids from committed baseline task files and ignores uncommitted task files", () => {
    const fixture = makeFixtureRepo("manifest");
    writeTaskFile(fixture.repoRoot, "003", "uncommitted must not count");

    const manifest = enumerateExpectedTaskManifest({
      baselineCommit: fixture.baseline,
      repoRoot: fixture.repoRoot,
      taskDirectory: "docs/plans/shohin-phase-0-spike/phase-1",
    });

    expect(manifest.tasks.map((task) => task.id)).toEqual(["001", "002"]);
    expect(manifest.hash).toBe(fixture.manifestHash);
  });

  it("fails closed when no committed phase task files exist under the topic", () => {
    const root = makeTempRoot("manifest-no-tasks");
    const repoRoot = path.join(root, "repo");
    mkdirSync(repoRoot, { recursive: true, mode: 0o700 });
    git(repoRoot, ["init", "--initial-branch=main"]);
    git(repoRoot, ["config", "user.email", "shohin@example.invalid"]);
    git(repoRoot, ["config", "user.name", "Shohin Test"]);
    writeMarkdown(
      repoRoot,
      "docs/plans/shohin-phase-0-spike/plan.md",
      "# Plan\n",
    );
    writeMarkdown(
      repoRoot,
      "docs/plans/shohin-phase-0-spike/decisions-ledger.md",
      "# Decisions\n",
    );
    const baseline = commitAll(repoRoot, "supporting docs only");

    expect(() =>
      enumerateExpectedTaskManifest({
        baselineCommit: baseline,
        repoRoot,
        taskDirectory: "docs/plans/shohin-phase-0-spike",
      }),
    ).toThrow(/Baseline did not contain committed task files/);
  });

  it("rejects malformed committed phase task files", () => {
    const root = makeTempRoot("manifest-malformed-task");
    const repoRoot = path.join(root, "repo");
    mkdirSync(repoRoot, { recursive: true, mode: 0o700 });
    git(repoRoot, ["init", "--initial-branch=main"]);
    git(repoRoot, ["config", "user.email", "shohin@example.invalid"]);
    git(repoRoot, ["config", "user.name", "Shohin Test"]);
    writeMarkdown(
      repoRoot,
      "docs/plans/shohin-phase-0-spike/phase-1/001-malformed.md",
      "---\ntitle: Missing id\n---\n",
    );
    const baseline = commitAll(repoRoot, "malformed true task");

    expect(() =>
      enumerateExpectedTaskManifest({
        baselineCommit: baseline,
        repoRoot,
        taskDirectory: "docs/plans/shohin-phase-0-spike",
      }),
    ).toThrow(
      /Committed task file lacks a valid id: docs\/plans\/shohin-phase-0-spike\/phase-1\/001-malformed\.md/,
    );
  });

  it("rejects duplicate committed phase task ids across phase files", () => {
    const root = makeTempRoot("manifest-duplicates");
    const repoRoot = path.join(root, "repo");
    mkdirSync(repoRoot, { recursive: true, mode: 0o700 });
    git(repoRoot, ["init", "--initial-branch=main"]);
    git(repoRoot, ["config", "user.email", "shohin@example.invalid"]);
    git(repoRoot, ["config", "user.name", "Shohin Test"]);
    writeTaskFile(repoRoot, "001", "first task\n");
    writeMarkdown(
      repoRoot,
      "docs/plans/shohin-phase-0-spike/phase-2/001-duplicate.md",
      "---\nid: \"001\"\nphase: 2\ntitle: Duplicate\n---\n",
    );
    const baseline = commitAll(repoRoot, "duplicate true task ids");

    expect(() =>
      enumerateExpectedTaskManifest({
        baselineCommit: baseline,
        repoRoot,
        taskDirectory: "docs/plans/shohin-phase-0-spike",
      }),
    ).toThrow(/Duplicate committed task id: 001/);
  });

  it("fails closed when the external baseline cannot provide committed tasks", () => {
    const fixture = makeFixtureRepo("missing-baseline");

    const outcome = verifyAuthoritativeOutcome({
      ...baseVerifyOptions(fixture),
      baselineCommit: "ffffffffffffffffffffffffffffffffffffffff",
    });

    expect(outcome.verified).toBe(false);
    expect(failureCodes(outcome)).toContain("expected_tasks_unavailable");
    expect(readFileSync(fixture.gateLog, "utf-8")).toBe("");
  });
});

describe("Shohin authoritative truth verification", () => {
  it("requires runner exit 0, exact task coverage, matching manifest, and green exact-SHA gates", () => {
    const fixture = makeFixtureRepo("success");

    const outcome = verifyAuthoritativeOutcome(baseVerifyOptions(fixture));

    expect(outcome.verified).toBe(true);
    expect(outcome.failures).toEqual([]);
    expect(outcome.expectedTasks.map((task) => task.id)).toEqual(["001", "002"]);
    expect(outcome.gateResults.map((result) => result.status)).toEqual([0, 0]);

    const gateRecords = readFileSync(fixture.gateLog, "utf-8")
      .trim()
      .split(/\r?\n/)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(gateRecords).toHaveLength(2);
    expect(gateRecords[0]).toMatchObject({
      argv: [
        "shohin-phase-0-spike",
        "001",
        "--commit",
        fixture.taskCommits["001"],
      ],
      head: fixture.taskCommits["001"],
    });
    expect(gateRecords[1]).toMatchObject({
      argv: [
        "shohin-phase-0-spike",
        "002",
        "--commit",
        fixture.taskCommits["002"],
      ],
      head: fixture.taskCommits["002"],
    });
    for (const record of gateRecords) {
      const env = record.env as Record<string, string>;
      expect(Object.keys(env).sort()).toEqual([
        "HOME",
        "PATH",
        "TMPDIR",
        "WAI_TEST_CMD",
        "WAI_TYPECHECK_CMD",
      ]);
      expect(env.WAI_TYPECHECK_CMD).toBe(
        "npm --prefix plugins/shohin/spike run typecheck",
      );
      expect(env.WAI_TEST_CMD).toBe(
        "npm --prefix plugins/shohin/spike exec -- vitest run {scope}",
      );
      expect(env).not.toHaveProperty("GH_TOKEN");
      expect(env).not.toHaveProperty("OPENCLAW_GATEWAY_TOKEN");
      expect(existsSync(record.cwd as string)).toBe(false);
    }
    expect(readdirSync(fixture.verifierRoot)).toEqual([]);
  });

  it("names missing task coverage even when runner exit and available gates are green", () => {
    const fixture = makeFixtureRepo("missing-task");

    const outcome = verifyAuthoritativeOutcome({
      ...baseVerifyOptions(fixture),
      taskCommits: { "001": fixture.taskCommits["001"] },
    });

    expect(outcome.verified).toBe(false);
    expect(failureCodes(outcome)).toContain("missing_task_commit");
    expect(outcome.gateResults.map((result) => result.taskId)).toEqual(["001"]);
  });

  it("names prebaseline and non-ancestor commits before accepting task commits", () => {
    const fixture = makeFixtureRepo("graph-failures");
    const sideBranch = git(fixture.repoRoot, ["rev-parse", "HEAD"]);
    git(fixture.repoRoot, ["checkout", "-b", "side", fixture.baseline]);
    writeFileSync(path.join(fixture.repoRoot, "side.txt"), "side\n", {
      mode: 0o600,
    });
    const nonAncestor = commitAll(fixture.repoRoot, "side task");
    git(fixture.repoRoot, ["checkout", sideBranch]);

    const prebaseline = verifyAuthoritativeOutcome({
      ...baseVerifyOptions(fixture),
      taskCommits: {
        ...fixture.taskCommits,
        "001": fixture.baseline,
      },
    });
    const nonancestor = verifyAuthoritativeOutcome({
      ...baseVerifyOptions(fixture),
      taskCommits: {
        ...fixture.taskCommits,
        "001": nonAncestor,
      },
    });

    expect(prebaseline.verified).toBe(false);
    expect(failureCodes(prebaseline)).toContain("prebaseline_commit");
    expect(nonancestor.verified).toBe(false);
    expect(failureCodes(nonancestor)).toContain("nonancestor_commit");
  });

  it("names dirty manifest hash, runner nonzero, and gate nonzero failures", () => {
    const dirtyManifest = makeFixtureRepo("dirty-manifest");
    const runnerNonzero = makeFixtureRepo("runner-nonzero");
    const gateNonzero = makeFixtureRepo("gate-nonzero", "002");

    const dirtyManifestOutcome = verifyAuthoritativeOutcome({
      ...baseVerifyOptions(dirtyManifest),
      expectedManifestHash: "sha256:not-the-baseline-manifest",
    });
    const runnerOutcome = verifyAuthoritativeOutcome({
      ...baseVerifyOptions(runnerNonzero),
      runnerExitStatus: 42,
    });
    const gateOutcome = verifyAuthoritativeOutcome(baseVerifyOptions(gateNonzero));

    expect(dirtyManifestOutcome.verified).toBe(false);
    expect(failureCodes(dirtyManifestOutcome)).toContain("manifest_mismatch");
    expect(runnerOutcome.verified).toBe(false);
    expect(failureCodes(runnerOutcome)).toContain("runner_nonzero");
    expect(gateOutcome.verified).toBe(false);
    expect(failureCodes(gateOutcome)).toContain("gate_nonzero");
    expect(gateOutcome.gateResults).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ status: 17, taskId: "002" }),
      ]),
    );
  });

  it("rejects gate commands that would run historical checks from final HEAD", () => {
    const fixture = makeFixtureRepo("unsafe-command");

    const outcome = verifyAuthoritativeOutcome({
      ...baseVerifyOptions(fixture),
      typecheckCommand: `cd ${fixture.repoRoot} && npm --prefix plugins/shohin/spike run typecheck`,
    });

    expect(outcome.verified).toBe(false);
    expect(failureCodes(outcome)).toContain("unsafe_gate_command");
    expect(readFileSync(fixture.gateLog, "utf-8")).toBe("");
  });
});
