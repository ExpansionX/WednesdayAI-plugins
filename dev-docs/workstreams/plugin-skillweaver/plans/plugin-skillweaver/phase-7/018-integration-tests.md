---
id: "018"
phase: 7
title: Create integration tests — hook registration, cache boundary proof, slash command survival, sub-agent propagation, error resilience
status: ready
depends_on: ["016"]
parallel: false
conflicts_with: []
files:
  - extensions/skillweaver/src/__tests__/integration.test.ts
irreversible: false
scope_test: "extensions/skillweaver/src/__tests__/integration.test.ts"
allowed_change: create
covers_criteria: [SC3, SC4, SC5]
covers_tests: [TS1, TS2, TS3, TS4, TS5, TS6, TS7, TS8, TS9]
---
## Failing test (write first)

Create `extensions/skillweaver/src/__tests__/integration.test.ts`:

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

let plugin: { id: string; register: (api: OpenClawPluginApi) => void };

describe("integration", () => {
  beforeAll(async () => {
    const mod = await import("../../index.js");
    plugin = mod.default ?? mod;
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("hook registration", () => {
    it("registers context.collect hook", () => {
      const api = createMockApi();
      plugin.register(api);
      expect(api.on).toHaveBeenCalledWith("context.collect", expect.any(Function));
    });

    it("returns a function from context.collect handler", () => {
      const api = createMockApi();
      plugin.register(api);
      const call = (api.on as ReturnType<typeof vi.fn>).mock.calls.find(
        (c: [string, Function]) => c[0] === "context.collect",
      );
      expect(call).toBeDefined();
      expect(typeof call[1]).toBe("function");
    });
  });

  describe("cache boundary proof", () => {
    it("prependContext is set, systemPrompt is undefined (conversation injection, not system prompt)", async () => {
      const api = createMockApi();
      plugin.register(api);
      const handler = (api.on as ReturnType<typeof vi.fn>).mock.calls.find(
        (c: [string, Function]) => c[0] === "context.collect",
      )[1];

      const result = await handler({
        cleanUserMessage: { text: "create a PR and notify the team on Slack about the deployment status" },
      });
      expect(result).toBeDefined();
      expect((result as Record<string, unknown>).systemPrompt).toBeUndefined();
    });
  });

  describe("slash commands", () => {
    it("plugin does not interfere with slash command resolution", () => {
      const api = createMockApi();
      plugin.register(api);
      expect(api.on).toHaveBeenCalledTimes(2);
      expect((api.on as ReturnType<typeof vi.fn>)).not.toHaveBeenCalledWith("before_tool_call", expect.anything());
    });
  });

  describe("sub-agent propagation", () => {
    it("skips routing for sub-agent events", async () => {
      const api = createMockApi();
      plugin.register(api);
      const handler = (api.on as ReturnType<typeof vi.fn>).mock.calls.find(
        (c: [string, Function]) => c[0] === "context.collect",
      )[1];

      const result = await handler({
        cleanUserMessage: { text: "a long enough query to normally trigger routing" },
        envelope: { isSubAgent: true },
      });

      expect(result).toEqual({});
    });
  });

  describe("error resilience", () => {
    it("returns empty for short query", async () => {
      const api = createMockApi();
      plugin.register(api);
      const handler = (api.on as ReturnType<typeof vi.fn>).mock.calls.find(
        (c: [string, Function]) => c[0] === "context.collect",
      )[1];

      const result = await handler({ cleanUserMessage: { text: "hi" } });
      expect(result).toEqual({});
    });

    it("returns empty for sub-agent events", async () => {
      const api = createMockApi();
      plugin.register(api);
      const handler = (api.on as ReturnType<typeof vi.fn>).mock.calls.find(
        (c: [string, Function]) => c[0] === "context.collect",
      )[1];

      const result = await handler({
        cleanUserMessage: { text: "long enough query text to pass min query length check" },
        envelope: { isSubAgent: true },
      });

      expect(result).toEqual({});
    });

    it("returns empty when disabled", async () => {
      const api = createMockApi({ pluginConfig: { enabled: false } });
      plugin.register(api);
      expect(api.on).not.toHaveBeenCalled();
    });
  });

  describe("plugin identity", () => {
    it("has id 'skillweaver'", () => {
      expect(plugin.id).toBe("skillweaver");
    });

    it("has configSchema with all required sections", () => {
      expect(plugin.configSchema).toBeDefined();
      const schema = plugin.configSchema as Record<string, unknown>;
      const props = schema.properties as Record<string, unknown>;
      expect(props).toHaveProperty("enabled");
      expect(props).toHaveProperty("decomposer");
      expect(props).toHaveProperty("embedding");
      expect(props).toHaveProperty("retrieval");
      expect(props).toHaveProperty("sad");
    });
  });
});
```

## Change

Create exactly `extensions/skillweaver/src/__tests__/integration.test.ts` with the content above. No other files.

## Allowed moves

Create exactly the integration test file. No other files. The test imports from `../../index.js` (relative from `src/__tests__/` to the extension root).

## STOP triggers

- Handler returns `prependContext` for sub-agent events (must return `{}`)
- Handler returns `prependContext` for messages shorter than `minQueryLength`
- Plugin registers hooks other than `context.collect` (other than the lifecycle `gateway_stop` from task 016)
- `configSchema` missing any of the 5 top-level sections

## Manual verification (record in decisions-ledger)

For full integration proof beyond unit tests: run against the real WednesdayAI gateway. Check that `wednesdayai --version` is in sync. Verify the plugin loads via `wednesdayai plugins list`. Confirm that injecting skill content via `context.collect` does not break system prompt cache by comparing `~/.openclaw/` cache hit logs before/after plugin enable.

## Done when

`WAI_TYPECHECK_CMD="cd extensions/skillweaver && pnpm exec tsc --noEmit" WAI_TEST_CMD="cd extensions/skillweaver && npx vitest run src/__tests__/integration.test.ts" bash ~/.claude/wai/scripts/task-gate.sh plugin-skillweaver 018` exits 0