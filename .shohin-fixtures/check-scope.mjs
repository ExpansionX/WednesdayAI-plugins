import { readFileSync } from 'node:fs';
import path from 'node:path';
const scope = process.argv[2];
const cwd = process.cwd();
const fail = (message) => {
  console.error(message);
  process.exit(1);
};
if (!scope) {
  console.error('missing scope');
  process.exit(2);
}
let parsed;
try {
  parsed = JSON.parse(readFileSync(scope, 'utf-8'));
} catch (error) {
  fail(String(error));
}
if (parsed.fixture !== 'shohin-r5' || typeof parsed.task !== 'string') {
  fail('scope fixture did not match reviewed schema');
}
const outputs = Array.isArray(parsed.requiredOutputs) ? parsed.requiredOutputs : [];
if (outputs.length === 0) {
  fail('scope fixture has no output assertions');
}
for (const output of outputs) {
  if (!output || typeof output.path !== 'string' || typeof output.content !== 'string') {
    fail('scope output assertion is malformed');
  }
  const absolute = path.resolve(cwd, output.path);
  if (absolute !== cwd && !absolute.startsWith(cwd + path.sep)) {
    fail('scope output escapes checkout: ' + output.path);
  }
  let actual;
  try {
    actual = readFileSync(absolute, 'utf-8');
  } catch {
    fail('missing produced output: ' + output.path);
  }
  if (actual !== output.content) {
    fail('produced output mismatch: ' + output.path);
  }
}
