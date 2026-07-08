import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

const mockDecomposer = { decompose: vi.fn(), dispose: vi.fn() };
const mockRetriever = { retrieve: vi.fn(), buildHintSet: vi.fn() };
const mockFormatSkillContext = vi.fn();

vi.mock("./context-injector.js", () => ({ formatSkillContext: mockFormatSkillContext }));
vi.mock("wednesdayai/plugin-sdk", () => ({
  createSubsystemLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let createCollectHandler: any;

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
