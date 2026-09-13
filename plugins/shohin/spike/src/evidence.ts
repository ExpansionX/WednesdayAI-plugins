import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export type ExecutorHintFile =
  | "notify"
  | "run_state"
  | "dag_passed_commits"
  | "dag_plan_commit"
  | "worker_handoff"
  | "commit_message";

export type ExecutorHintKind =
  | "notify"
  | "run_state"
  | "dag_passed_commit"
  | "dag_plan_commit"
  | "worker_handoff"
  | "commit_message"
  | "malformed"
  | "duplicate"
  | "unknown_task"
  | "truncated";

export interface ExecutorHint {
  readonly source: "executor";
  readonly authoritative: false;
  readonly file: ExecutorHintFile;
  readonly kind: ExecutorHintKind;
  readonly raw: string;
  readonly at?: string;
  readonly commit?: string;
  readonly reason?: string;
  readonly runId?: string;
  readonly state?: string;
  readonly taskId?: string;
  readonly terminal?: boolean;
  readonly topic?: string;
}

type ExecutorHintDetails = Omit<
  ExecutorHint,
  "authoritative" | "commit" | "file" | "kind" | "raw" | "source" | "taskId" | "terminal"
>;

export interface ExecutorHintInputs {
  readonly commitMessages?: readonly string[];
  readonly dagPassedCommits?: string;
  readonly dagPlanCommit?: string;
  readonly notifyJsonl?: string;
  readonly runStateJson?: string;
  readonly workerHandoffs?: readonly string[];
}

export interface ParseExecutorHintsOptions {
  readonly expectedRepoRoot?: string;
  readonly expectedTaskIds: readonly string[];
  readonly expectedTopic?: string;
  readonly inputs: ExecutorHintInputs;
  readonly maxBytes?: number;
  readonly maxHints?: number;
  readonly maxLineBytes?: number;
}

export interface ParseExecutorHintsResult {
  readonly hints: readonly ExecutorHint[];
  readonly proposedTaskCommits: Readonly<Record<string, string>>;
}

export interface ExpectedTask {
  readonly contentHash: string;
  readonly id: string;
  readonly path: string;
}

export interface ExpectedTaskManifest {
  readonly baselineCommit: string;
  readonly hash: string;
  readonly tasks: readonly ExpectedTask[];
}

export interface EnumerateExpectedTaskManifestOptions {
  readonly baselineCommit: string;
  readonly repoRoot: string;
  readonly taskDirectory: string;
}

export type TruthFailureCode =
  | "expected_tasks_unavailable"
  | "gate_nonzero"
  | "invalid_commit"
  | "manifest_mismatch"
  | "missing_task_commit"
  | "nonancestor_commit"
  | "prebaseline_commit"
  | "recorded_branch_unavailable"
  | "runner_nonzero"
  | "unexpected_task_commit"
  | "unsafe_gate_command"
  | "worktree_setup_failed";

export interface TruthFailure {
  readonly code: TruthFailureCode;
  readonly message: string;
  readonly commit?: string;
  readonly detail?: string;
  readonly taskId?: string;
}

export interface GateResult {
  readonly argv: readonly string[];
  readonly commit: string;
  readonly setupFailed?: boolean;
  readonly status: number;
  readonly stderr: string;
  readonly stdout: string;
  readonly taskId: string;
  readonly worktreePath: string;
}

export interface VerifyAuthoritativeOutcomeOptions {
  readonly baselineCommit: string;
  readonly envPath?: string;
  readonly executorHints?: readonly ExecutorHint[];
  readonly expectedManifestHash: string;
  readonly gateScript?: string;
  readonly gateTimeoutMs?: number;
  readonly recordedBranchRef: string;
  readonly repoRoot: string;
  readonly runnerExitStatus: number;
  readonly taskCommits: Readonly<Record<string, string>>;
  readonly taskDirectory: string;
  readonly testCommand: string;
  readonly topic: string;
  readonly typecheckCommand: string;
  readonly verifierRoot?: string;
}

export interface AuthoritativeOutcome {
  readonly expectedTasks: readonly ExpectedTask[];
  readonly failures: readonly TruthFailure[];
  readonly gateResults: readonly GateResult[];
  readonly hints: readonly ExecutorHint[];
  readonly manifestHash: string;
  readonly verified: boolean;
}

interface CommandResult {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

const defaultGateScript = "/home/david/.agents/wai/scripts/task-gate.sh";
const defaultMaxBytes = 256 * 1024;
const defaultMaxHints = 512;
const defaultMaxLineBytes = 8 * 1024;
const shaPattern = /^[0-9a-f]{40}$/i;
const taskIdPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const terminalStatuses = new Set([
  "completed",
  "done",
  "failed",
  "failure",
  "passed",
  "success",
  "succeeded",
]);

export const parseExecutorHints = ({
  expectedRepoRoot,
  expectedTaskIds,
  expectedTopic,
  inputs,
  maxBytes = defaultMaxBytes,
  maxHints = defaultMaxHints,
  maxLineBytes = defaultMaxLineBytes,
}: ParseExecutorHintsOptions): ParseExecutorHintsResult => {
  const expected = new Set(expectedTaskIds);
  const hints: ExecutorHint[] = [];
  const proposedTaskCommits: Record<string, string> = {};
  const seen = new Set<string>();

  const addHint = (
    file: ExecutorHintFile,
    kind: ExecutorHintKind,
    raw: string,
    taskId?: string,
    commit?: string,
    terminal?: boolean,
    details: ExecutorHintDetails = {},
  ): void => {
    if (hints.length >= maxHints) {
      return;
    }
    const boundedRaw = raw.slice(0, maxLineBytes);
    const duplicateKey = `${file}\0${taskId ?? ""}\0${commit ?? ""}\0${boundedRaw}`;
    const finalKind = selectHintKind(kind, taskId, expected, seen, duplicateKey);
    hints.push({
      source: "executor",
      authoritative: false,
      file,
      kind: finalKind,
      raw: boundedRaw,
      ...details,
      ...(commit === undefined ? {} : { commit }),
      ...(taskId === undefined ? {} : { taskId }),
      ...(terminal === undefined ? {} : { terminal }),
    });
    if (
      finalKind !== "malformed" &&
      finalKind !== "unknown_task" &&
      finalKind !== "duplicate" &&
      taskId !== undefined &&
      expected.has(taskId) &&
      commit !== undefined &&
      shaPattern.test(commit) &&
      proposedTaskCommits[taskId] === undefined
    ) {
      proposedTaskCommits[taskId] = commit.toLowerCase();
    }
  };

  parseNotify(inputs.notifyJsonl, maxBytes, addHint);
  parseRunState(inputs.runStateJson, maxBytes, addHint, {
    expectedRepoRoot,
    expectedTopic,
  });
  parseDagPassedCommits(inputs.dagPassedCommits, maxBytes, addHint);
  parseOneCommitHint(
    "dag_plan_commit",
    "dag_plan_commit",
    inputs.dagPlanCommit,
    maxBytes,
    addHint,
  );
  for (const handoff of inputs.workerHandoffs ?? []) {
    parseTextForCommitHint("worker_handoff", "worker_handoff", handoff, addHint);
  }
  for (const message of inputs.commitMessages ?? []) {
    parseTextForCommitHint("commit_message", "commit_message", message, addHint);
  }

  return { hints, proposedTaskCommits };
};

export const enumerateExpectedTaskManifest = ({
  baselineCommit,
  repoRoot,
  taskDirectory,
}: EnumerateExpectedTaskManifestOptions): ExpectedTaskManifest => {
  const baseline = resolveCommit(repoRoot, baselineCommit);
  const listing = runGit(repoRoot, [
    "ls-tree",
    "-r",
    "--name-only",
    baseline,
    "--",
    taskDirectory,
  ]);
  if (listing.status !== 0) {
    throw new Error(`Unable to enumerate expected task files: ${listing.stderr}`);
  }

  const taskPaths = listing.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.endsWith(".md"))
    .sort();
  if (taskPaths.length === 0) {
    throw new Error("Baseline did not contain committed task files");
  }

  const ids = new Set<string>();
  const tasks = taskPaths.map((taskPath) => {
    const content = runGit(repoRoot, ["show", `${baseline}:${taskPath}`]);
    if (content.status !== 0) {
      throw new Error(`Unable to read committed task file ${taskPath}`);
    }
    const id = parseTaskId(content.stdout);
    if (id === undefined) {
      throw new Error(`Committed task file lacks a valid id: ${taskPath}`);
    }
    if (ids.has(id)) {
      throw new Error(`Duplicate committed task id: ${id}`);
    }
    ids.add(id);
    return {
      contentHash: sha256(content.stdout),
      id,
      path: taskPath,
    };
  });
  const hash = sha256(
    JSON.stringify({
      baselineCommit: baseline,
      tasks,
    }),
  );

  return {
    baselineCommit: baseline,
    hash: `sha256:${hash}`,
    tasks,
  };
};

export const verifyAuthoritativeOutcome = (
  options: VerifyAuthoritativeOutcomeOptions,
): AuthoritativeOutcome => {
  const failures: TruthFailure[] = [];
  const gateResults: GateResult[] = [];
  const hints = [...(options.executorHints ?? [])];

  let manifest: ExpectedTaskManifest;
  try {
    manifest = enumerateExpectedTaskManifest(options);
  } catch (error) {
    return {
      expectedTasks: [],
      failures: [
        failure("expected_tasks_unavailable", "Could not derive committed tasks", {
          detail: formatError(error),
        }),
      ],
      gateResults,
      hints,
      manifestHash: "",
      verified: false,
    };
  }

  if (options.expectedManifestHash !== manifest.hash) {
    failures.push(
      failure("manifest_mismatch", "Expected task manifest hash did not match", {
        detail: `expected ${manifest.hash}, got ${options.expectedManifestHash}`,
      }),
    );
  }
  if (options.runnerExitStatus !== 0) {
    failures.push(
      failure("runner_nonzero", "Runner exit status was nonzero", {
        detail: String(options.runnerExitStatus),
      }),
    );
  }

  const unsafeGate = validateGateCommand(options);
  if (unsafeGate !== undefined) {
    failures.push(
      failure("unsafe_gate_command", "Gate command could run outside the verifier worktree", {
        detail: unsafeGate,
      }),
    );
  }

  const expectedIds = new Set(manifest.tasks.map((task) => task.id));
  const expectedById = new Map(manifest.tasks.map((task) => [task.id, task]));
  const actualIds = new Set(Object.keys(options.taskCommits));
  for (const task of manifest.tasks) {
    if (!actualIds.has(task.id)) {
      failures.push(
        failure("missing_task_commit", "Expected task is missing a commit", {
          taskId: task.id,
        }),
      );
    }
  }
  for (const taskId of actualIds) {
    if (!expectedIds.has(taskId)) {
      failures.push(
        failure("unexpected_task_commit", "Task commit map contains an unknown task", {
          taskId,
        }),
      );
    }
  }

  const baseline = manifest.baselineCommit;
  const branch = resolveCommitIfPresent(options.repoRoot, options.recordedBranchRef);
  if (branch === undefined) {
    failures.push(
      failure("recorded_branch_unavailable", "Recorded branch ref is unavailable", {
        detail: options.recordedBranchRef,
      }),
    );
  }

  const qualified: Array<{ readonly taskId: string; readonly commit: string }> = [];
  for (const [taskId, commit] of Object.entries(options.taskCommits).sort()) {
    if (!expectedById.has(taskId)) {
      continue;
    }
    const normalizedCommit = commit.toLowerCase();
    if (!shaPattern.test(normalizedCommit)) {
      failures.push(
        failure("invalid_commit", "Task commit must be a full commit SHA", {
          commit,
          taskId,
        }),
      );
      continue;
    }
    if (resolveCommitIfPresent(options.repoRoot, normalizedCommit) === undefined) {
      failures.push(
        failure("invalid_commit", "Task commit does not exist", {
          commit: normalizedCommit,
          taskId,
        }),
      );
      continue;
    }
    if (
      normalizedCommit === baseline ||
      isAncestor(options.repoRoot, normalizedCommit, baseline)
    ) {
      failures.push(
        failure("prebaseline_commit", "Task commit is not post-baseline", {
          commit: normalizedCommit,
          taskId,
        }),
      );
      continue;
    }
    if (
      !isAncestor(options.repoRoot, baseline, normalizedCommit) ||
      branch === undefined ||
      !isAncestor(options.repoRoot, normalizedCommit, branch)
    ) {
      failures.push(
        failure("nonancestor_commit", "Task commit is not ancestral to the recorded branch", {
          commit: normalizedCommit,
          taskId,
        }),
      );
      continue;
    }
    qualified.push({ commit: normalizedCommit, taskId });
  }

  const canRunGates =
    unsafeGate === undefined &&
    options.runnerExitStatus === 0 &&
    options.expectedManifestHash === manifest.hash &&
    branch !== undefined;
  if (canRunGates) {
    for (const task of qualified) {
      const result = runGate(options, task.taskId, task.commit);
      gateResults.push(result);
      if (result.setupFailed === true) {
        failures.push(
          failure("worktree_setup_failed", "Verifier worktree setup failed", {
            commit: task.commit,
            detail: result.stderr,
            taskId: task.taskId,
          }),
        );
      } else if (result.status !== 0) {
        failures.push(
          failure("gate_nonzero", "Independent task gate returned nonzero", {
            commit: task.commit,
            detail: result.stderr,
            taskId: task.taskId,
          }),
        );
      }
    }
  }

  return {
    expectedTasks: manifest.tasks,
    failures,
    gateResults,
    hints,
    manifestHash: manifest.hash,
    verified: failures.length === 0,
  };
};

const parseNotify = (
  content: string | undefined,
  maxBytes: number,
  addHint: (
    file: ExecutorHintFile,
    kind: ExecutorHintKind,
    raw: string,
    taskId?: string,
    commit?: string,
    terminal?: boolean,
    details?: ExecutorHintDetails,
  ) => void,
): void => {
  if (content === undefined) {
    return;
  }
  const bounded = boundContent(content, maxBytes);
  for (const line of bounded.text.split(/\r?\n/).filter((entry) => entry.length > 0)) {
    const parsed = parseJson(line);
    if (!isRecord(parsed)) {
      addHint("notify", "malformed", line);
      continue;
    }
    addHint(
      "notify",
      "notify",
      line,
      readString(parsed, "id") ?? readString(parsed, "task_id"),
      readString(parsed, "commit") ?? readString(parsed, "sha"),
      readTerminal(parsed),
      {
        at: readString(parsed, "at"),
        reason: readString(parsed, "reason"),
        runId: readString(parsed, "runId") ?? readString(parsed, "run_id"),
        state: readString(parsed, "state") ?? readString(parsed, "status"),
        topic: readString(parsed, "topic"),
      },
    );
  }
  if (bounded.truncated) {
    addHint("notify", "truncated", "");
  }
};

const parseRunState = (
  content: string | undefined,
  maxBytes: number,
  addHint: (
    file: ExecutorHintFile,
    kind: ExecutorHintKind,
    raw: string,
    taskId?: string,
    commit?: string,
    terminal?: boolean,
    details?: ExecutorHintDetails,
  ) => void,
  expected: { readonly expectedRepoRoot?: string; readonly expectedTopic?: string },
): void => {
  if (content === undefined) {
    return;
  }
  const bounded = boundContent(content, maxBytes);
  const parsed = parseJson(bounded.text);
  const records = normalizeRunState(parsed, expected);
  if (records.length === 0) {
    addHint("run_state", "malformed", bounded.text);
    return;
  }
  for (const { record, taskId } of records) {
    addHint(
      "run_state",
      "run_state",
      JSON.stringify(record),
      taskId ?? readString(record, "id") ?? readString(record, "task_id"),
      readString(record, "commit") ?? readString(record, "sha"),
      readTerminal(record),
      {
        at: readString(record, "at") ?? readString(record, "lastUpdated"),
        reason: readString(record, "reason") ?? readString(record, "kind"),
        runId: readString(record, "runId"),
        state: readString(record, "state") ?? readString(record, "status"),
        topic: readString(record, "topic"),
      },
    );
  }
  if (bounded.truncated) {
    addHint("run_state", "truncated", "");
  }
};

const parseDagPassedCommits = (
  content: string | undefined,
  maxBytes: number,
  addHint: (
    file: ExecutorHintFile,
    kind: ExecutorHintKind,
    raw: string,
    taskId?: string,
    commit?: string,
    terminal?: boolean,
    details?: ExecutorHintDetails,
  ) => void,
): void => {
  if (content === undefined) {
    return;
  }
  const bounded = boundContent(content, maxBytes);
  for (const line of bounded.text.split(/\r?\n/).filter((entry) => entry.length > 0)) {
    const [, taskId, commit] =
      line.match(/^\s*([A-Za-z0-9._-]+)\s+([0-9a-f]{40})\s*$/i) ?? [];
    addHint("dag_passed_commits", "dag_passed_commit", line, taskId, commit, true);
  }
  if (bounded.truncated) {
    addHint("dag_passed_commits", "truncated", "");
  }
};

const parseOneCommitHint = (
  file: ExecutorHintFile,
  kind: ExecutorHintKind,
  content: string | undefined,
  maxBytes: number,
  addHint: (
    file: ExecutorHintFile,
    kind: ExecutorHintKind,
    raw: string,
    taskId?: string,
    commit?: string,
    terminal?: boolean,
    details?: ExecutorHintDetails,
  ) => void,
): void => {
  if (content === undefined) {
    return;
  }
  const bounded = boundContent(content, maxBytes);
  const commit = bounded.text.match(/[0-9a-f]{40}/i)?.[0];
  addHint(file, kind, bounded.text, undefined, commit, undefined);
  if (bounded.truncated) {
    addHint(file, "truncated", "");
  }
};

const parseTextForCommitHint = (
  file: ExecutorHintFile,
  kind: ExecutorHintKind,
  content: string,
  addHint: (
    file: ExecutorHintFile,
    kind: ExecutorHintKind,
    raw: string,
    taskId?: string,
    commit?: string,
    terminal?: boolean,
    details?: ExecutorHintDetails,
  ) => void,
): void => {
  const taskId = content.match(/\btask[_ -]?id[:= ]+([A-Za-z0-9._-]+)/i)?.[1];
  const commit = content.match(/[0-9a-f]{40}/i)?.[0];
  addHint(file, kind, content, taskId, commit, readTerminalFromText(content));
};

const selectHintKind = (
  kind: ExecutorHintKind,
  taskId: string | undefined,
  expected: ReadonlySet<string>,
  seen: Set<string>,
  duplicateKey: string,
): ExecutorHintKind => {
  if (kind === "malformed" || kind === "truncated") {
    return kind;
  }
  const duplicate = seen.has(duplicateKey);
  seen.add(duplicateKey);
  if (duplicate) {
    return "duplicate";
  }
  if (taskId !== undefined && !expected.has(taskId)) {
    return "unknown_task";
  }
  return kind;
};

const normalizeRunState = (
  parsed: unknown,
  expected: { readonly expectedRepoRoot?: string; readonly expectedTopic?: string },
): Array<{ readonly record: Record<string, unknown>; readonly taskId?: string }> => {
  if (Array.isArray(parsed)) {
    return parsed
      .filter(isRecord)
      .map((record) => ({ record }));
  }
  if (!isRecord(parsed)) {
    return [];
  }
  const native = normalizeNativeRunState(parsed, expected);
  if (native !== undefined) {
    return native;
  }
  const tasks = parsed.tasks;
  if (isRecord(tasks)) {
    return Object.entries(tasks)
      .filter(([, record]) => isRecord(record))
      .map(([taskId, record]) => ({
        record: record as Record<string, unknown>,
        taskId,
      }));
  }
  if (readString(parsed, "id") !== undefined || readString(parsed, "task_id") !== undefined) {
    return [{ record: parsed }];
  }
  return [];
};


const nativeRunStateKeys = new Set([
  "attentionItems",
  "blockedTaskIds",
  "completedTaskIds",
  "currentTaskId",
  "failedTaskIds",
  "pendingTaskIds",
  "phase",
  "repoRoot",
  "runId",
  "topic",
]);

const normalizeNativeRunState = (
  parsed: Record<string, unknown>,
  expected: { readonly expectedRepoRoot?: string; readonly expectedTopic?: string },
): Array<{ readonly record: Record<string, unknown>; readonly taskId?: string }> | undefined => {
  if (!Object.keys(parsed).some((key) => nativeRunStateKeys.has(key))) {
    return undefined;
  }
  const runId = readString(parsed, "runId");
  const phase = readString(parsed, "phase");
  const topic = readString(parsed, "topic");
  const repoRoot = readString(parsed, "repoRoot");
  if (runId === undefined || phase === undefined) {
    return [];
  }
  if (expected.expectedTopic !== undefined && topic !== undefined && topic !== expected.expectedTopic) {
    return [];
  }
  if (expected.expectedRepoRoot !== undefined && repoRoot !== undefined && path.resolve(repoRoot) !== expected.expectedRepoRoot) {
    return [];
  }
  const base = {
    at: readString(parsed, "lastUpdated"),
    lastUpdated: readString(parsed, "lastUpdated"),
    phase,
    repoRoot,
    runId,
    topic,
  };
  const records: Array<{ readonly record: Record<string, unknown>; readonly taskId?: string }> = [];
  const pushTaskIds = (key: string, state: string, terminal: boolean): boolean => {
    const value = parsed[key];
    if (value === undefined) {
      return true;
    }
    if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) {
      return false;
    }
    for (const taskId of value) {
      records.push({
        record: {
          ...base,
          state,
          status: state,
          task_id: taskId,
          terminal,
        },
        taskId,
      });
    }
    return true;
  };

  if (
    !pushTaskIds("completedTaskIds", "completed", true) ||
    !pushTaskIds("failedTaskIds", "failed", true) ||
    !pushTaskIds("pendingTaskIds", "pending", false) ||
    !pushTaskIds("blockedTaskIds", "blocked", false)
  ) {
    return [];
  }

  const currentTaskId = parsed.currentTaskId;
  if (currentTaskId !== undefined && currentTaskId !== null) {
    if (typeof currentTaskId !== "string") {
      return [];
    }
    records.push({
      record: {
        ...base,
        state: "current",
        status: "current",
        task_id: currentTaskId,
        terminal: false,
      },
      taskId: currentTaskId,
    });
  }

  const attentionItems = parsed.attentionItems;
  if (attentionItems !== undefined) {
    if (!Array.isArray(attentionItems)) {
      return [];
    }
    for (const item of attentionItems) {
      if (!isRecord(item)) {
        return [];
      }
      const taskId = readString(item, "task_id") ?? readString(item, "id");
      const kind = readString(item, "kind") ?? "attention";
      const reason = readString(item, "reason");
      if (taskId === undefined) {
        return [];
      }
      records.push({
        record: {
          ...base,
          kind,
          ...(reason === undefined ? {} : { reason }),
          state: "attention",
          status: kind,
          task_id: taskId,
          terminal: false,
        },
        taskId,
      });
    }
  }

  return records;
};

const readString = (
  record: Readonly<Record<string, unknown>>,
  key: string,
): string | undefined => {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
};

const readTerminal = (record: Readonly<Record<string, unknown>>): boolean | undefined => {
  if (record.terminal === true || record.done === true) {
    return true;
  }
  const status = readString(record, "status") ?? readString(record, "reason");
  return status === undefined ? undefined : readTerminalFromText(status);
};

const readTerminalFromText = (text: string): boolean =>
  terminalStatuses.has(text.trim().toLowerCase()) ||
  /\b(done|failed|passed|success|succeeded)\b/i.test(text);

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const boundContent = (
  content: string,
  maxBytes: number,
): { readonly text: string; readonly truncated: boolean } => {
  const bytes = Buffer.byteLength(content);
  if (bytes <= maxBytes) {
    return { text: content, truncated: false };
  }
  return { text: content.slice(0, maxBytes), truncated: true };
};

const parseTaskId = (content: string): string | undefined => {
  const id = content.match(/^id:\s*["']?([A-Za-z0-9._-]+)["']?\s*$/m)?.[1];
  return id !== undefined && taskIdPattern.test(id) ? id : undefined;
};

const validateGateCommand = ({
  repoRoot,
  testCommand,
  typecheckCommand,
}: VerifyAuthoritativeOutcomeOptions): string | undefined => {
  for (const [label, command] of [
    ["typecheck", typecheckCommand],
    ["test", testCommand],
  ] as const) {
    const trimmed = command.trim();
    if (trimmed.length === 0 || trimmed === "true" || trimmed === ":" || trimmed === "exit 0") {
      return `${label} command is not a real check`;
    }
    if (trimmed.includes(path.resolve(repoRoot))) {
      return `${label} command embeds the final checkout path`;
    }
  }
  return undefined;
};

const runGate = (
  options: VerifyAuthoritativeOutcomeOptions,
  taskId: string,
  commit: string,
): GateResult => {
  const verifierRoot = options.verifierRoot ?? path.join(os.tmpdir(), "shohin-verifiers");
  mkdirSync(verifierRoot, { recursive: true, mode: 0o700 });
  const unique = randomUUID();
  const worktreePath = path.join(
    verifierRoot,
    `task-${taskId}-${commit.slice(0, 12)}-${unique}`,
  );
  const envRoot = path.join(verifierRoot, `env-${taskId}-${commit.slice(0, 12)}-${unique}`);
  const argv = [options.topic, taskId, "--commit", commit];
  const gateScript = options.gateScript ?? defaultGateScript;
  try {
    mkdirSync(envRoot, { recursive: true, mode: 0o700 });
    mkdirSync(path.join(envRoot, "HOME"), { mode: 0o700 });
    mkdirSync(path.join(envRoot, "tmp"), { mode: 0o700 });
    const setup = runGit(options.repoRoot, [
      "worktree",
      "add",
      "--detach",
      worktreePath,
      commit,
    ]);
    if (setup.status !== 0) {
      return {
        argv,
        commit,
        setupFailed: true,
        status: 127,
        stderr: setup.stderr,
        stdout: setup.stdout,
        taskId,
        worktreePath,
      };
    }
    const gate = spawnSync(gateScript, argv, {
      cwd: worktreePath,
      encoding: "utf-8",
      env: {
        HOME: path.join(envRoot, "HOME"),
        PATH: options.envPath ?? process.env.PATH ?? "/usr/bin:/bin",
        TMPDIR: path.join(envRoot, "tmp"),
        WAI_TEST_CMD: options.testCommand,
        WAI_TYPECHECK_CMD: options.typecheckCommand,
      },
      shell: false,
      timeout: options.gateTimeoutMs ?? 30 * 60 * 1000,
    });
    return {
      argv,
      commit,
      status: gate.status ?? 124,
      stderr: String(gate.stderr ?? gate.error?.message ?? ""),
      stdout: String(gate.stdout ?? ""),
      taskId,
      worktreePath,
    };
  } finally {
    const remove = runGit(options.repoRoot, ["worktree", "remove", "--force", worktreePath]);
    if (remove.status !== 0) {
      runGit(options.repoRoot, ["worktree", "prune"]);
      rmSync(worktreePath, { force: true, recursive: true });
    }
    rmSync(envRoot, { force: true, recursive: true });
  }
};

const resolveCommit = (repoRoot: string, commitish: string): string => {
  const result = runGit(repoRoot, ["rev-parse", "--verify", `${commitish}^{commit}`]);
  if (result.status !== 0) {
    throw new Error(result.stderr || `Cannot resolve commit ${commitish}`);
  }
  return result.stdout.trim().toLowerCase();
};

const resolveCommitIfPresent = (
  repoRoot: string,
  commitish: string,
): string | undefined => {
  try {
    return resolveCommit(repoRoot, commitish);
  } catch {
    return undefined;
  }
};

const isAncestor = (repoRoot: string, ancestor: string, descendant: string): boolean => {
  const result = runGit(repoRoot, ["merge-base", "--is-ancestor", ancestor, descendant]);
  return result.status === 0;
};

const runGit = (cwd: string, args: readonly string[]): CommandResult => {
  const result = spawnSync("git", [...args], {
    cwd,
    encoding: "utf-8",
    env: { PATH: process.env.PATH ?? "/usr/bin:/bin" },
    shell: false,
  });
  return {
    status: result.status ?? 127,
    stderr: String(result.stderr ?? result.error?.message ?? ""),
    stdout: String(result.stdout ?? ""),
  };
};

const sha256 = (content: string): string =>
  createHash("sha256").update(content).digest("hex");

const failure = (
  code: TruthFailureCode,
  message: string,
  extra: Omit<TruthFailure, "code" | "message"> = {},
): TruthFailure => ({
  code,
  message,
  ...extra,
});

const formatError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
