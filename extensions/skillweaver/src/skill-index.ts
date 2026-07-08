import { createSubsystemLogger } from "./logger.js";
import { watch } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { EmbeddingBackend, SkillEntry, SearchResult, IndexedSkill } from "./embedding/types.js";

const log = createSubsystemLogger("skillweaver/index");

interface HnswIndex {
  initIndex(num: number): void;
  setEf(ef: number): void;
  addPoint(point: number[], id: number): void;
  searchKnn(query: number[], k: number, filter?: unknown): { distances: number[] | Float64Array; neighbors: number[] | Float64Array };
}

export interface WatchOptions {
  debounceMs?: number;
}

export class SkillIndex {
  private backend: EmbeddingBackend;
  private skills = new Map<string, IndexedSkill>();
  private index: HnswIndex | null = null;
  private watchers = new Map<string, ReturnType<typeof watch>>();
  private rebuildTimer: ReturnType<typeof setTimeout> | null = null;
  private buildGeneration = 0;
  private rebuilding = false;
  private pendingRebuild = false;
  private disposed = false;

  constructor(backend: EmbeddingBackend) {
    this.backend = backend;
  }

  get size(): number {
    return this.skills.size;
  }

  async build(entries: SkillEntry[]): Promise<void> {
    if (this.disposed) return;
    const gen = ++this.buildGeneration;
    const newSkills = new Map<string, IndexedSkill>();
    if (entries.length === 0) {
      if (gen === this.buildGeneration) {
        this.skills = newSkills;
        this.index = null;
      }
      return;
    }

    for (const entry of entries) {
      newSkills.set(entry.name, { ...entry, vector: new Float32Array(0) });
    }

    const names = [...newSkills.keys()];
    const documents = names.map((name) => {
      const skill = newSkills.get(name)!;
      return `${skill.name}: ${skill.description}`;
    });

    const vectors = await this.backend.embed(documents);
    if (vectors.length !== names.length) {
      log.warn("embed returned mismatched count", { expected: names.length, got: vectors.length });
      if (gen === this.buildGeneration) {
        this.skills = new Map();
        this.index = null;
      }
      return;
    }
    for (let i = 0; i < names.length; i++) {
      const existing = newSkills.get(names[i]);
      if (existing) existing.vector = vectors[i];
    }

    if (vectors.length === 0) {
      if (gen === this.buildGeneration) {
        this.skills = newSkills;
        this.index = null;
      }
      return;
    }

    const { HierarchicalNSW } = await import("hnswlib-node");
    const newIndex = new HierarchicalNSW("cosine", this.backend.dimensions);
    newIndex.initIndex(vectors.length);
    newIndex.setEf(Math.min(400, Math.max(50, vectors.length * 2)));

    for (let i = 0; i < vectors.length; i++) {
      newIndex.addPoint(Array.from(vectors[i]), i);
    }

    if (gen === this.buildGeneration) {
      this.skills = newSkills;
      this.index = newIndex;
      log.info(`index built: ${this.skills.size} skills, ${this.backend.dimensions}d`);
    }
  }

  async search(query: string, topK: number): Promise<SearchResult[]> {
    if (this.disposed || !this.index || this.skills.size === 0) return [];

    const queryVector = await this.backend.embedSingle(query);

    const index = this.index;
    const skills = this.skills;
    if (!index || skills.size === 0) return [];

    const names = [...skills.keys()];
    const k = Math.min(topK, skills.size);
    const result = index.searchKnn(Array.from(queryVector), k, undefined);

    const hits = this.parseSearchResult(result);

    const results: SearchResult[] = [];
    for (let i = 0; i < Math.min(k, hits.neighbors.length); i++) {
      const idx = hits.neighbors[i];
      const distance = hits.distances[i];
      if (idx < names.length) {
        const name = names[idx];
        const skill = skills.get(name);
        if (!skill) continue;
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

  watch(
    dir: string,
    skillProvider: () => SkillEntry[] | Promise<SkillEntry[]>,
    opts: WatchOptions = {},
  ): ReturnType<typeof watch> | null {
    if (this.disposed) return null;
    if (this.watchers.has(dir)) return this.watchers.get(dir)!;

    const scheduleRebuild = () => {
      if (this.disposed) return;
      if (this.rebuilding) {
        this.pendingRebuild = true;
        return;
      }
      if (this.rebuildTimer) clearTimeout(this.rebuildTimer);
      this.rebuildTimer = setTimeout(async () => {
        this.rebuildTimer = null;
        if (this.disposed) return;
        if (this.rebuilding) {
          this.pendingRebuild = true;
          return;
        }
        this.rebuilding = true;
        try {
          const entries = await skillProvider();
          await this.build(entries);
        } catch (err) {
          log.error("rebuild failed", { error: String(err) });
        } finally {
          this.rebuilding = false;
          if (this.pendingRebuild && !this.disposed) {
            this.pendingRebuild = false;
            scheduleRebuild();
          }
        }
      }, opts.debounceMs ?? 2000);
    };

    const watchChildDirs = async () => {
      try {
        const entries = await readdir(dir, { withFileTypes: true });
        if (this.disposed || !this.watchers.has(dir)) return;
        for (const entry of entries) {
          if (!entry.isDirectory()) continue;
          const subDir = join(dir, entry.name);
          if (this.watchers.has(subDir)) continue;
          const subW = watch(subDir, { persistent: false }, (_event, filename) => {
            if (filename === "SKILL.md") scheduleRebuild();
          });
          subW.on("error", () => { this.watchers.delete(subDir); });
          if (this.disposed || !this.watchers.has(dir)) {
            subW.close();
            return;
          }
          this.watchers.set(subDir, subW);
        }
      } catch { /* ignore readdir errors */ }
    };

    try {
      const useRecursive = process.platform === "darwin" || process.platform === "win32";
      const w = watch(dir, { persistent: false, recursive: useRecursive }, (_event, filename) => {
        if (!filename?.endsWith("SKILL.md")) {
          if (!useRecursive) {
            scheduleRebuild();
            void watchChildDirs();
          }
          return;
        }
        scheduleRebuild();
      });
      w.on("error", (err) => {
        log.warn("watcher error", { dir, error: String(err) });
        this.unwatch();
      });
      this.watchers.set(dir, w);

      if (!useRecursive) {
        void watchChildDirs();
      }

      return w;
    } catch {
      return null;
    }
  }

  unwatch(): boolean {
    if (this.rebuildTimer) {
      clearTimeout(this.rebuildTimer);
      this.rebuildTimer = null;
    }
    this.rebuilding = false;
    this.pendingRebuild = false;
    if (this.watchers.size > 0) {
      for (const w of this.watchers.values()) w.close();
      this.watchers.clear();
      return true;
    }
    return false;
  }

  dispose(): void {
    this.disposed = true;
    this.buildGeneration++;
    this.unwatch();
    this.index = null;
    this.skills.clear();
  }

  private parseSearchResult(result: unknown): { distances: number[] | Float64Array; neighbors: number[] | Float64Array } {
    if (result && typeof result === "object" && "distances" in result && "neighbors" in result) {
      const r = result as Record<string, unknown>;
      return {
        distances: r.distances as number[] | Float64Array,
        neighbors: r.neighbors as number[] | Float64Array,
      };
    }
    throw new Error("hnswlib returned unrecognized search result shape");
  }
}
