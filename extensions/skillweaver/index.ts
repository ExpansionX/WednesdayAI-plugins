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
import { createSubsystemLogger } from "./src/logger.js";

const log = createSubsystemLogger("skillweaver");

function resolveBackend(config: ReturnType<typeof resolveConfig>): EmbeddingBackend {
  switch (config.embedding.backend) {
    case "local":
      return new LocalEmbedding(config.embedding.model);
    case "cloud":
      return new CloudEmbedding({
        apiKey: config.embedding.apiKey,
        model: config.embedding.cloudModel,
        dimensions: config.embedding.cloudDimensions ?? undefined,
      });
    case "custom":
      return new CustomEmbedding({
        endpoint: config.embedding.endpoint,
        apiKey: config.embedding.apiKey,
        dimensions: config.embedding.customDimensions ?? undefined,
        model: config.embedding.customModel,
      });
    default:
      throw new Error(`Unknown embedding backend: ${config.embedding.backend}`);
  }
}

async function discoverSkills(config: ReturnType<typeof resolveConfig>): Promise<{ skills: SkillEntry[]; dirs: string[] }> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const os = await import("node:os");
  const entries: SkillEntry[] = [];
  const seenFiles = new Set<string>();

  const dirs: string[] = [...(config.skills?.dirs ?? [])];
  if (dirs.length === 0) {
    const defaultSkillsDir = path.join(os.homedir(), ".openclaw", "skills");
    try {
      await fs.access(defaultSkillsDir);
      dirs.push(defaultSkillsDir);
    } catch { /* no default skills dir */ }
  }

  const stripQuotes = (s: string): string => s.replace(/^["']|["']$/g, "");

  async function walkDir(dir: string): Promise<void> {
    let items: import("node:fs").Dirent[];
    try {
      items = await fs.readdir(dir, { withFileTypes: true });
    } catch (err) {
      log.warn("skipping unreadable skills dir", { dir, error: String(err) });
      return;
    }
    const results = await Promise.allSettled(
      items.filter((item) => item.isDirectory()).map(async (item) => {
        const skillDir = path.join(dir, item.name);
        const skillFile = path.join(skillDir, "SKILL.md");
        if (seenFiles.has(skillFile)) return null;
        seenFiles.add(skillFile);
        try {
          const content = await fs.readFile(skillFile, "utf-8");
          return { content, skillFile, skillDir };
        } catch {
          return null;
        }
      }),
    );
    for (const result of results) {
      if (result.status === "rejected" || !result.value) continue;
      const { content, skillFile } = result.value;
      try {
        const normalized = content.replace(/^\uFEFF/, "");
        const fmMatch = normalized.match(/^\s*---\r?\n([\s\S]*?)\r?\n---/);
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
      } catch (err) {
        log.warn("skipping unreadable skill file", { error: String(err) });
      }
    }
  }

  for (const dir of dirs) {
    await walkDir(dir);
  }

  return { skills: entries, dirs };
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
          `agents.defaults.systemPrompt.sections.skills.mode to "names" in your openclaw config. ` +
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
      retrievalTimeoutMs: config.retrieval.retrievalTimeoutMs,
    });

    api.on("context.collect", handler);

    let disposed = false;
    let initPromise: Promise<void> | null = null;

    api.on("gateway_stop", async () => {
      if (disposed) return;
      disposed = true;
      try { decomposer.dispose(); } catch { /* ignore */ }
      try { index.dispose(); } catch { /* ignore */ }
      if (initPromise) {
        await initPromise.catch(() => {});
      }
      try {
        await backend.dispose();
      } catch (err) {
        log.warn("backend dispose failed", { error: String(err) });
      }
    });

    initPromise = discoverSkills(config)
      .then(({ skills, dirs }) => index.build(skills).then(() => {
        if (disposed) return;
        for (const dir of dirs) {
          index.watch(dir, async () => {
            const result = await discoverSkills(config);
            return result.skills;
          });
        }
      }))
      .catch((err: unknown) => {
        if (!disposed) {
          api.logger.warn("skillweaver: initialization failed", { error: String(err) });
        }
      })
      .then(() => { initPromise = null; });

    api.logger.info("skillweaver: registered");
  },
};

export default plugin;
