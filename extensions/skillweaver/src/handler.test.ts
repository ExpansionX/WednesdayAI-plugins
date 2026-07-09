import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

const mockDecomposer = { decompose: vi.fn(), dispose: vi.fn() };
const mockRetriever = { retrieve: vi.fn(), buildHintSet: vi.fn() };
const mockFormatSkillContext = vi.fn();

vi.mock("./context-injector.js", () => ({ formatSkillContext: mockFormatSkillContext }));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let createCollectHandler: any;

describe("createCollectHandler", () => {
  beforeAll(async () => {
    const mod = await import("./handler.js");
    createCollectHandler = mod.createCollectHandler;
  });

  beforeEach(() => {
    vi.useRealTimers();
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

  it("handles retriever search failure gracefully", async () => {
    mockDecomposer.decompose.mockResolvedValueOnce({
      subTasks: ["task1"], hints: [], pass: 1,
    });
    mockRetriever.retrieve.mockRejectedValueOnce(new Error("index corrupt"));
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

  it("filters empty-string subtasks from Pass-1 result", async () => {
    mockDecomposer.decompose.mockResolvedValueOnce({
      subTasks: ["", "  ", "  task1  ", ""], hints: [], pass: 1,
    });
    mockRetriever.retrieve.mockResolvedValue([]);
    mockFormatSkillContext.mockReturnValueOnce({ prependContext: [] });

    const handler = createCollectHandler({
      decomposer: mockDecomposer as never,
      retriever: mockRetriever as never,
      sadEnabled: false,
      minQueryLength: 5,
      decomposerModel: "test",
    });

    await handler(baseEvent);
    // retriever should receive only the non-empty subtask
    expect(mockRetriever.retrieve).toHaveBeenCalledWith(["task1"], expect.any(AbortSignal));
  });

  it("falls back to Pass-1 results when Pass-2 filtered is empty", async () => {
    mockDecomposer.decompose
      .mockResolvedValueOnce({ subTasks: ["task1"], hints: [], pass: 1 })
      .mockResolvedValueOnce({ subTasks: ["", "  "], hints: [], pass: 2 });
    mockRetriever.buildHintSet.mockResolvedValue([
      { name: "github", description: "Git" },
    ]);
    mockRetriever.retrieve.mockResolvedValue([]);
    mockFormatSkillContext.mockReturnValueOnce({ prependContext: [] });

    const handler = createCollectHandler({
      decomposer: mockDecomposer as never,
      retriever: mockRetriever as never,
      sadEnabled: true,
      minQueryLength: 5,
      decomposerModel: "test",
    });

    await handler(baseEvent);
    // Should use pass-1 subtasks since pass-2 filtered to empty
    expect(mockRetriever.retrieve).toHaveBeenCalledWith(["task1"], expect.any(AbortSignal));
  });

  it("skips SAD Pass-2 when hints are empty", async () => {
    mockDecomposer.decompose
      .mockResolvedValueOnce({ subTasks: ["task1"], hints: [], pass: 1 });
    mockRetriever.buildHintSet.mockResolvedValue([]);
    mockRetriever.retrieve.mockResolvedValue([]);
    mockFormatSkillContext.mockReturnValueOnce({ prependContext: [] });

    const handler = createCollectHandler({
      decomposer: mockDecomposer as never,
      retriever: mockRetriever as never,
      sadEnabled: true,
      minQueryLength: 5,
      decomposerModel: "test",
    });

    await handler(baseEvent);
    // Only 1 decompose call — pass-2 skipped because hints empty
    expect(mockDecomposer.decompose).toHaveBeenCalledTimes(1);
  });

  it("handles null/undefined cleanUserMessage", async () => {
    const handler = createCollectHandler({
      decomposer: mockDecomposer as never,
      retriever: mockRetriever as never,
      sadEnabled: true,
      minQueryLength: 20,
      decomposerModel: "test",
    });

    const result = await handler({ ...baseEvent, cleanUserMessage: undefined as never });
    expect(result).toEqual({});
  });

  it("does not crash on malformed envelope", async () => {
    const handler = createCollectHandler({
      decomposer: mockDecomposer as never,
      retriever: mockRetriever as never,
      sadEnabled: true,
      minQueryLength: 20,
      decomposerModel: "test",
    });

    const result = await handler({ ...baseEvent, envelope: null as never });
    expect(result).toEqual({});
  });

  it("shares a single timeout budget across both SAD passes", async () => {
    let capturedSignal: AbortSignal | undefined;
    mockDecomposer.decompose.mockImplementation(async (_q: string, _h: unknown, _m: unknown, signal?: AbortSignal) => {
      capturedSignal = signal;
      return { subTasks: ["task1"], hints: [], pass: 1 };
    });
    mockRetriever.buildHintSet.mockResolvedValue([{ name: "github", description: "Git" }]);
    mockRetriever.retrieve.mockResolvedValue([]);
    mockFormatSkillContext.mockReturnValueOnce({ prependContext: [] });

    const handler = createCollectHandler({
      decomposer: mockDecomposer as never,
      retriever: mockRetriever as never,
      sadEnabled: true,
      minQueryLength: 5,
      decomposerModel: "test",
      decomposerTimeoutMs: 5000,
    });

    await handler(baseEvent);
    expect(capturedSignal).toBeDefined();
    expect(capturedSignal).toBeInstanceOf(AbortSignal);
    expect(mockDecomposer.decompose).toHaveBeenCalledTimes(2);
    const pass1Signal = mockDecomposer.decompose.mock.calls[0][3];
    const pass2Signal = mockDecomposer.decompose.mock.calls[1][3];
    expect(pass1Signal).toBe(pass2Signal);
  });

  it("returns empty when decomposer ignores AbortSignal and exceeds timeout", async () => {
    vi.useFakeTimers();
    mockDecomposer.decompose.mockReturnValueOnce(new Promise(() => {}));

    const handler = createCollectHandler({
      decomposer: mockDecomposer as never,
      retriever: mockRetriever as never,
      sadEnabled: false,
      minQueryLength: 5,
      decomposerModel: "test",
      decomposerTimeoutMs: 10,
    });

    const resultPromise = handler(baseEvent);
    await vi.advanceTimersByTimeAsync(20);

    await expect(resultPromise).resolves.toEqual({});
    expect(mockRetriever.retrieve).not.toHaveBeenCalled();
  });

  it("clears timeout on early return (empty subtasks)", async () => {
    mockDecomposer.decompose.mockResolvedValueOnce({ subTasks: [], hints: [], pass: 1 });

    const handler = createCollectHandler({
      decomposer: mockDecomposer as never,
      retriever: mockRetriever as never,
      sadEnabled: false,
      minQueryLength: 5,
      decomposerModel: "test",
      decomposerTimeoutMs: 100,
    });

    const result = await handler(baseEvent);
    expect(result).toEqual({});
  });

  it("aborts retriever work when retrieval timeout expires", async () => {
    vi.useFakeTimers();
    let capturedSignal: AbortSignal | undefined;
    mockDecomposer.decompose.mockResolvedValueOnce({ subTasks: ["task1"], hints: [], pass: 1 });
    mockRetriever.retrieve.mockImplementationOnce((_subTasks: string[], signal?: AbortSignal) => {
      capturedSignal = signal;
      return new Promise(() => {});
    });

    const handler = createCollectHandler({
      decomposer: mockDecomposer as never,
      retriever: mockRetriever as never,
      sadEnabled: false,
      minQueryLength: 5,
      decomposerModel: "test",
      retrievalTimeoutMs: 10,
    });

    const resultPromise = handler(baseEvent);
    await vi.advanceTimersByTimeAsync(20);

    await expect(resultPromise).resolves.toEqual({});
    expect(capturedSignal).toBeDefined();
    expect(capturedSignal!.aborted).toBe(true);
  });
});
