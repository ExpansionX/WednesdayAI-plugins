#!/usr/bin/env node
// Rejects bare relative dynamic import() and top-level await in plugin/extension
// production sources. jiti 2.7.0 hands partially evaluated modules to concurrent
// import() callers, which surfaces as TDZ ReferenceError crashes; lazy loads must
// go through createLazyRuntimeModule from "openclaw/plugin-sdk/lazy-runtime".
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import ts from "typescript";

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

function scriptKind(file) {
  return file.endsWith(".ts") || file.endsWith(".mts") ? ts.ScriptKind.TS : ts.ScriptKind.JS;
}

/** Unwrap ParenthesizedExpression / AsExpression / SatisfiesExpression wrappers. */
function unwrapTransparent(node) {
  while (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isSatisfiesExpression(node)
  ) {
    node = node.expression;
  }
  return node;
}

function relativeSpecifier(arg) {
  if (!arg) return null;
  const expr = unwrapTransparent(arg);
  let text = null;
  if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) text = expr.text;
  else if (ts.isTemplateExpression(expr)) text = expr.head.text;
  if (text === null) return null;
  return /^\.{1,2}\//.test(text) ? text : null;
}

/** `createLazyRuntime*(() => import("./x.js"))` — the only sanctioned form. */
function isLazyWrapped(node) {
  const arrow = node.parent;
  if (!arrow || !ts.isArrowFunction(arrow) || arrow.body !== node || arrow.parameters.length > 0) {
    return false;
  }
  const call = arrow.parent;
  if (!call || !ts.isCallExpression(call) || !call.arguments.includes(arrow)) return false;
  const callee = call.expression;
  let name = null;
  if (ts.isIdentifier(callee)) name = callee.text;
  else if (ts.isPropertyAccessExpression(callee)) name = callee.name.text;
  return name !== null && /^createLazyRuntime\w*$/.test(name);
}

const violations = [];
const files = [];
for (const dir of ROOT_DIRS) {
  const abs = join(root, dir);
  if (existsSync(abs)) collect(abs, files);
}

for (const file of files) {
  const text = readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, scriptKind(file));
  const rel = relative(root, file).split(sep).join("/");
  const lineOf = (node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;

  const visit = (node, inFunction) => {
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      relativeSpecifier(node.arguments[0]) !== null &&
      !isLazyWrapped(node)
    ) {
      violations.push(
        `${rel}:${lineOf(node)}: bare relative import() — use createLazyRuntimeModule from openclaw/plugin-sdk/lazy-runtime`,
      );
    }
    if (
      !inFunction &&
      (ts.isAwaitExpression(node) || (ts.isForOfStatement(node) && node.awaitModifier))
    ) {
      violations.push(`${rel}:${lineOf(node)}: top-level await`);
    }
    const entersScope = ts.isFunctionLike(node) || ts.isClassStaticBlockDeclaration(node);
    const childScope = inFunction || entersScope;
    ts.forEachChild(node, (child) => {
      // Computed member names evaluate in the enclosing scope at class/object
      // definition time, not inside the method body.
      const scope =
        entersScope && child === node.name && ts.isComputedPropertyName(child)
          ? inFunction
          : childScope;
      visit(child, scope);
    });
  };
  visit(sf, false);
}

if (violations.length > 0) {
  for (const v of violations) console.error(v);
  console.error(`check-extension-lazy-imports: ${violations.length} violation(s)`);
  process.exit(1);
}
console.log(`check-extension-lazy-imports: ${files.length} files OK`);
