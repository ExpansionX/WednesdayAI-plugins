import { describe, it, expect, vi } from "vitest";

describe("createSubsystemLogger", () => {
  const createSubsystemLogger = async () => {
    const mod = await import("./logger.js");
    return mod.createSubsystemLogger;
  };

  const levels = [
    { method: "info" as const, consoleMethod: "log" as const, label: "INFO" },
    { method: "warn" as const, consoleMethod: "warn" as const, label: "WARN" },
    { method: "error" as const, consoleMethod: "error" as const, label: "ERROR" },
    { method: "debug" as const, consoleMethod: "debug" as const, label: "DEBUG" },
  ];

  for (const { method, consoleMethod, label } of levels) {
    it(`${method}() calls console.${consoleMethod} with [${label}] and namespace`, async () => {
      const factory = await createSubsystemLogger();
      const spy = vi.spyOn(console, consoleMethod).mockImplementation(() => {});
      const logger = factory("test/ns");
      logger[method]("hello world");
      expect(spy).toHaveBeenCalledTimes(1);
      const arg = spy.mock.calls[0][0] as string;
      expect(arg).toContain(`[${label}]`);
      expect(arg).toContain("[test/ns]");
      expect(arg).toContain("hello world");
      spy.mockRestore();
    });

    it(`${method}() appends JSON metadata when provided`, async () => {
      const factory = await createSubsystemLogger();
      const spy = vi.spyOn(console, consoleMethod).mockImplementation(() => {});
      const logger = factory("ns");
      logger[method]("msg", { key: "value", count: 42 });
      const arg = spy.mock.calls[0][0] as string;
      expect(arg).toContain('"key":"value"');
      expect(arg).toContain('"count":42');
      spy.mockRestore();
    });

    it(`${method}() has no trailing space when meta is undefined`, async () => {
      const factory = await createSubsystemLogger();
      const spy = vi.spyOn(console, consoleMethod).mockImplementation(() => {});
      const logger = factory("ns");
      logger[method]("msg");
      const arg = spy.mock.calls[0][0] as string;
      expect(arg).toBe(`[${label}] [ns] msg`);
      spy.mockRestore();
    });
  }

  it("returns object with all four methods", async () => {
    const factory = await createSubsystemLogger();
    const logger = factory("ns");
    expect(typeof logger.info).toBe("function");
    expect(typeof logger.warn).toBe("function");
    expect(typeof logger.error).toBe("function");
    expect(typeof logger.debug).toBe("function");
  });
});
