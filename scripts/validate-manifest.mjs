#!/usr/bin/env node
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const pluginsDir = join(root, "plugins");
let failures = 0;

if (!existsSync(pluginsDir)) {
  console.error("validate-manifest: no plugins/ directory found");
  process.exit(1);
}

const pluginDirs = readdirSync(pluginsDir, { withFileTypes: true })
  .filter((d) => d.isDirectory() && !d.name.startsWith("."))
  .map((d) => d.name);

if (pluginDirs.length === 0) {
  console.error("validate-manifest: no plugin directories found under plugins/");
  process.exit(1);
}

for (const id of pluginDirs) {
  const dir = join(pluginsDir, id);
  const manifestPath = join(dir, "openclaw.plugin.json");
  const pkgPath = join(dir, "package.json");

  if (!existsSync(manifestPath)) {
    console.error(`validate-manifest: ${id}/openclaw.plugin.json missing`);
    failures++;
    continue;
  }
  if (!existsSync(pkgPath)) {
    console.error(`validate-manifest: ${id}/package.json missing`);
    failures++;
    continue;
  }

  let manifest, pkg;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (e) {
    console.error(`validate-manifest: ${id}/openclaw.plugin.json is not valid JSON: ${e.message}`);
    failures++;
    continue;
  }
  try {
    pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  } catch (e) {
    console.error(`validate-manifest: ${id}/package.json is not valid JSON: ${e.message}`);
    failures++;
    continue;
  }

  if (typeof manifest.id !== "string" || !manifest.id) {
    console.error(`validate-manifest: ${id}/openclaw.plugin.json field "id" must be a non-empty string`);
    failures++;
  } else if (manifest.id !== id) {
    console.error(`validate-manifest: ${id}/openclaw.plugin.json id "${manifest.id}" != dir name "${id}"`);
    failures++;
  }

  if (typeof manifest.name !== "string" || !manifest.name) {
    console.error(`validate-manifest: ${id}/openclaw.plugin.json field "name" must be a non-empty string`);
    failures++;
  }

  if (typeof manifest.description !== "string" || !manifest.description) {
    console.error(`validate-manifest: ${id}/openclaw.plugin.json field "description" must be a non-empty string`);
    failures++;
  }

  if (typeof pkg.name !== "string" || !pkg.name) {
    console.error(`validate-manifest: ${id}/package.json field "name" must be a non-empty string`);
    failures++;
  } else {
    const expectedSuffix = `@wednesdayai/${id}`;
    if (pkg.name !== expectedSuffix) {
      console.error(`validate-manifest: ${id}/package.json name "${pkg.name}" != "${expectedSuffix}" (must be @wednesdayai/<dir>)`);
      failures++;
    }
  }

  if (manifest.configSchema && typeof manifest.configSchema === "object") {
    const schemaStr = JSON.stringify(manifest.configSchema);
    if (schemaStr.includes('"anyOf"') || schemaStr.includes('"oneOf"') || schemaStr.includes('"allOf"')) {
      console.error(`validate-manifest: ${id}/openclaw.plugin.json configSchema must not use anyOf/oneOf/allOf`);
      failures++;
    }
    if (schemaStr.includes('"format"')) {
      console.error(`validate-manifest: ${id}/openclaw.plugin.json configSchema must not use raw "format" key (some validators reject it)`);
      failures++;
    }
  }

  if (manifest.kind !== undefined && manifest.kind !== "memory") {
    console.error(`validate-manifest: ${id}/openclaw.plugin.json kind "${manifest.kind}" is not a valid PluginKind (only "memory" currently allowed)`);
    failures++;
  }

  if (manifest.minHostVersion !== undefined) {
    if (typeof manifest.minHostVersion !== "string" || !/^\d+\.\d+\.\d+/.test(manifest.minHostVersion)) {
      console.error(`validate-manifest: ${id}/openclaw.plugin.json minHostVersion must be a semver string`);
      failures++;
    }
  }
}

if (failures > 0) {
  console.error(`\nvalidate-manifest: ${failures} error(s) across ${pluginDirs.length} plugin(s)`);
  process.exit(1);
}

console.log(`validate-manifest: OK (${pluginDirs.length} plugin(s))`);
process.exit(0);
