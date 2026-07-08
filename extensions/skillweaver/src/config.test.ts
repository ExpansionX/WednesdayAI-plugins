import { describe, it, expect } from "vitest";
import { resolveConfig, checkSkillsMode, validateConfig } from "./config.js";

const defaults = {
  enabled: true,
  decomposer: { provider: "openrouter", model: "qwen/qwen2.5-7b-instruct", temperature: 0.1, maxTokens: 256 },
  embedding: { backend: "local", model: "all-MiniLM-L6-v2", cloudModel: "text-embedding-3-small", cloudDimensions: null, customModel: "custom", customDimensions: null },
  retrieval: { topK: 3, hintSize: 15, minQueryLength: 20, retrievalTimeoutMs: 30000 },
  sad: { enabled: true },
  skills: { dirs: [] },
} as const;

describe("resolveConfig", () => {
  it("fills defaults for empty input", () => {
    expect(resolveConfig({})).toEqual(defaults);
  });

  it("merges partial overrides", () => {
    const result = resolveConfig({ retrieval: { topK: 5 } });
    expect(result.retrieval.topK).toBe(5);
    expect(result.retrieval.hintSize).toBe(15);
  });

  it("preserves decomposer overrides", () => {
    const result = resolveConfig({ decomposer: { model: "gpt-4o-mini", provider: "openai", temperature: 0.2, maxTokens: 128 } });
    expect(result.decomposer.model).toBe("gpt-4o-mini");
    expect(result.decomposer.temperature).toBe(0.2);
  });

  it("handles enabled: false", () => {
    const result = resolveConfig({ enabled: false });
    expect(result.enabled).toBe(false);
  });

  it("handles enabled: 'false' string", () => {
    const result = resolveConfig({ enabled: "false" });
    expect(result.enabled).toBe(false);
  });

  it("handles enabled: '0' string", () => {
    const result = resolveConfig({ enabled: "0" });
    expect(result.enabled).toBe(false);
  });

  it("handles enabled: 'False' (case-insensitive)", () => {
    const result = resolveConfig({ enabled: "False" });
    expect(result.enabled).toBe(false);
  });

  it("handles enabled: '  ' whitespace-only string", () => {
    const result = resolveConfig({ enabled: "  " });
    expect(result.enabled).toBe(false);
  });

  it("handles enabled: true boolean", () => {
    const result = resolveConfig({ enabled: true });
    expect(result.enabled).toBe(true);
  });

  it("handles enabled: 'true' string", () => {
    const result = resolveConfig({ enabled: "true" });
    expect(result.enabled).toBe(true);
  });

  it("handles enabled: null (uses default)", () => {
    const result = resolveConfig({ enabled: null });
    expect(result.enabled).toBe(true);
  });

  it("handles skills.dirs as string (coerced to array)", () => {
    const result = resolveConfig({ skills: { dirs: "/path/to/skills" } });
    expect(result.skills.dirs).toEqual(["/path/to/skills"]);
  });

  it("handles skills.dirs as array", () => {
    const result = resolveConfig({ skills: { dirs: ["/a", "/b"] } });
    expect(result.skills.dirs).toEqual(["/a", "/b"]);
  });

  it("filters non-string skills.dirs entries", () => {
    const result = resolveConfig({ skills: { dirs: ["/a", 123, "", "/b"] } });
    expect(result.skills.dirs).toEqual(["/a", "/b"]);
  });

  it("handles non-object decomposer gracefully", () => {
    const result = resolveConfig({ decomposer: "invalid" });
    expect(result.decomposer.provider).toBe("openrouter");
  });

  it("handles non-object embedding gracefully", () => {
    const result = resolveConfig({ embedding: [1, 2, 3] });
    expect(result.embedding.backend).toBe("local");
  });
});

describe("validateConfig", () => {
  it("rejects invalid backend", () => {
    const config = resolveConfig({ embedding: { backend: "invalid" } });
    expect(() => validateConfig(config)).toThrow(/backend/);
  });

  it("rejects invalid decomposer provider", () => {
    const config = resolveConfig({ decomposer: { provider: "gemini" } });
    expect(() => validateConfig(config)).toThrow(/provider/);
  });

  it("accepts valid config", () => {
    expect(() => validateConfig(defaults as never)).not.toThrow();
  });

  it("rejects custom backend without endpoint", () => {
    const config = resolveConfig({ embedding: { backend: "custom" } });
    expect(() => validateConfig(config)).toThrow(/endpoint/);
  });

  it("rejects openai-compatible without baseUrl", () => {
    const config = resolveConfig({ decomposer: { provider: "openai-compatible" } });
    expect(() => validateConfig(config)).toThrow(/baseUrl/);
  });

  it("rejects NaN for topK", () => {
    const config = resolveConfig({ retrieval: { topK: NaN } });
    expect(() => validateConfig(config)).toThrow(/finite/);
  });

  it("rejects float for topK", () => {
    const config = resolveConfig({ retrieval: { topK: 3.5 } });
    expect(() => validateConfig(config)).toThrow(/integer/);
  });

  it("rejects float for maxTokens", () => {
    const config = resolveConfig({ decomposer: { maxTokens: 256.5 } });
    expect(() => validateConfig(config)).toThrow(/integer/);
  });

  it("rejects out-of-range temperature", () => {
    const config = resolveConfig({ decomposer: { temperature: 3 } });
    expect(() => validateConfig(config)).toThrow(/temperature/);
  });

  it("rejects out-of-range topK", () => {
    const config = resolveConfig({ retrieval: { topK: 0 } });
    expect(() => validateConfig(config)).toThrow(/topK/);
  });

  it("rejects out-of-range hintSize", () => {
    const config = resolveConfig({ retrieval: { hintSize: 100 } });
    expect(() => validateConfig(config)).toThrow(/hintSize/);
  });

  it("rejects out-of-range minQueryLength", () => {
    const config = resolveConfig({ retrieval: { minQueryLength: 1 } });
    expect(() => validateConfig(config)).toThrow(/minQueryLength/);
  });

  it("rejects out-of-range maxTokens", () => {
    const config = resolveConfig({ decomposer: { maxTokens: 2000 } });
    expect(() => validateConfig(config)).toThrow(/maxTokens/);
  });

  it("rejects out-of-range retrievalTimeoutMs", () => {
    const config = resolveConfig({ retrieval: { retrievalTimeoutMs: 50 } });
    expect(() => validateConfig(config)).toThrow(/retrievalTimeoutMs/);
  });

  it("rejects non-integer cloudDimensions", () => {
    const config = resolveConfig({ embedding: { backend: "cloud", cloudModel: "text-embedding-3-small", cloudDimensions: 128.5 } });
    expect(() => validateConfig(config)).toThrow(/cloudDimensions/);
  });

  it("rejects out-of-range cloudDimensions", () => {
    const config = resolveConfig({ embedding: { backend: "cloud", cloudModel: "text-embedding-3-small", cloudDimensions: 9999 } });
    expect(() => validateConfig(config)).toThrow(/cloudDimensions/);
  });

  it("accepts valid cloudDimensions", () => {
    const config = resolveConfig({ embedding: { backend: "cloud", cloudModel: "text-embedding-3-large", cloudDimensions: 3072 } });
    expect(() => validateConfig(config)).not.toThrow();
  });

  it("rejects empty decomposer.model", () => {
    const config = resolveConfig({ decomposer: { model: "" } });
    expect(() => validateConfig(config)).toThrow(/decomposer\.model/);
  });

  it("rejects whitespace-only decomposer.model", () => {
    const config = resolveConfig({ decomposer: { model: "   " } });
    expect(() => validateConfig(config)).toThrow(/decomposer\.model/);
  });

  it("rejects empty embedding.model for local backend", () => {
    const config = resolveConfig({ embedding: { model: "" } });
    expect(() => validateConfig(config)).toThrow(/embedding\.model/);
  });

  it("rejects empty embedding.cloudModel for cloud backend", () => {
    const config = resolveConfig({ embedding: { backend: "cloud", cloudModel: "" } });
    expect(() => validateConfig(config)).toThrow(/embedding\.cloudModel/);
  });

  it("rejects non-integer customDimensions", () => {
    const config = resolveConfig({ embedding: { backend: "custom", endpoint: "http://x", customDimensions: 128.5 } });
    expect(() => validateConfig(config)).toThrow(/customDimensions/);
  });

  it("rejects out-of-range customDimensions", () => {
    const config = resolveConfig({ embedding: { backend: "custom", endpoint: "http://x", customDimensions: 9999 } });
    expect(() => validateConfig(config)).toThrow(/customDimensions/);
  });

  it("accepts valid customDimensions", () => {
    const config = resolveConfig({ embedding: { backend: "custom", endpoint: "http://x", customDimensions: 768 } });
    expect(() => validateConfig(config)).not.toThrow();
  });

  it("accepts null cloudDimensions (uses default)", () => {
    const config = resolveConfig({ embedding: { backend: "cloud", cloudModel: "text-embedding-3-small" } });
    expect(() => validateConfig(config)).not.toThrow();
    expect(config.embedding.cloudDimensions).toBeNull();
  });

  it("accepts null customDimensions (uses default)", () => {
    const config = resolveConfig({ embedding: { backend: "custom", endpoint: "http://x" } });
    expect(() => validateConfig(config)).not.toThrow();
    expect(config.embedding.customDimensions).toBeNull();
  });

  it("merges customModel from config", () => {
    const config = resolveConfig({ embedding: { backend: "custom", customModel: "bge-small" } });
    expect(config.embedding.customModel).toBe("bge-small");
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
    const result = checkSkillsMode({ agents: { defaults: { systemPrompt: { sections: { skills: "compact" } } } } });
    expect(result).toBe("compact");
  });

  it("returns 'default' for unrecognized mode string", () => {
    const result = checkSkillsMode({ agents: { defaults: { systemPrompt: { sections: { skills: "custom" } } } } });
    expect(result).toBe("default");
  });

  it("returns 'default' for undefined config", () => {
    expect(checkSkillsMode(undefined)).toBe("default");
  });

  it("returns 'default' for empty agents object", () => {
    expect(checkSkillsMode({ agents: {} })).toBe("default");
  });

  it("returns 'default' for missing sections", () => {
    expect(checkSkillsMode({ agents: { defaults: { systemPrompt: {} } } })).toBe("default");
  });
});
