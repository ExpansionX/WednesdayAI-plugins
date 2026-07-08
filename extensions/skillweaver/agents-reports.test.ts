import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

// This PR adds a series of adversarial "tournament" review reports plus an
// implementation review under .agents/reports/. These tests validate the
// structural integrity of those reports: that scoring tables are internally
// consistent (the declared winner really has the highest score), that
// required sections are present, and that the reports agree with each
// other on cross-cutting facts (e.g. test counts).

const repoRoot = path.resolve(import.meta.dirname!, "..", "..");
const reportsRoot = path.join(repoRoot, ".agents", "reports");

function read(fileName: string): string {
  const filePath = path.join(reportsRoot, fileName);
  expect(existsSync(filePath)).toBe(true);
  return readFileSync(filePath, "utf-8");
}

interface ScoreRow {
  challenger: string;
  issuesFound: number;
  valid: number;
  remediationsAccepted: number;
  score: number;
}

function parseScoringTable(content: string): ScoreRow[] {
  const lines = content.split(/\r?\n/);
  const startIdx = lines.findIndex((l) => l.trim().startsWith("| Challenger"));
  if (startIdx === -1) throw new Error("scoring table header not found");
  const rows: ScoreRow[] = [];
  for (let i = startIdx + 2; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim().startsWith("|")) break;
    const cells = line.split("|").slice(1, -1).map((c) => c.trim());
    if (cells.length < 5) break;
    rows.push({
      challenger: cells[0],
      issuesFound: Number(cells[1]),
      valid: Number(cells[2]),
      remediationsAccepted: Number(cells[3]),
      score: Number(cells[4]),
    });
  }
  return rows;
}

function parseWinnerLine(content: string): { label: string; score: number } {
  const match = content.match(/\*\*Winner:\s*(.+?)\*\*\s*—\s*(\d+)\s*points/);
  if (!match) throw new Error("winner line not found");
  return { label: match[1].trim(), score: Number(match[2]) };
}

describe("tournament round reports", () => {
  const rounds = [
    { file: "2026-07-08-r1-tournament-round1.md", round: 1, testCount: 116, note: "was 115" },
    { file: "2026-07-08-r2-tournament-round2.md", round: 2, testCount: 116 },
    { file: "2026-07-08-r3-tournament-round3.md", round: 3, testCount: 116 },
    { file: "2026-07-08-r4-tournament-round4.md", round: 4, testCount: 116 },
    { file: "2026-07-08-r5-tournament-round5.md", round: 5, testCount: 116 },
  ];

  for (const { file, round, testCount } of rounds) {
    describe(file, () => {
      it(`has a top-level heading for Tournament Round ${round}`, () => {
        const content = read(file);
        expect(content).toMatch(new RegExp(`^# Tournament Round ${round} — Adversarial Review$`, "m"));
      });

      it("scoring table has exactly three challenger rows with numeric scores", () => {
        const content = read(file);
        const rows = parseScoringTable(content);
        expect(rows).toHaveLength(3);
        for (const row of rows) {
          expect(Number.isNaN(row.issuesFound)).toBe(false);
          expect(Number.isNaN(row.valid)).toBe(false);
          expect(Number.isNaN(row.remediationsAccepted)).toBe(false);
          expect(Number.isNaN(row.score)).toBe(false);
          // valid issues can never exceed issues found
          expect(row.valid).toBeLessThanOrEqual(row.issuesFound);
          expect(row.remediationsAccepted).toBeLessThanOrEqual(row.valid);
        }
      });

      it("declared winner has the strictly highest score in the scoring table", () => {
        const content = read(file);
        const rows = parseScoringTable(content);
        const winner = parseWinnerLine(content);
        const maxScore = Math.max(...rows.map((r) => r.score));
        expect(winner.score).toBe(maxScore);
        const winningRow = rows.find((r) => winner.label.includes(r.challenger.split(" ")[0]));
        expect(winningRow).toBeDefined();
        expect(winningRow!.score).toBe(maxScore);
      });

      it(`reports a "Tests" section with the expected passing count`, () => {
        const content = read(file);
        expect(content).toMatch(new RegExp(`${testCount} tests passing`));
      });
    });
  }

  it("test count is non-decreasing across successive tournament rounds", () => {
    const counts = rounds.map(({ file }) => {
      const content = read(file);
      const match = content.match(/(\d+) tests passing/);
      expect(match).not.toBeNull();
      return Number(match![1]);
    });
    for (let i = 1; i < counts.length; i++) {
      expect(counts[i]).toBeGreaterThanOrEqual(counts[i - 1]);
    }
  });

  it("round 5 summary calls out that a confirmation round is still needed", () => {
    const content = read("2026-07-08-r5-tournament-round5.md");
    expect(content).toContain("Round 6 is needed to confirm zero valid issues");
  });
});

describe("2026-07-08-r1-opus-implementation-review.md", () => {
  const file = "2026-07-08-r1-opus-implementation-review.md";

  it("has the expected title and reviewer metadata", () => {
    const content = read(file);
    expect(content).toMatch(/^# SkillWeaver Implementation Review$/m);
    expect(content).toContain("**Reviewer:** opencode (r1)");
  });

  it("contains all required top-level sections", () => {
    const content = read(file);
    for (const heading of [
      "## Summary",
      "## Implementation vs Plan",
      "## Findings",
      "## Remediations",
      "## Assessment",
    ]) {
      expect(content).toContain(heading);
    }
  });

  it("marks all seven implementation phases as complete", () => {
    const content = read(file);
    const phaseHeadings = [...content.matchAll(/^### Phase \d.*✅ COMPLETE$/gm)];
    expect(phaseHeadings).toHaveLength(7);
  });

  it("reports exactly four numbered findings", () => {
    const content = read(file);
    const findings = [...content.matchAll(/^### Finding \d:/gm)];
    expect(findings).toHaveLength(4);
  });

  it("concludes with an overall PASS verdict", () => {
    const content = read(file);
    expect(content).toContain("**Overall: PASS — Implementation meets all goals.**");
    expect(content).toContain("Ready for PR review and merge.");
  });

  it("baseline test count (115) is less than or equal to round 1's reported count", () => {
    const reviewContent = read(file);
    const round1Content = read("2026-07-08-r1-tournament-round1.md");
    const reviewMatch = reviewContent.match(/(\d+) tests passing/);
    const round1Match = round1Content.match(/(\d+) tests passing \(was (\d+)\)/);
    expect(reviewMatch).not.toBeNull();
    expect(round1Match).not.toBeNull();
    const reviewCount = Number(reviewMatch![1]);
    const round1PreviousCount = Number(round1Match![2]);
    const round1NewCount = Number(round1Match![1]);
    expect(reviewCount).toBe(round1PreviousCount);
    expect(round1NewCount).toBeGreaterThanOrEqual(round1PreviousCount);
  });
});