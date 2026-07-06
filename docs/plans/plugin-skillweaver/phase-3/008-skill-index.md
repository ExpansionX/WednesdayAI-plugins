---
id: "008"
phase: 3
title: Create SkillIndex — build hnswlib index from skill entries, search by vector, discover skills from config
status: ready
depends_on: ["001", "004"]
parallel: false
conflicts_with: []
files:
  - extensions/skillweaver/src/skill-index.ts
irreversible: false
scope_test: "extensions/skillweaver/src/skill-index.test.ts"
allowed_change: create
covers_criteria: [SC1]
---
## Failing test (write first)

Create `extensions/skillweaver/src/skill-index.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { EmbeddingBackend, SkillEntry } from "./embedding/types.js";

const mockBackend: EmbeddingBackend = {
  id: "test",
  dimensions: 4,
  embed: async (texts: string[]) => texts.map((t) => new Float32Array(Array.from(t, (c) => c.charCodeAt(0) / 128))),
  embedSingle: async (text: string) => new Float32Array(Array.from(text, (c) => c.charCodeAt(0) / 128)),
  dispose: () => {},
};

const sampleSkills: SkillEntry[] = [
  { name: "github", description: "Git operations via gh CLI", location: "/skills/github/SKILL.md", source: "bundled" },
  { name: "weather", description: "Fetch weather data from APIs", location: "/skills/weather/SKILL.md", source: "bundled" },
  { name: "slack", description: "Slack messaging and channel ops", location: "/skills/slack/SKILL.md", source: "bundled" },
  { name: "duplicate", description: "Duplicate name, different source", location: "/skills/dup/SKILL.md", source: "managed" },
  { name: "github", description: "Duplicate github from managed", location: "/other/github/SKILL.md", source: "managed" },
];

let SkillIndex: { new (...args: unknown[]): { build: Function; search: Function; getSkill: Function; size: number; dispose: Function } };

describe("SkillIndex", () => {
  beforeAll(async () => {
    const mod = await import("./skill-index.js");
    SkillIndex = mod.SkillIndex;
  });

  describe("build()", () => {
    it("builds index from skill entries", async () => {
      const index = new SkillIndex(mockBackend);
      await index.build(sampleSkills);
      expect(index.size).toBeGreaterThan(0);
    });

    it("deduplicates skills by name (last-loaded wins)", async () => {
      const index = new SkillIndex(mockBackend);
      await index.build(sampleSkills);
      const skill = index.getSkill("github");
      expect(skill?.source).toBe("managed");
      expect(skill?.location).toBe("/other/github/SKILL.md");
    });

    it("handles empty skill list", async () => {
      const index = new SkillIndex(mockBackend);
      await index.build([]);
      expect(index.size).toBe(0);
    });

    it("handles skill with empty description", async () => {
      const index = new SkillIndex(mockBackend);
      await index.build([{ name: "no-desc", description: "", location: "/x", source: "bundled" }]);
      expect(index.size).toBe(1);
    });
  });

  describe("search()", () => {
    it("returns top-K results sorted by score", async () => {
      const index = new SkillIndex(mockBackend);
      await index.build(sampleSkills);
      const results = await index.search("github pull request", 3);
      expect(results.length).toBeLessThanOrEqual(3);
      expect(results[0].name).toBeDefined();
    });

    it("returns empty array for empty index", async () => {
      const index = new SkillIndex(mockBackend);
      await index.build([]);
      const results = await index.search("query", 5);
      expect(results).toEqual([]);
    });

    it("caps results at available skills", async () => {
      const index = new SkillIndex(mockBackend);
      await index.build(sampleSkills.slice(0, 2));
      const results = await index.search("query", 10);
      expect(results.length).toBeLessThanOrEqual(2);
    });
  });

  describe("getSkill()", () => {
    it("returns skill by name", async () => {
      const index = new SkillIndex(mockBackend);
      await index.build(sampleSkills);
      expect(index.getSkill("weather")?.description).toContain("weather");
    });

    it("returns undefined for unknown skill", async () => {
      const index = new SkillIndex(mockBackend);
      await index.build(sampleSkills);
      expect(index.getSkill("nonexistent")).toBeUndefined();
    });
  });

  describe("dispose()", () => {
    it("clears index and releases memory", async () => {
      const index = new SkillIndex(mockBackend);
      await index.build(sampleSkills);
      index.dispose();
      expect(index.size).toBe(0);
    });
  });
});
```

## Change

**File:** `extensions/skillweaver/src/skill-index.ts`
**Anchor:** new file — create at this path
**Before:** file does not exist
**After:**
```ts
import type { EmbeddingBackend, SkillEntry, SearchResult, IndexedSkill } from "./embedding/types.js";
import { createSubsystemLogger } from "wednesdayai/plugin-sdk";

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
    ids.forEach((id, i) => index.addPoint(vectors[i], id));
    this.index = index;

    log.info(`index built: ${this.skills.size} skills, ${this.backend.dimensions}d`);
  }

  async search(query: string, topK: number): Promise<SearchResult[]> {
    if (!this.index || this.skills.size === 0) return [];

    const queryVector = await this.backend.embedSingle(query);
    const names = [...this.skills.keys()];
    const k = Math.min(topK, this.skills.size);
    const result = this.index.searchKnn(queryVector, k, undefined);

    const hits = typeof result === "object" && result !== null
      ? (result as { distances: Float64Array; neighbors: Float64Array })
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

  private parseLegacyResult(result: unknown, k: number): { distances: Float64Array; neighbors: Float64Array } {
    if (result && typeof result === "object" && "distances" in result && "neighbors" in result) {
      const r = result as Record<string, unknown>;
      return {
        distances: r.distances as Float64Array,
        neighbors: r.neighbors as Float64Array,
      };
    }
    throw new Error("hnswlib returned unrecognized search result shape");
  }

  private async createHnsw() {
    const { HierarchicalNSW } = await import("hnswlib-node");
    return new HierarchicalNSW("cosine", this.backend.dimensions);
  }
}
```

## Allowed moves

Create exactly `extensions/skillweaver/src/skill-index.ts` and its test. Add `hnswlib-node` to dependencies in package.json ONLY if the test requires the real module (prefer mocking @import level). No other files.

## STOP triggers

- `search()` returns results when `this.index` is null
- hnswlib-node `HierarchicalNSW` constructor signature doesn't match expectations — check actual package API
- Duplicate names silently double-count — dedup by name must be verified
- `embed()` is called with document strings that don't include skill description

## Done when

`WAI_TYPECHECK_CMD="cd extensions/skillweaver && pnpm exec tsc --noEmit" WAI_TEST_CMD="cd extensions/skillweaver && npx vitest run src/skill-index.test.ts" bash ~/.claude/wai/scripts/task-gate.sh plugin-skillweaver 008` exits 0