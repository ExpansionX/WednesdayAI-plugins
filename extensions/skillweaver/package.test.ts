import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname!);

describe("extension package scaffolding", () => {
  it("package.json exists and is valid JSON", () => {
    const pkgPath = path.join(root, "package.json");
    expect(existsSync(pkgPath)).toBe(true);
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    expect(pkg.name).toBe("@wednesdayai/skillweaver");
    expect(pkg.type).toBe("module");
    expect(pkg.openclaw).toBeDefined();
    expect(pkg.openclaw.extensions).toEqual(["./index.ts"]);
  });

  it("openclaw.plugin.json exists with required manifest fields", () => {
    const manifestPath = path.join(root, "openclaw.plugin.json");
    expect(existsSync(manifestPath)).toBe(true);
    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
    expect(manifest.id).toBe("skillweaver");
    expect(manifest.configSchema).toBeDefined();
  });

  it("tsconfig.json exists and targets ESM", () => {
    const tsconfigPath = path.join(root, "tsconfig.json");
    expect(existsSync(tsconfigPath)).toBe(true);
    const tsconfig = JSON.parse(readFileSync(tsconfigPath, "utf-8"));
    expect(tsconfig.compilerOptions.module).toBe("NodeNext");
    expect(tsconfig.compilerOptions.moduleResolution).toBe("NodeNext");
  });
});
