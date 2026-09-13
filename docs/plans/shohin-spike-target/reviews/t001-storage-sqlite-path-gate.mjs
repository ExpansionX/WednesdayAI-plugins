import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const manifestUrl = new URL("../../../../plugins/shohin/openclaw.plugin.json", import.meta.url);
const manifest = JSON.parse(readFileSync(manifestUrl, "utf8"));

test("Shohin manifest declares a closed storage.sqlitePath schema", () => {
  const schema = manifest.configSchema;
  assert.equal(schema?.type, "object");
  assert.equal(schema?.additionalProperties, false);

  const storage = schema?.properties?.storage;
  assert.equal(storage?.type, "object");
  assert.equal(storage?.additionalProperties, false);
  assert.deepEqual(Object.keys(storage?.properties ?? {}).sort(), ["sqlitePath"]);
  assert.equal(storage?.properties?.sqlitePath?.type, "string");
});
