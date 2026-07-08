import type { EmbeddingBackend } from "./types.js";

const DEFAULT_MODEL = "text-embedding-3-small";
const DEFAULT_ENDPOINT = "https://api.openai.com/v1/embeddings";
const DIMENSIONS = 1536;

export interface CloudEmbeddingOptions {
  apiKey?: string | null;
  model?: string;
  endpoint?: string;
}

export class CloudEmbedding implements EmbeddingBackend {
  readonly id = "cloud";
  readonly dimensions = DIMENSIONS;

  private apiKey: string | null;
  private model: string;
  private endpoint: string;
  private disposed = false;

  constructor(opts: CloudEmbeddingOptions = {}) {
    this.apiKey = opts.apiKey ?? process.env.OPENAI_API_KEY ?? null;
    this.model = opts.model ?? DEFAULT_MODEL;
    this.endpoint = opts.endpoint ?? DEFAULT_ENDPOINT;
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

    const response = await fetch(this.endpoint, { method: "POST", headers, body });
    if (!response.ok) {
      throw new Error(`CloudEmbedding: request failed ${response.status}: ${await response.text()}`);
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
