// Minimal npm registry helpers shared by scripts/catalog.mjs and
// scripts/verify-provenance.mjs. sha512IntegrityToHex is a port of core
// src/infra/npm-integrity.ts so the digests pinned here are the digests the
// client compares (ADR 1668 §1.3).

const DEFAULT_TIMEOUT_MS = 30_000;

export function registryUrl() {
  return (process.env.NPM_REGISTRY_URL ?? "https://registry.npmjs.org").replace(/\/+$/, "");
}

export function encodePackageName(name) {
  return name.replace("/", "%2f");
}

// npm SRI -> 64 bytes of lowercase hex. Requires the sha512- prefix and a base64
// payload decoding to exactly 64 bytes; anything else is unpinnable -> null.
export function sha512IntegrityToHex(integrity) {
  if (typeof integrity !== "string" || !integrity.startsWith("sha512-")) return null;
  const decoded = Buffer.from(integrity.slice("sha512-".length), "base64");
  if (decoded.length !== 64) return null;
  return decoded.toString("hex");
}

export async function fetchPublishedVersion({ name, version, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  const url = `${registryUrl()}/${encodePackageName(name)}/${version}`;
  let response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, retryable: true, error: `registry fetch failed (${message})` };
  }
  if (response.status === 404) {
    return { ok: false, retryable: true, error: `${name}@${version} is not published` };
  }
  if (!response.ok) {
    return { ok: false, retryable: false, error: `registry fetch failed (${response.status})` };
  }
  let body;
  try {
    body = await response.json();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, retryable: false, error: `registry fetch failed (${message})` };
  }
  const integrity = body?.dist?.integrity;
  if (sha512IntegrityToHex(integrity) === null) {
    return {
      ok: false,
      retryable: false,
      error: `${name}@${version} has no sha512 dist.integrity`,
    };
  }
  return { ok: true, integrity, tarball: body.dist.tarball };
}
