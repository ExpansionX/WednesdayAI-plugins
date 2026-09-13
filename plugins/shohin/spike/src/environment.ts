import { execFileSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  statSync,
} from "node:fs";
import path from "node:path";

export type SourceEnvironment = Readonly<Record<string, string | undefined>>;

export interface CopyAllowedHomeOptions {
  readonly sourceHome: string;
  readonly destinationHome: string;
  readonly allowList: readonly string[];
}

export interface BuildExecutorEnvironmentOptions {
  readonly sourceEnv: SourceEnvironment;
  readonly home: string;
  readonly tmpdir: string;
  readonly runnerEnvKeys?: readonly string[];
  readonly envAllowList?: readonly string[];
}

export interface BuildControlEnvironmentOptions {
  readonly sourceEnv: SourceEnvironment;
}

export type BuiltEnvironment = Record<string, string>;

const topicPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const envNamePattern = /^[A-Z_][A-Z0-9_]*$/;
const defaultExecutorEnvAllowList = ["PATH"] as const;
const executorBaseKeys = new Set(["PATH", "HOME", "TMPDIR"]);
const controlBusKeys = new Set(["XDG_RUNTIME_DIR", "DBUS_SESSION_BUS_ADDRESS"]);

export const validateTopic = (topic: string): string => {
  if (!topicPattern.test(topic) || topic === "." || topic === "..") {
    throw new Error(`Invalid Shohin topic: ${topic}`);
  }
  return topic;
};

export const resolveRegisteredRepoRoot = (
  repoRoot: string,
  expectedRepoRoot?: string,
): string => {
  const canonicalRoot = canonicalExistingDirectory(repoRoot, "registered repo root");
  ensureCanonicalInput(repoRoot, canonicalRoot, "registered repo root");

  let gitTopLevel: string;
  try {
    gitTopLevel = resolveGitTopLevel(canonicalRoot);
  } catch (error) {
    throw new Error(
      `Registered repo root must be the Git worktree root: ${formatUnknownError(error)}`,
    );
  }
  if (gitTopLevel !== canonicalRoot) {
    throw new Error("Registered repo root must be the Git worktree root");
  }

  if (expectedRepoRoot !== undefined) {
    const expectedCanonical = canonicalExistingDirectory(
      expectedRepoRoot,
      "expected registered repo root",
    );
    if (canonicalRoot !== expectedCanonical) {
      throw new Error("Configured path does not match the registered repo root");
    }
  }

  return canonicalRoot;
};

export const resolveLinkedWorktree = (
  worktreeRoot: string,
  registeredRepoRoot: string,
): string => {
  rejectTraversalPath(worktreeRoot, "linked worktree");
  const canonicalRegisteredRoot = resolveRegisteredRepoRoot(registeredRepoRoot);
  const canonicalWorktree = canonicalExistingDirectory(
    worktreeRoot,
    "linked worktree",
  );
  ensureCanonicalInput(worktreeRoot, canonicalWorktree, "linked worktree");

  const worktreeTopLevel = resolveGitTopLevel(canonicalWorktree);
  if (worktreeTopLevel !== canonicalWorktree) {
    throw new Error("Linked worktree path must be the worktree root");
  }

  const registeredCommonDir = resolveGitCommonDirectory(canonicalRegisteredRoot);
  const worktreeCommonDir = resolveGitCommonDirectory(canonicalWorktree);
  if (registeredCommonDir !== worktreeCommonDir) {
    throw new Error(
      "Linked worktree common git directory does not match registered root",
    );
  }

  return canonicalWorktree;
};

export const readAllowList = (allowListPath: string): string[] => {
  const content = readFileSync(allowListPath, "utf-8");
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
};

export const copyAllowedHome = ({
  sourceHome,
  destinationHome,
  allowList,
}: CopyAllowedHomeOptions): string[] => {
  const canonicalSourceHome = canonicalExistingDirectory(sourceHome, "source HOME");
  ensureCanonicalInput(sourceHome, canonicalSourceHome, "source HOME");
  const canonicalDestinationHome = prepareDestinationHome(destinationHome);
  const copied: string[] = [];

  for (const entry of allowList) {
    const relativeEntry = validateHomeAllowListEntry(entry);
    const sourcePath = path.join(canonicalSourceHome, relativeEntry);
    ensureInside(canonicalSourceHome, sourcePath, "HOME allowlist source");
    rejectSymlinkComponents(canonicalSourceHome, relativeEntry);

    const sourceStats = statSync(sourcePath);
    if (!sourceStats.isFile()) {
      throw new Error(`HOME allowlist entry must point to a regular file: ${entry}`);
    }

    const realSourcePath = realpathSync.native(sourcePath);
    ensureInside(canonicalSourceHome, realSourcePath, "HOME allowlist source");

    const destinationPath = path.join(canonicalDestinationHome, relativeEntry);
    ensureInside(canonicalDestinationHome, destinationPath, "HOME copy destination");
    prepareContainedDirectory(
      canonicalDestinationHome,
      path.dirname(destinationPath),
    );
    rejectExistingDestinationSpecialFile(destinationPath);

    copyFileSync(sourcePath, destinationPath);
    chmodSync(destinationPath, sourceStats.mode & 0o777);
    copied.push(relativeEntry);
  }

  return copied;
};

export const buildExecutorEnvironment = ({
  sourceEnv,
  home,
  tmpdir,
  runnerEnvKeys = [],
  envAllowList = defaultExecutorEnvAllowList,
}: BuildExecutorEnvironmentOptions): BuiltEnvironment => {
  rejectForbiddenEnvironmentInputs(sourceEnv, { allowBus: false });

  const env: BuiltEnvironment = {};
  for (const key of envAllowList) {
    assertEnvironmentName(key, "executor allowlist");
    if (key === "HOME" || key === "TMPDIR") {
      throw new Error(`Executor ${key} must come from explicit paths, not source env`);
    }
    rejectForbiddenEnvironmentName(key, { allowBus: false });
    copyRequiredEnvValue(env, sourceEnv, key);
  }

  if (env.PATH === undefined) {
    copyRequiredEnvValue(env, sourceEnv, "PATH");
  }
  env.HOME = validateAbsoluteNormalizedPath(home, "executor HOME");
  env.TMPDIR = validateAbsoluteNormalizedPath(tmpdir, "executor TMPDIR");

  for (const key of runnerEnvKeys) {
    assertEnvironmentName(key, "executor runner variable");
    if (executorBaseKeys.has(key)) {
      throw new Error(`Executor runner variable cannot override ${key}`);
    }
    rejectForbiddenEnvironmentName(key, { allowBus: false });
    copyRequiredEnvValue(env, sourceEnv, key);
  }

  rejectForbiddenEnvironmentOutputs(env, { allowBus: false });
  return env;
};

export const buildControlEnvironment = ({
  sourceEnv,
}: BuildControlEnvironmentOptions): BuiltEnvironment => {
  rejectForbiddenEnvironmentInputs(sourceEnv, { allowBus: true });

  const env: BuiltEnvironment = {
    PATH: readRequiredEnvValue(sourceEnv, "PATH"),
    XDG_RUNTIME_DIR: validateAbsoluteNormalizedPath(
      readRequiredEnvValue(sourceEnv, "XDG_RUNTIME_DIR"),
      "XDG_RUNTIME_DIR",
    ),
  };

  const busAddress = sourceEnv.DBUS_SESSION_BUS_ADDRESS;
  if (busAddress !== undefined) {
    env.DBUS_SESSION_BUS_ADDRESS = validateDbusSessionBusAddress(
      busAddress,
      env.XDG_RUNTIME_DIR,
    );
  }

  rejectForbiddenEnvironmentOutputs(env, { allowBus: true });
  return env;
};

const canonicalExistingDirectory = (inputPath: string, label: string): string => {
  rejectEmptyPath(inputPath, label);
  rejectTraversalPath(inputPath, label);
  const resolved = path.resolve(inputPath);
  const stats = lstatSync(resolved);
  if (stats.isSymbolicLink()) {
    throw new Error(`${label} must be the canonical path; symlink aliases are rejected`);
  }
  if (!stats.isDirectory()) {
    throw new Error(`${label} must be a directory`);
  }
  return realpathSync.native(resolved);
};

const ensureCanonicalInput = (
  inputPath: string,
  canonicalPath: string,
  label: string,
): void => {
  if (path.resolve(inputPath) !== canonicalPath) {
    throw new Error(`${label} must be the canonical path; symlink aliases are rejected`);
  }
};

const resolveGitTopLevel = (cwd: string): string => {
  const topLevel = runGit(cwd, ["rev-parse", "--show-toplevel"], "Git top-level");
  return realpathSync.native(topLevel);
};

const resolveGitCommonDirectory = (cwd: string): string => {
  const commonDir = runGit(cwd, ["rev-parse", "--git-common-dir"], "Git common directory");
  const absoluteCommonDir = path.isAbsolute(commonDir)
    ? commonDir
    : path.resolve(cwd, commonDir);
  return realpathSync.native(absoluteCommonDir);
};

const runGit = (cwd: string, args: readonly string[], label: string): string => {
  try {
    return execFileSync("git", [...args], {
      cwd,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (error) {
    throw new Error(`${label} failed: ${formatUnknownError(error)}`);
  }
};

const formatUnknownError = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
};

const rejectEmptyPath = (inputPath: string, label: string): void => {
  if (inputPath.length === 0 || inputPath.includes("\0")) {
    throw new Error(`${label} must be a non-empty path`);
  }
};

const rejectTraversalPath = (inputPath: string, label: string): void => {
  if (inputPath.split(/[\\/]+/).includes("..")) {
    throw new Error(`${label} must not contain traversal segments`);
  }
};

const validateHomeAllowListEntry = (entry: string): string => {
  if (entry.length === 0 || entry.includes("\0")) {
    throw new Error("HOME allowlist entry must be non-empty");
  }
  if (path.isAbsolute(entry) || entry.includes("\\")) {
    throw new Error(`Unsafe HOME allowlist entry: ${entry}`);
  }
  if (entry.split("/").includes("..")) {
    throw new Error(`Unsafe HOME allowlist traversal entry: ${entry}`);
  }

  const normalized = path.posix.normalize(entry);
  if (normalized === "." || normalized !== entry) {
    throw new Error(`Unsafe HOME allowlist entry: ${entry}`);
  }
  return normalized;
};

const prepareDestinationHome = (destinationHome: string): string => {
  rejectEmptyPath(destinationHome, "destination HOME");
  rejectTraversalPath(destinationHome, "destination HOME");
  if (!path.isAbsolute(destinationHome) || path.resolve(destinationHome) !== destinationHome) {
    throw new Error("destination HOME must be an absolute normalized path");
  }
  rejectExistingSymlinkComponents(destinationHome);
  mkdirSync(destinationHome, { recursive: true, mode: 0o700 });
  const stats = lstatSync(destinationHome);
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error("destination HOME must be a directory, not a special file");
  }
  chmodSync(destinationHome, 0o700);
  const realDestinationHome = realpathSync.native(destinationHome);
  ensureCanonicalInput(destinationHome, realDestinationHome, "destination HOME");
  return realDestinationHome;
};

const prepareContainedDirectory = (root: string, directory: string): void => {
  ensureInside(root, directory, "HOME copy destination");
  rejectExistingSymlinkComponents(directory, root);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  rejectExistingSymlinkComponents(directory, root);
  const realDirectory = realpathSync.native(directory);
  ensureInside(root, realDirectory, "HOME copy destination");
  chmodSync(directory, 0o700);
};

const rejectExistingDestinationSpecialFile = (destinationPath: string): void => {
  if (!existsSync(destinationPath)) {
    return;
  }
  const stats = lstatSync(destinationPath);
  if (stats.isSymbolicLink() || !stats.isFile()) {
    throw new Error("HOME copy destination must not be a symlink or special file");
  }
};

const rejectSymlinkComponents = (root: string, relativeEntry: string): void => {
  let currentPath = root;
  for (const segment of relativeEntry.split("/")) {
    currentPath = path.join(currentPath, segment);
    const stats = lstatSync(currentPath);
    if (stats.isSymbolicLink()) {
      throw new Error(`HOME allowlist entry crosses a symlink: ${relativeEntry}`);
    }
  }
};

const rejectExistingSymlinkComponents = (
  inputPath: string,
  stopAt?: string,
): void => {
  const resolvedPath = path.resolve(inputPath);
  const resolvedStop = stopAt === undefined ? path.parse(resolvedPath).root : stopAt;
  const relative = path.relative(resolvedStop, resolvedPath);
  const segments = relative.length === 0 ? [] : relative.split(path.sep);
  let currentPath = resolvedStop;

  for (const segment of segments) {
    currentPath = path.join(currentPath, segment);
    if (!existsSync(currentPath)) {
      return;
    }
    const stats = lstatSync(currentPath);
    if (stats.isSymbolicLink()) {
      throw new Error(`Path must not cross a symlink: ${inputPath}`);
    }
  }
};

const ensureInside = (root: string, candidate: string, label: string): void => {
  const relative = path.relative(root, candidate);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`${label} escapes its root`);
  }
};

const validateAbsoluteNormalizedPath = (value: string, label: string): string => {
  if (value.length === 0 || value.includes("\0")) {
    throw new Error(`${label} must be non-empty`);
  }
  if (!path.isAbsolute(value) || path.resolve(value) !== value) {
    throw new Error(`${label} must be an absolute normalized path`);
  }
  return value;
};

const validateDbusSessionBusAddress = (
  address: string,
  runtimeDir: string,
): string => {
  const prefix = "unix:path=";
  if (!address.startsWith(prefix)) {
    throw new Error("DBUS_SESSION_BUS_ADDRESS must be a unix:path address");
  }
  const busPath = address.slice(prefix.length);
  if (busPath.includes(",")) {
    throw new Error("DBUS_SESSION_BUS_ADDRESS must contain only a unix:path value");
  }
  const normalizedBusPath = validateAbsoluteNormalizedPath(
    busPath,
    "DBUS_SESSION_BUS_ADDRESS",
  );
  ensureInside(runtimeDir, normalizedBusPath, "DBUS_SESSION_BUS_ADDRESS");
  return `${prefix}${normalizedBusPath}`;
};

const assertEnvironmentName = (key: string, label: string): void => {
  if (!envNamePattern.test(key)) {
    throw new Error(`${label} contains an invalid environment variable name: ${key}`);
  }
};

const copyRequiredEnvValue = (
  target: BuiltEnvironment,
  sourceEnv: SourceEnvironment,
  key: string,
): void => {
  target[key] = readRequiredEnvValue(sourceEnv, key);
};

const readRequiredEnvValue = (sourceEnv: SourceEnvironment, key: string): string => {
  const value = sourceEnv[key];
  if (value === undefined) {
    throw new Error(`Required environment variable is missing: ${key}`);
  }
  if (value.includes("\0")) {
    throw new Error(`Environment variable contains a NUL byte: ${key}`);
  }
  return value;
};

const rejectForbiddenEnvironmentInputs = (
  sourceEnv: SourceEnvironment,
  options: { readonly allowBus: boolean },
): void => {
  for (const key of Object.keys(sourceEnv)) {
    if (sourceEnv[key] === undefined) {
      continue;
    }
    rejectForbiddenEnvironmentName(key, options);
  }
};

const rejectForbiddenEnvironmentOutputs = (
  env: BuiltEnvironment,
  options: { readonly allowBus: boolean },
): void => {
  for (const key of Object.keys(env)) {
    rejectForbiddenEnvironmentName(key, options);
  }
};

const rejectForbiddenEnvironmentName = (
  key: string,
  { allowBus }: { readonly allowBus: boolean },
): void => {
  const upperKey = key.toUpperCase();
  if (allowBus && controlBusKeys.has(upperKey)) {
    return;
  }
  if (
    !allowBus &&
    (upperKey === "XDG_RUNTIME_DIR" || upperKey === "DBUS_SESSION_BUS_ADDRESS")
  ) {
    throw new Error(`Forbidden user-bus environment variable: ${key}`);
  }
  if (upperKey.startsWith("DBUS_")) {
    throw new Error(`Forbidden user-bus environment variable: ${key}`);
  }
  if (
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
  ) {
    throw new Error(`Forbidden credential environment variable: ${key}`);
  }
};
