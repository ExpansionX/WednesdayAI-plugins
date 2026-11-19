#!/usr/bin/env node
// Verifies that a published npm artifact carries SLSA provenance signed by this repo's
// release.yml on main (ADR 1668 §1, §2). Ported from core src/infra/provenance.ts; the
// signer identity policy MUST stay anchored, because @sigstore/verify applies
// subjectAlternativeName as a RegExp via String.match — an unanchored pattern would let
// `...@refs/heads/main-evil` satisfy `refs/heads/main`.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { bundleFromJSON, isBundleWithDsseEnvelope } from "@sigstore/bundle";
import { getTrustedRoot } from "@sigstore/tuf";
import { PolicyError, Verifier, toSignedEntity, toTrustMaterial } from "@sigstore/verify";
import {
  encodePackageName,
  fetchPublishedVersion,
  registryUrl,
  sha512IntegrityToHex,
} from "./npm-registry.mjs";

export const SIGNER = {
  repository: "ExpansionX/WednesdayAI-plugins",
  workflowPath: ".github/workflows/release.yml",
  ref: "refs/heads/main",
};
export const GITHUB_ACTIONS_OIDC_ISSUER = "https://token.actions.githubusercontent.com";

const SLSA_PROVENANCE_V1 = "https://slsa.dev/provenance/v1";
const IN_TOTO_PAYLOAD_TYPE = "application/vnd.in-toto+json";
const SIGSTORE_TUF_MIRROR = "https://tuf-repo-cdn.sigstore.dev";
const TIMEOUT_MS = 30_000;
const MAX_ATTEMPTS = 10;
const RETRY_DELAY_MS = 15_000;

export function expectedSignerIdentity(signer) {
  return `https://github.com/${signer.repository}/${signer.workflowPath}@${signer.ref}`;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function errorMessage(err) {
  return err instanceof Error ? err.message : String(err);
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function verifyBundle({ bundle: raw, hex, signer }) {
  // Fail closed on a malformed digest before any cryptographic work: a short hex could
  // vacuously match an empty subject digest.
  if (typeof hex !== "string" || hex.length !== 128) {
    return { ok: false, error: "invalid digest: expected 128 hex characters for sha512" };
  }

  // 1. Parse the bundle; it must carry a DSSE envelope.
  let bundle;
  let envelope;
  try {
    const parsed = bundleFromJSON(raw);
    if (!isBundleWithDsseEnvelope(parsed)) throw new Error("bundle has no DSSE envelope");
    bundle = parsed;
    envelope = parsed.content.dsseEnvelope;
  } catch (err) {
    return { ok: false, error: `invalid Sigstore bundle: ${errorMessage(err)}` };
  }

  // 2. Trust material from the public Sigstore TUF mirror.
  let trustedRoot;
  try {
    trustedRoot = await getTrustedRoot();
  } catch (err) {
    return {
      ok: false,
      error: `could not load the Sigstore trusted root (needs ${SIGSTORE_TUF_MIRROR}): ${errorMessage(err)}`,
    };
  }

  // 3. Signature chain plus the anchored Fulcio signer identity.
  const identity = expectedSignerIdentity(signer);
  try {
    const verifier = new Verifier(toTrustMaterial(trustedRoot), {
      tlogThreshold: 1,
      ctlogThreshold: 1,
    });
    verifier.verify(toSignedEntity(bundle), {
      subjectAlternativeName: new RegExp(`^${escapeRegExp(identity)}$`),
      extensions: { issuer: GITHUB_ACTIONS_OIDC_ISSUER },
    });
  } catch (err) {
    if (err instanceof PolicyError) {
      return {
        ok: false,
        error: `signer identity does not match ${identity}: ${errorMessage(err)}`,
      };
    }
    return { ok: false, error: `signature verification failed: ${errorMessage(err)}` };
  }

  // 4. Only after the chain verifies: an SLSA v1 in-toto statement whose subject digest
  //    is the artifact we expect.
  const digestMismatch = "attestation subject digest does not match the expected sha512 digest";
  if (envelope.payloadType !== IN_TOTO_PAYLOAD_TYPE) return { ok: false, error: digestMismatch };
  let statement;
  try {
    statement = JSON.parse(Buffer.from(envelope.payload).toString("utf8"));
  } catch {
    return { ok: false, error: digestMismatch };
  }
  if (!isRecord(statement) || statement.predicateType !== SLSA_PROVENANCE_V1) {
    return { ok: false, error: digestMismatch };
  }
  const subjects = Array.isArray(statement.subject) ? statement.subject : [];
  const expected = hex.toLowerCase();
  const matched = subjects.some((subject) => {
    if (!isRecord(subject) || !isRecord(subject.digest)) return false;
    const digest = subject.digest.sha512;
    return typeof digest === "string" && digest.toLowerCase() === expected;
  });
  if (!matched) return { ok: false, error: digestMismatch };

  return { ok: true, signerIdentity: identity };
}

export async function verifyNpmProvenance({ name, version, signer = SIGNER }) {
  const published = await fetchPublishedVersion({ name, version });
  if (!published.ok) return published;

  // Digest equality, checked twice (ADR 1668 §1.3): downloaded bytes == dist.integrity,
  // and the attestation subject == that same digest.
  let bytes;
  try {
    const response = await fetch(published.tarball, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!response.ok) {
      return { ok: false, retryable: true, error: `tarball fetch failed (${response.status})` };
    }
    bytes = Buffer.from(await response.arrayBuffer());
  } catch (err) {
    return { ok: false, retryable: true, error: `tarball fetch failed (${errorMessage(err)})` };
  }
  const actual = `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
  if (actual !== published.integrity) {
    return { ok: false, retryable: false, error: "tarball digest does not match dist.integrity" };
  }

  const noProvenance = `no SLSA provenance attestation published for ${name}@${version}`;
  let bundle;
  try {
    const url = `${registryUrl()}/-/npm/v1/attestations/${encodePackageName(name)}@${version}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (response.status === 404) return { ok: false, retryable: true, error: noProvenance };
    if (!response.ok) {
      return {
        ok: false,
        retryable: false,
        error: `attestation fetch failed (${response.status})`,
      };
    }
    const body = await response.json();
    const entries = isRecord(body) && Array.isArray(body.attestations) ? body.attestations : [];
    const attestation = entries.find(
      (entry) => isRecord(entry) && entry.predicateType === SLSA_PROVENANCE_V1,
    );
    if (!isRecord(attestation) || attestation.bundle === undefined || attestation.bundle === null) {
      return { ok: false, retryable: true, error: noProvenance };
    }
    bundle = attestation.bundle;
  } catch (err) {
    return { ok: false, retryable: true, error: `attestation fetch failed (${errorMessage(err)})` };
  }

  const verified = await verifyBundle({
    bundle,
    hex: sha512IntegrityToHex(published.integrity),
    signer,
  });
  if (!verified.ok) return { ok: false, retryable: false, error: verified.error };
  return { ok: true, integrity: published.integrity, signerIdentity: verified.signerIdentity };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(argv) {
  const dir = argv[0];
  if (!dir) {
    console.error("verify-provenance: usage: verify-provenance.mjs <plugin-dir>");
    return 1;
  }
  let pkg;
  try {
    pkg = JSON.parse(readFileSync(join(process.cwd(), dir, "package.json"), "utf8"));
  } catch (err) {
    console.error(`verify-provenance: cannot read ${dir}/package.json: ${errorMessage(err)}`);
    return 1;
  }

  // The registry and the attestation API both lag a fresh publish by seconds to minutes.
  let result;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    result = await verifyNpmProvenance({ name: pkg.name, version: pkg.version });
    if (result.ok || !result.retryable) break;
    if (attempt < MAX_ATTEMPTS) {
      console.log(`verify-provenance: ${result.error}; retrying (${attempt}/${MAX_ATTEMPTS})`);
      await sleep(RETRY_DELAY_MS);
    }
  }
  if (!result.ok) {
    console.error(`verify-provenance: ${result.error}`);
    return 1;
  }
  console.log(
    `verify-provenance: OK ${pkg.name}@${pkg.version} signed by ${result.signerIdentity}`,
  );
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exit(await main(process.argv.slice(2)));
}
