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
    endpoint?: string | null;
    apiKey?: string | null;
  };
  retrieval: {
    topK: number;
    hintSize: number;
    minQueryLength: number;
  };
  sad: {
    enabled: boolean;
    maxIterations: number;
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
  },
  retrieval: {
    topK: 3,
    hintSize: 15,
    minQueryLength: 20,
  },
  sad: {
    enabled: true,
    maxIterations: 1,
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
    if (typeof v === "string") return v !== "false" && v !== "0" && v !== "";
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

export interface EffectiveDecomposerConfig {
  provider: string;
  model: string;
  apiKey?: string | null;
  baseUrl?: string | null;
  temperature: number;
  maxTokens: number;
}

export function resolveEffectiveDecomposerConfig(
  cfg: SkillWeaverConfig,
  agentDefaults?: { provider?: string; model?: string },
): EffectiveDecomposerConfig {
  const provider = agentDefaults?.provider || cfg.decomposer.provider || "openrouter";
  const model = agentDefaults?.model || cfg.decomposer.model || "qwen/qwen2.5-7b-instruct";
  return {
    provider,
    model,
    apiKey: cfg.decomposer.apiKey ?? null,
    baseUrl: cfg.decomposer.baseUrl ?? null,
    temperature: cfg.decomposer.temperature,
    maxTokens: cfg.decomposer.maxTokens,
  };
}
