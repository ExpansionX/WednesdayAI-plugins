// @ts-expect-error — plugin-sdk not installed in this workspace
import type { OpenClawPluginApi } from "wednesdayai/plugin-sdk";
import { describe, it, expect, vi, beforeAll } from "vitest";

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
