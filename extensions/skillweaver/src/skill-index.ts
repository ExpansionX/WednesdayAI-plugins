// @ts-expect-error — plugin-sdk not installed in this workspace
import { createSubsystemLogger } from "wednesdayai/plugin-sdk";
import type { EmbeddingBackend, SkillEntry, SearchResult, IndexedSkill } from "./embedding/types.js";

const log = createSubsystemLogger("skillweaver/index");

export class SkillIndex {
  private backend: EmbeddingBackend;
  private skills = new Map<string, IndexedSkill>();
  private index: Awaited<ReturnType<typeof this.createHnsw>> | null = null;

  constructor(backend: EmbeddingBackend) {
    this.backend = backend;
  }

  get size(): number {
    return this.skills.size;
  }

  async build(entries: SkillEntry[]): Promise<void> {
    this.skills.clear();
    this.index = null;
    if (entries.length === 0) return;

    for (const entry of entries) {
      this.skills.set(entry.name, { ...entry, vector: new Float32Array(0) });
    }

    const names = [...this.skills.keys()];
    const documents = names.map((name) => {
      const skill = this.skills.get(name)!;
      return `${skill.name}: ${skill.description}`;
    });

    const vectors = await this.backend.embed(documents);
    for (let i = 0; i < names.length; i++) {
      const existing = this.skills.get(names[i]);
      if (existing) existing.vector = vectors[i];
    }

    if (vectors.length === 0) return;

    const { HierarchicalNSW } = await import("hnswlib-node");
    const index = new HierarchicalNSW("cosine", this.backend.dimensions);
    index.initIndex(vectors.length);
    index.setEf(400);

    const ids = Array.from({ length: vectors.length }, (_, i) => i);
    ids.forEach((id, i) => index.addPoint(Array.from(vectors[i]), id));
    this.index = index;

    log.info(`index built: ${this.skills.size} skills, ${this.backend.dimensions}d`);
  }

  async search(query: string, topK: number): Promise<SearchResult[]> {
    if (!this.index || this.skills.size === 0) return [];

    const queryVector = await this.backend.embedSingle(query);
    const names = [...this.skills.keys()];
    const k = Math.min(topK, this.skills.size);
    const result = this.index.searchKnn(Array.from(queryVector), k, undefined);

    const hits = typeof result === "object" && result !== null
      ? (result as unknown as { distances: number[] | Float64Array; neighbors: number[] | Float64Array })
      : this.parseLegacyResult(result, k);

    const results: SearchResult[] = [];
    for (let i = 0; i < Math.min(k, hits.neighbors.length); i++) {
      const idx = hits.neighbors[i];
      const distance = hits.distances[i];
      if (idx < names.length) {
        const name = names[idx];
        const skill = this.skills.get(name)!;
        results.push({
          name: skill.name,
          description: skill.description,
          location: skill.location,
          source: skill.source,
          score: 1 - distance,
        });
      }
    }
    return results;
  }

  getSkill(name: string): SkillEntry | undefined {
    const skill = this.skills.get(name);
    if (!skill) return undefined;
    const { vector: _, ...entry } = skill;
    return entry;
  }

  dispose(): void {
    this.index = null;
    this.skills.clear();
  }

  private parseLegacyResult(result: unknown, k: number): { distances: number[] | Float64Array; neighbors: number[] | Float64Array } {
    if (result && typeof result === "object" && "distances" in result && "neighbors" in result) {
      const r = result as Record<string, unknown>;
      return {
        distances: r.distances as number[] | Float64Array,
        neighbors: r.neighbors as number[] | Float64Array,
      };
    }
    throw new Error("hnswlib returned unrecognized search result shape");
  }

  private async createHnsw() {
    const { HierarchicalNSW } = await import("hnswlib-node");
    return new HierarchicalNSW("cosine", this.backend.dimensions);
  }
}
