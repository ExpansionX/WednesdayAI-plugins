---
id: "001"
phase: 1
title: Create extension package scaffolding (package.json, openclaw.plugin.json, tsconfig.json)
status: ready
depends_on: []
parallel: false
conflicts_with: []
files:
  - extensions/skillweaver/package.json
  - extensions/skillweaver/openclaw.plugin.json
  - extensions/skillweaver/tsconfig.json
irreversible: false
scope_test: "extensions/skillweaver"
allowed_change: create
covers_criteria: []
---
## Failing test (write first)

Create `extensions/skillweaver/package.test.ts`:

```ts
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
```

## Change

For each file in `files:`:

**File:** `extensions/skillweaver/package.json`
**Anchor:** new file — create at this path
**Before:** file does not exist
**After:**
```json
{
  "name": "@wednesdayai/skillweaver",
  "version": "0.1.0",
  "private": true,
  "description": "SkillWeaver — compositional skill routing for WednesdayAI via context.collect hook",
  "type": "module",
  "main": "./index.ts",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "hnswlib-node": "^3.0.0"
  },
  "devDependencies": {
    "@types/node": "^24.0.0",
    "typescript": "^5.9.0",
    "vitest": "^4.0.0"
  },
  "openclaw": {
    "extensions": [
      "./index.ts"
    ]
  }
}
```

**File:** `extensions/skillweaver/openclaw.plugin.json`
**Anchor:** new file — create at this path
**Before:** file does not exist
**After:**
```json
{
  "id": "skillweaver",
  "name": "SkillWeaver",
  "description": "Compositional skill routing: decompose queries, retrieve relevant skills, inject into context via context.collect hook.",
  "configSchema": {
    "type": "object",
    "additionalProperties": false,
    "properties": {
      "enabled": {
        "type": "boolean",
        "default": true,
        "description": "Master on/off switch."
      },
      "decomposer": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "provider": {
            "type": "string",
            "default": "openrouter",
            "enum": ["openrouter", "openai", "anthropic", "openai-compatible"],
            "description": "LLM provider for the decomposition model."
          },
          "model": {
            "type": "string",
            "default": "qwen/qwen2.5-7b-instruct",
            "description": "Model used for query decomposition."
          },
          "apiKey": {
            "type": "string",
            "description": "API key override. If null, uses agent's provider credentials."
          },
          "baseUrl": {
            "type": "string",
            "description": "Base URL for openai-compatible endpoints."
          },
          "temperature": {
            "type": "number",
            "default": 0.1,
            "minimum": 0,
            "maximum": 2
          },
          "maxTokens": {
            "type": "number",
            "default": 256,
            "minimum": 50,
            "maximum": 1024
          }
        }
      },
      "embedding": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "backend": {
            "type": "string",
            "default": "local",
            "enum": ["local", "cloud", "custom"],
            "description": "Embedding backend: local (Xenova/transformers), cloud (OpenAI), custom (OpenAI-compatible endpoint)."
          },
          "model": {
            "type": "string",
            "default": "all-MiniLM-L6-v2",
            "description": "Model name for the local backend."
          },
          "cloudModel": {
            "type": "string",
            "default": "text-embedding-3-small",
            "description": "Model name for the cloud (OpenAI) backend."
          },
          "endpoint": {
            "type": "string",
            "description": "OpenAI-compatible endpoint URL for the custom backend."
          },
          "apiKey": {
            "type": "string",
            "description": "API key for the custom backend."
          }
        }
      },
      "retrieval": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "topK": {
            "type": "integer",
            "default": 3,
            "minimum": 1,
            "maximum": 10,
            "description": "Number of skills returned per sub-task."
          },
          "hintSize": {
            "type": "integer",
            "default": 15,
            "minimum": 5,
            "maximum": 50,
            "description": "Total hints passed to SAD Pass-2."
          },
          "minQueryLength": {
            "type": "integer",
            "default": 20,
            "minimum": 5,
            "maximum": 500,
            "description": "Skip routing for queries shorter than this."
          }
        }
      },
      "sad": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "enabled": {
            "type": "boolean",
            "default": true,
            "description": "Enable SAD (2-pass). False = Pass-1 only."
          },
          "maxIterations": {
            "type": "integer",
            "default": 1,
            "minimum": 1,
            "maximum": 5,
            "description": "Max SAD iterations (V1 capped at 1)."
          }
        }
      }
    }
  },
  "uiHints": {
    "enabled": {
      "label": "Enable SkillWeaver",
      "help": "Master on/off switch for automatic skill routing."
    },
    "decomposer.provider": {
      "label": "Decomposer Provider",
      "help": "LLM provider for the decomposition model."
    },
    "decomposer.model": {
      "label": "Decomposer Model",
      "help": "Model used for query decomposition (smaller/cheaper recommended)."
    },
    "embedding.backend": {
      "label": "Embedding Backend",
      "help": "Where to compute embeddings: locally, via OpenAI cloud, or custom endpoint."
    },
    "sad.enabled": {
      "label": "SAD (2-Pass)",
      "help": "Enable Skill-Aware Decomposition for improved accuracy."
    }
  }
}
```

**File:** `extensions/skillweaver/tsconfig.json`
**Anchor:** new file — create at this path
**Before:** file does not exist
**After:**
```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "outDir": "./dist",
    "rootDir": ".",
    "declaration": true,
    "sourceMap": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "paths": {
      "wednesdayai/plugin-sdk": ["./node_modules/wednesdayai/dist/plugin-sdk/index.js"]
    }
  },
  "include": ["./**/*.ts"],
  "exclude": ["node_modules", "dist"]
}
```

## Allowed moves

Create exactly the three files listed in `files:`. No other files. No edits to existing files.

## STOP triggers

- Any of the three file paths already exist
- package.json `name` is not `@wednesdayai/skillweaver`
- openclaw.plugin.json `id` is not `"skillweaver"`
- test fails to parse any file as valid JSON

## Done when

`WAI_TYPECHECK_CMD="cd extensions/skillweaver && pnpm exec tsc --noEmit" WAI_TEST_CMD="cd extensions/skillweaver && npx vitest run package.test.ts" bash ~/.claude/wai/scripts/task-gate.sh plugin-skillweaver 001` exits 0