import { readFileSync } from 'node:fs';
const scope = process.argv[2];
if (!scope) {
  console.error('missing scope');
  process.exit(2);
}
let parsed;
try {
  parsed = JSON.parse(readFileSync(scope, 'utf-8'));
} catch (error) {
  console.error(String(error));
  process.exit(1);
}
if (parsed.fixture !== 'shohin-r5' || parsed.ok !== true) {
  console.error('scope fixture did not match reviewed schema');
  process.exit(1);
}
