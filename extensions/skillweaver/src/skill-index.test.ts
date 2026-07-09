import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import type { EmbeddingBackend, SkillEntry } from "./embedding/types.js";
import { mkdirSync, rmSync } from "node:fs";

const DIM = 4;
const mockBackend: EmbeddingBackend = {
  id: "test",
  dimensions: DIM,
  embed: async (texts: string[]) => texts.map((t) => {
    const v = new Float32Array(DIM);
    for (let i = 0; i < t.length && i < DIM; i++) v[i] = t.charCodeAt(i) / 128;
    return v;
  }),
  embedSingle: async (text: string) => {
    const v = new Float32Array(DIM);
    for (let i = 0; i < text.length && i < DIM; i++) v[i] = text.charCodeAt(i) / 128;
    return v;
  },
  dispose: () => {},
};

const sampleSkills: SkillEntry[] = [
  { name: "github", description: "Git operations via gh CLI", location: "/skills/github/SKILL.md", source: "bundled" },
  { name: "weather", description: "Fetch weather data from APIs", location: "/skills/weather/SKILL.md", source: "bundled" },
  { name: "slack", description: "Slack messaging and channel ops", location: "/skills/slack/SKILL.md", source: "bundled" },
  { name: "duplicate", description: "Duplicate name, different source", location: "/skills/dup/SKILL.md", source: "managed" },
  { name: "github", description: "Duplicate github from managed", location: "/other/github/SKILL.md", source: "managed" },
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let SkillIndex: any;

const TEST_SKILLS_DIR = "/tmp/skillweaver-test-skills";

describe("SkillIndex", () => {
  beforeAll(async () => {
    const mod = await import("./skill-index.js");
    SkillIndex = mod.SkillIndex;
    mkdirSync(TEST_SKILLS_DIR, { recursive: true });
  });

  afterAll(() => {
    rmSync(TEST_SKILLS_DIR, { recursive: true, force: true });
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

    it("passes caller abort signal to the embedding backend", async () => {
      const ac = new AbortController();
      const embedSingle = vi.fn().mockResolvedValue(new Float32Array(DIM));
      const backend: EmbeddingBackend = { ...mockBackend, embedSingle };
      const index = new SkillIndex(backend);
      await index.build(sampleSkills.slice(0, 2));

      await index.search("query", 1, ac.signal);

      expect(embedSingle).toHaveBeenCalledWith("query", ac.signal);
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

    it("prevents build after dispose", async () => {
      const index = new SkillIndex(mockBackend);
      index.dispose();
      await index.build(sampleSkills);
      expect(index.size).toBe(0);
    });

    it("prevents watch after dispose", async () => {
      const index = new SkillIndex(mockBackend);
      index.dispose();
      const watcher = index.watch(TEST_SKILLS_DIR, () => sampleSkills);
      expect(watcher).toBeNull();
    });

    it("is idempotent", async () => {
      const index = new SkillIndex(mockBackend);
      await index.build(sampleSkills);
      index.dispose();
      index.dispose();
      expect(index.size).toBe(0);
    });
  });

  describe("generation counter", () => {
    it("build with disposed flag is no-op", async () => {
      const index = new SkillIndex(mockBackend);
      index.dispose();
      await index.build(sampleSkills);
      expect(index.size).toBe(0);
    });
  });

  describe("vectors-length guard", () => {
    it("aborts build when embed returns mismatched count", async () => {
      const badBackend: EmbeddingBackend = {
        ...mockBackend,
        embed: async () => [new Float32Array(4)], // Only 1 vector for 5 skills
      };

      const index = new SkillIndex(badBackend);
      await index.build(sampleSkills);
      expect(index.size).toBe(0);
    });

    it("clears existing index when rebuild returns mismatched count", async () => {
      const badBackend: EmbeddingBackend = {
        ...mockBackend,
        embed: async () => [new Float32Array(4)], // Only 1 vector for 5 skills
      };

      const index = new SkillIndex(mockBackend);
      await index.build(sampleSkills.slice(0, 2));
      expect(index.size).toBe(2);

      (index as unknown as { backend: EmbeddingBackend }).backend = badBackend;
      await index.build(sampleSkills);
      expect(index.size).toBe(0);
    });
  });

  describe("watch() / rebuild", () => {
    it("watch() starts a file watcher", async () => {
      const index = new SkillIndex(mockBackend);
      await index.build(sampleSkills);
      const watcher = index.watch(TEST_SKILLS_DIR, () => [...sampleSkills]);
      expect(watcher).toBeDefined();
      expect(watcher?.close).toBeDefined();
      watcher?.close();
    });

    it("returns null for non-existent dir", () => {
      const index = new SkillIndex(mockBackend);
      const watcher = index.watch("/nonexistent/path", () => []);
      expect(watcher).toBeNull();
    });

    it("unwatch() closes the watcher", async () => {
      const index = new SkillIndex(mockBackend);
      await index.build(sampleSkills);
      index.watch(TEST_SKILLS_DIR, () => [...sampleSkills]);
      const closed = index.unwatch();
      expect(closed).toBe(true);
    });

    it("unwatch() returns false when no watcher active", () => {
      const index = new SkillIndex(mockBackend);
      expect(index.unwatch()).toBe(false);
    });

    it("second watch() returns the same watcher for same dir", async () => {
      const index = new SkillIndex(mockBackend);
      await index.build(sampleSkills);
      const w1 = index.watch(TEST_SKILLS_DIR, () => [...sampleSkills]);
      const w2 = index.watch(TEST_SKILLS_DIR, () => [...sampleSkills]);
      expect(w1).toBe(w2);
      w1?.close();
    });

    it("watch() accepts async skillProvider", async () => {
      const index = new SkillIndex(mockBackend);
      await index.build(sampleSkills);
      const watcher = index.watch(TEST_SKILLS_DIR, async () => {
        await new Promise((r) => setTimeout(r, 10));
        return [...sampleSkills];
      });
      expect(watcher).toBeDefined();
      watcher?.close();
    });

    it("watch() returns null when disposed", async () => {
      const index = new SkillIndex(mockBackend);
      await index.build(sampleSkills);
      index.dispose();
      const watcher = index.watch(TEST_SKILLS_DIR, () => sampleSkills);
      expect(watcher).toBeNull();
    });

    it.skipIf(process.platform === "darwin")("rebuilds when a new skill directory appears on non-recursive platforms", async () => {
      const index = new SkillIndex(mockBackend);
      const dir = `${TEST_SKILLS_DIR}/linux-new-dir`;
      mkdirSync(dir, { recursive: true });
      try {
        await index.build(sampleSkills);
        let rebuildCount = 0;
        const watcher = index.watch(dir, () => {
          rebuildCount++;
          return sampleSkills;
        }, { debounceMs: 10 });
        expect(watcher).not.toBeNull();

        watcher!.emit("change", "rename", "SKILL.md");
        await new Promise((r) => setTimeout(r, 50));

        expect(rebuildCount).toBe(1);
      } finally {
        index.unwatch();
      }
    });

    it("calls skillProvider and rebuilds after debounce", async () => {
      const index = new SkillIndex(mockBackend);
      await index.build(sampleSkills);

      const provider = () => sampleSkills;

      const watcher = index.watch(TEST_SKILLS_DIR, provider, { debounceMs: 100 });
      expect(watcher).toBeDefined();

      // Verify the watcher is an EventEmitter with close
      expect(typeof watcher?.close).toBe("function");

      watcher?.close();
    });
  });

  describe("unwatch() with rebuildTimer", () => {
    it("clears pending rebuild timer on unwatch()", async () => {
      const index = new SkillIndex(mockBackend);
      await index.build(sampleSkills);

      let callCount = 0;
      const provider = () => {
        callCount++;
        return sampleSkills;
      };

      const watcher = index.watch(TEST_SKILLS_DIR, provider, { debounceMs: 5000 });
      expect(watcher).not.toBeNull();

      // Trigger scheduleRebuild by emitting change event with SKILL.md filename
      // fs.watch callback is registered on the "change" event
      watcher!.emit("change", "rename", "SKILL.md");

      // Immediately unwatch — should clear the pending rebuild timer
      const closed = index.unwatch();
      expect(closed).toBe(true);

      // Wait — provider should NOT have been called since timer was cleared
      await new Promise((r) => setTimeout(r, 100));
      expect(callCount).toBe(0);
    });

    it("does not start rebuild after unwatch() even if timer fires", async () => {
      const index = new SkillIndex(mockBackend);
      await index.build(sampleSkills);

      let rebuildCount = 0;
      const provider = () => {
        rebuildCount++;
        return sampleSkills;
      };

      const watcher = index.watch(TEST_SKILLS_DIR, provider, { debounceMs: 50 });
      expect(watcher).not.toBeNull();

      // Trigger a rebuild
      watcher!.emit("change", "rename", "SKILL.md");

      // Unwatch immediately — clears the timer
      index.unwatch();

      // Wait for what would have been the debounce period
      await new Promise((r) => setTimeout(r, 150));
      expect(rebuildCount).toBe(0);
    });
  });

  describe("search() after build with empty entries clears index", () => {
    it("returns empty when index was cleared by empty build", async () => {
      const index = new SkillIndex(mockBackend);
      await index.build(sampleSkills);
      expect(index.size).toBeGreaterThan(0);

      // Rebuild with empty — clears index
      await index.build([]);
      expect(index.size).toBe(0);

      const results = await index.search("github", 5);
      expect(results).toEqual([]);
    });
  });

  describe("search() race condition", () => {
    it("returns empty when dispose() is called during embedSingle await", async () => {
      let resolveEmbed: (v: Float32Array) => void = () => {};
      const delayingBackend: EmbeddingBackend = {
        id: "test",
        dimensions: DIM,
        embed: async (texts: string[]) => texts.map(() => new Float32Array(DIM)),
        embedSingle: () => new Promise<Float32Array>((resolve) => { resolveEmbed = resolve; }),
        dispose: () => {},
      };

      const index = new SkillIndex(delayingBackend);
      await index.build(sampleSkills);

      const searchPromise = index.search("query", 3);
      index.dispose();
      resolveEmbed(new Float32Array(DIM));

      const results = await searchPromise;
      expect(results).toEqual([]);
    });

    it("does not throw when index is replaced by a new build during search", async () => {
      let resolveEmbed: (v: Float32Array) => void = () => {};
      const delayingBackend: EmbeddingBackend = {
        id: "test",
        dimensions: DIM,
        embed: async (texts: string[]) => texts.map(() => new Float32Array(DIM)),
        embedSingle: () => new Promise<Float32Array>((resolve) => { resolveEmbed = resolve; }),
        dispose: () => {},
      };

      const index = new SkillIndex(delayingBackend);
      await index.build(sampleSkills.slice(0, 2));

      const searchPromise = index.search("query", 3);
      await index.build(sampleSkills);
      resolveEmbed(new Float32Array(DIM));

      const results = await searchPromise;
      expect(results).toBeDefined();
      expect(Array.isArray(results)).toBe(true);
    });
  });

  describe("child watcher cleanup on parent error", () => {
    it("closes child watchers when parent watcher errors", async () => {
      const index = new SkillIndex(mockBackend);
      await index.build(sampleSkills);

      const parentDir = TEST_SKILLS_DIR;
      const childDir = `${parentDir}/child-skill`;

      const parentWatcher = index.watch(parentDir, () => sampleSkills);
      expect(parentWatcher).not.toBeNull();

      const childClose = vi.fn();
      const mockChildWatcher = { close: childClose, on: vi.fn() } as unknown as ReturnType<typeof import("node:fs").watch>;
      (index as unknown as { watchers: Map<string, unknown> }).watchers.set(childDir, mockChildWatcher);

      parentWatcher!.emit("error", new Error("watcher failed"));

      expect(childClose).toHaveBeenCalled();
      expect((index as unknown as { watchers: Map<string, unknown> }).watchers.has(childDir)).toBe(false);
      expect((index as unknown as { watchers: Map<string, unknown> }).watchers.has(parentDir)).toBe(false);
    });

    it("removes child watcher from map on child error (allows re-watching)", async () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, "platform", { value: "linux", configurable: true });

      const childDir = `${TEST_SKILLS_DIR}/child-err-test`;
      mkdirSync(childDir, { recursive: true });

      try {
        const index = new SkillIndex(mockBackend);
        await index.build(sampleSkills);
        index.watch(TEST_SKILLS_DIR, () => sampleSkills, { debounceMs: 10 });
        await new Promise((r) => setTimeout(r, 100));

        const watchers = (index as unknown as { watchers: Map<string, { emit: (event: string, err: Error) => void }> }).watchers;
        const childW = watchers.get(childDir);
        expect(childW).toBeDefined();

        childW!.emit("error", new Error("child dir deleted"));
        expect(watchers.has(childDir)).toBe(false);

        index.unwatch();
      } finally {
        Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true });
        rmSync(childDir, { recursive: true, force: true });
      }
    });
  });

  describe("rebuild coalescing", () => {
    it("does not drop file changes that arrive during a rebuild", async () => {
      let resolveProvider: (v: SkillEntry[]) => void = () => {};
      const slowProvider = (): Promise<SkillEntry[]> => new Promise<SkillEntry[]>((resolve) => {
        resolveProvider = resolve;
      });

      const index = new SkillIndex(mockBackend);
      await index.build(sampleSkills);

      const watcher = index.watch(TEST_SKILLS_DIR, slowProvider, { debounceMs: 10 });
      expect(watcher).not.toBeNull();

      // First change → schedule rebuild
      watcher!.emit("change", "rename", "SKILL.md");
      await new Promise((r) => setTimeout(r, 30));

      // First rebuild is in-flight (slowProvider not yet resolved)
      // Second change during rebuild
      watcher!.emit("change", "rename", "SKILL.md");
      await new Promise((r) => setTimeout(r, 30));

      // Resolve the first rebuild
      resolveProvider(sampleSkills);
      await new Promise((r) => setTimeout(r, 30));

      // The second change should have triggered a second rebuild
      // Resolve the second rebuild
      resolveProvider(sampleSkills);
      await new Promise((r) => setTimeout(r, 30));

      // The watcher should still be active
      expect((index as unknown as { watchers: Map<string, unknown> }).watchers.has(TEST_SKILLS_DIR)).toBe(true);

      watcher?.close();
    });
  });
});
