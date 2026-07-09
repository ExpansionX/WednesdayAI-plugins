import { describe, it, expect, beforeAll } from "vitest";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let formatSkillContext: any;

describe("formatSkillContext", () => {
  beforeAll(async () => {
    const mod = await import("./context-injector.js");
    formatSkillContext = mod.formatSkillContext;
  });

  it("returns empty contribution for empty skills array", () => {
    const result = formatSkillContext([], []);
    expect(result).toEqual({});
  });

  it("formats skills into prependContext", () => {
    const result = formatSkillContext(
      [
        { name: "github", description: "Git operations", location: "/skills/github/SKILL.md", source: "bundled", score: 0.95 },
        { name: "slack", description: "Slack messaging", location: "/skills/slack/SKILL.md", source: "bundled", score: 0.88 },
      ],
      ["create PR", "notify slack"],
    );

    expect(result.prependContext).toBeDefined();
    expect(result.prependContext).toHaveLength(1);

    const block = result.prependContext![0];
    expect(block.id).toBe("skillweaver:route");
    expect(block.source).toBe("plugin-skillweaver");
    expect(typeof block.priority).toBe("number");
    expect(block.priority).toBeGreaterThanOrEqual(10);
    expect(block.priority).toBeLessThanOrEqual(20);
    expect(block.metadata).toBeDefined();
    expect(block.metadata!.matchedSkills).toEqual(["github", "slack"]);
    expect(block.text).toContain("## Skill Routing");
    expect(block.text).toContain("github");
    expect(block.text).toContain("create PR");
  });

  it("includes decomposer model in metadata", () => {
    const result = formatSkillContext(
      [{ name: "github", description: "Git", location: "/x", source: "bundled", score: 0.9 }],
      ["task"],
      "qwen/qwen2.5-7b-instruct",
    );

    expect(result.prependContext![0].metadata!.decomposerModel).toBe("qwen/qwen2.5-7b-instruct");
  });

  it("estimates token count", () => {
    const result = formatSkillContext(
      [
        { name: "github", description: "Git operations via gh CLI", location: "/skills/github/SKILL.md", source: "bundled", score: 0.9 },
      ],
      ["task"],
    );

    const block = result.prependContext![0];
    expect(typeof block.tokenEstimate).toBe("number");
    expect(block.tokenEstimate).toBeGreaterThan(0);
  });

  it("handles many sub-tasks", () => {
    const tasks = Array.from({ length: 10 }, (_, i) => `task ${i}`);
    const skills = Array.from({ length: 10 }, (_, i) => ({
      name: `skill-${i}`,
      description: `desc ${i}`,
      location: `/x/${i}`,
      source: "bundled" as const,
      score: 0.9 - i * 0.01,
    }));

    const result = formatSkillContext(skills, tasks);
    expect(result.prependContext![0].metadata!.subTasks).toHaveLength(10);
    expect(result.prependContext![0].metadata!.matchedSkills).toHaveLength(10);
  });

  it("truncates long skill descriptions and appends ellipsis", () => {
    const longName = "x".repeat(300);
    const result = formatSkillContext(
      [{ name: longName, description: "desc", location: "/x", source: "bundled", score: 0.9 }],
      ["task"],
    );
    const text = result.prependContext![0].text;
    expect(text).toContain("\u2026");
  });

  it("escapes markdown special characters in skill names", () => {
    const result = formatSkillContext(
      [{ name: "evil**name", description: "desc", location: "/x", source: "bundled", score: 0.9 }],
      ["task"],
    );
    const text = result.prependContext![0].text;
    expect(text).toContain("\\*\\*");
    expect(text).not.toContain("evil**name");
  });

  it("does not truncate short text", () => {
    const result = formatSkillContext(
      [{ name: "short", description: "brief", location: "/x", source: "bundled", score: 0.9 }],
      ["task"],
    );
    const text = result.prependContext![0].text;
    expect(text).not.toContain("\u2026");
  });
});
