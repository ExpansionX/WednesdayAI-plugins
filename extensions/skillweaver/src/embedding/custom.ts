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
    });

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;

    const response = await fetch(this.endpoint, { method: "POST", headers, body });
    if (!response.ok) {
      throw new Error(`CustomEmbedding: request failed ${response.status}: ${await response.text()}`);
    }

    const json = await response.json() as { data: Array<{ embedding: number[]; index: number }> };
    return json.data
      .sort((a, b) => a.index - b.index)
      .map((item) => new Float32Array(item.embedding));
  }

  async embedSingle(text: string): Promise<Float32Array> {
    const results = await this.embed([text]);
    return results[0];
  }

  dispose(): void {
    this.disposed = true;
  }
}
