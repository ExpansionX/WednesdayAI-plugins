---
id: "014"
phase: 5
title: Wire full pipeline in register() — build SkillIndex, discover skills, create Decomposer+Retriever, register context.collect handler
status: ready
depends_on: ["003", "004", "008", "010", "011", "012", "013"]
parallel: false
conflicts_with: []
files:
  - extensions/skillweaver/index.ts
irreversible: false
scope_test: "extensions/skillweaver/index.test.ts"
allowed_change: edit
covers_criteria: [SC1, SC2, SC3, SC4]
---
## Failing test (write first)

Replace `extensions/skillweaver/index.test.ts` with:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { OpenClawPluginApi } from "wednesdayai/plugin-sdk";

const mockLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

function createMockApi(overrides: Partial<OpenClawPluginApi> = {}): OpenClawPluginApi {
  return {
    pluginConfig: {},
    config: {
      agents: { defaults: { systemPrompt: { sections: { skills: "names" } } } },
    },
    logger: mockLogger,
    on: vi.fn(),
    registerTool: vi.fn(),
    ...overrides,
  } as unknown as OpenClawPluginApi;
}

describe("plugin register() wiring", () => {
  let plugin: { id: string; register: (api: OpenClawPluginApi) => void };

  beforeAll(async () => {
    const mod = await import("./index.js");
    plugin = mod.default ?? mod;
  });

  it("builds SkillIndex and registers a context.collect handler", () => {
    const api = createMockApi();
    plugin.register(api);
    expect(api.on).toHaveBeenCalledWith("context.collect", expect.any(Function));
  });

  it("does NOT build pipeline when disabled", () => {
    const api = createMockApi({ pluginConfig: { enabled: false } });
    plugin.register(api);
    expect(api.on).not.toHaveBeenCalled();
  });

  it("logs info on successful registration", () => {
    const api = createMockApi();
    plugin.register(api);
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.stringContaining("skillweaver"),
    );
  });

  it("builds with local backend when configured", () => {
    const api = createMockApi({
      pluginConfig: { embedding: { backend: "local" } },
    });
    expect(() => plugin.register(api)).not.toThrow();
  });

  it("builds with cloud backend when configured", () => {
    const api = createMockApi({
      pluginConfig: { embedding: { backend: "cloud", apiKey: "sk-test" } },
    });
    expect(() => plugin.register(api)).not.toThrow();
  });

  it("builds with custom backend when configured", () => {
    const api = createMockApi({
      pluginConfig: {
        embedding: { backend: "custom", endpoint: "http://localhost:8080/v1/embeddings" },
      },
    });
    expect(() => plugin.register(api)).not.toThrow();
  });
});
```

## Change

**File:** `extensions/skillweaver/index.ts`
**Anchor:** replace entire file content
**Before:**
```ts
import type { OpenClawPluginApi } from "wednesdayai/plugin-sdk";
import manifest from "./openclaw.plugin.json" with { type: "json" };
import { resolveConfig, validateConfig, checkSkillsMode } from "./src/config.js";

const plugin = {
  id: manifest.id,
  name: manifest.name,
  description: manifest.description,
  configSchema: manifest.configSchema,

  register(api: OpenClawPluginApi) {
    const rawConfig = (api.pluginConfig ?? {}) as Record<string, unknown>;
    const config = resolveConfig(rawConfig);
    validateConfig(config);

    if (!config.enabled) {
      api.logger.info("skillweaver: disabled via config");
      return;
    }

    const skillsMode = checkSkillsMode(api.config);
    if (skillsMode === "default" || skillsMode === "compact") {
      api.logger.warn(
        `skillweaver: detected skills mode "${skillsMode}". ` +
          `For optimal context savings, set ` +
          `agents.defaults.systemPrompt.sections.skills to "names" in your openclaw config. ` +
          `With "default" mode, full skill descriptions still appear in the system prompt ` +
          `alongside SkillWeaver's selective injection.`,
      );
    }

    api.on("context.collect", async (_event) => {
      return {};
    });
  },
};

export default plugin;
```
**After:**
```ts
import type { OpenClawPluginApi } from "wednesdayai/plugin-sdk";
import manifest from "./openclaw.plugin.json" with { type: "json" };
import { resolveConfig, validateConfig, checkSkillsMode } from "./src/config.js";
import { SkillIndex } from "./src/skill-index.js";
import { LocalEmbedding } from "./src/embedding/local.js";
import { CloudEmbedding } from "./src/embedding/cloud.js";
import { CustomEmbedding } from "./src/embedding/custom.js";
import type { EmbeddingBackend, SkillEntry } from "./src/embedding/types.js";
import { Decomposer } from "./src/decomposer.js";
import { createRetriever } from "./src/retriever.js";
import { createCollectHandler } from "./src/handler.js";

function resolveBackend(config: ReturnType<typeof resolveConfig>): EmbeddingBackend {
  switch (config.embedding.backend) {
    case "local":
      return new LocalEmbedding(config.embedding.model);
    case "cloud":
      return new CloudEmbedding({
        apiKey: config.embedding.apiKey,
        model: config.embedding.cloudModel,
      });
    case "custom":
      return new CustomEmbedding({
        endpoint: config.embedding.endpoint,
        apiKey: config.embedding.apiKey,
      });
  }
}

function collectSkillPaths(config: unknown): string[] {
  const skillsCfg = (config as Record<string, unknown> | undefined)?.skills as
    | { load?: { extraDirs?: string[]; paths?: string[] } }
    | undefined;
  return skillsCfg?.load?.extraDirs ?? skillsCfg?.load?.paths ?? [];
}

function isSkillEntry(entry: unknown): entry is { name: string; description: string; filePath: string; sourceInfo: string } {
  return (
    typeof entry === "object" &&
    entry !== null &&
    "name" in entry &&
    "description" in entry &&
    "filePath" in entry
  );
}

async function discoverSkills(config: SkillWeaverConfig): Promise<SkillEntry[]> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const os = await import("node:os");
  const entries: SkillEntry[] = [];

  const dirs: string[] = config.skills?.dirs ?? [];
  if (dirs.length === 0) {
    const defaultSkillsDir = path.join(os.homedir(), ".openclaw", "skills");
    try {
      await fs.access(defaultSkillsDir);
      dirs.push(defaultSkillsDir);
    } catch { /* no default skills dir */ }
  }

  for (const dir of dirs) {
    try {
      const items = await fs.readdir(dir, { withFileTypes: true });
      for (const item of items) {
        if (!item.isDirectory()) continue;
        const skillFile = path.join(dir, item.name, "SKILL.md");
        try {
          const content = await fs.readFile(skillFile, "utf-8");
          const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
          if (!fmMatch) continue;
          const fmText = fmMatch[1];
          const nameMatch = fmText.match(/^name:\s*(.+)/m);
          const descMatch = fmText.match(/^description:\s*(.+)/m);
          if (!nameMatch) continue;
          entries.push({
            name: nameMatch[1].trim(),
            description: descMatch?.[1]?.trim() ?? nameMatch[1].trim(),
            location: skillFile,
            source: "managed",
          });
        } catch { /* skip unreadable skill files */ }
      }
    } catch { /* skip unreadable dirs */ }
  }

  return entries;
}

const plugin = {
  id: manifest.id,
  name: manifest.name,
  description: manifest.description,
  configSchema: manifest.configSchema,

  register(api: OpenClawPluginApi) {
    const rawConfig = (api.pluginConfig ?? {}) as Record<string, unknown>;
    const config = resolveConfig(rawConfig);
    validateConfig(config);

    if (!config.enabled) {
      api.logger.info("skillweaver: disabled via config");
      return;
    }

    const skillsMode = checkSkillsMode(api.config);
    if (skillsMode === "default" || skillsMode === "compact") {
      api.logger.warn(
        `skillweaver: detected skills mode "${skillsMode}". ` +
          `For optimal context savings, set ` +
          `agents.defaults.systemPrompt.sections.skills to "names" in your openclaw config. ` +
          `With "default" mode, full skill descriptions still appear in the system prompt ` +
          `alongside SkillWeaver's selective injection.`,
      );
    }

    const backend = resolveBackend(config);
    const index = new SkillIndex(backend);

    const decomposer = new Decomposer({
      provider: config.decomposer.provider,
      model: config.decomposer.model,
      apiKey: config.decomposer.apiKey,
      baseUrl: config.decomposer.baseUrl,
      temperature: config.decomposer.temperature,
      maxTokens: config.decomposer.maxTokens,
    });

    const retriever = createRetriever(index, {
      topK: config.retrieval.topK,
      hintSize: config.retrieval.hintSize,
    });

    const handler = createCollectHandler({
      decomposer,
      retriever,
      sadEnabled: config.sad.enabled,
      minQueryLength: config.retrieval.minQueryLength,
      decomposerModel: config.decomposer.model,
    });

    api.on("context.collect", handler);

    discoverSkills(api.config).then((skills) => {
      index.build(skills).catch((err) => {
        api.logger.warn("skillweaver: initial index build failed", { error: String(err) });
      });
    });

    api.logger.info("skillweaver: registered");
  },
};

export default plugin;
```

## Allowed moves

Only edit `extensions/skillweaver/index.ts` (the complete replacement above) and replace the test file. Import path `"./embedding/types.js"` must use `.js` extension (ESM). The `discoverSkills` function discovers skills by scanning configured `skills.dirs` for SKILL.md files, parsing their YAML frontmatter for `name` and `description`. If no dirs are configured, it falls back to scanning `~/.openclaw/skills/` if it exists.

## STOP triggers

- Any uncaught exception in `register()` — must not throw
- `api.on` registered before config validation
- Leaked API keys in log messages

## Done when

`WAI_TYPECHECK_CMD="cd extensions/skillweaver && pnpm exec tsc --noEmit" WAI_TEST_CMD="cd extensions/skillweaver && npx vitest run index.test.ts" bash ~/.claude/wai/scripts/task-gate.sh plugin-skillweaver 014` exits 0