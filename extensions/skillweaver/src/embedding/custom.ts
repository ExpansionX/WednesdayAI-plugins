import type { EmbeddingBackend } from "./types.js";
import { createSubsystemLogger } from "../logger.js";

const log = createSubsystemLogger("skillweaver/custom");

const DEFAULT_TIMEOUT_MS = 30000;
const MAX_ERROR_BODY_LENGTH = 500;

export interface CustomEmbeddingOptions {
  endpoint?: string | null;
  apiKey?: string | null;
  dimensions?: number;
  model?: string;
  timeoutMs?: number;
}

export class CustomEmbedding implements EmbeddingBackend {
  readonly id = "custom";
  readonly dimensions: number;

  private endpoint: string;
  private apiKey: string | null;
  private model: string;
  private timeoutMs: number;
  private disposed = false;

  constructor(opts: CustomEmbeddingOptions) {
    if (!opts.endpoint) {
      throw new Error("CustomEmbedding: endpoint is required");
    }
    this.endpoint = opts.endpoint;
    this.apiKey = opts.apiKey ?? null;
    this.dimensions = opts.dimensions ?? 384;
    this.model = opts.model ?? "custom";
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (!this.apiKey) {
      log.warn("No API key configured for custom endpoint. Set 'embedding.apiKey' if your endpoint requires authentication.");
    }
  }

  async embed(texts: string[]): Promise<Float32Array[]> {
    if (this.disposed) throw new Error("CustomEmbedding: already disposed");
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
      throw new Error(`CustomEmbedding: request failed ${response.status}: ${errBody}`);
    }

    const json = await response.json() as { data?: Array<{ embedding: number[]; index: number }> };
    if (!Array.isArray(json.data)) {
      throw new Error("CustomEmbedding: endpoint response missing 'data' array");
    }
    const sorted = json.data.sort((a, b) => a.index - b.index);
    if (sorted.length > 0) {
      if (!Array.isArray(sorted[0].embedding)) {
        throw new Error("CustomEmbedding: endpoint response missing embedding array");
      }
      if (sorted[0].embedding.length !== this.dimensions) {
        throw new Error(
          `CustomEmbedding: dimension mismatch — expected ${this.dimensions} but endpoint returned ${sorted[0].embedding.length}. ` +
          `Configure 'embedding.dimensions' to match your endpoint's output.`
        );
      }
    }
    return sorted.map((item) => {
      if (!Array.isArray(item.embedding)) {
        throw new Error("CustomEmbedding: endpoint response missing embedding array");
      }
      return new Float32Array(item.embedding);
    });
  }

  async embedSingle(text: string): Promise<Float32Array> {
    const results = await this.embed([text]);
    if (results.length === 0) throw new Error("CustomEmbedding: backend returned empty result");
    return results[0];
  }

  dispose(): void {
    this.disposed = true;
  }
}
