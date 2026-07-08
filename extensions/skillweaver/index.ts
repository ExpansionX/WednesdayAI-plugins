// @ts-expect-error — plugin-sdk not installed in this workspace
import type { OpenClawPluginApi } from "wednesdayai/plugin-sdk";
import manifest from "./openclaw.plugin.json" with { type: "json" };
import { resolveConfig, validateConfig, checkSkillsMode } from "./src/config.js";
import { SkillIndex } from "./src/skill-index.js";
import { LocalEmbedding } from "./src/embedding/local.js";
import { CloudEmbedding } from "./src/embedding/cloud.js";
import { CustomEmbedding } from "./src/embedding/custom.js";
import type { EmbeddingBackend, SkillEntry } from "./src/embedding/types.js";
import { Decomposer } from "./src/decomposer.js";
import { createRetriever } from "./src/retriever.js";
import { createCollectHandler } from "./src/handler.js";

function resolveBackend(config: ReturnType<typeof resolveConfig>): EmbeddingBackend {
  switch (config.embedding.backend) {
    case "local":
      return new LocalEmbedding(config.embedding.model);
    case "cloud":
      return new CloudEmbedding({
        apiKey: config.embedding.apiKey,
        model: config.embedding.cloudModel,
      });
    case "custom":
      return new CustomEmbedding({
        endpoint: config.embedding.endpoint,
        apiKey: config.embedding.apiKey,
      });
    default:
      throw new Error(`Unknown embedding backend: ${config.embedding.backend}`);
  }
}

async function discoverSkills(config: ReturnType<typeof resolveConfig>): Promise<SkillEntry[]> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const os = await import("node:os");
  const entries: SkillEntry[] = [];

  const dirs: string[] = [...(config.skills?.dirs ?? [])];
  if (dirs.length === 0) {
    const defaultSkillsDir = path.join(os.homedir(), ".openclaw", "skills");
    try {
      await fs.access(defaultSkillsDir);
      dirs.push(defaultSkillsDir);
    } catch { /* no default skills dir */ }
  }

  const stripQuotes = (s: string): string => s.replace(/^["']|["']$/g, "");

  for (const dir of dirs) {
    try {
      const items = await fs.readdir(dir, { withFileTypes: true });
      for (const item of items) {
        if (!item.isDirectory()) continue;
        const skillFile = path.join(dir, item.name, "SKILL.md");
        try {
          const content = await fs.readFile(skillFile, "utf-8");
          const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
          if (!fmMatch) continue;
          const fmText = fmMatch[1];
          const nameMatch = fmText.match(/^name:\s*(.+)/m);
          const descMatch = fmText.match(/^description:\s*(.+)/m);
          if (!nameMatch) continue;
          entries.push({
            name: stripQuotes(nameMatch[1].trim()),
            description: stripQuotes(descMatch?.[1]?.trim() ?? nameMatch[1].trim()),
            location: skillFile,
            source: "managed",
          });
        } catch { /* skip unreadable skill files */ }
      }
    } catch { /* skip unreadable dirs */ }
  }

  return entries;
}

const plugin = {
  id: manifest.id,
  name: manifest.name,
  description: manifest.description,
  configSchema: manifest.configSchema,

  register(api: OpenClawPluginApi) {
    const rawConfig = (api.pluginConfig ?? {}) as Record<string, unknown>;
    const config = resolveConfig(rawConfig);
    validateConfig(config);

    if (!config.enabled) {
      api.logger.info("skillweaver: disabled via config");
      return;
    }

    const skillsMode = checkSkillsMode(api.config);
    if (skillsMode === "default" || skillsMode === "compact") {
      api.logger.warn(
        `skillweaver: detected skills mode "${skillsMode}". ` +
          `For optimal context savings, set ` +
          `agents.defaults.systemPrompt.sections.skills to "names" in your openclaw config. ` +
          `With "default" mode, full skill descriptions still appear in the system prompt ` +
          `alongside SkillWeaver's selective injection.`,
      );
    }

    const backend = resolveBackend(config);
    const index = new SkillIndex(backend);

    const decomposer = new Decomposer({
      provider: config.decomposer.provider,
      model: config.decomposer.model,
      apiKey: config.decomposer.apiKey,
      baseUrl: config.decomposer.baseUrl,
      temperature: config.decomposer.temperature,
      maxTokens: config.decomposer.maxTokens,
    });

    const retriever = createRetriever(index, {
      topK: config.retrieval.topK,
      hintSize: config.retrieval.hintSize,
    });

    const handler = createCollectHandler({
      decomposer,
      retriever,
      sadEnabled: config.sad.enabled,
      minQueryLength: config.retrieval.minQueryLength,
      decomposerModel: config.decomposer.model,
    });

    api.on("context.collect", handler);

    let disposed = false;
    api.on("gateway_stop", async () => {
      if (disposed) return;
      disposed = true;
      decomposer.dispose();
      index.dispose();
      await Promise.resolve(backend.dispose());
    });

    discoverSkills(config).then((skills) => {
      index.build(skills).then(() => {
        const dirs = [...(config.skills?.dirs ?? [])];
        if (dirs.length > 0) {
          index.watch(dirs[0], () => {
            const { readdirSync, statSync } = require("node:fs");
            const path = require("node:path");
            const os = require("node:os");
            const result: SkillEntry[] = [];
            for (const dir of dirs) {
              try {
                const items = readdirSync(dir, { withFileTypes: true });
                for (const item of items) {
                  if (!item.isDirectory()) continue;
                  const skillFile = path.join(dir, item.name, "SKILL.md");
                  try {
                    const content = require("node:fs").readFileSync(skillFile, "utf-8");
                    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
                    if (!fmMatch) continue;
                    const fmText = fmMatch[1];
                    const nameMatch = fmText.match(/^name:\s*(.+)/m);
                    const descMatch = fmText.match(/^description:\s*(.+)/m);
                    if (!nameMatch) continue;
                    result.push({
                      name: nameMatch[1].trim().replace(/^["']|["']$/g, ""),
                      description: descMatch?.[1]?.trim().replace(/^["']|["']$/g, "") ?? nameMatch[1].trim().replace(/^["']|["']$/g, ""),
                      location: skillFile,
                      source: "managed",
                    });
                  } catch { /* skip unreadable */ }
                }
              } catch { /* skip unreadable dir */ }
            }
            return result;
          });
        }
      }).catch((err: unknown) => {
        api.logger.warn("skillweaver: initial index build failed", { error: String(err) });
      });
    });

    api.logger.info("skillweaver: registered");
  },
};

export default plugin;
