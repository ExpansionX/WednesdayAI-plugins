import type { EmbeddingBackend } from "./types.js";

const DEFAULT_MODEL = "all-MiniLM-L6-v2";
const DIMENSIONS = 384;

export class LocalEmbedding implements EmbeddingBackend {
  readonly id = "local";
  readonly dimensions = DIMENSIONS;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private pipeline: Promise<any> | null;
  private pipelineError: Error | null = null;
  private disposed = false;

  constructor(modelName: string = DEFAULT_MODEL) {
    this.pipeline = this.loadPipeline(modelName);
    this.pipeline.catch((err: unknown) => {
      this.pipelineError = err instanceof Error ? err : new Error(String(err));
      this.pipeline = null;
    });
  }

  private async loadPipeline(modelName: string): Promise<unknown> {
    // @xenova/transformers ships without type declarations; resolve lazily.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { pipeline } = await import("@xenova/transformers") as any;
    const xenovaModel = modelName.startsWith("Xenova/") ? modelName : `Xenova/${modelName}`;
    return pipeline("feature-extraction", xenovaModel);
  }

  async embed(texts: string[]): Promise<Float32Array[]> {
    if (this.disposed) throw new Error("LocalEmbedding: already disposed");
    if (this.pipelineError) throw this.pipelineError;
    if (!this.pipeline) throw new Error("LocalEmbedding: pipeline failed to initialize");
    const pipe = await this.pipeline;
    if (this.disposed) throw new Error("LocalEmbedding: already disposed");
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
    this.pipeline = null;
    this.pipelineError = null;
  }
}
