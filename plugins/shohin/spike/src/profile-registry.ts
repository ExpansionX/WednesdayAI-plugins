import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import type {
  ApprovedNoProviderGenerationHashes,
  ApprovedNoProviderProfileRecord,
  ApprovedNoProviderVerifierBinding,
} from "./supervisor.js";

export const approvedProfileDigestAlgorithm = "recursive-canonical-json-sha256-v1";
export const defaultApprovedProfileRegistryPath =
  process.env.SHOHIN_SPIKE_APPROVED_PROFILE_REGISTRY ??
  "/home/david/.zenith/projects/20260913T063314Z-resume-shohin-phase-0-spike-from-existing-docs-superpowers-specs/.zenith/missions/mission-001/approved-profiles.json";

export interface ApprovedNoProviderRuntimeOptions {
  readonly approvedNoProviderProfile: ApprovedNoProviderProfileRecord;
  readonly externalBaseline: string;
  readonly generationId?: string;
  readonly heartbeatPollIntervalMs: number;
  readonly heartbeatStaleAfterMs: number;
  readonly maxAttempts: 1;
  readonly runId?: string;
  readonly runnerTimeoutSec: number;
  readonly sourceHome: string;
  readonly targetRepoRoot: string;
  readonly waiBundleSourceDir: string;
  readonly waiRunCommand: string;
}

export interface ApprovedProfileResolveOptions {
  readonly profileId: string;
  readonly registryPath?: string;
  readonly request: {
    readonly generationId?: string;
    readonly runId?: string;
    readonly targetRepoRoot: string;
    readonly topic: string;
  };
}

interface RegistryFile {
  readonly profiles: readonly unknown[];
  readonly version: 1;
}

interface DependencyPin {
  readonly path: string;
  readonly sha256: string;
}

const requiredGenerationHashKeys = [
  "VERSION",
  "cost",
  "executors",
  "gate",
  "run",
  "watch",
] as const;

interface ApprovedProfileEntry {
  readonly approved: true;
  readonly approvedAt?: string;
  readonly dependencies: readonly DependencyPin[];
  readonly expectedArgv: readonly string[];
  readonly expectedCommonGitDir: string;
  readonly expectedEnvPath: string;
  readonly expectedGenerationHashes: ApprovedNoProviderGenerationHashes;
  readonly expectedManifestHash: string;
  readonly expectedStartingHead: string;
  readonly expectedVerifier: ApprovedNoProviderVerifierBinding;
  readonly externalBaseline: string;
  readonly generationId?: string;
  readonly heartbeatPollIntervalMs: number;
  readonly heartbeatStaleAfterMs: number;
  readonly id: string;
  readonly kind: "deterministic-no-provider-probe";
  readonly maxAttempts: 1;
  readonly profileDigest: string;
  readonly profileDigestAlgorithm: typeof approvedProfileDigestAlgorithm;
  readonly providerAccess: "denied";
  readonly runId?: string;
  readonly runnerTimeoutSec: number;
  readonly sourceHome: string;
  readonly targetRepoRoot: string;
  readonly topic: string;
  readonly waiBundleSourceDir: string;
  readonly waiRunCommand: string;
}

export class ApprovedProfileError extends Error {
  public constructor(
    public readonly code:
      | "approved_profile_altered"
      | "approved_profile_missing"
      | "approved_profile_path_alias"
      | "approved_profile_rejected"
      | "approved_profile_unknown",
    message: string,
  ) {
    super(message);
    this.name = "ApprovedProfileError";
  }
}

export const resolveApprovedNoProviderProfile = ({
  profileId,
  registryPath = defaultApprovedProfileRegistryPath,
  request,
}: ApprovedProfileResolveOptions): ApprovedNoProviderRuntimeOptions => {
  const registry = readRegistry(registryPath);
  const profile = registry.profiles.find(
    (entry): entry is ApprovedProfileEntry =>
      isRecord(entry) && entry.id === profileId,
  );
  if (profile === undefined) {
    throw new ApprovedProfileError(
      "approved_profile_unknown",
      `Approved no-provider profile is not registered: ${profileId}`,
    );
  }
  validateProfile(profile);
  if (profile.topic !== request.topic) {
    throw new ApprovedProfileError(
      "approved_profile_rejected",
      "Approved profile topic does not match the requested run",
    );
  }
  if (canonicalRealPath(request.targetRepoRoot, "requested target repo root") !== profile.targetRepoRoot) {
    throw new ApprovedProfileError(
      "approved_profile_rejected",
      "Approved profile target worktree does not match the requested run",
    );
  }
  if (request.runId !== undefined && profile.runId !== undefined && request.runId !== profile.runId) {
    throw new ApprovedProfileError(
      "approved_profile_rejected",
      "Approved profile run id does not match the requested run",
    );
  }
  if (
    request.generationId !== undefined &&
    profile.generationId !== undefined &&
    request.generationId !== profile.generationId
  ) {
    throw new ApprovedProfileError(
      "approved_profile_rejected",
      "Approved profile generation id does not match the requested run",
    );
  }

  return {
    approvedNoProviderProfile: {
      approvedAt: profile.approvedAt,
      classification: "zero-provider",
      digest: profile.profileDigest,
      expectedArgv: profile.expectedArgv,
      expectedCommonGitDir: profile.expectedCommonGitDir,
      expectedEnvPath: profile.expectedEnvPath,
      expectedGenerationHashes: profile.expectedGenerationHashes,
      expectedManifestHash: profile.expectedManifestHash,
      expectedStartingHead: profile.expectedStartingHead,
      expectedVerifier: profile.expectedVerifier,
      id: profile.id,
    },
    externalBaseline: profile.externalBaseline,
    generationId: request.generationId ?? profile.generationId,
    heartbeatPollIntervalMs: profile.heartbeatPollIntervalMs,
    heartbeatStaleAfterMs: profile.heartbeatStaleAfterMs,
    maxAttempts: 1,
    runId: request.runId ?? profile.runId,
    runnerTimeoutSec: profile.runnerTimeoutSec,
    sourceHome: profile.sourceHome,
    targetRepoRoot: profile.targetRepoRoot,
    waiBundleSourceDir: profile.waiBundleSourceDir,
    waiRunCommand: profile.waiRunCommand,
  };
};

export const canonicalJson = (value: unknown): string => stringifyCanonical(value);

export const canonicalJsonDigest = (value: unknown): string =>
  `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;

const readRegistry = (registryPath: string): RegistryFile => {
  const canonicalPath = canonicalRealPath(registryPath, "approved profile registry");
  if (!existsSync(canonicalPath)) {
    throw new ApprovedProfileError(
      "approved_profile_missing",
      `Approved profile registry is missing: ${canonicalPath}`,
    );
  }
  const parsed = JSON.parse(readFileSync(canonicalPath, "utf-8")) as unknown;
  if (!isRecord(parsed) || parsed.version !== 1 || !Array.isArray(parsed.profiles)) {
    throw new ApprovedProfileError("approved_profile_rejected", "Approved profile registry is malformed");
  }
  return parsed as unknown as RegistryFile;
};

const validateProfile = (profile: ApprovedProfileEntry): void => {
  const raw = profile as unknown as Record<string, unknown>;
  for (const key of [
    "expectedManifestHash",
    "externalBaseline",
    "id",
    "kind",
    "profileDigest",
    "profileDigestAlgorithm",
    "providerAccess",
    "sourceHome",
    "targetRepoRoot",
    "topic",
    "waiBundleSourceDir",
    "waiRunCommand",
  ]) {
    assertString(raw[key], `profile ${key}`);
  }
  for (const key of [
    "expectedCommonGitDir",
    "expectedEnvPath",
    "expectedStartingHead",
    "generationId",
    "runId",
    "approvedAt",
  ]) {
    if (raw[key] !== undefined || key.startsWith("expected")) {
      assertString(raw[key], `profile ${key}`);
    }
  }
  if (profile.expectedVerifier === undefined || profile.expectedGenerationHashes === undefined) {
    throw new ApprovedProfileError(
      "approved_profile_rejected",
      "Profile is missing required no-provider bindings",
    );
  }
  if (!Array.isArray(profile.expectedArgv) || !profile.expectedArgv.every((entry) => typeof entry === "string")) {
    throw new ApprovedProfileError("approved_profile_rejected", "Profile expected argv is malformed");
  }
  if (
    !Array.isArray(profile.dependencies) ||
    !profile.dependencies.every(
      (entry) =>
        isRecord(entry) &&
        typeof entry.path === "string" &&
        typeof entry.sha256 === "string",
    )
  ) {
    throw new ApprovedProfileError("approved_profile_rejected", "Profile dependencies are malformed");
  }
  if (profile.approved !== true || profile.kind !== "deterministic-no-provider-probe") {
    throw new ApprovedProfileError("approved_profile_rejected", "Profile is not approved for no-provider probe use");
  }
  if (profile.profileDigestAlgorithm !== approvedProfileDigestAlgorithm) {
    throw new ApprovedProfileError("approved_profile_rejected", "Profile digest algorithm is not supported");
  }
  validateVerifierBinding(profile.expectedVerifier);
  validateGenerationHashes(profile.expectedGenerationHashes);
  if (canonicalJsonDigest(profile) !== profile.profileDigest) {
    throw new ApprovedProfileError("approved_profile_altered", "Approved profile digest does not match its bytes");
  }
  assertSha(profile.externalBaseline, "external baseline");
  assertSha256(profile.expectedManifestHash, "expected manifest hash");
  assertSha(profile.expectedStartingHead, "expected starting HEAD");
  assertComponent(profile.id, "profile id");
  assertComponent(profile.topic, "profile topic");
  if (profile.maxAttempts !== 1 || profile.providerAccess !== "denied") {
    throw new ApprovedProfileError("approved_profile_rejected", "Profile is not a closed zero-provider run");
  }
  if (!Number.isSafeInteger(profile.runnerTimeoutSec) || profile.runnerTimeoutSec < 1 || profile.runnerTimeoutSec > 30 * 60) {
    throw new ApprovedProfileError("approved_profile_rejected", "Profile runner timeout is outside the spike ceiling");
  }
  if (!Number.isSafeInteger(profile.heartbeatPollIntervalMs) || profile.heartbeatPollIntervalMs < 1) {
    throw new ApprovedProfileError("approved_profile_rejected", "Profile heartbeat poll interval is invalid");
  }
  if (!Number.isSafeInteger(profile.heartbeatStaleAfterMs) || profile.heartbeatStaleAfterMs < 60_000) {
    throw new ApprovedProfileError("approved_profile_rejected", "Profile heartbeat stale window is too small");
  }
  const canonicalTarget = canonicalRealPath(profile.targetRepoRoot, "profile target repo root");
  const canonicalHome = canonicalRealPath(profile.sourceHome, "profile source HOME");
  const canonicalBundle = canonicalRealPath(profile.waiBundleSourceDir, "profile WAI bundle");
  const canonicalCommonGitDir = profile.expectedCommonGitDir === undefined
    ? undefined
    : canonicalRealPath(profile.expectedCommonGitDir, "profile common Git directory");
  if (
    canonicalTarget !== profile.targetRepoRoot ||
    canonicalHome !== profile.sourceHome ||
    canonicalBundle !== profile.waiBundleSourceDir ||
    (canonicalCommonGitDir !== undefined && canonicalCommonGitDir !== profile.expectedCommonGitDir)
  ) {
    throw new ApprovedProfileError("approved_profile_path_alias", "Profile paths must be canonical real paths");
  }
  if (profile.expectedArgv.length < 3 || profile.expectedArgv[0] !== profile.waiRunCommand || profile.expectedArgv.at(-1) !== profile.topic) {
    throw new ApprovedProfileError("approved_profile_rejected", "Profile runner argv is not the reviewed deterministic argv");
  }
  for (const dependency of profile.dependencies) {
    const canonicalDependency = canonicalRealPath(dependency.path, "profile dependency");
    if (canonicalDependency !== dependency.path) {
      throw new ApprovedProfileError("approved_profile_path_alias", "Profile dependency path is not canonical");
    }
    assertSha256(dependency.sha256, "dependency hash");
    const actual = `sha256:${createHash("sha256").update(readFileSync(canonicalDependency)).digest("hex")}`;
    if (actual !== dependency.sha256) {
      throw new ApprovedProfileError("approved_profile_altered", `Profile dependency hash mismatch: ${canonicalDependency}`);
    }
  }
};

const validateVerifierBinding = (binding: ApprovedNoProviderVerifierBinding | undefined): void => {
  if (binding === undefined) {
    return;
  }
  if (!isRecord(binding)) {
    throw new ApprovedProfileError("approved_profile_rejected", "Profile verifier binding is malformed");
  }
  for (const key of ["gateScriptBasename", "taskDirectory", "testCommand", "typecheckCommand"] as const) {
    assertString(binding[key], `profile verifier ${key}`);
  }
  assertComponent(binding.gateScriptBasename, "profile verifier gate script basename");
  if (!Number.isSafeInteger(binding.gateTimeoutMs) || binding.gateTimeoutMs < 1 || binding.gateTimeoutMs > 30 * 60 * 1000) {
    throw new ApprovedProfileError("approved_profile_rejected", "Profile verifier timeout is outside the spike ceiling");
  }
};

const validateGenerationHashes = (hashes: ApprovedNoProviderGenerationHashes | undefined): void => {
  if (hashes === undefined) {
    return;
  }
  if (!isRecord(hashes)) {
    throw new ApprovedProfileError("approved_profile_rejected", "Profile runner generation hashes are malformed");
  }
  const keys = Object.keys(hashes).sort();
  if (JSON.stringify(keys) !== JSON.stringify([...requiredGenerationHashKeys].sort())) {
    throw new ApprovedProfileError("approved_profile_rejected", "Profile runner generation hashes are incomplete");
  }
  for (const key of requiredGenerationHashKeys) {
    assertSha256(hashes[key], `runner generation hash ${key}`);
  }
};

const canonicalRealPath = (input: string, label: string): string => {
  if (!path.isAbsolute(input) || path.normalize(input) !== input) {
    throw new ApprovedProfileError("approved_profile_path_alias", `${label} must be an absolute normalized path`);
  }
  try {
    const stats = lstatSync(input);
    if (stats.isSymbolicLink()) {
      throw new ApprovedProfileError("approved_profile_path_alias", `${label} must not be a symlink`);
    }
  } catch (error) {
    if (error instanceof ApprovedProfileError) {
      throw error;
    }
    throw new ApprovedProfileError("approved_profile_missing", `${label} is missing: ${input}`);
  }
  const canonical = realpathSync.native(input);
  if (canonical !== input) {
    throw new ApprovedProfileError("approved_profile_path_alias", `${label} is not a canonical real path`);
  }
  return canonical;
};

const stringifyCanonical = (value: unknown): string => {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new ApprovedProfileError("approved_profile_rejected", "Profile contains a non-finite number");
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stringifyCanonical(entry)).join(",")}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .filter((key) => key !== "profileDigest" && key !== "profileDigestAlgorithm")
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stringifyCanonical(value[key])}`)
      .join(",")}}`;
  }
  throw new ApprovedProfileError("approved_profile_rejected", "Profile contains an unsupported JSON value");
};

const assertComponent = (value: string, label: string): void => {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)) {
    throw new ApprovedProfileError("approved_profile_rejected", `${label} is invalid`);
  }
};

const assertString = (value: unknown, label: string): void => {
  if (typeof value !== "string" || value.length === 0) {
    throw new ApprovedProfileError("approved_profile_rejected", `${label} must be a non-empty string`);
  }
};

const assertSha = (value: string, label: string): void => {
  if (!/^[0-9a-f]{40}$/i.test(value)) {
    throw new ApprovedProfileError("approved_profile_rejected", `${label} must be a full commit SHA`);
  }
};

const assertSha256 = (value: string, label: string): void => {
  if (!/^sha256:[0-9a-f]{64}$/i.test(value)) {
    throw new ApprovedProfileError("approved_profile_rejected", `${label} must be a sha256 digest`);
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
