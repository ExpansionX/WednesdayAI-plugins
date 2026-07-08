import type { EmbeddingBackend } from "./types.js";

export interface CustomEmbeddingOptions {
  endpoint?: string | null;
  apiKey?: string | null;
  dimensions?: number;
  model?: string;
}

export class CustomEmbedding implements EmbeddingBackend {
  readonly id = "custom";
  readonly dimensions: number;

  private endpoint: string;
  private apiKey: string | null;
  private model: string;
  private disposed = false;

  constructor(opts: CustomEmbeddingOptions) {
    if (!opts.endpoint) {
      throw new Error("CustomEmbedding: endpoint is required");
    }
    this.endpoint = opts.endpoint;
    this.apiKey = opts.apiKey ?? null;
    this.dimensions = opts.dimensions ?? 384;
    this.model = opts.model ?? "custom";
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

    const response = await fetch(this.endpoint, { method: "POST", headers, body });
    if (!response.ok) {
      throw new Error(`CustomEmbedding: request failed ${response.status}: ${await response.text()}`);
    }

    const json = await response.json() as { data: Array<{ embedding: number[]; index: number }> };
    const sorted = json.data.sort((a, b) => a.index - b.index);
    if (sorted.length > 0 && sorted[0].embedding.length !== this.dimensions) {
      throw new Error(
        `CustomEmbedding: dimension mismatch — expected ${this.dimensions} but endpoint returned ${sorted[0].embedding.length}. ` +
        `Configure 'embedding.dimensions' to match your endpoint's output.`
      );
    }
    return sorted.map((item) => new Float32Array(item.embedding));
  }

  async embedSingle(text: string): Promise<Float32Array> {
    const results = await this.embed([text]);
    return results[0];
  }

  dispose(): void {
    this.disposed = true;
  }
}
