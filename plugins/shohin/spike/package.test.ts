import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const packageRoot = path.resolve(import.meta.dirname);
const repoRoot = path.resolve(packageRoot, "../../..");
const skillWeaverRoot = path.join(repoRoot, "extensions", "skillweaver");

const readJson = (filePath: string): Record<string, unknown> => {
  expect(existsSync(filePath), `${filePath} should exist`).toBe(true);
  return JSON.parse(readFileSync(filePath, "utf-8")) as Record<string, unknown>;
};

const asRecord = (value: unknown): Record<string, unknown> => {
  expect(value).toBeTypeOf("object");
  expect(value).not.toBeNull();
  expect(Array.isArray(value)).toBe(false);
  return value as Record<string, unknown>;
};

const readLines = (filePath: string): string[] => {
  expect(existsSync(filePath), `${filePath} should exist`).toBe(true);
  return readFileSync(filePath, "utf-8")
    .split(/\r?\n/)
    .filter((line) => line.length > 0);
};

describe("Shohin spike package scaffold", () => {
  it("records the relevant SkillWeaver sibling conventions and divergences", () => {
    const siblingPackage = readJson(path.join(skillWeaverRoot, "package.json"));
    const siblingTsconfig = readJson(path.join(skillWeaverRoot, "tsconfig.json"));
    const siblingTestSource = readFileSync(
      path.join(skillWeaverRoot, "package.test.ts"),
      "utf-8",
    );

    expect(asRecord(siblingPackage.scripts)).toMatchObject({
      build: "tsc -p tsconfig.build.json",
      typecheck: "tsc --noEmit",
      test: "vitest run",
    });
    expect(asRecord(siblingPackage.openclaw).extensions).toEqual([
      "./dist/index.js",
    ]);
    expect(asRecord(siblingTsconfig.compilerOptions)).toMatchObject({
      target: "ES2023",
      module: "NodeNext",
      moduleResolution: "NodeNext",
      strict: true,
      skipLibCheck: true,
    });
    expect(siblingTsconfig.exclude).toEqual(["node_modules", "dist"]);
    expect(siblingTestSource).toContain("existsSync");
    expect(siblingTestSource).toContain("JSON.parse");
  });

  it("package.json is private strict NodeNext ESM with a Jiti source entry", () => {
    const pkg = readJson(path.join(packageRoot, "package.json"));

    expect(pkg.name).toBe("@wednesdayai/shohin-spike");
    expect(pkg.private).toBe(true);
    expect(pkg.type).toBe("module");
    expect(pkg.engines).toEqual({ node: ">=24.0.0" });
    expect(pkg.wednesdayai).toEqual({ extensions: ["./index.ts"] });
    expect(pkg.openclaw).toBeUndefined();
    expect(pkg.scripts).toEqual({
      build: "tsc -p tsconfig.build.json",
      typecheck: "tsc --noEmit",
      test: "vitest run",
    });
    expect(pkg.dependencies).toBeUndefined();
    expect(pkg.peerDependencies).toBeUndefined();

    const devDependencies = asRecord(pkg.devDependencies);
    expect(devDependencies).toEqual({
      "@types/node": "^24.0.0",
      typescript: "^5.9.0",
      vitest: "^4.0.0",
      wednesdayai: "file:/data/Code/WednesdayAI-core",
    });
    expect(
      Object.values(devDependencies).some(
        (version) =>
          typeof version === "string" && version.startsWith("workspace:"),
      ),
    ).toBe(false);
  });

  it("openclaw.plugin.json exposes only the optional repoRoot string", () => {
    const manifest = readJson(path.join(packageRoot, "openclaw.plugin.json"));

    expect(manifest.id).toBe("shohin-spike");
    expect(manifest.name).toBe("Shohin Phase 0 Spike");

    const configSchema = asRecord(manifest.configSchema);
    expect(configSchema).toEqual({
      type: "object",
      additionalProperties: false,
      properties: {
        repoRoot: {
          type: "string",
        },
      },
    });
    expect(configSchema.required).toBeUndefined();
  });

  it("tsconfig files keep strict NodeNext settings and exclude runtime outputs", () => {
    const tsconfig = readJson(path.join(packageRoot, "tsconfig.json"));
    const buildConfig = readJson(path.join(packageRoot, "tsconfig.build.json"));

    expect(asRecord(tsconfig.compilerOptions)).toMatchObject({
      target: "ES2023",
      module: "NodeNext",
      moduleResolution: "NodeNext",
      strict: true,
      esModuleInterop: true,
      outDir: "./dist",
      rootDir: ".",
      declaration: true,
      sourceMap: true,
      skipLibCheck: true,
      forceConsistentCasingInFileNames: true,
      resolveJsonModule: true,
    });
    expect(tsconfig.include).toEqual(["./**/*.ts"]);
    expect(tsconfig.exclude).toEqual([
      "node_modules",
      "dist",
      "coverage",
      "run-data",
    ]);

    expect(buildConfig).toEqual({
      extends: "./tsconfig.json",
      include: ["index.ts", "src/**/*.ts"],
      exclude: [
        "node_modules",
        "dist",
        "coverage",
        "run-data",
        "**/*.test.ts",
      ],
    });
  });

  it("ignores exactly dependency, build, test, and spike runtime directories", () => {
    expect(readLines(path.join(packageRoot, ".gitignore"))).toEqual([
      "node_modules/",
      "dist/",
      "coverage/",
      "run-data/",
    ]);
  });
});
