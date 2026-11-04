#!/usr/bin/env node
// catalog.json lists only published, verified artifacts (ADR 1668 §3). It is written
// by release CI via `catalog.mjs entry <plugin-dir>` and gated by `catalog.mjs check`.
// The field rules mirror core's isRemoteCatalogEntry (src/plugins/catalog.ts): a single
// invalid entry makes every new client reject the whole feed.
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchPublishedVersion, sha512IntegrityToHex } from "./npm-registry.mjs";

const ENTRY_KEYS = [
  "id",
  "name",
  "description",
  "kind",
  "npmSpec",
  "version",
  "integrity",
  "minHostVersion",
  "minWednesdayVersion",
  "contracts",
];
const REQUIRED = ENTRY_KEYS.slice(0, 7);
// Copied from core src/plugins/catalog.ts: pinned versions land in install specs and
// temp archive paths, so they must never carry separators or traversal.
const VERSION_RE = /^[0-9A-Za-z][0-9A-Za-z.+-]*$/;

const CANONICAL_FORM_HINT =
  "catalog.json is not in canonical form (entries sorted by id; keys ordered " +
  `${ENTRY_KEYS.join(", ")}; 2-space JSON with trailing newline)`;

function deriveCatalogKind(manifest) {
  if (Array.isArray(manifest.channels) && manifest.channels.length > 0) return "channel";
  if (manifest.providers && manifest.providers.webSearch) return "web-search";
  if (manifest.kind === "memory") return "memory";
  return "misc";
}

function canonicalEntry(entry) {
  const out = {};
  for (const key of ENTRY_KEYS) {
    const value = entry[key];
    if (value === undefined) continue;
    if (key === "contracts" && value && typeof value === "object" && !Array.isArray(value)) {
      const contracts = {};
      for (const name of Object.keys(value).sort()) contracts[name] = value[name];
      out[key] = contracts;
      continue;
    }
    out[key] = value;
  }
  return out;
}

function byId(a, b) {
  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
}

function serializeCatalog(plugins) {
  const entries = plugins.map(canonicalEntry).sort(byId);
  return `${JSON.stringify({ version: 1, plugins: entries }, null, 2)}\n`;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function loadPackages(root) {
  const packages = new Map();
  const pluginsDir = join(root, "plugins");
  if (!existsSync(pluginsDir)) return packages;
  const dirs = readdirSync(pluginsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith("."))
    .map((d) => d.name)
    .sort();
  for (const name of dirs) {
    const absDir = join(pluginsDir, name);
    const pkgPath = join(absDir, "package.json");
    if (!existsSync(pkgPath)) continue;
    let pkg;
    try {
      pkg = readJson(pkgPath);
    } catch {
      continue;
    }
    if (typeof pkg.name !== "string") continue;
    const manifestPath = join(absDir, "openclaw.plugin.json");
    let manifest = null;
    if (existsSync(manifestPath)) {
      try {
        manifest = readJson(manifestPath);
      } catch {
        manifest = null;
      }
    }
    packages.set(pkg.name, { dir: `plugins/${name}`, absDir, pkg, manifest });
  }
  return packages;
}

// The trust chain covers the published tarball, not its dependency tree (ADR 1668
// Consequences): a plugin with runtime dependencies must ship a shrinkwrap.
function dependencyBlocker(absDir, pkg) {
  if (Object.keys(pkg.dependencies ?? {}).length === 0) return null;
  if (existsSync(join(absDir, "npm-shrinkwrap.json"))) return null;
  return `${pkg.name} declares dependencies but ships no npm-shrinkwrap.json`;
}

export function runCheck(root) {
  const errors = [];
  const catalogPath = join(root, "catalog.json");
  let text;
  let catalog;
  try {
    text = readFileSync(catalogPath, "utf8");
    catalog = JSON.parse(text);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`catalog: cannot read catalog.json: ${message}`);
    return 1;
  }

  const topKeys = catalog && typeof catalog === "object" ? Object.keys(catalog) : [];
  if (
    !catalog ||
    typeof catalog !== "object" ||
    Array.isArray(catalog) ||
    topKeys.length !== 2 ||
    !topKeys.includes("version") ||
    !topKeys.includes("plugins") ||
    catalog.version !== 1 ||
    !Array.isArray(catalog.plugins)
  ) {
    console.error('catalog: catalog.json must be { "version": 1, "plugins": [...] }');
    return 1;
  }

  const packages = loadPackages(root);
  const seen = new Set();

  catalog.plugins.forEach((entry, index) => {
    const label = typeof entry?.id === "string" && entry.id.length > 0 ? entry.id : `#${index}`;
    const fail = (message) => errors.push(`entry "${label}": ${message}`);

    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      fail("must be an object");
      return;
    }
    for (const key of REQUIRED) {
      if (key === "integrity") continue;
      if (typeof entry[key] !== "string" || entry[key].length === 0) {
        fail(`${key} must be a non-empty string`);
      }
    }
    if (typeof entry.version === "string" && !VERSION_RE.test(entry.version)) {
      fail(`version "${entry.version}" is not a valid version`);
    }
    if (sha512IntegrityToHex(entry.integrity) === null) {
      fail("integrity must be a sha512 SRI (sha512-<base64 of 64 bytes>)");
    }
    for (const key of ["minHostVersion", "minWednesdayVersion"]) {
      if (entry[key] !== undefined && typeof entry[key] !== "string") {
        fail(`${key} must be a string`);
      }
    }
    if (entry.contracts !== undefined) {
      const ok =
        typeof entry.contracts === "object" &&
        entry.contracts !== null &&
        !Array.isArray(entry.contracts) &&
        Object.values(entry.contracts).every((v) => typeof v === "string");
      if (!ok) fail("contracts must be an object of strings");
    }
    for (const key of Object.keys(entry)) {
      if (!ENTRY_KEYS.includes(key)) fail(`unknown key "${key}"`);
    }
    if (typeof entry.id === "string") {
      if (seen.has(entry.id)) fail("duplicate id");
      seen.add(entry.id);
    }

    if (typeof entry.npmSpec !== "string" || entry.npmSpec.length === 0) return;
    const found = packages.get(entry.npmSpec);
    if (!found) {
      fail(`${entry.npmSpec} is not a package in plugins/`);
      return;
    }
    if (found.pkg.private === true) {
      fail(`${entry.npmSpec} is a private package and must not be listed`);
    }
    if (found.manifest?.id !== entry.id) {
      fail(`${found.dir}/openclaw.plugin.json id does not match`);
    }
    const blocker = dependencyBlocker(found.absDir, found.pkg);
    if (blocker) fail(blocker);
  });

  if (text !== serializeCatalog(catalog.plugins)) {
    errors.push(CANONICAL_FORM_HINT);
  }

  if (errors.length > 0) {
    for (const error of errors) console.error(`catalog: ${error}`);
    return 1;
  }
  const n = catalog.plugins.length;
  console.log(`catalog: OK (${n} ${n === 1 ? "entry" : "entries"})`);
  return 0;
}

async function runEntry(root, args) {
  if (args.length !== 1) {
    console.error("catalog: usage: catalog.mjs entry <plugin-dir>");
    return 1;
  }
  const dir = args[0];
  const absDir = join(root, dir);
  const pkgPath = join(absDir, "package.json");
  const manifestPath = join(absDir, "openclaw.plugin.json");
  let pkg;
  let manifest;
  try {
    pkg = readJson(pkgPath);
  } catch (err) {
    console.error(`catalog: cannot read ${dir}/package.json: ${err.message}`);
    return 1;
  }
  try {
    manifest = readJson(manifestPath);
  } catch (err) {
    console.error(`catalog: cannot read ${dir}/openclaw.plugin.json: ${err.message}`);
    return 1;
  }
  if (pkg.private === true) {
    console.error(`catalog: ${pkg.name} is a private package`);
    return 1;
  }
  const blocker = dependencyBlocker(absDir, pkg);
  if (blocker) {
    console.error(`catalog: ${blocker}`);
    return 1;
  }

  const published = await fetchPublishedVersion({ name: pkg.name, version: pkg.version });
  if (!published.ok) {
    console.error(`catalog: ${published.error}`);
    return 1;
  }

  const entry = {
    id: manifest.id,
    name: manifest.name,
    description: manifest.description,
    kind: deriveCatalogKind(manifest),
    npmSpec: pkg.name,
    version: pkg.version,
    integrity: published.integrity,
  };
  // Compatibility fields mirror the manifest names so a publisher copies them
  // verbatim (ADR 1668 §6).
  for (const key of ["minHostVersion", "minWednesdayVersion", "contracts"]) {
    if (manifest[key] !== undefined) entry[key] = manifest[key];
  }

  const catalogPath = join(root, "catalog.json");
  let catalog;
  try {
    catalog = readJson(catalogPath);
  } catch (err) {
    console.error(`catalog: cannot read catalog.json: ${err.message}`);
    return 1;
  }
  const plugins = Array.isArray(catalog.plugins) ? [...catalog.plugins] : [];
  const index = plugins.findIndex((e) => e?.id === entry.id);
  if (index >= 0) plugins[index] = entry;
  else plugins.push(entry);

  writeFileSync(catalogPath, serializeCatalog(plugins));
  console.log(`${entry.id} ${entry.version}`);
  return 0;
}

function runPublishable(root, args) {
  let paths;
  try {
    paths = JSON.parse(args[0] ?? "");
  } catch {
    console.error("catalog: publishable expects a JSON array of paths");
    return 1;
  }
  if (!Array.isArray(paths) || !paths.every((p) => typeof p === "string")) {
    console.error("catalog: publishable expects a JSON array of paths");
    return 1;
  }
  const kept = [];
  for (const path of paths) {
    const absDir = join(root, path);
    let pkg;
    try {
      pkg = readJson(join(absDir, "package.json"));
    } catch (err) {
      console.error(`catalog: cannot read ${path}/package.json: ${err.message}`);
      return 1;
    }
    if (pkg.private === true) continue;
    const blocker = dependencyBlocker(absDir, pkg);
    if (blocker) {
      console.error(`catalog: ${blocker}`);
      return 1;
    }
    kept.push(path);
  }
  console.log(JSON.stringify(kept));
  return 0;
}

async function main(argv) {
  const root = process.cwd();
  const [command, ...args] = argv;
  if (command === "check") return runCheck(root);
  if (command === "entry") return runEntry(root, args);
  if (command === "publishable") return runPublishable(root, args);
  console.error(
    "catalog: usage: catalog.mjs check | entry <plugin-dir> | publishable <paths-json>",
  );
  return 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exit(await main(process.argv.slice(2)));
}
