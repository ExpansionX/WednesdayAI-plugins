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
    cloudDimensions?: number | null;
    customModel: string;
    customDimensions?: number | null;
    endpoint?: string | null;
    apiKey?: string | null;
  };
  retrieval: {
    topK: number;
    hintSize: number;
    minQueryLength: number;
    retrievalTimeoutMs: number;
  };
  sad: {
    enabled: boolean;
  };
  skills: {
    dirs?: string[];
  };
}

const DEFAULTS = {
  enabled: true,
  decomposer: {
    provider: "openrouter" as const,
    model: "qwen/qwen2.5-7b-instruct",
    temperature: 0.1,
    maxTokens: 256,
  },
  embedding: {
    backend: "local" as const,
    model: "all-MiniLM-L6-v2",
    cloudModel: "text-embedding-3-small",
    cloudDimensions: null,
    customModel: "custom",
    customDimensions: null,
  },
  retrieval: {
    topK: 3,
    hintSize: 15,
    minQueryLength: 20,
    retrievalTimeoutMs: 30000,
  },
  sad: {
    enabled: true,
  },
  skills: {
    dirs: [] as string[],
  },
} as const;

const VALID_BACKENDS = new Set(["local", "cloud", "custom"]);
const VALID_PROVIDERS = new Set(["openrouter", "openai", "anthropic", "openai-compatible"]);

export function resolveConfig(raw: Record<string, unknown>): SkillWeaverConfig {
  const rawObj = (v: unknown): Record<string, unknown> =>
    typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

  const decomposer = { ...DEFAULTS.decomposer, ...rawObj(raw.decomposer) as Partial<SkillWeaverConfig["decomposer"]> };
  const embedding = { ...DEFAULTS.embedding, ...rawObj(raw.embedding) as Partial<SkillWeaverConfig["embedding"]> };
  const retrieval = { ...DEFAULTS.retrieval, ...rawObj(raw.retrieval) as Partial<SkillWeaverConfig["retrieval"]> };
  const sad = { ...DEFAULTS.sad, ...rawObj(raw.sad) as Partial<SkillWeaverConfig["sad"]> };
  const rawSkills = rawObj(raw.skills);
  const rawDirs = rawSkills.dirs;
  const dirs = typeof rawDirs === "string"
    ? [rawDirs]
    : Array.isArray(rawDirs)
      ? rawDirs.filter((d): d is string => typeof d === "string" && d.length > 0)
      : DEFAULTS.skills.dirs;
  const skills = { dirs };

  function toBool(v: unknown, fallback: boolean): boolean {
    if (typeof v === "boolean") return v;
    if (typeof v === "string") {
      const trimmed = v.trim().toLowerCase();
      return trimmed !== "false" && trimmed !== "0" && trimmed !== "";
    }
    if (v === undefined || v === null) return fallback;
    return Boolean(v);
  }

  return {
    ...DEFAULTS,
    enabled: raw.enabled !== undefined ? toBool(raw.enabled, DEFAULTS.enabled) : DEFAULTS.enabled,
    decomposer,
    embedding,
    retrieval,
    sad,
    skills,
  };
}

export function validateConfig(config: SkillWeaverConfig): void {
  if (!VALID_PROVIDERS.has(config.decomposer.provider)) {
    throw new Error(`Invalid decomposer provider: ${config.decomposer.provider}`);
  }
  if (!VALID_BACKENDS.has(config.embedding.backend)) {
    throw new Error(`Invalid embedding backend: ${config.embedding.backend}`);
  }
  const numericFields: Array<[string, number, number, number, boolean]> = [
    ["topK", config.retrieval.topK, 1, 10, true],
    ["hintSize", config.retrieval.hintSize, 5, 50, true],
    ["minQueryLength", config.retrieval.minQueryLength, 5, 500, true],
    ["temperature", config.decomposer.temperature, 0, 2, false],
    ["maxTokens", config.decomposer.maxTokens, 50, 1024, true],
    ["retrievalTimeoutMs", config.retrieval.retrievalTimeoutMs, 1000, 300000, true],
  ];
  for (const [name, value, min, max, isInt] of numericFields) {
    if (!Number.isFinite(value)) {
      throw new Error(`${name} must be a finite number, got ${value}`);
    }
    if (isInt && !Number.isInteger(value)) {
      throw new Error(`${name} must be an integer, got ${value}`);
    }
    if (value < min || value > max) {
      throw new Error(`${name} must be ${min}-${max}, got ${value}`);
    }
  }
  if (config.embedding.backend === "custom" && !config.embedding.endpoint) {
    throw new Error("embedding.endpoint is required when backend is 'custom'");
  }
  if (config.decomposer.provider === "openai-compatible" && !config.decomposer.baseUrl) {
    throw new Error("decomposer.baseUrl is required when provider is 'openai-compatible'");
  }
  if (!config.decomposer.model || config.decomposer.model.trim() === "") {
    throw new Error("decomposer.model must be a non-empty string");
  }
  if (config.embedding.backend === "local" && (!config.embedding.model || config.embedding.model.trim() === "")) {
    throw new Error("embedding.model must be a non-empty string when backend is 'local'");
  }
  if (config.embedding.backend === "cloud" && (!config.embedding.cloudModel || config.embedding.cloudModel.trim() === "")) {
    throw new Error("embedding.cloudModel must be a non-empty string when backend is 'cloud'");
  }
  if (config.embedding.backend === "cloud" && config.embedding.cloudDimensions != null) {
    if (!Number.isFinite(config.embedding.cloudDimensions) || !Number.isInteger(config.embedding.cloudDimensions)) {
      throw new Error("embedding.cloudDimensions must be a finite integer");
    }
    if (config.embedding.cloudDimensions < 1 || config.embedding.cloudDimensions > 4096) {
      throw new Error(`embedding.cloudDimensions must be 1-4096, got ${config.embedding.cloudDimensions}`);
    }
  }
  if (config.embedding.backend === "custom" && config.embedding.customDimensions != null) {
    if (!Number.isFinite(config.embedding.customDimensions) || !Number.isInteger(config.embedding.customDimensions)) {
      throw new Error("embedding.customDimensions must be a finite integer");
    }
    if (config.embedding.customDimensions < 1 || config.embedding.customDimensions > 4096) {
      throw new Error(`embedding.customDimensions must be 1-4096, got ${config.embedding.customDimensions}`);
    }
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
