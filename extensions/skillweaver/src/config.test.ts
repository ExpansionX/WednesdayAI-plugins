import { describe, it, expect } from "vitest";
import { resolveConfig, checkSkillsMode, validateConfig, resolveEffectiveDecomposerConfig } from "./config.js";

const defaults = {
  enabled: true,
  decomposer: { provider: "openrouter", model: "qwen/qwen2.5-7b-instruct", temperature: 0.1, maxTokens: 256 },
  embedding: { backend: "local", model: "all-MiniLM-L6-v2", cloudModel: "text-embedding-3-small" },
  retrieval: { topK: 3, hintSize: 15, minQueryLength: 20 },
  sad: { enabled: true, maxIterations: 1 },
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
    expect(() => validateConfig(defaults as never)).not.toThrow();
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
