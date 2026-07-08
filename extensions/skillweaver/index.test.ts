import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
// @ts-expect-error — plugin-sdk not installed in this workspace
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
  let plugin: { id: string; name: string; description: string; configSchema: unknown; register: (api: OpenClawPluginApi) => void };

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
