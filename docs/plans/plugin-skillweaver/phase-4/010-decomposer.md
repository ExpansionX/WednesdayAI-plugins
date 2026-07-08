---
id: "010"
phase: 4
title: Create Decomposer — SAD pipeline with LLM call, prompt templates, response parsing
status: ready
depends_on: ["002", "004"]
parallel: false
conflicts_with: []
files:
  - extensions/skillweaver/src/decomposer.ts
  - extensions/skillweaver/src/decomposer.test.ts
irreversible: false
scope_test: "extensions/skillweaver/src/decomposer.test.ts"
allowed_change: create
covers_criteria: [SC2, SC7]
---
## Failing test (write first)

Create `extensions/skillweaver/src/decomposer.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import type { HintEntry } from "./embedding/types.js";

const buildSADPass1Prompt = (query: string) => `PASS 1: ${query}`;
const buildSADPass2Prompt = (query: string, hints: string) => `PASS 2: ${query} — hints: ${hints}`;
const mockFetchRaw = vi.fn();

let Decomposer: { new (...args: unknown[]): { decompose: Function; dispose: Function } };

describe("Decomposer", () => {
  beforeAll(async () => {
    vi.doMock("./decomposer.js", async () => {
      const actual = await vi.importActual<typeof import("./decomposer.js")>("./decomposer.js");
      return {
        ...actual,
        buildSADPass1Prompt,
        buildSADPass2Prompt,
      };
    });
    const mod = await import("./decomposer.js");
    Decomposer = mod.Decomposer;
  });

  describe("decompose() — Pass 1 (no hints)", () => {
    it("decomposes a query into sub-tasks", async () => {
      const decomposer = new Decomposer({
        fetchRaw: mockFetchRaw,
        provider: "openrouter",
        model: "qwen/qwen2.5-7b-instruct",
        apiKey: "sk-test",
      });

      mockFetchRaw.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '["download CSV from URL", "run statistical analysis"]' } }],
        }),
      });

      const result = await decomposer.decompose("download this dataset and analyze it");
      expect(result.subTasks).toEqual(["download CSV from URL", "run statistical analysis"]);
      expect(result.pass).toBe(1);
    });

    it("returns empty subTasks for malformed JSON response", async () => {
      mockFetchRaw.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: "not json }" } }],
        }),
      });

      const decomposer = new Decomposer({
        fetchRaw: mockFetchRaw,
        provider: "openrouter",
        model: "test",
        apiKey: "sk-test",
      });

      const result = await decomposer.decompose("query");
      expect(result.subTasks).toEqual([]);
    });

    it("extracts JSON array from markdown-wrapped response", async () => {
      mockFetchRaw.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '```json\n["task one", "task two"]\n```' } }],
        }),
      });

      const decomposer = new Decomposer({
        fetchRaw: mockFetchRaw,
        provider: "openrouter",
        model: "test",
        apiKey: "sk-test",
      });

      const result = await decomposer.decompose("query");
      expect(result.subTasks).toEqual(["task one", "task two"]);
    });

    it("caps sub-tasks at maxSubTasks (default 10)", async () => {
      const tooMany = JSON.stringify(Array.from({ length: 20 }, (_, i) => `task ${i}`));
      mockFetchRaw.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ choices: [{ message: { content: tooMany } }] }),
      });

      const decomposer = new Decomposer({
        fetchRaw: mockFetchRaw,
        provider: "openrouter",
        model: "test",
        apiKey: "sk-test",
      });

      const result = await decomposer.decompose("query", [], 10);
      expect(result.subTasks.length).toBeLessThanOrEqual(10);
    });
  });

  describe("decompose() — Pass 2 (with hints)", () => {
    it("includes hints in the Pass-2 prompt", async () => {
      const decomposer = new Decomposer({
        fetchRaw: mockFetchRaw,
        provider: "openrouter",
        model: "test",
        apiKey: "sk-test",
      });

      mockFetchRaw.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '["fetch data with github", "analyze with slack"]' } }],
        }),
      });

      const hints: HintEntry[] = [
        { name: "github", description: "Git operations" },
        { name: "slack", description: "Slack messaging" },
      ];

      const result = await decomposer.decompose("query", hints);
      expect(result.subTasks.length).toBeGreaterThan(0);
      expect(mockFetchRaw).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining("github"),
        }),
      );
    });

    it("marks pass as 2 when hints provided", async () => {
      mockFetchRaw.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '["task"]' } }],
        }),
      });

      const decomposer = new Decomposer({
        fetchRaw: mockFetchRaw,
        provider: "test",
        model: "test",
        apiKey: "sk-test",
      });

      const result = await decomposer.decompose("query", [{ name: "github", description: "Git" }]);
      expect(result.pass).toBe(2);
    });
  });

  describe("error handling", () => {
    it("returns empty result on fetch failure", async () => {
      mockFetchRaw.mockRejectedValueOnce(new Error("network error"));

      const decomposer = new Decomposer({
        fetchRaw: mockFetchRaw,
        provider: "test",
        model: "test",
        apiKey: "sk-test",
      });

      const result = await decomposer.decompose("query");
      expect(result.subTasks).toEqual([]);
    });
  });
});
```

## Change

**File:** `extensions/skillweaver/src/decomposer.ts`
**Anchor:** new file — create at this path
**Before:** file does not exist
**After:**
```ts
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

function buildSADPass1Prompt(query: string): string {
  return `You are a query decomposition tool. Break the following user query into a list of atomic sub-tasks. Each sub-task should be a single, self-contained action that could be performed by a specific skill.

Query: ${query}

Output ONLY a JSON object with a "subTasks" key containing an array of strings:`;
}

function buildSADPass2Prompt(query: string, hints: string): string {
  return `You are a query decomposition tool. Break the following user query into a list of atomic sub-tasks. Each sub-task should be mapped to ONE of the available skills listed below. Use the skill names in your sub-task descriptions to maximize retrievability.

Available skills:
${hints}

Query: ${query}

Output ONLY a JSON object with a "subTasks" key containing an array of strings:`;
}

function formatHints(hints: HintEntry[]): string {
  return hints.map((h) => `- ${h.name}: ${h.description}`).join("\n");
}

function extractJsonArray(text: string): string[] {
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
      let headers: Record<string, string> = { "Content-Type": "application/json" };

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
    } catch (err) {
      return { subTasks: [], hints: [], pass: 1 };
    }
  }

  dispose(): void {
    this.disposed = true;
  }
}
```

## Allowed moves

Create exactly `extensions/skillweaver/src/decomposer.ts` and its test. No other files.

## STOP triggers

- `decompose()` throws an uncaught exception (must catch and return empty)
- Any hardcoded API keys or URLs that aren't configurable
- `extractJsonArray` can't handle `["single entry"]` (basic array)
- API key included in error messages or logs

## Done when

`WAI_TYPECHECK_CMD="cd extensions/skillweaver && pnpm exec tsc --noEmit" WAI_TEST_CMD="cd extensions/skillweaver && npx vitest run src/decomposer.test.ts" bash ~/.claude/wai/scripts/task-gate.sh plugin-skillweaver 010` exits 0