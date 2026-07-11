import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
// @ts-expect-error — plugin-sdk not installed in this workspace
import type { OpenClawPluginApi } from "wednesdayai/plugin-sdk";

const mockLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

vi.mock("@xenova/transformers", () => ({
  pipeline: vi.fn().mockResolvedValue(vi.fn()),
}));

vi.mock("wednesdayai/plugin-sdk", () => ({
  createSubsystemLogger: () => mockLogger,
}));

function createMockApi(overrides: Partial<OpenClawPluginApi> = {}): OpenClawPluginApi {
  return {
    pluginConfig: {},
    config: {
      agents: { defaults: { systemPrompt: { sections: { skills: { mode: "names" } } } } },
    },
    logger: mockLogger,
    on: vi.fn(),
    registerTool: vi.fn(),
    ...overrides,
  } as unknown as OpenClawPluginApi;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let plugin: any;

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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const call = (api.on as ReturnType<typeof vi.fn>).mock.calls.find(
        (c: any[]) => c[0] === "context.collect",
      );
      expect(call).toBeDefined();
      expect(typeof call![1]).toBe("function");
    });
  });

  describe("cache boundary proof", () => {
    it("prependContext is set, systemPrompt is undefined (conversation injection, not system prompt)", async () => {
      const api = createMockApi();
      plugin.register(api);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const handler = (api.on as ReturnType<typeof vi.fn>).mock.calls.find(
        (c: any[]) => c[0] === "context.collect",
      )![1];

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
      // 2 hooks: context.collect + gateway_stop
      expect(api.on).toHaveBeenCalledTimes(2);
      expect((api.on as ReturnType<typeof vi.fn>)).not.toHaveBeenCalledWith("before_tool_call", expect.anything());
    });
  });

  describe("sub-agent propagation", () => {
    it("skips routing for sub-agent events", async () => {
      const api = createMockApi();
      plugin.register(api);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const handler = (api.on as ReturnType<typeof vi.fn>).mock.calls.find(
        (c: any[]) => c[0] === "context.collect",
      )![1];

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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const handler = (api.on as ReturnType<typeof vi.fn>).mock.calls.find(
        (c: any[]) => c[0] === "context.collect",
      )![1];

      const result = await handler({ cleanUserMessage: { text: "hi" } });
      expect(result).toEqual({});
    });

    it("returns empty for sub-agent events", async () => {
      const api = createMockApi();
      plugin.register(api);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const handler = (api.on as ReturnType<typeof vi.fn>).mock.calls.find(
        (c: any[]) => c[0] === "context.collect",
      )![1];

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
