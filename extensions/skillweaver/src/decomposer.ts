import type { DecompositionResult, HintEntry } from "./embedding/types.js";
import { createSubsystemLogger } from "./logger.js";

const log = createSubsystemLogger("skillweaver/decomposer");

const MAX_LENGTH = 50000;

export interface DecompositionError {
  type: "network" | "auth" | "rate_limit" | "parse" | "timeout" | "unknown";
  message: string;
  statusCode?: number;
}

export interface DecompositionResultWithError extends DecompositionResult {
  errors?: DecompositionError[];
}

/**
 * Minimal shape of core's plugin analysis runtime (api.runtime.analysis).
 * Routes LLM calls through the gateway's own model layer and credentials, so
 * plugins need no API keys of their own. Source of truth:
 * WednesdayAI-core src/plugins/runtime/types-analysis.ts
 */
export interface AnalysisRunner {
  run(params: {
    purpose: string;
    input: string;
    systemPrompt?: string;
    model?: string;
    sessionKey?: string;
    timeoutMs?: number;
    responseFormat?: "text" | "json";
    maxOutputTokens?: number;
    temperature?: number;
  }): Promise<{
    status: "ok" | "empty" | "timeout" | "error" | "rejected";
    text?: string;
    json?: unknown;
    error?: string;
    model?: string;
  }>;
}

export interface DecomposerOptions {
  fetchRaw?: typeof fetch;
  provider: string;
  /** For provider "gateway": an optional "<provider>/<model>" or bare model ref
   * resolved by core; null/undefined uses the session default model. Required
   * for all other providers. */
  model?: string | null;
  /** Required for provider "gateway"; unused otherwise. */
  analysis?: AnalysisRunner | null;
  apiKey?: string | null;
  baseUrl?: string | null;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
}

export interface DecomposerConfig extends DecomposerOptions {
  fetchRaw: typeof fetch;
}

export function envApiKey(provider: string): string | null {
  switch (provider) {
    case "openrouter": return process.env.OPENROUTER_API_KEY ?? null;
    case "openai": return process.env.OPENAI_API_KEY ?? null;
    case "anthropic": return process.env.ANTHROPIC_API_KEY ?? null;
    default: return null;
  }
}

function resolveEndpoint(provider: string, baseUrl?: string | null): string {
  if (baseUrl) return baseUrl;
  switch (provider) {
    case "openai": return "https://api.openai.com/v1/chat/completions";
    case "anthropic": return "https://api.anthropic.com/v1/messages";
    case "openai-compatible": throw new Error("openai-compatible requires baseUrl");
    default: return "https://openrouter.ai/api/v1/chat/completions";
  }
}

function sanitizeQueryForPrompt(query: string): string {
  return query
    .replace(/<\/user_query>/g, "")
    .replace(/<user_query>/g, "");
}

export function buildSADPass1Prompt(query: string): string {
  return `You are a query decomposition tool. Break the following user query into a list of atomic sub-tasks. Each sub-task should be a single, self-contained action that could be performed by a specific skill.

<user_query>
${sanitizeQueryForPrompt(query)}
</user_query>

Output ONLY a JSON object with a "subTasks" key containing an array of strings:`;
}

export function buildSADPass2Prompt(query: string, hints: string): string {
  return `You are a query decomposition tool. Break the following user query into a list of atomic sub-tasks. Each sub-task should be mapped to ONE of the available skills listed below. Use the skill names in your sub-task descriptions to maximize retrievability.

Available skills:
${hints}

<user_query>
${sanitizeQueryForPrompt(query)}
</user_query>

Output ONLY a JSON object with a "subTasks" key containing an array of strings:`;
}

function formatHints(hints: HintEntry[]): string {
  const sanitized = hints
    .map((h) => {
      const name = h.name.replace(/[#*_[\]`<>\\]/g, "").replace(/\n+/g, " ").slice(0, 100);
      const desc = h.description.replace(/[#*_[\]`<>\\]/g, "").replace(/\n+/g, " ").slice(0, 200);
      if (!name) return null;
      return `- ${name}: ${desc || name}`;
    })
    .filter((s): s is string => s !== null);
  return `<available_skills>\n${sanitized.join("\n")}\n</available_skills>`;
}

function classifyError(err: unknown, statusCode?: number): DecompositionError {
  const message = err instanceof Error ? err.message : String(err);
  if (statusCode === 401 || statusCode === 403) return { type: "auth", message, statusCode };
  if (statusCode === 429) return { type: "rate_limit", message, statusCode };
  if (err instanceof DOMException && err.name === "AbortError") return { type: "timeout", message: "request timed out" };
  if (err instanceof TypeError && (err.message.includes("fetch") || err.message.includes("network") || err.message.includes("terminated") || err.message.includes("ECONNREFUSED") || err.message.includes("ECONNRESET") || err.message.includes("ETIMEDOUT"))) return { type: "network", message };
  return { type: "unknown", message };
}

export function extractJsonArray(text: string): string[] {
  let cleaned = text.trim();
  const codeBlockMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) cleaned = codeBlockMatch[1].trim();

  if (cleaned.length > MAX_LENGTH) cleaned = cleaned.slice(0, MAX_LENGTH);

  try {
    const parsed = JSON.parse(cleaned) as Record<string, unknown>;
    if (Array.isArray(parsed.subTasks) && (parsed.subTasks as unknown[]).every((item: unknown): item is string => typeof item === "string")) {
      return parsed.subTasks as string[];
    }
  } catch { /* fall through to array extraction */ }
  try {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed) && parsed.every((item): item is string => typeof item === "string")) {
      return parsed;
    }
  } catch { /* fall through to substring extraction */ }
  const allMatches = [...cleaned.matchAll(/\[((?:[^[\]]|\[[^\]]*\])*)\]/g)].slice(-50);
  for (let i = allMatches.length - 1; i >= 0; i--) {
    try {
      const reparsed = JSON.parse(`[${allMatches[i][1]}]`);
      if (Array.isArray(reparsed) && reparsed.every((item): item is string => typeof item === "string")) {
        return reparsed;
      }
    } catch { /* try next */ }
  }
  return [];
}

export class Decomposer {
  private config: DecomposerConfig;
  private disposed = false;

  constructor(opts: DecomposerOptions) {
    if (opts.provider === "gateway" && !opts.analysis) {
      throw new Error("Decomposer: provider \"gateway\" requires an analysis runtime");
    }
    if (opts.provider !== "gateway" && (!opts.model || opts.model.trim() === "")) {
      throw new Error(`Decomposer: model is required for provider "${opts.provider}"`);
    }
    this.config = {
      fetchRaw: opts.fetchRaw ?? fetch,
      provider: opts.provider,
      model: opts.model ?? null,
      analysis: opts.analysis ?? null,
      apiKey: opts.apiKey ?? null,
      baseUrl: opts.baseUrl ?? null,
      temperature: opts.temperature ?? 0.1,
      maxTokens: opts.maxTokens ?? 256,
      timeoutMs: opts.timeoutMs ?? 30000,
    };
  }

  async decompose(query: string, hints?: HintEntry[], maxSubTasks = 10, signal?: AbortSignal, sessionKey?: string): Promise<DecompositionResultWithError> {
    if (this.disposed) throw new Error("Decomposer: already disposed");

    const hasHints = hints && hints.length > 0;
    try {
      let prompt = hasHints
        ? buildSADPass2Prompt(query, formatHints(hints))
        : buildSADPass1Prompt(query);
      if (hasHints && hints.length < 3) {
        prompt += "\n\nIf no skill matches the sub-task, use a clear description that would help a human find the right tool.";
      }

      if (this.config.provider === "gateway") {
        return await this.decomposeViaGateway(prompt, hasHints ? 2 : 1, maxSubTasks, sessionKey);
      }

      const endpoint = resolveEndpoint(this.config.provider, this.config.baseUrl);
      const isAnthropic = this.config.provider === "anthropic";
      const isOpenRouter = this.config.provider === "openrouter";

      let body: string;
      const headers: Record<string, string> = { "Content-Type": "application/json" };

      if (isAnthropic) {
        if (this.config.apiKey) headers["x-api-key"] = this.config.apiKey;
        headers["anthropic-version"] = "2023-06-01";
        body = JSON.stringify({
          model: this.config.model,
          max_tokens: this.config.maxTokens,
          temperature: this.config.temperature,
          system: "Output ONLY a JSON object with a \"subTasks\" key containing an array of strings. No other text.",
          messages: [{ role: "user", content: prompt }],
        });
      } else {
        if (this.config.apiKey) headers.Authorization = `Bearer ${this.config.apiKey}`;
        if (isOpenRouter) {
          headers["HTTP-Referer"] = "https://github.com/ExpansionX/WednesdayAI-plugins";
        }
        body = JSON.stringify({
          model: this.config.model,
          temperature: this.config.temperature,
          max_tokens: this.config.maxTokens,
          messages: [
            { role: "system", content: "Output ONLY a JSON object with a \"subTasks\" key containing an array of strings. No other text." },
            { role: "user", content: prompt },
          ],
        });
      }

      const response = await this.config.fetchRaw(endpoint, { method: "POST", headers, body, ...(signal ? { signal } : {}) });

      if (!response.ok) {
        const errBody = await response.text().catch(() => "");
        const statusCode = response.status;
        const error = classifyError(new Error(`Decomposer: request failed ${statusCode}: ${errBody}`), statusCode);
        log.warn("decompose failed", { error: error.message, provider: this.config.provider });
        return { subTasks: [], pass: hasHints ? 2 : 1, errors: [error] };
      }

      const json = await response.json() as Record<string, unknown>;

      let content: string;
      if (isAnthropic) {
        const contentArr = json.content;
        if (!Array.isArray(contentArr) || contentArr.length === 0) {
          return { subTasks: [], pass: hasHints ? 2 : 1, errors: [{ type: "parse", message: "Anthropic response missing content array" }] };
        }
        const firstBlock = contentArr[0] as { text?: string; type?: string };
        if (firstBlock?.type && firstBlock.type !== "text") {
          return { subTasks: [], pass: hasHints ? 2 : 1, errors: [{ type: "parse", message: `Anthropic response returned non-text block: ${firstBlock.type}` }] };
        }
        content = firstBlock?.text ?? "";
      } else {
        const choices = json.choices;
        if (!Array.isArray(choices) || choices.length === 0) {
          return { subTasks: [], pass: hasHints ? 2 : 1, errors: [{ type: "parse", message: "LLM response missing choices array" }] };
        }
        content = ((choices[0] as { message?: { content?: string } })?.message?.content) ?? "";
      }

      let subTasks = extractJsonArray(content);
      if (subTasks.length > maxSubTasks) {
        subTasks = subTasks.slice(0, maxSubTasks);
      }

      const errors: DecompositionError[] = [];
      if (subTasks.length === 0 && content.length > 0) {
        errors.push({ type: "parse", message: "failed to extract sub-tasks from LLM response" });
      }

      return { subTasks, pass: hasHints ? 2 : 1, ...(errors.length > 0 ? { errors } : {}) };
    } catch (err) {
      const error = classifyError(err);
      log.warn("decompose failed", { error: error.message, provider: this.config.provider });
      return { subTasks: [], pass: hasHints ? 2 : 1, errors: [error] };
    }
  }

  private async decomposeViaGateway(prompt: string, pass: 1 | 2, maxSubTasks: number, sessionKey?: string): Promise<DecompositionResultWithError> {
    const analysis = this.config.analysis;
    if (!analysis) {
      return { subTasks: [], pass, errors: [{ type: "unknown", message: "gateway provider has no analysis runtime" }] };
    }

    const result = await analysis.run({
      purpose: "skillweaver.decompose",
      input: prompt,
      systemPrompt: "Output ONLY a JSON object with a \"subTasks\" key containing an array of strings. No other text.",
      responseFormat: "json",
      ...(this.config.model ? { model: this.config.model } : {}),
      ...(sessionKey ? { sessionKey } : {}),
      timeoutMs: this.config.timeoutMs,
      maxOutputTokens: this.config.maxTokens,
      temperature: this.config.temperature,
    });

    if (result.status !== "ok") {
      const type: DecompositionError["type"] = result.status === "timeout" ? "timeout" : result.status === "empty" ? "parse" : "unknown";
      const error: DecompositionError = { type, message: result.error ?? `analysis ${result.status}` };
      log.warn("decompose failed", { error: error.message, status: result.status, provider: "gateway" });
      return { subTasks: [], pass, errors: [error] };
    }

    let subTasks: string[];
    const json = result.json as Record<string, unknown> | undefined;
    if (json && Array.isArray(json.subTasks) && (json.subTasks as unknown[]).every((s): s is string => typeof s === "string")) {
      subTasks = json.subTasks as string[];
    } else {
      subTasks = extractJsonArray(result.text ?? (result.json !== undefined ? JSON.stringify(result.json) : ""));
    }
    if (subTasks.length > maxSubTasks) subTasks = subTasks.slice(0, maxSubTasks);

    const errors: DecompositionError[] = [];
    if (subTasks.length === 0 && (result.text || result.json !== undefined)) {
      errors.push({ type: "parse", message: "failed to extract sub-tasks from analysis response" });
    }
    return { subTasks, pass, ...(errors.length > 0 ? { errors } : {}) };
  }

  dispose(): void {
    this.disposed = true;
  }
}
