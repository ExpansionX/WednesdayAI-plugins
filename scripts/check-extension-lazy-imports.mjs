#!/usr/bin/env node
// Rejects bare relative dynamic import() and top-level await in plugin/extension
// production sources. jiti 2.7.0 hands partially evaluated modules to concurrent
// import() callers, which surfaces as TDZ ReferenceError crashes; lazy loads must
// go through createLazyRuntimeModule from "openclaw/plugin-sdk/lazy-runtime".
import { readdirSync, existsSync } from "node:fs";
import { readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

const root = process.argv[2] ?? process.cwd();
const ROOT_DIRS = ["extensions", "plugins"];
const EXTS = [".ts", ".mts", ".js", ".mjs"];
const SKIP_DIRS = new Set(["node_modules", "dist", "build", "coverage", "__tests__"]);

function collect(dir, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      collect(abs, out);
      continue;
    }
    if (!entry.isFile()) continue;
    const name = entry.name;
    if (name.endsWith(".d.ts")) continue;
    if (name.includes(".test.") || name.includes(".spec.")) continue;
    if (!EXTS.some((e) => name.endsWith(e))) continue;
    out.push(abs);
  }
  return out;
}

/**
 * One pass over the source producing:
 * - `code`: same length as input, with comment and string/template *contents*
 *   blanked (newlines preserved) but quote characters kept.
 * - `depth`: brace depth at each position, counting braces in code state only.
 */
function scan(text) {
  const code = Array.from({ length: text.length }, () => " ");
  const mask = new Uint8Array(text.length);
  const depth = new Int32Array(text.length);
  let state = "code"; // code | line | block | single | double | template
  const tmplStack = []; // brace depth at which each `${` was opened
  let braces = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const next = text[i + 1];
    depth[i] = braces;
    if (state === "code") {
      if (c === "/" && next === "/") {
        state = "line";
        i++;
        depth[i] = braces;
        continue;
      }
      if (c === "/" && next === "*") {
        state = "block";
        i++;
        depth[i] = braces;
        continue;
      }
      if (c === "'") state = "single";
      else if (c === '"') state = "double";
      else if (c === "`") state = "template";
      else if (c === "{") braces++;
      else if (c === "}") {
        braces--;
        if (tmplStack.length > 0 && braces === tmplStack[tmplStack.length - 1]) {
          tmplStack.pop();
          state = "template";
          code[i] = c;
          mask[i] = 1;
          continue;
        }
      }
      code[i] = c;
      mask[i] = 1;
      continue;
    }
    if (c === "\n") code[i] = "\n";
    if (state === "line") {
      if (c === "\n") state = "code";
      continue;
    }
    if (state === "block") {
      if (c === "*" && next === "/") {
        state = "code";
        i++;
        depth[i] = braces;
      }
      continue;
    }
    if (state === "single" || state === "double") {
      if (c === "\\") {
        i++;
        if (i < text.length) depth[i] = braces;
        continue;
      }
      if ((state === "single" && c === "'") || (state === "double" && c === '"')) {
        state = "code";
        code[i] = c;
      }
      continue;
    }
    // template
    if (c === "\\") {
      i++;
      if (i < text.length) depth[i] = braces;
      continue;
    }
    if (c === "$" && next === "{") {
      tmplStack.push(braces);
      braces++;
      state = "code";
      code[i] = " ";
      i++;
      depth[i] = braces;
      code[i] = "{";
      continue;
    }
    if (c === "`") {
      state = "code";
      code[i] = c;
    }
  }
  return { code: code.join(""), mask, depth };
}

function lineOf(text, index) {
  let line = 1;
  for (let i = 0; i < index; i++) if (text[i] === "\n") line++;
  return line;
}

const violations = [];
const files = [];
for (const dir of ROOT_DIRS) {
  const abs = join(root, dir);
  if (existsSync(abs)) collect(abs, files);
}

const RELATIVE_IMPORT = /\bimport\s*\(\s*(['"`])(\.{1,2}\/)/g;
const LAZY_WRAPPER = /createLazyRuntime\w*(?:<[^<>]*>)?\(\s*(?:async\s*)?\(\s*\)\s*=>\s*$/;
const AWAIT = /\bawait\b/g;

for (const file of files) {
  const text = readFileSync(file, "utf8");
  const { code, mask, depth } = scan(text);
  const rel = relative(root, file).split(sep).join("/");

  RELATIVE_IMPORT.lastIndex = 0;
  let m;
  while ((m = RELATIVE_IMPORT.exec(text)) !== null) {
    if (!mask[m.index]) continue;
    const before = code.slice(0, m.index).trimEnd();
    if (/\btypeof$/.test(before)) continue;
    if (LAZY_WRAPPER.test(before)) continue;
    violations.push(
      `${rel}:${lineOf(text, m.index)}: bare relative import() — use createLazyRuntimeModule from openclaw/plugin-sdk/lazy-runtime`,
    );
  }

  AWAIT.lastIndex = 0;
  while ((m = AWAIT.exec(code)) !== null) {
    if (depth[m.index] === 0) {
      violations.push(`${rel}:${lineOf(text, m.index)}: top-level await`);
    }
  }
}

if (violations.length > 0) {
  for (const v of violations) console.error(v);
  console.error(`check-extension-lazy-imports: ${violations.length} violation(s)`);
  process.exit(1);
}
console.log(`check-extension-lazy-imports: ${files.length} files OK`);
