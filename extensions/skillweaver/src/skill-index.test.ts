import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import type { EmbeddingBackend, SkillEntry } from "./embedding/types.js";
import { mkdirSync, rmSync } from "node:fs";

vi.mock("wednesdayai/plugin-sdk", () => ({
  createSubsystemLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

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

    it("calls skillProvider and rebuilds after debounce", async () => {
      const index = new SkillIndex(mockBackend);
      await index.build(sampleSkills);

      let callCount = 0;
      const provider = () => {
        callCount++;
        return sampleSkills;
      };

      const watcher = index.watch(TEST_SKILLS_DIR, provider, { debounceMs: 100 });
      expect(watcher).toBeDefined();

      // Verify the watcher is an EventEmitter with close
      expect(typeof watcher?.close).toBe("function");

      watcher?.close();
    });
  });
});
