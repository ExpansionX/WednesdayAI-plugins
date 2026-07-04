#!/usr/bin/env node
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const pluginsDir = join(root, "plugins");
let failures = 0;

function parseFrontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return null;
  const fm = {};
  for (const line of m[1].split("\n")) {
    const mm = line.match(/^(\w[\w-]*)\s*:\s*(.*)$/);
    if (mm) fm[mm[1]] = mm[2].replace(/^["']|["']$/g, "");
  }
  return fm;
}

if (!existsSync(pluginsDir)) {
  console.log("validate-skills: no plugins/ directory, skipping");
  process.exit(0);
}

const pluginDirs = readdirSync(pluginsDir, { withFileTypes: true })
  .filter((d) => d.isDirectory() && !d.name.startsWith("."))
  .map((d) => d.name);

let checked = 0;
for (const id of pluginDirs) {
  const skillsDir = join(pluginsDir, id, "skills");
  if (!existsSync(skillsDir)) continue;

  const files = readdirSync(skillsDir, { withFileTypes: true })
    .filter((d) => d.isFile() && d.name.endsWith(".md"))
    .map((d) => d.name);

  for (const f of files) {
    checked++;
    const path = join(skillsDir, f);
    const text = readFileSync(path, "utf8");
    const fm = parseFrontmatter(text);
    if (!fm) {
      console.error(`validate-skills: ${id}/skills/${f}: no frontmatter`);
      failures++;
      continue;
    }
    if (!fm.name) {
      console.error(`validate-skills: ${id}/skills/${f}: missing "name"`);
      failures++;
    }
    if (!fm.description) {
      console.error(`validate-skills: ${id}/skills/${f}: missing "description"`);
      failures++;
    }
  }
}

if (failures > 0) {
  console.error(`\nvalidate-skills: ${failures} error(s) in ${checked} file(s)`);
  process.exit(1);
}
if (checked === 0) {
  console.log("validate-skills: no skill files found (ok)");
} else {
  console.log(`validate-skills: OK (${checked} skill file(s))`);
}
process.exit(0);
