import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  approvedProfileDigestAlgorithm,
  canonicalJsonDigest,
  resolveApprovedNoProviderProfile,
} from "./profile-registry.js";

const tempRoots: string[] = [];

const makeTempRoot = (name: string): string => {
  const root = mkdtempSync(path.join(os.tmpdir(), `shohin-profile-${name}-`));
  tempRoots.push(root);
  return realpathSync.native(root);
};

const sha256 = (content: string): string =>
  `sha256:${createHash("sha256").update(content).digest("hex")}`;

const makeProfile = (root: string, overrides: Record<string, unknown> = {}) => {
  const targetRepoRoot = path.join(root, "target");
  const sourceHome = path.join(root, "home");
  const waiBundleSourceDir = path.join(root, "bundle");
  mkdirSync(targetRepoRoot, { recursive: true });
  mkdirSync(sourceHome, { recursive: true });
  mkdirSync(waiBundleSourceDir, { recursive: true });
  const runner = path.join(waiBundleSourceDir, "wai-dag-run.sh");
  writeFileSync(runner, "#!/usr/bin/env bash\nexit 0\n", { mode: 0o755 });
  const profile = {
    approved: true,
    approvedAt: "2026-09-13T21:00:00Z",
    dependencies: [{ path: runner, sha256: sha256(readFileSync(runner, "utf-8")) }],
    expectedArgv: ["bash", "wai-dag-run.sh", "fixture-topic"],
    expectedManifestHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    externalBaseline: "0123456789abcdef0123456789abcdef01234567",
    heartbeatPollIntervalMs: 250,
    heartbeatStaleAfterMs: 60000,
    id: "fixture-profile",
    kind: "deterministic-no-provider-probe",
    maxAttempts: 1,
    profileDigest: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
    profileDigestAlgorithm: approvedProfileDigestAlgorithm,
    providerAccess: "denied",
    runnerTimeoutSec: 120,
    sourceHome,
    targetRepoRoot,
    topic: "fixture-topic",
    waiBundleSourceDir,
    waiRunCommand: "bash",
    ...overrides,
  };
  return { ...profile, profileDigest: canonicalJsonDigest(profile) };
};

const writeRegistry = (root: string, profile: unknown): string => {
  const registryPath = path.join(root, "approved-profiles.json");
  writeFileSync(registryPath, JSON.stringify({ profiles: [profile], version: 1 }, null, 2));
  return registryPath;
};

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("approved no-provider profile registry", () => {
  it("resolves only an approved exact profile and preserves zero-provider classification", () => {
    const root = makeTempRoot("success");
    const profile = makeProfile(root);
    const registryPath = writeRegistry(root, profile);

    const resolved = resolveApprovedNoProviderProfile({
      profileId: "fixture-profile",
      registryPath,
      request: {
        targetRepoRoot: profile.targetRepoRoot as string,
        topic: "fixture-topic",
      },
    });

    expect(resolved).toMatchObject({
      approvedNoProviderProfile: {
        classification: "zero-provider",
        digest: profile.profileDigest,
        id: "fixture-profile",
      },
      externalBaseline: "0123456789abcdef0123456789abcdef01234567",
      heartbeatStaleAfterMs: 60000,
      maxAttempts: 1,
    });
  });

  it("rejects missing approval, unknown profiles, and nested tamper", () => {
    const root = makeTempRoot("reject");
    const approved = makeProfile(root);
    expect(() =>
      resolveApprovedNoProviderProfile({
        profileId: "missing",
        registryPath: writeRegistry(root, approved),
        request: { targetRepoRoot: approved.targetRepoRoot as string, topic: "fixture-topic" },
      }),
    ).toThrow(/not registered/);

    const unapproved = { ...approved, approved: false };
    expect(() =>
      resolveApprovedNoProviderProfile({
        profileId: "fixture-profile",
        registryPath: writeRegistry(root, unapproved),
        request: { targetRepoRoot: approved.targetRepoRoot as string, topic: "fixture-topic" },
      }),
    ).toThrow(/not approved|not a closed zero-provider|digest/i);

    const nestedTamper = {
      ...approved,
      dependencies: [
        { ...(approved.dependencies as Array<Record<string, string>>)[0], sha256: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" },
      ],
    };
    expect(() =>
      resolveApprovedNoProviderProfile({
        profileId: "fixture-profile",
        registryPath: writeRegistry(root, nestedTamper),
        request: { targetRepoRoot: approved.targetRepoRoot as string, topic: "fixture-topic" },
      }),
    ).toThrow(/digest|hash/i);
  });

  it("rejects symlink/path aliases, baseline, argv, dependency, topic and run substitutions", () => {
    const root = makeTempRoot("substitution");
    const profile = makeProfile(root);
    const registryPath = writeRegistry(root, profile);

    expect(() =>
      resolveApprovedNoProviderProfile({
        profileId: "fixture-profile",
        registryPath,
        request: { targetRepoRoot: `${profile.targetRepoRoot as string}/.`, topic: "fixture-topic" },
      }),
    ).toThrow(/absolute normalized|canonical/i);
    expect(() =>
      resolveApprovedNoProviderProfile({
        profileId: "fixture-profile",
        registryPath,
        request: { targetRepoRoot: profile.targetRepoRoot as string, topic: "other-topic" },
      }),
    ).toThrow(/topic/);
    const fixedRun = makeProfile(root, { runId: "reviewed-run" });
    expect(() =>
      resolveApprovedNoProviderProfile({
        profileId: "fixture-profile",
        registryPath: writeRegistry(root, fixedRun),
        request: { runId: "other-run", targetRepoRoot: fixedRun.targetRepoRoot as string, topic: "fixture-topic" },
      }),
    ).toThrow(/run id/);

    const badBaseline = makeProfile(root, { externalBaseline: "not-a-sha" });
    expect(() =>
      resolveApprovedNoProviderProfile({
        profileId: "fixture-profile",
        registryPath: writeRegistry(root, badBaseline),
        request: { targetRepoRoot: profile.targetRepoRoot as string, topic: "fixture-topic" },
      }),
    ).toThrow(/baseline/);

    const badArgv = makeProfile(root, { expectedArgv: ["node", "other.js", "fixture-topic"] });
    expect(() =>
      resolveApprovedNoProviderProfile({
        profileId: "fixture-profile",
        registryPath: writeRegistry(root, badArgv),
        request: { targetRepoRoot: profile.targetRepoRoot as string, topic: "fixture-topic" },
      }),
    ).toThrow(/argv/);

    const dependencyRegistryPath = writeRegistry(root, profile);
    const dependencyPath = (profile.dependencies as Array<Record<string, string>>)[0].path;
    writeFileSync(dependencyPath, "changed\n");
    expect(() =>
      resolveApprovedNoProviderProfile({
        profileId: "fixture-profile",
        registryPath: dependencyRegistryPath,
        request: { targetRepoRoot: profile.targetRepoRoot as string, topic: "fixture-topic" },
      }),
    ).toThrow(/hash mismatch/);

    const symlinkRoot = makeTempRoot("symlink");
    const symlinkProfile = makeProfile(symlinkRoot);
    const link = path.join(symlinkRoot, "runner-link.sh");
    symlinkSync((symlinkProfile.dependencies as Array<Record<string, string>>)[0].path, link);
    const symlinked = makeProfile(symlinkRoot, {
      dependencies: [{ path: link, sha256: (symlinkProfile.dependencies as Array<Record<string, string>>)[0].sha256 }],
    });
    expect(() =>
      resolveApprovedNoProviderProfile({
        profileId: "fixture-profile",
        registryPath: writeRegistry(symlinkRoot, symlinked),
        request: { targetRepoRoot: symlinked.targetRepoRoot as string, topic: "fixture-topic" },
      }),
    ).toThrow(/symlink|canonical/);
  });

  it("defines recursive canonical JSON so nested changes alter the digest", () => {
    const before = canonicalJsonDigest({ a: [{ b: "one" }], z: 1 });
    const after = canonicalJsonDigest({ z: 1, a: [{ b: "two" }] });

    expect(before).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(after).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(after).not.toBe(before);
  });
});
