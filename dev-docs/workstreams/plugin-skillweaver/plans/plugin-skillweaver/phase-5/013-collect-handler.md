---
id: "013"
phase: 5
title: Create context.collect handler — full pipeline: decompose → retrieve → inject; sub-agent filter; short query skip
status: ready
depends_on: ["003", "008", "010", "011", "012"]
parallel: false
conflicts_with: []
files:
  - extensions/skillweaver/src/handler.ts
  - extensions/skillweaver/src/handler.test.ts
irreversible: false
scope_test: "extensions/skillweaver/src/handler.test.ts"
allowed_change: create
covers_criteria: [SC1, SC2, SC3, SC4, SC5, SC7]
---
## Failing test (write first)

Create `extensions/skillweaver/src/handler.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockDecomposer = { decompose: vi.fn(), dispose: vi.fn() };
const mockRetriever = { retrieve: vi.fn(), buildHintSet: vi.fn() };
const mockFormatSkillContext = vi.fn();

vi.doMock("./context-injector.js", () => ({ formatSkillContext: mockFormatSkillContext }));

let createCollectHandler: Function;

describe("createCollectHandler", () => {
  beforeAll(async () => {
    const mod = await import("./handler.js");
    createCollectHandler = mod.createCollectHandler;
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  const baseEvent = {
    cleanUserMessage: { text: "download this dataset and analyze it then send a report to slack" },
    messages: [],
    envelope: {},
    storage: undefined,
  };

  it("returns empty for short query (below minQueryLength)", async () => {
    const handler = createCollectHandler({
      decomposer: mockDecomposer as never,
      retriever: mockRetriever as never,
      sadEnabled: true,
      minQueryLength: 20,
      decomposerModel: "test",
    });

    const result = await handler({
      ...baseEvent,
      cleanUserMessage: { text: "hi" },
    });

    expect(result).toEqual({});
    expect(mockDecomposer.decompose).not.toHaveBeenCalled();
  });

  it("returns empty when no text in cleanUserMessage", async () => {
    const handler = createCollectHandler({
      decomposer: mockDecomposer as never,
      retriever: mockRetriever as never,
      sadEnabled: true,
      minQueryLength: 20,
      decomposerModel: "test",
    });

    const result = await handler({
      ...baseEvent,
      cleanUserMessage: { text: "" } as never,
    });

    expect(result).toEqual({});
  });

  it("returns empty when enabled is false", async () => {
    const handler = createCollectHandler({
      decomposer: mockDecomposer as never,
      retriever: mockRetriever as never,
      sadEnabled: true,
      minQueryLength: 20,
      decomposerModel: "test",
      enabled: false,
    });

    const result = await handler(baseEvent);
    expect(result).toEqual({});
  });

  it("runs Pass-1 decompose and returns results (no SAD)", async () => {
    mockDecomposer.decompose.mockResolvedValueOnce({
      subTasks: ["download dataset", "analyze data", "send to slack"],
      hints: [],
      pass: 1,
    });
    mockRetriever.retrieve.mockResolvedValue([
      { name: "github", description: "Git", location: "/x", source: "bundled", score: 0.9 },
      { name: "slack", description: "Slack", location: "/x", source: "bundled", score: 0.85 },
    ]);
    mockFormatSkillContext.mockReturnValueOnce({
      prependContext: [{ id: "skillweaver:route", source: "skillweaver", text: "## Skill Routing\n..." }],
    });

    const handler = createCollectHandler({
      decomposer: mockDecomposer as never,
      retriever: mockRetriever as never,
      sadEnabled: false,
      minQueryLength: 20,
      decomposerModel: "test",
    });

    const result = await handler(baseEvent);
    expect(result.prependContext).toBeDefined();
    expect(mockDecomposer.decompose).toHaveBeenCalledTimes(1);
    expect(mockRetriever.retrieve).toHaveBeenCalledTimes(1);
  });

  it("runs SAD (2-pass) when sadEnabled is true", async () => {
    mockDecomposer.decompose
      .mockResolvedValueOnce({ subTasks: ["task1", "task2", "task3"], hints: [], pass: 1 })
      .mockResolvedValueOnce({ subTasks: ["refined task1", "refined task2"], hints: [], pass: 2 });
    mockRetriever.buildHintSet.mockResolvedValue([
      { name: "github", description: "Git" },
      { name: "slack", description: "Slack" },
    ]);
    mockRetriever.retrieve.mockResolvedValue([]);
    mockFormatSkillContext.mockReturnValueOnce({ prependContext: [] });

    const handler = createCollectHandler({
      decomposer: mockDecomposer as never,
      retriever: mockRetriever as never,
      sadEnabled: true,
      minQueryLength: 20,
      decomposerModel: "test",
    });

    await handler(baseEvent);
    expect(mockDecomposer.decompose).toHaveBeenCalledTimes(2);
    expect(mockRetriever.buildHintSet).toHaveBeenCalledTimes(1);
  });

  it("skips SAD Pass-2 when Pass-1 returns empty sub-tasks", async () => {
    mockDecomposer.decompose.mockResolvedValueOnce({ subTasks: [], hints: [], pass: 1 });
    mockFormatSkillContext.mockReturnValueOnce({});

    const handler = createCollectHandler({
      decomposer: mockDecomposer as never,
      retriever: mockRetriever as never,
      sadEnabled: true,
      minQueryLength: 20,
      decomposerModel: "test",
    });

    const result = await handler(baseEvent);
    expect(result).toEqual({});
    expect(mockDecomposer.decompose).toHaveBeenCalledTimes(1);
  });

  it("skips routing for sub-agent events", async () => {
    const handler = createCollectHandler({
      decomposer: mockDecomposer as never,
      retriever: mockRetriever as never,
      sadEnabled: true,
      minQueryLength: 20,
      decomposerModel: "test",
    });

    const result = await handler({
      ...baseEvent,
      envelope: { isSubAgent: true },
    });

    expect(result).toEqual({});
    expect(mockDecomposer.decompose).not.toHaveBeenCalled();
  });

  it("catches decomposer errors gracefully", async () => {
    mockDecomposer.decompose.mockRejectedValueOnce(new Error("API failure"));
    mockFormatSkillContext.mockReturnValueOnce({});

    const handler = createCollectHandler({
      decomposer: mockDecomposer as never,
      retriever: mockRetriever as never,
      sadEnabled: false,
      minQueryLength: 20,
      decomposerModel: "test",
    });

    const result = await handler(baseEvent);
    expect(result).toEqual({});
  });
});
```

## Change

**File:** `extensions/skillweaver/src/handler.ts`
**Anchor:** new file — create at this path
**Before:** file does not exist
**After:**
```ts
import type { Decomposer } from "./decomposer.js";
import type { Retriever } from "./retriever.js";
import { formatSkillContext } from "./context-injector.js";
import { createSubsystemLogger } from "wednesdayai/plugin-sdk";

const log = createSubsystemLogger("skillweaver/handler");

interface CollectEvent {
  cleanUserMessage?: { text?: string };
  messages?: unknown[];
  envelope?: Record<string, unknown>;
  prompt?: string;
  storage?: unknown;
}

interface CollectResult {
  prependContext?: Array<Record<string, unknown>>;
}

export interface HandlerOptions {
  decomposer: Decomposer;
  retriever: Retriever;
  sadEnabled: boolean;
  minQueryLength: number;
  decomposerModel: string;
  enabled?: boolean;
}

export function createCollectHandler(opts: HandlerOptions) {
  return async (event: CollectEvent): Promise<CollectResult> => {
    if (opts.enabled === false) return {};

    const text = event.cleanUserMessage?.text ?? "";
    if (text.length < opts.minQueryLength) return {};

    if (event.envelope?.["isSubAgent"]) return {};

    try {
      const pass1Result = await opts.decomposer.decompose(text);
      if (pass1Result.subTasks.length === 0) return {};

      let subTasks: string[];

      if (opts.sadEnabled && pass1Result.subTasks.length > 0) {
        const hints = await opts.retriever.buildHintSet(pass1Result.subTasks);
        if (hints.length > 0) {
          const pass2Result = await opts.decomposer.decompose(text, hints);
          subTasks = pass2Result.subTasks.length > 0 ? pass2Result.subTasks : pass1Result.subTasks;
        } else {
          subTasks = pass1Result.subTasks;
        }
      } else {
        subTasks = pass1Result.subTasks;
      }

      const results = await opts.retriever.retrieve(subTasks);
      const contribution = formatSkillContext(results, text, subTasks, opts.decomposerModel);

      if (contribution.prependContext && contribution.prependContext.length > 0) {
        log.info("routing complete", {
          subTasks: subTasks.length,
          skillsMatched: results.length,
          pass: opts.sadEnabled ? 2 : 1,
        });
      }

      return contribution as CollectResult;
    } catch (err) {
      log.error("handler error", { error: String(err) });
      return {};
    }
  };
}
```

## Allowed moves

Create exactly `extensions/skillweaver/src/handler.ts` and its test. Types `CollectEvent` and `CollectResult` are inlined interfaces matching the SDK shapes structurally.

## STOP triggers

- `context.collect` handler throws uncaught (must catch all and return `{}`)
- Sub-agent detection uses wrong property path (actual SDK uses `envelope.isSubAgent` or similar — verify against SDK types)
- Pass-2 runs when Pass-1 returns 0 sub-tasks

## Done when

`WAI_TYPECHECK_CMD="cd extensions/skillweaver && pnpm exec tsc --noEmit" WAI_TEST_CMD="cd extensions/skillweaver && npx vitest run src/handler.test.ts" bash ~/.claude/wai/scripts/task-gate.sh plugin-skillweaver 013` exits 0