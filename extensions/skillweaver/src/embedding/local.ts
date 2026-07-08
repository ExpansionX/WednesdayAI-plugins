import type { EmbeddingBackend } from "./types.js";

const DEFAULT_MODEL = "all-MiniLM-L6-v2";
const DIMENSIONS = 384;

export class LocalEmbedding implements EmbeddingBackend {
  readonly id = "local";
  readonly dimensions = DIMENSIONS;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private pipeline: Promise<any>;
  private disposed = false;

  constructor(modelName: string = DEFAULT_MODEL) {
    this.pipeline = this.loadPipeline(modelName);
  }

  private async loadPipeline(modelName: string): Promise<unknown> {
    // @ts-expect-error — @xenova/transformers types resolved at runtime
    const { pipeline } = await import("@xenova/transformers");
    const xenovaModel = modelName.startsWith("Xenova/") ? modelName : `Xenova/${modelName}`;
    return pipeline("feature-extraction", xenovaModel);
  }

  async embed(texts: string[]): Promise<Float32Array[]> {
    if (this.disposed) throw new Error("LocalEmbedding: already disposed");
    const pipe = await this.pipeline;
    const results: Float32Array[] = [];
    for (const text of texts) {
      const output = await pipe(text, { pooling: "mean", normalize: true });
      const data = output.data instanceof Float32Array ? output.data : new Float32Array(output.data);
      results.push(data);
    }
    return results;
  }

  async embedSingle(text: string): Promise<Float32Array> {
    const results = await this.embed([text]);
    return results[0];
  }

  dispose(): void {
    this.disposed = true;
  }
}
