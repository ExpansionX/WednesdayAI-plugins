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
  const decomposer = { ...DEFAULTS.decomposer, ...(raw.decomposer as Partial<SkillWeaverConfig["decomposer"]> ?? {}) };
  const embedding = { ...DEFAULTS.embedding, ...(raw.embedding as Partial<SkillWeaverConfig["embedding"]> ?? {}) };
  const retrieval = { ...DEFAULTS.retrieval, ...(raw.retrieval as Partial<SkillWeaverConfig["retrieval"]> ?? {}) };
  const sad = { ...DEFAULTS.sad, ...(raw.sad as Partial<SkillWeaverConfig["sad"]> ?? {}) };
  return {
    ...DEFAULTS,
    enabled: raw.enabled !== undefined ? Boolean(raw.enabled) : DEFAULTS.enabled,
    decomposer,
    embedding,
    retrieval,
    sad,
  };
}

export function validateConfig(config: SkillWeaverConfig): void {
  if (config.decomposer && !VALID_PROVIDERS.has(config.decomposer.provider)) {
    throw new Error(`Invalid decomposer provider: ${config.decomposer.provider}`);
  }
  if (config.embedding && !VALID_BACKENDS.has(config.embedding.backend)) {
    throw new Error(`Invalid embedding backend: ${config.embedding.backend}`);
  }
  if (config.retrieval && (config.retrieval.topK < 1 || config.retrieval.topK > 10)) {
    throw new Error(`topK must be 1-10, got ${config.retrieval.topK}`);
  }
  if (config.sad && (config.sad.maxIterations < 1 || config.sad.maxIterations > 5)) {
    throw new Error(`maxIterations must be 1-5, got ${config.sad.maxIterations}`);
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
