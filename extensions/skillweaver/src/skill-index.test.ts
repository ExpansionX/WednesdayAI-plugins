import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import type { EmbeddingBackend, SkillEntry } from "./embedding/types.js";

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
