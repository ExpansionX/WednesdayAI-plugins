import type { EmbeddingBackend } from "./types.js";
import { createSubsystemLogger } from "../logger.js";

const log = createSubsystemLogger("skillweaver/cloud");

const DEFAULT_MODEL = "text-embedding-3-small";
const DEFAULT_ENDPOINT = "https://api.openai.com/v1/embeddings";
const DEFAULT_DIMENSIONS = 1536;
const DEFAULT_TIMEOUT_MS = 30000;
const MAX_ERROR_BODY_LENGTH = 500;

export interface CloudEmbeddingOptions {
  apiKey?: string | null;
  model?: string;
  endpoint?: string;
  dimensions?: number;
  timeoutMs?: number;
}

export class CloudEmbedding implements EmbeddingBackend {
  readonly id = "cloud";
  readonly dimensions: number;

  private apiKey: string | null;
  private model: string;
  private endpoint: string;
  private timeoutMs: number;
  private disposed = false;

  constructor(opts: CloudEmbeddingOptions = {}) {
    this.apiKey = opts.apiKey ?? process.env.OPENAI_API_KEY ?? null;
    this.model = opts.model ?? DEFAULT_MODEL;
    this.endpoint = opts.endpoint ?? DEFAULT_ENDPOINT;
    this.dimensions = opts.dimensions ?? DEFAULT_DIMENSIONS;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (!this.apiKey) {
      log.warn("No API key configured. Set 'embedding.apiKey' or OPENAI_API_KEY env var.");
    }
  }

  async embed(texts: string[]): Promise<Float32Array[]> {
    if (this.disposed) throw new Error("CloudEmbedding: already disposed");
    const body = JSON.stringify({
      model: this.model,
      input: texts,
      encoding_format: "float",
    });

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;

    const response = await fetch(this.endpoint, {
      method: "POST",
      headers,
      body,
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) {
      const errBody = (await response.text().catch(() => "")).slice(0, MAX_ERROR_BODY_LENGTH);
      throw new Error(`CloudEmbedding: request failed ${response.status}: ${errBody}`);
    }

    const json = await response.json() as { data?: Array<{ embedding: number[]; index: number }> };
    if (!Array.isArray(json.data)) {
      throw new Error("CloudEmbedding: API response missing 'data' array");
    }
    const sorted = json.data.sort((a, b) => a.index - b.index);
    if (sorted.length > 0 && sorted[0].embedding.length !== this.dimensions) {
      throw new Error(
        `CloudEmbedding: dimension mismatch — expected ${this.dimensions} but API returned ${sorted[0].embedding.length}. ` +
        `Configure 'embedding.cloudModel' to match the model's actual output dimensions.`
      );
    }
    return sorted.map((item) => new Float32Array(item.embedding));
  }

  async embedSingle(text: string): Promise<Float32Array> {
    const results = await this.embed([text]);
    if (results.length === 0) throw new Error("CloudEmbedding: backend returned empty result");
    return results[0];
  }

  dispose(): void {
    this.disposed = true;
  }
}
