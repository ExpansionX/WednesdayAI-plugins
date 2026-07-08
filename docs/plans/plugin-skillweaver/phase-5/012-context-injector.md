---
id: "012"
phase: 5
title: Create ContextInjector — format skill entries as PromptContribution prependContext blocks
status: ready
depends_on: ["001", "004"]
parallel: false
conflicts_with: []
files:
  - extensions/skillweaver/src/context-injector.ts
  - extensions/skillweaver/src/context-injector.test.ts
irreversible: false
scope_test: "extensions/skillweaver/src/context-injector.test.ts"
allowed_change: create
covers_criteria: [SC3, SC4]
---
## Failing test (write first)

Create `extensions/skillweaver/src/context-injector.test.ts`:

```ts
import { describe, it, expect } from "vitest";

let formatSkillContext: Function;

describe("formatSkillContext", () => {
  beforeAll(async () => {
    const mod = await import("./context-injector.js");
    formatSkillContext = mod.formatSkillContext;
  });

  it("returns empty contribution for empty skills array", () => {
    const result = formatSkillContext([], "test query", []);
    expect(result).toEqual({});
  });

  it("formats skills into prependContext", () => {
    const result = formatSkillContext(
      [
        { name: "github", description: "Git operations", location: "/skills/github/SKILL.md", source: "bundled", score: 0.95 },
        { name: "slack", description: "Slack messaging", location: "/skills/slack/SKILL.md", source: "bundled", score: 0.88 },
      ],
      "create a PR and notify slack",
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
      "query",
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
      "query",
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

    const result = formatSkillContext(skills, "complex query", tasks);
    expect(result.prependContext![0].metadata!.subTasks).toHaveLength(10);
    expect(result.prependContext![0].metadata!.matchedSkills).toHaveLength(10);
  });
});
```

## Change

**File:** `extensions/skillweaver/src/context-injector.ts`
**Anchor:** new file — create at this path
**Before:** file does not exist
**After:**
```ts
import type { SearchResult } from "./embedding/types.js";

interface ContextBlock {
  id?: string;
  source?: string;
  text: string;
  priority?: number;
  tokenEstimate?: number;
  metadata?: Record<string, unknown>;
}

interface PromptContribution {
  prependContext?: ContextBlock[];
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function formatSkillContext(
  skills: SearchResult[],
  query: string,
  subTasks: string[],
  decomposerModel?: string,
): PromptContribution {
  if (skills.length === 0) return {};

  const lines: string[] = [
    "## Skill Routing",
    "The following skills are recommended for this query:",
    "",
  ];

  for (const skill of skills) {
    lines.push(`### ${skill.name}`);
    lines.push(skill.description);
    lines.push(`Location: ${skill.location}`);
    lines.push("");
  }

  if (subTasks.length > 0) {
    lines.push("**Sub-tasks detected:**");
    for (const task of subTasks) {
      lines.push(`- ${task}`);
    }
  }

  const text = lines.join("\n");

  const block: ContextBlock = {
    id: "skillweaver:route",
    source: "skillweaver",
    text,
    priority: 10,
    tokenEstimate: estimateTokens(text),
    metadata: {
      matchedSkills: skills.map((s) => s.name),
      subTasks,
      ...(decomposerModel ? { decomposerModel } : {}),
    },
  };

  return { prependContext: [block] };
}
```

## Allowed moves

Create exactly `extensions/skillweaver/src/context-injector.ts` and its test. No other files. The types `ContextBlock` and `PromptContribution` are inlined here (no import from plugin-sdk) to keep the unit test self-contained; they match the WednesdayAI SDK shapes structurally.

## STOP triggers

- `prependContext` block has `id` other than `"skillweaver:route"`
- `priority` outside 10-20 range (must not trample other plugins)
- Empty skills array returns non-empty contribution or throws
- tokenEstimate uses wrong divisor (char/4 for English is the standard heuristic)

## Done when

`WAI_TYPECHECK_CMD="cd extensions/skillweaver && pnpm exec tsc --noEmit" WAI_TEST_CMD="cd extensions/skillweaver && npx vitest run src/context-injector.test.ts" bash ~/.claude/wai/scripts/task-gate.sh plugin-skillweaver 012` exits 0