---
id: "003"
phase: 1
title: Create plugin entry point with config warning for suboptimal skills mode
status: ready
depends_on: ["002"]
parallel: false
conflicts_with: []
files:
  - extensions/skillweaver/index.ts
irreversible: false
scope_test: "extensions/skillweaver/index.test.ts"
allowed_change: create
covers_criteria: [SC3, SC4]
---
## Failing test (write first)

Create `extensions/skillweaver/index.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { OpenClawPluginApi } from "wednesdayai/plugin-sdk";

const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

const mockConfig = {};

function createMockApi(overrides: Partial<OpenClawPluginApi> = {}): OpenClawPluginApi {
  return {
    pluginConfig: mockConfig,
    config: mockConfig,
    logger: mockLogger,
    on: vi.fn(),
    registerTool: vi.fn(),
    ...overrides,
  } as unknown as OpenClawPluginApi;
}

describe("plugin entry point", () => {
  let plugin: { id: string; name: string; register: (api: OpenClawPluginApi) => void };

  beforeAll(async () => {
    const mod = await import("./index.js");
    plugin = mod.default ?? mod;
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("exports a plugin object with id, name, description, configSchema, and register", () => {
    expect(plugin.id).toBe("skillweaver");
    expect(plugin.name).toBeDefined();
    expect(plugin.description).toBeDefined();
    expect(plugin.configSchema).toBeDefined();
    expect(typeof plugin.register).toBe("function");
  });

  it("register() does not throw with a mock api", () => {
    const api = createMockApi();
    expect(() => plugin.register(api)).not.toThrow();
  });

  it("logs a warning when skills mode is default (suboptimal)", () => {
    const api = createMockApi({
      config: {
        agents: { defaults: { systemPrompt: { sections: { skills: "default" } } } },
      } as never,
    });
    plugin.register(api);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining("skillweaver"),
    );
  });

  it("does NOT warn when skills mode is names", () => {
    const api = createMockApi({
      config: {
        agents: { defaults: { systemPrompt: { sections: { skills: "names" } } } },
      } as never,
    });
    plugin.register(api);
    expect(mockLogger.warn).not.toHaveBeenCalledWith(
      expect.stringContaining("skillweaver"),
    );
  });

  it("registers a context.collect hook", () => {
    const api = createMockApi();
    plugin.register(api);
    expect(api.on).toHaveBeenCalledWith("context.collect", expect.any(Function));
  });
});
```

## Change

**File:** `extensions/skillweaver/index.ts`
**Anchor:** new file — create at this path
**Before:** file does not exist
**After:**
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

## Allowed moves

Create exactly `extensions/skillweaver/index.ts` and `extensions/skillweaver/index.test.ts`. No other files.

## STOP triggers

- Plugin object missing `register` method
- `configSchema` does not match `openclaw.plugin.json` manifest
- Import fails at runtime — dependencies from package.json not installed
- `api.on` is called with a hook name other than `"context.collect"`

## Done when

`WAI_TYPECHECK_CMD="cd extensions/skillweaver && pnpm exec tsc --noEmit" WAI_TEST_CMD="cd extensions/skillweaver && npx vitest run index.test.ts" bash ~/.claude/wai/scripts/task-gate.sh plugin-skillweaver 003` exits 0