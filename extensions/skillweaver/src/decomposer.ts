import type { DecompositionResult, HintEntry } from "./embedding/types.js";

export interface DecomposerOptions {
  fetchRaw?: typeof fetch;
  provider: string;
  model: string;
  apiKey?: string | null;
  baseUrl?: string | null;
  temperature?: number;
  maxTokens?: number;
}

export interface DecomposerConfig extends DecomposerOptions {
  fetchRaw: typeof fetch;
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

export function buildSADPass1Prompt(query: string): string {
  return `You are a query decomposition tool. Break the following user query into a list of atomic sub-tasks. Each sub-task should be a single, self-contained action that could be performed by a specific skill.

Query: ${query}

Output ONLY a JSON object with a "subTasks" key containing an array of strings:`;
}

export function buildSADPass2Prompt(query: string, hints: string): string {
  return `You are a query decomposition tool. Break the following user query into a list of atomic sub-tasks. Each sub-task should be mapped to ONE of the available skills listed below. Use the skill names in your sub-task descriptions to maximize retrievability.

Available skills:
${hints}

Query: ${query}

Output ONLY a JSON object with a "subTasks" key containing an array of strings:`;
}

function formatHints(hints: HintEntry[]): string {
  return hints.map((h) => `- ${h.name}: ${h.description}`).join("\n");
}

export function extractJsonArray(text: string): string[] {
  let cleaned = text.trim();
  const codeBlockMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) cleaned = codeBlockMatch[1].trim();

  try {
    const parsed = JSON.parse(cleaned) as Record<string, unknown>;
    if (Array.isArray(parsed.subTasks) && (parsed.subTasks as unknown[]).every((item: unknown): item is string => typeof item === "string")) {
      return parsed.subTasks as string[];
    }
  } catch { /* fall through to array extraction */ }
  // backward-compatible: try raw JSON array
  try {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed) && parsed.every((item): item is string => typeof item === "string")) {
      return parsed;
    }
  } catch { /* fall through to substring extraction */ }
  const arrayMatch = cleaned.match(/\[([\s\S]*)\]/);
  if (arrayMatch) {
    try {
      const reparsed = JSON.parse(`[${arrayMatch[1]}]`);
      if (Array.isArray(reparsed) && reparsed.every((item): item is string => typeof item === "string")) {
        return reparsed;
      }
    } catch { /* fall through */ }
  }
  return [];
}

export class Decomposer {
  private config: DecomposerConfig;
  private disposed = false;

  constructor(opts: DecomposerOptions) {
    this.config = {
      fetchRaw: opts.fetchRaw ?? fetch,
      provider: opts.provider,
      model: opts.model,
      apiKey: opts.apiKey ?? null,
      baseUrl: opts.baseUrl ?? null,
      temperature: opts.temperature ?? 0.1,
      maxTokens: opts.maxTokens ?? 256,
    };
  }

  async decompose(query: string, hints?: HintEntry[], maxSubTasks = 10): Promise<DecompositionResult> {
    if (this.disposed) throw new Error("Decomposer: already disposed");

    try {
      const hasHints = hints && hints.length > 0;
      let prompt = hasHints
        ? buildSADPass2Prompt(query, formatHints(hints))
        : buildSADPass1Prompt(query);
      if (hints && hints.length < 3 && hints.length > 0) {
        prompt += "\n\nIf no skill matches the sub-task, use a clear description that would help a human find the right tool.";
      }

      const endpoint = resolveEndpoint(this.config.provider, this.config.baseUrl);
      const isAnthropic = this.config.provider === "anthropic";
      const isOpenRouter = this.config.provider === "openrouter";

      let body: string;
      const headers: Record<string, string> = { "Content-Type": "application/json" };

      if (isAnthropic) {
        headers["x-api-key"] = this.config.apiKey ?? "";
        headers["anthropic-version"] = "2023-06-01";
        body = JSON.stringify({
          model: this.config.model,
          max_tokens: this.config.maxTokens,
          temperature: this.config.temperature,
          system: "Output ONLY a JSON object with a \"subTasks\" key containing an array of strings. No other text.",
          messages: [{ role: "user", content: prompt }],
        });
      } else {
        headers.Authorization = `Bearer ${this.config.apiKey ?? ""}`;
        if (isOpenRouter) {
          headers["HTTP-Referer"] = "wednesdayai-skillweaver";
        }
        body = JSON.stringify({
          model: this.config.model,
          temperature: this.config.temperature,
          max_tokens: this.config.maxTokens,
          messages: [
            { role: "system", content: "Output ONLY a JSON array of strings. No other text." },
            { role: "user", content: prompt },
          ],
        });
      }

      const response = await this.config.fetchRaw(endpoint, { method: "POST", headers, body });

      if (!response.ok) {
        throw new Error(`Decomposer: request failed ${response.status}`);
      }

      const json = await response.json() as Record<string, unknown>;

      let content: string;
      if (isAnthropic) {
        const contentArr = json.content as Array<{ text: string }>;
        content = contentArr?.[0]?.text ?? "";
      } else {
        const choices = json.choices as Array<{ message: { content: string } }>;
        content = choices?.[0]?.message?.content ?? "";
      }

      let subTasks = extractJsonArray(content);
      if (subTasks.length > maxSubTasks) {
        subTasks = subTasks.slice(0, maxSubTasks);
      }

      return { subTasks, hints: [], pass: hasHints ? 2 : 1 };
    } catch {
      return { subTasks: [], hints: [], pass: 1 };
    }
  }

  dispose(): void {
    this.disposed = true;
  }
}
