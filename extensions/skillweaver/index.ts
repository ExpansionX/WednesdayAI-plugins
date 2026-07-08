// @ts-expect-error — plugin-sdk not installed in this workspace
import type { OpenClawPluginApi } from "wednesdayai/plugin-sdk";
import manifest from "./openclaw.plugin.json" with { type: "json" };
import { resolveConfig, validateConfig, checkSkillsMode } from "./src/config.js";

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

    api.on("context.collect", async (_event: unknown) => {
      return {};
    });
  },
};

export default plugin;
