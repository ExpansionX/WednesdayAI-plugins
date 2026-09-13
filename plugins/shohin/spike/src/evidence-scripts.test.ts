import { spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const packageRoot = path.resolve(import.meta.dirname, "..");
const repoRoot = path.resolve(packageRoot, "../../..");
const scriptsRoot = path.join(packageRoot, "scripts");
const tempRoots: string[] = [];

type JsonRecord = Record<string, unknown>;

interface CommandResult {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

const makeTempRoot = (name: string): string => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), `shohin-${name}-`));
  tempRoots.push(tempRoot);
  return tempRoot;
};

const minimalEnv = (overrides: Record<string, string> = {}) => ({
  PATH: process.env.PATH ?? "/usr/bin:/bin",
  ...overrides,
});

const runScript = (
  scriptPath: string,
  args: readonly string[],
  env: Record<string, string>,
  input = "",
): Promise<CommandResult> =>
  new Promise((resolve, reject) => {
    const child = spawn(scriptPath, [...args], {
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];

    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({
        status: code ?? 128,
        stdout: Buffer.concat(stdout).toString("utf-8"),
        stderr: Buffer.concat(stderr).toString("utf-8"),
      });
    });
    child.stdin.end(input);
  });

const readJsonLines = (filePath: string): JsonRecord[] => {
  expect(existsSync(filePath), `${filePath} should exist`).toBe(true);
  return readFileSync(filePath, "utf-8")
    .split(/\r?\n/)
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as JsonRecord);
};

const parseReportBlocks = (content: string): JsonRecord[] =>
  [...content.matchAll(/```json\n([\s\S]*?)\n```/g)].map(
    ([, block]) => JSON.parse(block) as JsonRecord,
  );

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("Shohin append-only evidence scripts", () => {
  it("notify.sh accepts the runner ABI and appends escaped JSON under a lock", async () => {
    const runDir = path.join(makeTempRoot("notify"), "run");
    const notify = path.join(scriptsRoot, "notify.sh");
    const env = minimalEnv({ WAI_RUN_DIR: runDir });
    const hostileReason = 'worker-stopped: quote " slash \\ newline\n tab\t end';

    const bad = spawnSync(notify, ["topic", "task-only"], {
      env,
      encoding: "utf-8",
    });
    expect(bad.status).toBe(2);

    const writes = Array.from({ length: 24 }, (_, index) =>
      runScript(
        notify,
        ["shohin-phase-0-spike", `task-${index}`, `${hostileReason} ${index}`],
        env,
      ),
    );
    const results = await Promise.all(writes);
    expect(results.map((result) => result.status)).toEqual(Array(24).fill(0));

    const records = readJsonLines(path.join(runDir, "attention.jsonl"));
    expect(records).toHaveLength(24);
    expect(lstatSync(runDir).mode & 0o777).toBe(0o700);
    expect(records.map((record) => record.id).sort()).toEqual(
      Array.from({ length: 24 }, (_, index) => `task-${index}`).sort(),
    );
    expect(records[0]).toMatchObject({
      topic: "shohin-phase-0-spike",
    });
    expect(records.every((record) => typeof record.at === "string")).toBe(true);
    expect(
      records.some((record) => record.reason === `${hostileReason} 7`),
    ).toBe(true);
  });

  it("report-append.sh appends literal command and distinct streams without interleaving", async () => {
    const temp = makeTempRoot("report");
    const report = path.join(temp, "spike-report.md");
    const append = path.join(scriptsRoot, "report-append.sh");
    writeFileSync(report, "# Spike Report\n", { mode: 0o600 });

    const expected = Array.from({ length: 16 }, (_, index) => {
      const stdoutPath = path.join(temp, `stdout-${index}.txt`);
      const stderrPath = path.join(temp, `stderr-${index}.txt`);
      const stdout = `stdout ${index}\njson-ish {"i":${index}}\n\`\`\`\n`;
      const stderr = `stderr ${index}\nquote " tab\tbackslash\\\n`;
      const command = `bash -lc 'case ${index}; printf "literal ${index}"'`;
      writeFileSync(stdoutPath, stdout, { mode: 0o600 });
      writeFileSync(stderrPath, stderr, { mode: 0o600 });
      return { command, stderr, stderrPath, stdout, stdoutPath };
    });

    const writes = expected.map((item, index) =>
      runScript(
        append,
        [
          report,
          `Evidence ${index}`,
          item.command,
          item.stdoutPath,
          item.stderrPath,
          String(40 + index),
        ],
        minimalEnv(),
      ),
    );
    const results = await Promise.all(writes);
    expect(results.map((result) => result.status)).toEqual(Array(16).fill(0));

    const blocks = parseReportBlocks(readFileSync(report, "utf-8"));
    expect(blocks).toHaveLength(16);
    for (const item of expected) {
      expect(blocks).toContainEqual(
        expect.objectContaining({
          command: item.command,
          stdout: item.stdout,
          stderr: item.stderr,
        }),
      );
    }
  });

  it("opencode-wrapper.sh preserves streams and status while recording redacted usage", () => {
    const temp = makeTempRoot("wrapper");
    const runDir = path.join(temp, "run");
    const callLog = path.join(runDir, "opencode-calls.jsonl");
    const realOpenCode = path.join(temp, "real-opencode");
    const wrapper = path.join(scriptsRoot, "opencode-wrapper.sh");
    const expectedStdout =
      '{"type":"message","usage":{"total_tokens":11},"text":"alpha"}\n' +
      '{"type":"status","status":"running"}\n';
    const expectedStderr = "stderr-one\nstdin:executor input\n";

    writeFileSync(
      realOpenCode,
      [
        "#!/usr/bin/env bash",
        "set -euo pipefail",
        'payload="$(cat)"',
        "printf '%s\\n' '{\"type\":\"message\",\"usage\":{\"total_tokens\":11},\"text\":\"alpha\"}'",
        "printf '%s\\n' '{\"type\":\"status\",\"status\":\"running\"}'",
        "printf 'stderr-one\\n' >&2",
        'printf "stdin:%s\\n" "$payload" >&2',
        "exit 7",
        "",
      ].join("\n"),
      { mode: 0o600 },
    );
    chmodSync(realOpenCode, 0o755);

    const result = spawnSync(
      wrapper,
      [
        "run",
        "--format",
        "json",
        "-m",
        "haiku",
        "--dir",
        repoRoot,
        "never-log-this-prompt",
      ],
      {
        env: minimalEnv({
          SECRET_TOKEN: "do-not-log-secret",
          WAI_RUN_DIR: runDir,
          WAI_SHOHIN_ATTEMPT: "3",
          WAI_SHOHIN_CALL_LOG: callLog,
          WAI_SHOHIN_MODEL: "haiku",
          WAI_SHOHIN_OPENCODE_BIN: realOpenCode,
          WAI_SHOHIN_ROLE: "worker",
        }),
        input: "executor input\n",
        encoding: "utf-8",
      },
    );

    expect(result.status).toBe(7);
    expect(result.stdout).toBe(expectedStdout);
    expect(result.stderr).toBe(expectedStderr);
    expect(lstatSync(runDir).mode & 0o777).toBe(0o700);

    const records = readJsonLines(callLog);
    const call = records.find((record) => record.kind === "opencode_call");
    const usage = records.find((record) => record.kind === "token_usage");
    expect(call).toMatchObject({
      attempt: 3,
      model: "haiku",
      role: "worker",
      status: 7,
    });
    expect(call?.argv).toEqual([
      "run",
      "--format",
      "json",
      "-m",
      "haiku",
      "--dir",
      repoRoot,
      "[redacted-prompt]",
    ]);
    expect(usage).toMatchObject({
      attempt: 3,
      estimated_usd: null,
      model: "haiku",
      role: "worker",
      total_tokens: 11,
    });

    const stdoutPath = call?.stdout_path;
    const stderrPath = call?.stderr_path;
    expect(typeof stdoutPath).toBe("string");
    expect(typeof stderrPath).toBe("string");
    expect(readFileSync(stdoutPath as string, "utf-8")).toBe(expectedStdout);
    expect(readFileSync(stderrPath as string, "utf-8")).toBe(expectedStderr);
    const logText = readFileSync(callLog, "utf-8");
    expect(logText).not.toContain("SECRET_TOKEN");
    expect(logText).not.toContain("do-not-log-secret");
    expect(logText).not.toContain("never-log-this-prompt");
  });

  it("orchestrator-abort.sh emits the installed runner decision schema without stdin", () => {
    const temp = makeTempRoot("assessor");
    const envelope = path.join(temp, "envelope.md");
    const callLog = path.join(temp, "assessor-usage.jsonl");
    const assessor = path.join(scriptsRoot, "orchestrator-abort.sh");
    writeFileSync(
      envelope,
      [
        "## Workstream goal",
        "Measure WAI surfaces.",
        "",
        "## Open attention items",
        "- task=004 kind=worker-stopped reason=done=false: missing files",
        "",
        "## Attended task files",
        "### task 004 (task.md)",
        "```",
        "body",
        "```",
        "",
      ].join("\n"),
      { mode: 0o600 },
    );

    const result = spawnSync(assessor, [envelope, repoRoot], {
      env: minimalEnv({
        WAI_SHOHIN_ATTEMPT: "2",
        WAI_SHOHIN_CALL_LOG: callLog,
      }),
      input: "- task=999 kind=worker-stopped reason=stdin must not win\n",
      encoding: "utf-8",
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual({
      items: [
        {
          decision: "abort",
          reason:
            "deterministic abort for worker-stopped: done=false: missing files",
          task_id: "004",
        },
      ],
      overall: "abort",
    });
    expect(readJsonLines(callLog)).toEqual([
      expect.objectContaining({
        attempt: 2,
        estimated_usd: 0,
        kind: "token_usage",
        model: "deterministic-assessor",
        role: "assessor",
        total_tokens: 0,
      }),
    ]);
  });
});
