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
  const dirs = Array.isArray(rawDirs) ? rawDirs.filter((d): d is string => typeof d === "string" && d.length > 0) : DEFAULTS.skills.dirs;
  const skills = { dirs };
  return {
    ...DEFAULTS,
    enabled: raw.enabled !== undefined ? Boolean(raw.enabled) : DEFAULTS.enabled,
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
  if (config.retrieval.topK < 1 || config.retrieval.topK > 10) {
    throw new Error(`topK must be 1-10, got ${config.retrieval.topK}`);
  }
  if (config.retrieval.hintSize < 5 || config.retrieval.hintSize > 50) {
    throw new Error(`hintSize must be 5-50, got ${config.retrieval.hintSize}`);
  }
  if (config.retrieval.minQueryLength < 5 || config.retrieval.minQueryLength > 500) {
    throw new Error(`minQueryLength must be 5-500, got ${config.retrieval.minQueryLength}`);
  }
  if (config.embedding.backend === "custom" && !config.embedding.endpoint) {
    throw new Error("embedding.endpoint is required when backend is 'custom'");
  }
  if (config.decomposer.temperature < 0 || config.decomposer.temperature > 2) {
    throw new Error(`temperature must be 0-2, got ${config.decomposer.temperature}`);
  }
  if (config.decomposer.maxTokens < 50 || config.decomposer.maxTokens > 1024) {
    throw new Error(`maxTokens must be 50-1024, got ${config.decomposer.maxTokens}`);
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
