import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

// These plan task files live under docs/plans/plugin-skillweaver/phase-*/*.md.
// This PR added a `<file>.test.ts` entry to the `files:` frontmatter list of
// every task spec (002-007) so that WAI's deterministic file-set gate no
// longer flags the test file as an "undeclared" change, and it removed the
// `peerDependencies` block from the 001 scaffold example. These tests lock
// in that regression fix.

const repoRoot = path.resolve(import.meta.dirname!, "..", "..");
const plansRoot = path.join(repoRoot, "docs", "plans", "plugin-skillweaver");

interface Frontmatter {
  id?: string;
  phase?: number;
  title?: string;
  status?: string;
  depends_on?: string[];
  parallel?: boolean;
  conflicts_with?: string[];
  files?: string[];
  irreversible?: boolean;
  scope_test?: string;
  allowed_change?: string;
  covers_criteria?: string[];
}

function extractFrontmatterBlock(content: string): string {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) {
    throw new Error("no YAML frontmatter block found");
  }
  return match[1];
}

function parseScalar(raw: string): string | number | boolean {
  const trimmed = raw.trim();
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (/^-?\d+$/.test(trimmed)) return Number(trimmed);
  const quoted = trimmed.match(/^"(.*)"$/);
  if (quoted) return quoted[1];
  return trimmed;
}

function parseInlineArray(raw: string): string[] {
  const inner = raw.trim().replace(/^\[/, "").replace(/\]$/, "");
  if (!inner.trim()) return [];
  return inner.split(",").map((s) => s.trim().replace(/^"(.*)"$/, "$1"));
}

/** Minimal parser tailored to the flat frontmatter shape used by WAI task specs. */
function parseFrontmatter(content: string): Frontmatter {
  const block = extractFrontmatterBlock(content);
  const lines = block.split(/\r?\n/);
  const result: Record<string, unknown> = {};
  let currentListKey: string | null = null;

  for (const line of lines) {
    const listItemMatch = line.match(/^\s+-\s+(.*)$/);
    if (listItemMatch && currentListKey) {
      (result[currentListKey] as string[]).push(listItemMatch[1].trim());
      continue;
    }
    const kvMatch = line.match(/^([A-Za-z_]+):\s*(.*)$/);
    if (kvMatch) {
      const [, key, rawValue] = kvMatch;
      if (rawValue === "") {
        result[key] = [];
        currentListKey = key;
      } else if (rawValue.startsWith("[")) {
        result[key] = parseInlineArray(rawValue);
        currentListKey = null;
      } else {
        result[key] = parseScalar(rawValue);
        currentListKey = null;
      }
    }
  }
  return result as Frontmatter;
}

function loadTask(relativePath: string): { content: string; fm: Frontmatter } {
  const filePath = path.join(plansRoot, relativePath);
  expect(existsSync(filePath)).toBe(true);
  const content = readFileSync(filePath, "utf-8");
  return { content, fm: parseFrontmatter(content) };
}

describe("plugin-skillweaver task plan frontmatter", () => {
  const cases: Array<{
    file: string;
    id: string;
    phase: number;
    files: string[];
    scopeTest: string;
  }> = [
    {
      file: "phase-1/001-plugin-scaffold.md",
      id: "001",
      phase: 1,
      files: [
        "extensions/skillweaver/package.json",
        "extensions/skillweaver/openclaw.plugin.json",
        "extensions/skillweaver/tsconfig.json",
      ],
      scopeTest: "extensions/skillweaver",
    },
    {
      file: "phase-1/002-config-schema.md",
      id: "002",
      phase: 1,
      files: [
        "extensions/skillweaver/src/config.ts",
        "extensions/skillweaver/src/config.test.ts",
      ],
      scopeTest: "extensions/skillweaver/src/config.test.ts",
    },
    {
      file: "phase-1/003-register-entry.md",
      id: "003",
      phase: 1,
      files: [
        "extensions/skillweaver/index.ts",
        "extensions/skillweaver/index.test.ts",
      ],
      scopeTest: "extensions/skillweaver/index.test.ts",
    },
    {
      file: "phase-2/004-embedding-types.md",
      id: "004",
      phase: 2,
      files: [
        "extensions/skillweaver/src/embedding/types.ts",
        "extensions/skillweaver/src/embedding/types.test.ts",
      ],
      scopeTest: "extensions/skillweaver/src/embedding/types.test.ts",
    },
    {
      file: "phase-2/005-local-embedding.md",
      id: "005",
      phase: 2,
      files: [
        "extensions/skillweaver/src/embedding/local.ts",
        "extensions/skillweaver/src/embedding/local.test.ts",
      ],
      scopeTest: "extensions/skillweaver/src/embedding/local.test.ts",
    },
    {
      file: "phase-2/006-cloud-embedding.md",
      id: "006",
      phase: 2,
      files: [
        "extensions/skillweaver/src/embedding/cloud.ts",
        "extensions/skillweaver/src/embedding/cloud.test.ts",
      ],
      scopeTest: "extensions/skillweaver/src/embedding/cloud.test.ts",
    },
    {
      file: "phase-2/007-custom-embedding.md",
      id: "007",
      phase: 2,
      files: [
        "extensions/skillweaver/src/embedding/custom.ts",
        "extensions/skillweaver/src/embedding/custom.test.ts",
      ],
      scopeTest: "extensions/skillweaver/src/embedding/custom.test.ts",
    },
  ];

  for (const tc of cases) {
    describe(tc.file, () => {
      it(`has id "${tc.id}" and phase ${tc.phase}`, () => {
        const { fm } = loadTask(tc.file);
        expect(fm.id).toBe(tc.id);
        expect(fm.phase).toBe(tc.phase);
      });

      it("declares allowed_change as create", () => {
        const { fm } = loadTask(tc.file);
        expect(fm.allowed_change).toBe("create");
      });

      it("lists exactly the expected files (including the test file)", () => {
        const { fm } = loadTask(tc.file);
        expect(fm.files).toEqual(tc.files);
      });

      it("scope_test matches the declared scope", () => {
        const { fm } = loadTask(tc.file);
        expect(fm.scope_test).toBe(tc.scopeTest);
      });

      it("has boolean parallel/irreversible flags and array depends_on/conflicts_with", () => {
        const { fm } = loadTask(tc.file);
        expect(typeof fm.parallel).toBe("boolean");
        expect(typeof fm.irreversible).toBe("boolean");
        expect(Array.isArray(fm.depends_on)).toBe(true);
        expect(Array.isArray(fm.conflicts_with)).toBe(true);
        expect(Array.isArray(fm.covers_criteria)).toBe(true);
      });
    });
  }

  it("every task file's test entry lives alongside its implementation file in the same directory", () => {
    for (const tc of cases.filter((c) => c.id !== "001")) {
      const { fm } = loadTask(tc.file);
      const files = fm.files ?? [];
      const implFile = files.find((f) => !f.endsWith(".test.ts"));
      const testFile = files.find((f) => f.endsWith(".test.ts"));
      expect(implFile, `${tc.file} should declare a non-test implementation file`).toBeDefined();
      expect(testFile, `${tc.file} should declare a companion test file`).toBeDefined();
      expect(path.dirname(testFile!)).toBe(path.dirname(implFile!));
    }
  });

  it("task 001's package.json example no longer declares a peerDependencies block", () => {
    const { content } = loadTask("phase-1/001-plugin-scaffold.md");
    const jsonBlocks = [...content.matchAll(/```json\n([\s\S]*?)\n```/g)].map((m) => m[1]);
    const packageJsonBlock = jsonBlocks.find((block) => block.includes('"name": "@wednesdayai/skillweaver"'));
    expect(packageJsonBlock).toBeDefined();
    const parsed = JSON.parse(packageJsonBlock!);
    expect(parsed.peerDependencies).toBeUndefined();
    expect(packageJsonBlock).not.toContain("peerDependencies");
  });

  it("task 001's package.json example still declares the openclaw extensions entry", () => {
    const { content } = loadTask("phase-1/001-plugin-scaffold.md");
    const jsonBlocks = [...content.matchAll(/```json\n([\s\S]*?)\n```/g)].map((m) => m[1]);
    const packageJsonBlock = jsonBlocks.find((block) => block.includes('"name": "@wednesdayai/skillweaver"'));
    const parsed = JSON.parse(packageJsonBlock!);
    expect(parsed.openclaw.extensions).toEqual(["./index.ts"]);
  });
});