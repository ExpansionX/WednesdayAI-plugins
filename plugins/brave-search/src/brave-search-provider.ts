import type { OpenClawConfig } from "openclaw/plugin-sdk";
import {
  readNumberParam,
  readStringParam,
  type WebSearchProviderPlugin,
} from "openclaw/plugin-sdk/provider-web-search";
import { normalizeBraveLanguageParams, normalizeFreshness } from "./brave-client.js";
import { resolveBraveApiKey } from "./config.js";

type BraveClientModule = typeof import("./brave-client.js");
let clientPromise: Promise<BraveClientModule> | undefined;
function loadClient(): Promise<BraveClientModule> {
  // Reset cached promise on failure so transient errors don't poison future calls.
  clientPromise ??= import("./brave-client.js").catch((error) => {
    clientPromise = undefined;
    throw error;
  });
  return clientPromise;
}

const BraveSearchSchema = {
  type: "object",
  required: ["query"],
  additionalProperties: false,
  properties: {
    query: { type: "string", description: "Search query string." },
    count: {
      type: "number",
      description: "Number of results to return (1-10).",
      minimum: 1,
      maximum: 10,
    },
    country: {
      type: "string",
      description:
        "2-letter country code for region-specific results (e.g., 'DE', 'US', 'ALL'). Default: 'US'.",
    },
    search_lang: {
      type: "string",
      description:
        "Short ISO language code for search results (e.g., 'de', 'en', 'fr'). Must be a 2-letter code, NOT a locale.",
    },
    ui_lang: {
      type: "string",
      description:
        "Locale code for UI elements in language-region format (e.g., 'en-US', 'de-DE'). Must include region subtag.",
    },
    freshness: {
      type: "string",
      description:
        "Filter results by discovery time. Supports 'pd', 'pw', 'pm', 'py', and date range 'YYYY-MM-DDtoYYYY-MM-DD'.",
    },
  },
} satisfies Record<string, unknown>;

export function createBraveWebSearchProvider(): WebSearchProviderPlugin {
  return {
    id: "brave-search",
    label: "Brave Search",
    hint: "Brave Search API — requires BRAVE_API_KEY",
    envVars: ["BRAVE_API_KEY"],
    autoDetectOrder: 10,
    createTool: (ctx) => {
      const apiKey = resolveBraveApiKey(ctx.config as OpenClawConfig | undefined);
      if (!apiKey) return null;
      return {
        description:
          "Search the web using Brave Search API. Supports region-specific and localized search via country and language parameters. Returns titles, URLs, and snippets for fast research.",
        parameters: BraveSearchSchema,
        execute: async (args) => {
          const { runBraveSearch } = await loadClient();
          const params = args as Record<string, unknown>;
          const rawSearchLang = readStringParam(params, "search_lang");
          const rawUiLang = readStringParam(params, "ui_lang");
          const normalized = normalizeBraveLanguageParams({
            search_lang: rawSearchLang,
            ui_lang: rawUiLang,
          });
          if (normalized.invalidField === "search_lang") {
            return {
              error: "invalid_search_lang",
              message:
                "search_lang must be a 2-letter ISO language code like 'en' (not a locale like 'en-US').",
              docs: "https://docs.openclaw.ai/tools/web",
            };
          }
          if (normalized.invalidField === "ui_lang") {
            return {
              error: "invalid_ui_lang",
              message: "ui_lang must be a language-region locale like 'en-US'.",
              docs: "https://docs.openclaw.ai/tools/web",
            };
          }
          const rawFreshness = readStringParam(params, "freshness");
          if (rawFreshness) {
            const freshness = normalizeFreshness(rawFreshness);
            if (!freshness) {
              return {
                error: "invalid_freshness",
                message:
                  "freshness must be one of pd, pw, pm, py, or a range like YYYY-MM-DDtoYYYY-MM-DD.",
                docs: "https://docs.openclaw.ai/tools/web",
              };
            }
          }
          return runBraveSearch({
            config: ctx.config as OpenClawConfig | undefined,
            query: readStringParam(params, "query", { required: true }),
            count: readNumberParam(params, "count", { integer: true }),
            apiKey,
            country: readStringParam(params, "country"),
            search_lang: normalized.search_lang,
            ui_lang: normalized.ui_lang,
            freshness: normalizeFreshness(readStringParam(params, "freshness")),
          });
        },
      };
    },
  };
}
