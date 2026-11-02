import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const script = join(scriptDir, "check-extension-lazy-imports.mjs");
const repoRoot = join(scriptDir, "..");

function makeRoot(files) {
  const root = mkdtempSync(join(tmpdir(), "lazy-imports-"));
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  return root;
}

function run(root) {
  return spawnSync(process.execPath, [script, root], { encoding: "utf8" });
}

test("rejects bare relative import()", () => {
  const root = makeRoot({
    "plugins/bad/src/a.ts": `export async function load() {\n  const m = await import("./b.js");\n  return m;\n}\n`,
  });
  const res = run(root);
  assert.equal(res.status, 1);
  assert.match(res.stderr, /plugins\/bad\/src\/a\.ts:2/);
  assert.match(res.stderr, /bare relative import\(\)/);
});

test("rejects top-level await", () => {
  const root = makeRoot({
    "plugins/bad/index.ts": `async function foo() {\n  return 1;\n}\nconst x = await foo();\nexport default x;\n`,
  });
  const res = run(root);
  assert.equal(res.status, 1);
  assert.match(res.stderr, /top-level await/);
});

test("allows lazy-runtime, non-relative, type-only and test files", () => {
  const root = makeRoot({
    "plugins/ok/src/a.ts":
      `import { createLazyRuntimeModule } from "openclaw/plugin-sdk/lazy-runtime";\n` +
      `type Mod = typeof import("./b.js");\n` +
      `const loadB = createLazyRuntimeModule<Mod>(() => import("./b.js"));\n` +
      `/** @typedef {import("./types.js").T} T */\n` +
      `export async function go() {\n  const fs = await import("node:fs");\n  const pkg = await import("some-pkg");\n  return [await loadB(), fs, pkg];\n}\n`,
    "plugins/ok/src/a.test.ts": `const m = await import("./a.js");\nexport default m;\n`,
    "plugins/ok/node_modules/x/index.ts": `const m = await import("./y.js");\nexport default m;\n`,
    "plugins/ok/dist/index.js": `const m = await import("./y.js");\nexport default m;\n`,
    "extensions/ok/index.ts": `export const s = "await import(\\"./nope.js\\")";\n`,
  });
  const res = run(root);
  assert.equal(res.status, 0, res.stderr);
});

test("repo tree passes", () => {
  const res = run(repoRoot);
  assert.equal(res.status, 0, res.stderr);
});
