#!/usr/bin/env node
import { readdirSync, readFileSync, writeFileSync, existsSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";

const check = process.argv.includes("--check");
const root = process.cwd();
const pluginsDir = join(root, "plugins");
const catalogPath = join(root, "catalog.json");

function deriveCatalogKind(manifest) {
  if (Array.isArray(manifest.channels) && manifest.channels.length > 0) return "channel";
  if (manifest.providers && manifest.providers.webSearch) return "web-search";
  if (manifest.kind === "memory") return "memory";
  return "misc";
}

const pluginDirs = readdirSync(pluginsDir, { withFileTypes: true })
  .filter((d) => d.isDirectory() && !d.name.startsWith("."))
  .map((d) => d.name)
  .sort();

const plugins = [];
for (const id of pluginDirs) {
  const dir = join(pluginsDir, id);
  const manifestPath = join(dir, "openclaw.plugin.json");
  const pkgPath = join(dir, "package.json");
  if (!existsSync(manifestPath) || !existsSync(pkgPath)) continue;

  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));

  const entry = {
    id: manifest.id,
    name: manifest.name,
    description: manifest.description,
    kind: deriveCatalogKind(manifest),
    npmSpec: pkg.name,
  };
  if (manifest.minHostVersion) entry.minHostVersion = manifest.minHostVersion;
  plugins.push(entry);
}

const catalog = { version: 1, plugins };
const output = JSON.stringify(catalog, null, 2) + "\n";

if (check) {
  if (!existsSync(catalogPath)) {
    console.error("generate-catalog: catalog.json missing (run without --check first)");
    process.exit(1);
  }
  const tmp = mkdtempSync(join(tmpdir(), "wai-catalog-"));
  const tmpPath = join(tmp, "catalog.json");
  writeFileSync(tmpPath, output);
  try {
    execSync(`git diff --no-index --quiet "${catalogPath}" "${tmpPath}"`, { stdio: "pipe" });
    console.log(`generate-catalog: OK (${plugins.length} plugin(s), no drift)`);
    process.exit(0);
  } catch {
    try {
      const diff = execSync(`git diff --no-index "${catalogPath}" "${tmpPath}"`, { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
      console.error(`generate-catalog: catalog.json drifts from generated output:\n${diff}`);
    } catch (e) {
      console.error(`generate-catalog: catalog.json drifts from generated output:\n${e.stdout || e.message}`);
    }
    process.exit(1);
  }
}

writeFileSync(catalogPath, output);
console.log(`generate-catalog: wrote catalog.json (${plugins.length} plugin(s))`);
