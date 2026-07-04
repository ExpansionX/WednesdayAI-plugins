import type { OpenClawConfig } from "openclaw/plugin-sdk";

type BraveWebSearchConfig = {
  apiKey?: unknown;
};

function readPluginWebSearchConfig(config?: OpenClawConfig): BraveWebSearchConfig | undefined {
  const pluginConfig = config?.plugins?.entries?.["brave-search"]?.config as
    | { webSearch?: unknown }
    | undefined;
  const ws = pluginConfig?.webSearch;
  return ws && typeof ws === "object" && !Array.isArray(ws)
    ? (ws as BraveWebSearchConfig)
    : undefined;
}

function readLegacyApiKey(config?: OpenClawConfig): string | undefined {
  // Backwards compat with pre-refactor configs and `openclaw configure --section web`,
  // which write the Brave key to `tools.web.search.apiKey`.
  const search = config?.tools?.web?.search as { apiKey?: unknown } | undefined;
  return normalizeKey(search?.apiKey);
}

function normalizeKey(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function resolveBraveApiKey(
  config?: OpenClawConfig,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const ws = readPluginWebSearchConfig(config);
  return normalizeKey(ws?.apiKey) ?? readLegacyApiKey(config) ?? normalizeKey(env.BRAVE_API_KEY);
}
