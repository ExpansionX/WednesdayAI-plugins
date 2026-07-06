---
id: "002"
phase: 1
title: Create config schema resolver, validator, and skills-mode checker
status: ready
depends_on: ["001"]
parallel: false
conflicts_with: []
files:
  - extensions/skillweaver/src/config.ts
irreversible: false
scope_test: "extensions/skillweaver/src/config.test.ts"
allowed_change: create
covers_criteria: [SC6, D6]
---
## Failing test (write first)

Create `extensions/skillweaver/src/config.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { resolveConfig, checkSkillsMode, validateConfig, resolveEffectiveDecomposerConfig } from "./config.js";

const defaults = {
  enabled: true,
  decomposer: { provider: "openrouter", model: "qwen/qwen2.5-7b-instruct", temperature: 0.1, maxTokens: 256 },
  embedding: { backend: "local", model: "all-MiniLM-L6-v2", cloudModel: "text-embedding-3-small" },
  retrieval: { topK: 3, hintSize: 15, minQueryLength: 20 },
  sad: { enabled: true, maxIterations: 1 },
};

describe("resolveConfig", () => {
  it("fills defaults for empty input", () => {
    expect(resolveConfig({})).toEqual(defaults);
  });

  it("merges partial overrides", () => {
    const result = resolveConfig({ retrieval: { topK: 5 } });
    expect(result.retrieval.topK).toBe(5);
    expect(result.retrieval.hintSize).toBe(15); // default preserved
  });

  it("preserves decomposer overrides", () => {
    const result = resolveConfig({ decomposer: { model: "gpt-4o-mini", provider: "openai", temperature: 0.2, maxTokens: 128 } });
    expect(result.decomposer.model).toBe("gpt-4o-mini");
    expect(result.decomposer.temperature).toBe(0.2);
  });
});

describe("validateConfig", () => {
  it("rejects invalid backend", () => {
    expect(() => validateConfig({ embedding: { backend: "invalid" } } as never))
      .toThrow(/backend/);
  });

  it("rejects invalid decomposer provider", () => {
    expect(() => validateConfig({ decomposer: { provider: "gemini" } } as never))
      .toThrow(/provider/);
  });

  it("accepts valid config", () => {
    expect(() => validateConfig(defaults)).not.toThrow();
  });
});

describe("checkSkillsMode", () => {
  it("returns 'default' when skills mode is default or missing", () => {
    const result = checkSkillsMode({});
    expect(result).toBe("default");
  });

  it("returns 'names' when configured", () => {
    const result = checkSkillsMode({ agents: { defaults: { systemPrompt: { sections: { skills: "names" } } } } });
    expect(result).toBe("names");
  });

  it("returns 'off' when disabled", () => {
    const result = checkSkillsMode({ agents: { defaults: { systemPrompt: { sections: { skills: "off" } } } } });
    expect(result).toBe("off");
  });

  it("detects 'compact' mode", () => {
    const result = checkSkillsMode({ agents: { defaults: { systemPrompt: { sections: { skills: "compact" } } } });
    expect(result).toBe("compact");
  });
});

describe("resolveEffectiveDecomposerConfig", () => {
  it("uses configured provider/model when set", () => {
    const cfg = resolveConfig({ decomposer: { provider: "anthropic", model: "claude-haiku" } });
    const result = resolveEffectiveDecomposerConfig(cfg);
    expect(result.provider).toBe("anthropic");
    expect(result.model).toBe("claude-haiku");
  });

  it("falls back to agent defaults when decomposer is unconfigured", () => {
    const cfg = resolveConfig({});
    const result = resolveEffectiveDecomposerConfig(cfg, { provider: "openai", model: "gpt-4o-mini" });
    expect(result.provider).toBe("openai");
    expect(result.model).toBe("gpt-4o-mini");
  });

  it("falls back to built-in defaults when nothing is configured", () => {
    const cfg = resolveConfig({});
    const result = resolveEffectiveDecomposerConfig(cfg);
    expect(result.provider).toBe("openrouter");
  });
});
```

## Change

**File:** `extensions/skillweaver/src/config.ts`
**Anchor:** new file — create at this path
**Before:** file does not exist
**After:**
```ts
export interface SkillWeaverConfig {
  enabled: boolean;
  decomposer: {
    provider: "openrouter" | "openai" | "anthropic" | "openai-compatible";
    model: string;
    apiKey?: string | null;
    baseUrl?: string | null;
    temperature: number;
    maxTokens: number;
  };
  embedding: {
    backend: "local" | "cloud" | "custom";
    model: string;
    cloudModel: string;
    endpoint?: string | null;
    apiKey?: string | null;
  };
  retrieval: {
    topK: number;
    hintSize: number;
    minQueryLength: number;
  };
  sad: {
    enabled: boolean;
    maxIterations: number;
  };
  skills: {
    dirs?: string[];
  };
}

const DEFAULTS: SkillWeaverConfig = {
  enabled: true,
  decomposer: {
    provider: "openrouter",
    model: "qwen/qwen2.5-7b-instruct",
    temperature: 0.1,
    maxTokens: 256,
  },
  embedding: {
    backend: "local",
    model: "all-MiniLM-L6-v2",
    cloudModel: "text-embedding-3-small",
  },
  retrieval: {
    topK: 3,
    hintSize: 15,
    minQueryLength: 20,
  },
  sad: {
    enabled: true,
    maxIterations: 1,
  },
  skills: {
    dirs: [],
  },
};

const VALID_BACKENDS = new Set(["local", "cloud", "custom"]);
const VALID_PROVIDERS = new Set(["openrouter", "openai", "anthropic", "openai-compatible"]);

export function resolveConfig(raw: Record<string, unknown>): SkillWeaverConfig {
  const decomposer = { ...DEFAULTS.decomposer, ...(raw.decomposer as Partial<SkillWeaverConfig["decomposer"]> ?? {}) };
  const embedding = { ...DEFAULTS.embedding, ...(raw.embedding as Partial<SkillWeaverConfig["embedding"]> ?? {}) };
  const retrieval = { ...DEFAULTS.retrieval, ...(raw.retrieval as Partial<SkillWeaverConfig["retrieval"]> ?? {}) };
  const sad = { ...DEFAULTS.sad, ...(raw.sad as Partial<SkillWeaverConfig["sad"]> ?? {}) };
  return {
    ...DEFAULTS,
    enabled: raw.enabled !== undefined ? Boolean(raw.enabled) : DEFAULTS.enabled,
    decomposer,
    embedding,
    retrieval,
    sad,
  };
}

export function validateConfig(config: SkillWeaverConfig): void {
  if (!VALID_PROVIDERS.has(config.decomposer.provider)) {
    throw new Error(`Invalid decomposer provider: ${config.decomposer.provider}`);
  }
  if (!VALID_BACKENDS.has(config.embedding.backend)) {
    throw new Error(`Invalid embedding backend: ${config.embedding.backend}`);
  }
  if (config.retrieval.topK < 1 || config.retrieval.topK > 10) {
    throw new Error(`topK must be 1-10, got ${config.retrieval.topK}`);
  }
  if (config.sad.maxIterations < 1 || config.sad.maxIterations > 5) {
    throw new Error(`maxIterations must be 1-5, got ${config.sad.maxIterations}`);
  }
}

type SkillsMode = "default" | "compact" | "names" | "off";

export function checkSkillsMode(coreConfig: Record<string, unknown> | undefined): SkillsMode {
  const skills = (coreConfig as Record<string, unknown> | undefined)
    ?.agents as Record<string, unknown> | undefined;
  const defaults = skills?.defaults as Record<string, unknown> | undefined;
  const sysPrompt = defaults?.systemPrompt as Record<string, unknown> | undefined;
  const sections = sysPrompt?.sections as Record<string, unknown> | undefined;
  const mode = sections?.skills as string | undefined;
  if (mode === "compact" || mode === "names" || mode === "off") return mode;
  return "default";
}

export interface EffectiveDecomposerConfig {
  provider: string;
  model: string;
  apiKey?: string | null;
  baseUrl?: string | null;
  temperature: number;
  maxTokens: number;
}

export function resolveEffectiveDecomposerConfig(
  cfg: SkillWeaverConfig,
  agentDefaults?: { provider?: string; model?: string },
): EffectiveDecomposerConfig {
  const provider = cfg.decomposer.provider || agentDefaults?.provider || "openrouter";
  const model = cfg.decomposer.model || agentDefaults?.model || "qwen/qwen2.5-7b-instruct";
  return {
    provider,
    model,
    apiKey: cfg.decomposer.apiKey ?? null,
    baseUrl: cfg.decomposer.baseUrl ?? null,
    temperature: cfg.decomposer.temperature,
    maxTokens: cfg.decomposer.maxTokens,
  };
}
```

## Allowed moves

Create exactly `extensions/skillweaver/src/config.ts` and `extensions/skillweaver/src/config.test.ts`. No other files.

## STOP triggers

- `extensions/skillweaver/src/` directory missing (task 001 not completed)
- Any test expects a different default value than what DEFAULTS produces
- `resolveConfig` returns shapes that don't match `SkillWeaverConfig` type
- `resolveEffectiveDecomposerConfig` fails to resolve agent defaults when decomposer fields are empty
- Decomposer model used without calling `resolveEffectiveDecomposerConfig` (must resolve at runtime)

## Done when

`WAI_TYPECHECK_CMD="cd extensions/skillweaver && pnpm exec tsc --noEmit" WAI_TEST_CMD="cd extensions/skillweaver && npx vitest run src/config.test.ts" bash ~/.claude/wai/scripts/task-gate.sh plugin-skillweaver 002` exits 0