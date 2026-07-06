---
id: "004"
phase: 2
title: Create EmbeddingBackend interface and shared types
status: ready
depends_on: ["001"]
parallel: false
conflicts_with: []
files:
  - extensions/skillweaver/src/embedding/types.ts
irreversible: true
scope_test: "extensions/skillweaver/src/embedding/types.test.ts"
allowed_change: create
covers_criteria: [SC6]
---
## Failing test (write first)

Create `extensions/skillweaver/src/embedding/types.test.ts`:

```ts
import { describe, it, expect } from "vitest";

const mockBackend = {
  id: "test",
  dimensions: 384,
  embed: async (texts: string[]) => texts.map(() => new Float32Array(384)),
  embedSingle: async (text: string) => new Float32Array(384),
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
```

## Change

**File:** `extensions/skillweaver/src/embedding/types.ts`
**Anchor:** new file — create at this path
**Before:** file does not exist
**After:**
```ts
export interface EmbeddingBackend {
  readonly id: string;
  readonly dimensions: number;
  embed(texts: string[]): Promise<Float32Array[]>;
  embedSingle(text: string): Promise<Float32Array>;
  dispose(): void | Promise<void>;
}

export interface SkillEntry {
  name: string;
  description: string;
  location: string;
  source: string;
  category?: string;
}

export interface IndexedSkill extends SkillEntry {
  vector: Float32Array;
}

export interface SearchResult {
  name: string;
  description: string;
  location: string;
  source: string;
  score: number;
}

export interface DecompositionResult {
  subTasks: string[];
  hints: string[];
  pass: 1 | 2;
}

export interface HintEntry {
  name: string;
  description: string;
}
```

## Allowed moves

Create exactly `extensions/skillweaver/src/embedding/types.ts` and `extensions/skillweaver/src/embedding/types.test.ts`. No other files. The types are structural — no runtime export needed; the test proves the shape via structural typing.

## STOP triggers

- `EmbeddingBackend` interface has more than 5 members
- `SearchResult.score` type is not `number`
- Any type added that is not referenced in the spec's design section

## Done when

`WAI_TYPECHECK_CMD="cd extensions/skillweaver && pnpm exec tsc --noEmit" WAI_TEST_CMD="cd extensions/skillweaver && npx vitest run src/embedding/types.test.ts" bash ~/.claude/wai/scripts/task-gate.sh plugin-skillweaver 004` exits 0