#!/usr/bin/env node
// catalog.json is written only by release CI (scripts/catalog.mjs entry, ADR 1668 §3).
// This entry point remains because the factory station gate runs
// "generate-catalog.mjs --check".
import { runCheck } from "./catalog.mjs";

if (!process.argv.includes("--check")) {
  console.error(
    'generate-catalog: catalog.json is written only by release CI; validate with "node scripts/catalog.mjs check"',
  );
  process.exit(1);
}

process.exit(runCheck(process.cwd()));
