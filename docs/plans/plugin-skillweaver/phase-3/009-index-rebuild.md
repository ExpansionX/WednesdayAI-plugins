---
id: "009"
phase: 3
title: Add debounced fs.watch rebuild to SkillIndex for live skill file changes
status: ready
depends_on: ["008"]
parallel: false
conflicts_with: []
files:
  - extensions/skillweaver/src/skill-index.ts
irreversible: false
scope_test: "extensions/skillweaver/src/skill-index.test.ts"
allowed_change: edit
covers_criteria: [SC1]
---
## Failing test (write first)

Add these tests to `extensions/skillweaver/src/skill-index.test.ts`:

```ts
// ==== Add to existing describe("SkillIndex", () => { ... }) block ====

  describe("watch() / rebuild", () => {
    it("watch() starts a file watcher", async () => {
      const index = new SkillIndex(mockBackend);
      await index.build(sampleSkills);
      const watcher = index.watch("/tmp/skills", () => [...sampleSkills]);
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
      index.watch("/tmp/skills", () => [...sampleSkills]);
      const closed = index.unwatch();
      expect(closed).toBe(true);
    });

    it("unwatch() returns false when no watcher active", () => {
      const index = new SkillIndex(mockBackend);
      expect(index.unwatch()).toBe(false);
    });

    it("second watch() closes the first watcher", async () => {
      const index = new SkillIndex(mockBackend);
      await index.build(sampleSkills);
      const w1 = index.watch("/tmp/skills", () => [...sampleSkills]);
      const w2 = index.watch("/tmp/skills", () => [...sampleSkills]);
      expect(w1?.close).toBeDefined();
      expect(w2?.close).toBeDefined();
      w2?.close();
    });

    it("calls skillProvider and rebuilds after debounce", async () => {
      vi.useFakeTimers();
      const index = new SkillIndex(mockBackend);
      await index.build(sampleSkills);

      const freshSkills: SkillEntry[] = [
        { name: "github", description: "Updated github skill", location: "/x", source: "bundled" },
      ];

      let callCount = 0;
      const provider = () => {
        callCount++;
        return callCount === 1 ? sampleSkills : freshSkills;
      };

      const watcher = index.watch("/tmp/skills", provider, { debounceMs: 100 });
      expect(watcher).toBeDefined();

      // Trigger a change event
      (watcher as unknown as { _emit: (e: string, f: string) => void })._emit?.("change", "somefile.md") ??
        watcher?.emit?.("change", "somefile.md");

      // Fast-forward past debounce
      await vi.advanceTimersToNextTimerAsync();
      await vi.runAllTimersAsync();

      expect(callCount).toBeGreaterThanOrEqual(1);

      watcher?.close();
      vi.useRealTimers();
    });
  });
```

## Change

**File:** `extensions/skillweaver/src/skill-index.ts`
**Anchor:** `SkillIndex` class — add watch/unwatch fields + method after the existing fields/methods
**Before:**
```ts
export class SkillIndex {
  private backend: EmbeddingBackend;
  private skills = new Map<string, IndexedSkill>();
  private index: Awaited<ReturnType<typeof this.createHnsw>> | null = null;

  constructor(backend: EmbeddingBackend) {
    this.backend = backend;
  }
```
**After:**
```ts
import { watch } from "node:fs";

export interface WatchOptions {
  debounceMs?: number;
}

export class SkillIndex {
  private backend: EmbeddingBackend;
  private skills = new Map<string, IndexedSkill>();
  private index: Awaited<ReturnType<typeof this.createHnsw>> | null = null;
  private watcher: ReturnType<typeof watch> | null = null;
  private rebuildTimer: ReturnType<typeof setTimeout> | null = null;
  private watchDir: string | null = null;

  constructor(backend: EmbeddingBackend) {
    this.backend = backend;
  }
```

And add these methods before `dispose()`:

**Before:**
```ts
  dispose(): void {
    this.index = null;
    this.skills.clear();
  }
```
**After:**
```ts
  watch(
    dir: string,
    skillProvider: () => SkillEntry[],
    opts: WatchOptions = {},
  ): ReturnType<typeof watch> | null {
    this.unwatch();
    try {
      const w = watch(dir, { persistent: false, recursive: true }, (_event, filename) => {
        if (!filename?.endsWith(".md")) return;
        if (this.rebuildTimer) clearTimeout(this.rebuildTimer);
        this.rebuildTimer = setTimeout(async () => {
          try {
            const entries = skillProvider();
            await this.build(entries);
          } catch (err) {
            log.error("rebuild failed", { error: String(err) });
          }
        }, opts.debounceMs ?? 2000);
      });
      this.watcher = w;
      this.watchDir = dir;
      return w;
    } catch {
      return null;
    }
  }

  unwatch(): boolean {
    if (this.rebuildTimer) {
      clearTimeout(this.rebuildTimer);
      this.rebuildTimer = null;
    }
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
      this.watchDir = null;
      return true;
    }
    return false;
  }

  dispose(): void {
    this.unwatch();
    this.index = null;
    this.skills.clear();
  }
```

## Allowed moves

Only modify `extensions/skillweaver/src/skill-index.ts`: add the watcher field + `watch()` + `unwatch()` methods, update `dispose()` to call `unwatch()`. Add the test cases above to the existing test file. Do NOT change any existing method signatures. Do NOT add new files.

## STOP triggers

- `watch()` method changes the return type of `build()` or `search()`
- `dispose()` is called without cleaning up the watcher
- The `import("node:fs")` dynamic import causes a type error — if so, use `import { watch } from "node:fs"` as a top-level import instead

## Done when

`WAI_TYPECHECK_CMD="cd extensions/skillweaver && pnpm exec tsc --noEmit" WAI_TEST_CMD="cd extensions/skillweaver && npx vitest run src/skill-index.test.ts" bash ~/.claude/wai/scripts/task-gate.sh plugin-skillweaver 009` exits 0