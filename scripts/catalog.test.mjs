import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const CATALOG = fileURLToPath(new URL("./catalog.mjs", import.meta.url));

const tempDirs = [];
after(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

function run(cwd, args, env) {
  return execFileAsync(process.execPath, [CATALOG, ...args], {
    cwd,
    env: env ?? process.env,
  }).then(
    ({ stdout, stderr }) => ({ code: 0, stdout, stderr }),
    (err) => ({ code: err.code ?? 1, stdout: err.stdout ?? "", stderr: err.stderr ?? "" }),
  );
}

function sri(text) {
  return `sha512-${createHash("sha512").update(text).digest("base64")}`;
}

function validEntry(id, overrides = {}) {
  return {
    id,
    name: id,
    description: "d",
    kind: "misc",
    npmSpec: `@wednesdayai/${id}`,
    version: "1.0.0",
    integrity: sri(id),
    ...overrides,
  };
}

function plugin(id, pkgOverrides = {}, extra = {}) {
  return {
    dir: id,
    pkg: { name: `@wednesdayai/${id}`, version: "1.0.0", private: false, ...pkgOverrides },
    manifest: { id, name: id, description: "d", ...extra.manifest },
    files: extra.files ?? {},
  };
}

function makeRepo({ catalog, plugins = [] }) {
  const dir = mkdtempSync(join(tmpdir(), "wai-catalog-test-"));
  tempDirs.push(dir);
  if (catalog !== undefined) {
    const text = typeof catalog === "string" ? catalog : `${JSON.stringify(catalog, null, 2)}\n`;
    writeFileSync(join(dir, "catalog.json"), text);
  }
  for (const p of plugins) {
    const pdir = join(dir, "plugins", p.dir);
    mkdirSync(pdir, { recursive: true });
    writeFileSync(join(pdir, "package.json"), `${JSON.stringify(p.pkg, null, 2)}\n`);
    if (p.manifest) {
      writeFileSync(join(pdir, "openclaw.plugin.json"), `${JSON.stringify(p.manifest, null, 2)}\n`);
    }
    for (const [name, content] of Object.entries(p.files ?? {})) {
      writeFileSync(join(pdir, name), content);
    }
  }
  return dir;
}

function readCatalog(dir) {
  return JSON.parse(readFileSync(join(dir, "catalog.json"), "utf8"));
}

describe("catalog.mjs check", () => {
  it("accepts a canonical catalog of published public plugins", async () => {
    const dir = makeRepo({
      catalog: { version: 1, plugins: [validEntry("alpha"), validEntry("beta")] },
      plugins: [plugin("alpha"), plugin("beta")],
    });
    const res = await run(dir, ["check"]);
    assert.equal(res.code, 0, res.stderr);
    assert.match(res.stdout, /catalog: OK \(2 entries\)/);
  });

  it("rejects an entry with no integrity", async () => {
    const entry = validEntry("alpha");
    delete entry.integrity;
    const dir = makeRepo({
      catalog: { version: 1, plugins: [entry] },
      plugins: [plugin("alpha")],
    });
    const res = await run(dir, ["check"]);
    assert.equal(res.code, 1);
    assert.match(res.stderr, /entry "alpha": integrity must be a sha512 SRI/);
  });

  it("rejects a sha256 integrity", async () => {
    const sha256 = `sha256-${createHash("sha256").update("alpha").digest("base64")}`;
    const dir = makeRepo({
      catalog: { version: 1, plugins: [validEntry("alpha", { integrity: sha256 })] },
      plugins: [plugin("alpha")],
    });
    const res = await run(dir, ["check"]);
    assert.equal(res.code, 1);
    assert.match(res.stderr, /entry "alpha": integrity must be a sha512 SRI/);
  });

  it("rejects a private package", async () => {
    const dir = makeRepo({
      catalog: { version: 1, plugins: [validEntry("alpha")] },
      plugins: [plugin("alpha", { private: true })],
    });
    const res = await run(dir, ["check"]);
    assert.equal(res.code, 1);
    assert.match(res.stderr, /is a private package and must not be listed/);
  });

  it("rejects entries that are not sorted by id", async () => {
    const dir = makeRepo({
      catalog: { version: 1, plugins: [validEntry("beta"), validEntry("alpha")] },
      plugins: [plugin("alpha"), plugin("beta")],
    });
    const res = await run(dir, ["check"]);
    assert.equal(res.code, 1);
    assert.match(res.stderr, /not in canonical form/);
  });

  it("rejects entry keys in non-canonical order", async () => {
    const entry = validEntry("alpha");
    const reordered = { name: entry.name, id: entry.id, ...entry };
    const raw = `${JSON.stringify({ version: 1, plugins: [reordered] }, null, 2)}\n`;
    const dir = makeRepo({ catalog: raw, plugins: [plugin("alpha")] });
    const res = await run(dir, ["check"]);
    assert.equal(res.code, 1);
    assert.match(res.stderr, /not in canonical form/);
  });

  it("refuses dependencies without a shrinkwrap and accepts them with one", async () => {
    const withoutShrinkwrap = makeRepo({
      catalog: { version: 1, plugins: [validEntry("alpha")] },
      plugins: [plugin("alpha", { dependencies: { "left-pad": "1.3.0" } })],
    });
    const bad = await run(withoutShrinkwrap, ["check"]);
    assert.equal(bad.code, 1);
    assert.match(bad.stderr, /declares dependencies but ships no npm-shrinkwrap\.json/);

    const withShrinkwrap = makeRepo({
      catalog: { version: 1, plugins: [validEntry("alpha")] },
      plugins: [
        plugin(
          "alpha",
          { dependencies: { "left-pad": "1.3.0" } },
          { files: { "npm-shrinkwrap.json": "{}\n" } },
        ),
      ],
    });
    const good = await run(withShrinkwrap, ["check"]);
    assert.equal(good.code, 0, good.stderr);
  });

  it("rejects an entry with no matching package", async () => {
    const dir = makeRepo({
      catalog: { version: 1, plugins: [validEntry("ghost")] },
      plugins: [],
    });
    const res = await run(dir, ["check"]);
    assert.equal(res.code, 1);
    assert.match(res.stderr, /is not a package in plugins\//);
  });
});

describe("catalog.mjs entry", () => {
  it("pins the published version and integrity in place", async () => {
    const integrity = sri("alpha-1.1.0");
    const server = createServer((req, res) => {
      if (req.url === "/@wednesdayai%2falpha/1.1.0") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            name: "@wednesdayai/alpha",
            version: "1.1.0",
            dist: { integrity, tarball: "http://unused" },
          }),
        );
        return;
      }
      res.writeHead(404).end("{}");
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address();
    try {
      const dir = makeRepo({
        catalog: { version: 1, plugins: [validEntry("alpha"), validEntry("beta")] },
        plugins: [
          plugin("alpha", { version: "1.1.0" }, { manifest: { providers: { webSearch: true } } }),
          plugin("beta"),
        ],
      });
      const res = await run(dir, ["entry", "plugins/alpha"], {
        ...process.env,
        NPM_REGISTRY_URL: `http://127.0.0.1:${port}`,
      });
      assert.equal(res.code, 0, res.stderr);
      assert.equal(res.stdout, "alpha 1.1.0\n");

      const catalog = readCatalog(dir);
      assert.equal(catalog.plugins.length, 2);
      assert.deepEqual(
        catalog.plugins.map((e) => e.id),
        ["alpha", "beta"],
      );
      assert.equal(catalog.plugins[0].version, "1.1.0");
      assert.equal(catalog.plugins[0].integrity, integrity);
      assert.equal(catalog.plugins[0].kind, "web-search");
      assert.deepEqual(catalog.plugins[1], validEntry("beta"));

      const recheck = await run(dir, ["check"]);
      assert.equal(recheck.code, 0, recheck.stderr);
    } finally {
      server.close();
    }
  });

  it("refuses a private package and leaves the catalog untouched", async () => {
    const dir = makeRepo({
      catalog: { version: 1, plugins: [validEntry("alpha")] },
      plugins: [plugin("alpha"), plugin("secret", { private: true })],
    });
    const before = readFileSync(join(dir, "catalog.json"), "utf8");
    const res = await run(dir, ["entry", "plugins/secret"]);
    assert.equal(res.code, 1);
    assert.match(res.stderr, /is a private package/);
    assert.equal(readFileSync(join(dir, "catalog.json"), "utf8"), before);
  });
});

describe("catalog.mjs matrix", () => {
  const SHA_A = "a".repeat(40);
  const SHA_B = "b".repeat(40);

  it("emits {path, ref} rows for publishable paths and drops private ones", async () => {
    const dir = makeRepo({
      catalog: { version: 1, plugins: [validEntry("alpha")] },
      plugins: [plugin("alpha"), plugin("secret", { private: true })],
    });
    const res = await run(dir, [
      "matrix",
      '["plugins/alpha","plugins/secret"]',
      JSON.stringify({ "plugins/alpha--sha": SHA_A, "plugins/secret--sha": SHA_B }),
    ]);
    assert.equal(res.code, 0, res.stderr);
    assert.equal(res.stdout, `[{"path":"plugins/alpha","ref":"${SHA_A}"}]\n`);
  });

  it("fails when a publishable path has no release-please sha", async () => {
    const dir = makeRepo({
      catalog: { version: 1, plugins: [validEntry("alpha")] },
      plugins: [plugin("alpha")],
    });
    const res = await run(dir, ["matrix", '["plugins/alpha"]', "{}"]);
    assert.equal(res.code, 1);
    assert.match(res.stderr, /no valid sha for plugins\/alpha/);
  });

  it("fails on malformed outputs JSON", async () => {
    const dir = makeRepo({
      catalog: { version: 1, plugins: [validEntry("alpha")] },
      plugins: [plugin("alpha")],
    });
    const res = await run(dir, ["matrix", '["plugins/alpha"]', "not json"]);
    assert.equal(res.code, 1);
    assert.match(res.stderr, /outputs JSON object/);
  });
});
