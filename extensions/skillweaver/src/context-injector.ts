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

function sanitizeMarkdown(text: string): string {
  return text.replace(/[#*_[\]`]/g, "\\$&").replace(/\n/g, " ").slice(0, 200);
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
    lines.push(`### ${sanitizeMarkdown(skill.name)}`);
    lines.push(sanitizeMarkdown(skill.description));
    lines.push("");
  }

  if (subTasks.length > 0) {
    lines.push("**Sub-tasks detected:**");
    for (const task of subTasks) {
      lines.push(`- ${sanitizeMarkdown(task)}`);
    }
  }

  const text = lines.join("\n");

  const block: ContextBlock = {
    id: "skillweaver:route",
    source: "plugin-skillweaver",
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
