import { describe, it, expect } from "vitest";

const mockBackend = {
  id: "test",
  dimensions: 384,
  embed: async (texts: string[]) => texts.map(() => new Float32Array(384)),
  embedSingle: async (_text: string) => new Float32Array(384),
  dispose: () => {},
};

describe("EmbeddingBackend interface (structural type)", () => {
  it("has required shape: id, dimensions, embed, embedSingle, dispose", () => {
    expect(typeof mockBackend.id).toBe("string");
    expect(typeof mockBackend.dimensions).toBe("number");
    expect(typeof mockBackend.embed).toBe("function");
    expect(typeof mockBackend.embedSingle).toBe("function");
    expect(typeof mockBackend.dispose).toBe("function");
  });

  it("embed returns Float32Array per input text", async () => {
    const results = await mockBackend.embed(["hello", "world"]);
    expect(results).toHaveLength(2);
    expect(results[0]).toBeInstanceOf(Float32Array);
    expect(results[1]).toBeInstanceOf(Float32Array);
  });

  it("embedSingle returns Float32Array", async () => {
    const result = await mockBackend.embedSingle("hello");
    expect(result).toBeInstanceOf(Float32Array);
  });

  it("dispose is callable without throw", () => {
    expect(() => mockBackend.dispose()).not.toThrow();
  });
});
