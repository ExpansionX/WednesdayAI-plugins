import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

// These files are artifacts emitted by the WAI DAG orchestrator while
// attempting to execute the plugin-skillweaver plan (docs/plans/plugin-skillweaver).
// They record three consecutive failed attempts at task "001" before the
// plan was eventually completed manually. These tests validate the
// structural shape of each artifact and cross-check consistency between
// the `.jsonl` run records, their paired `.md` summaries, and the final
// `.wai-run-state.json` snapshot.

const repoRoot = path.resolve(import.meta.dirname!, "..", "..");
const plansRoot = path.join(repoRoot, "docs", "plans", "plugin-skillweaver");

function read(relativePath: string): string {
  const filePath = path.join(plansRoot, relativePath);
  expect(existsSync(filePath)).toBe(true);
  return readFileSync(filePath, "utf-8");
}

interface DagRunRecord {
  task_id: string;
  status: string;
  attempts: number;
  executor: string;
  stop_reason: string;
}

function parseJsonl(content: string): DagRunRecord[] {
  return content
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as DagRunRecord);
}

describe(".dag-gate-001-1.log", () => {
  it("records the pnpm workspace permission failure", () => {
    const content = read(".dag-gate-001-1.log").trim();
    expect(content).toBe("env: extensions/skillweaver: Permission denied");
  });
});

describe(".dag-worker-001-1.json", () => {
  it("is valid JSON describing a completed task 001", () => {
    const parsed = JSON.parse(read(".dag-worker-001-1.json"));
    expect(parsed.done).toBe(true);
    expect(parsed.stop_reason).toBe("");
    expect(parsed.files_changed).toEqual([
      "extensions/skillweaver/package.json",
      "extensions/skillweaver/openclaw.plugin.json",
      "extensions/skillweaver/tsconfig.json",
    ]);
  });

  it("includes evidence entries confirming manifest field values", () => {
    const parsed = JSON.parse(read(".dag-worker-001-1.json"));
    expect(Array.isArray(parsed.evidence)).toBe(true);
    expect(parsed.evidence.length).toBeGreaterThan(0);
    expect(parsed.evidence.some((e: string) => e.includes("@wednesdayai/skillweaver"))).toBe(true);
    expect(parsed.evidence.some((e: string) => e.includes("NodeNext"))).toBe(true);
  });
});

describe(".dag-worker-001-1.log", () => {
  it("is a single-line JSON record of type result/success", () => {
    const content = read(".dag-worker-001-1.log").trim();
    const lines = content.split(/\r?\n/);
    expect(lines).toHaveLength(1);

    const parsed = JSON.parse(lines[0]);
    expect(parsed.type).toBe("result");
    expect(parsed.subtype).toBe("success");
    expect(parsed.is_error).toBe(false);
    expect(parsed.terminal_reason).toBe("completed");
  });

  it("embeds a result payload consistent with .dag-worker-001-1.json", () => {
    const content = read(".dag-worker-001-1.log").trim();
    const parsed = JSON.parse(content);
    const codeBlockMatch = (parsed.result as string).match(/```json\n([\s\S]*?)\n```/);
    expect(codeBlockMatch).not.toBeNull();
    const embedded = JSON.parse(codeBlockMatch![1]);
    const sibling = JSON.parse(read(".dag-worker-001-1.json"));
    expect(embedded).toEqual(sibling);
  });
});

describe(".wai-dag-plan-commit", () => {
  it("contains a single 40-character git SHA", () => {
    const content = read(".wai-dag-plan-commit").trim();
    expect(content).toMatch(/^[0-9a-f]{40}$/);
  });
});

describe(".wai-dag-wr-sha", () => {
  it("references the WAI DAG runner script at HEAD", () => {
    const content = read(".wai-dag-wr-sha").trim();
    expect(content).toBe("HEAD:plugins/wai/scripts/wai-dag-run.sh");
    expect(content).toMatch(/^[^:]+:.+\.sh$/);
  });
});

describe("dag-run-*.jsonl / dag-run-*.md pairs", () => {
  const runs: Array<{ runId: string; record: DagRunRecord }> = [
    {
      runId: "20260707T211728Z-61314",
      record: {
        task_id: "001",
        status: "stopped",
        attempts: 0,
        executor: "claude",
        stop_reason:
          "orchestrator-abort:worker-stopped: 0: typecheck (WAI_TYPECHECK_CMD) failed: pnpm cannot authenticate with registry to fetch dependencies (hnswlib-node, typescript, vitest). Files are valid JSON and structurally correct; failure is environmental (pnpm auth/network issue), not task spec violation.",
      },
    },
    {
      runId: "20260707T212249Z-85203",
      record: {
        task_id: "001",
        status: "failed",
        attempts: 0,
        executor: "claude",
        stop_reason: "precondition-violated:not-retried: extensions/skillweaver/package.json already exists (introduced by 4514841)",
      },
    },
    {
      runId: "20260707T212425Z-89115",
      record: {
        task_id: "001",
        status: "failed",
        attempts: 1,
        executor: "claude",
        stop_reason: "orchestrator-abort:deadlock: no ready task and dispatch stalled",
      },
    },
  ];

  for (const { runId, record } of runs) {
    describe(`run ${runId}`, () => {
      it("jsonl file contains exactly one record matching the expected shape", () => {
        const content = read(`dag-run-${runId}.jsonl`);
        const records = parseJsonl(content);
        expect(records).toHaveLength(1);
        expect(records[0]).toEqual(record);
      });

      it("md summary references the same run_id and final_state", () => {
        const md = read(`dag-run-${runId}.md`);
        expect(md).toContain(`run_id: ${runId}`);
        expect(md).toContain("final_state: Failed");
        expect(md).toMatch(/^# DAG run report — plugin-skillweaver$/m);
      });

      it("md summary table row matches the jsonl record for the task", () => {
        const md = read(`dag-run-${runId}.md`);
        const tableRow = md
          .split(/\r?\n/)
          .find((line) => line.trim().startsWith(`| ${record.task_id} |`));
        expect(tableRow).toBeDefined();
        const cells = tableRow!
          .split("|")
          .slice(1, -1)
          .map((c) => c.trim());
        const [taskId, status, attempts, executor, stopReason] = cells;
        expect(taskId).toBe(record.task_id);
        expect(status).toBe(record.status);
        expect(Number(attempts)).toBe(record.attempts);
        expect(executor).toBe(record.executor);
        expect(stopReason).toBe(record.stop_reason);
      });

      it("md summary counts line reflects a single non-passed outcome", () => {
        const md = read(`dag-run-${runId}.md`);
        const countsLine = md.split(/\r?\n/).find((line) => line.startsWith("passed:"));
        expect(countsLine).toBeDefined();
        const counts = Object.fromEntries(
          [...countsLine!.matchAll(/(passed|failed|blocked|stopped):\s*(\d+)/g)].map(
            (m): [string, number] => [m[1], Number(m[2])],
          ),
        ) as Record<string, number>;
        expect(counts.passed).toBe(0);
        // exactly one of failed/stopped should be 1, the rest 0, for these single-task runs
        const total = counts.failed + counts.blocked + counts.stopped;
        expect(total).toBe(1);
        expect(counts[record.status]).toBe(1);
      });
    });
  }

  it("run ids are in ascending chronological order across the three attempts", () => {
    const ids = runs.map((r) => r.runId.split("-")[0]);
    const sorted = [...ids].sort();
    expect(ids).toEqual(sorted);
  });
});

describe(".wai-run-state.json", () => {
  it("is valid JSON reflecting the final failed run state for task 001", () => {
    const state = JSON.parse(read(".wai-run-state.json"));
    expect(state.topic).toBe("plugin-skillweaver");
    expect(state.completedTaskIds).toEqual([]);
    expect(state.failedTaskIds).toEqual(["001"]);
    expect(state.currentTaskId).toBeNull();
    expect(state.blockedTaskIds).toEqual([]);
    expect(state.attentionItems).toEqual([]);
    expect(state.phase).toBe("Failed");
    expect(state.attempts).toBe("001=1");
  });

  it("lists pendingTaskIds 002-018 in ascending order", () => {
    const state = JSON.parse(read(".wai-run-state.json"));
    const expected = Array.from({ length: 17 }, (_, i) => String(i + 2).padStart(3, "0"));
    expect(state.pendingTaskIds).toEqual(expected);
  });

  it("reportJournal matches the stop_reason of the final dag-run attempt", () => {
    const state = JSON.parse(read(".wai-run-state.json"));
    const finalRunJsonl = read("dag-run-20260707T212425Z-89115.jsonl");
    const [finalRecord] = parseJsonl(finalRunJsonl);
    expect(state.reportJournal).toContain(finalRecord.stop_reason);
    expect(state.reportJournal).toContain(finalRecord.task_id);
    expect(state.reportJournal).toContain(finalRecord.status);
  });

  it("runId matches the most recent dag-run artifact", () => {
    const state = JSON.parse(read(".wai-run-state.json"));
    expect(state.runId).toBe("20260707T212425Z-89115");
    expect(existsSync(path.join(plansRoot, `dag-run-${state.runId}.md`))).toBe(true);
    expect(existsSync(path.join(plansRoot, `dag-run-${state.runId}.jsonl`))).toBe(true);
  });

  it("lastUpdated is a valid ISO-8601 timestamp", () => {
    const state = JSON.parse(read(".wai-run-state.json"));
    expect(state.lastUpdated).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    expect(Number.isNaN(new Date(state.lastUpdated).getTime())).toBe(false);
  });
});