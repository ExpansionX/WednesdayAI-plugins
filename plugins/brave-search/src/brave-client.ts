import type { OpenClawConfig } from "openclaw/plugin-sdk";
import {
  DEFAULT_CACHE_TTL_MINUTES,
  DEFAULT_TIMEOUT_SECONDS,
  MAX_SEARCH_COUNT,
  hashSecretForCacheKey,
  normalizeCacheKey,
  readCache,
  readResponseText,
  resolveCacheTtlMs,
  resolveSiteName,
  resolveTimeoutSeconds,
  sanitizeUpstreamErrorBody,
  withTrustedWebSearchEndpoint,
  wrapWebContent,
  writeCache,
  type CacheEntry,
} from "openclaw/plugin-sdk/provider-web-search";

const BRAVE_SEARCH_ENDPOINT = "https://api.search.brave.com/res/v1/web/search";
const BRAVE_FRESHNESS_SHORTCUTS = new Set(["pd", "pw", "pm", "py"]);
const BRAVE_FRESHNESS_RANGE = /^(\d{4}-\d{2}-\d{2})to(\d{4}-\d{2}-\d{2})$/;
const BRAVE_SEARCH_LANG_CODE = /^[a-z]{2}$/i;
const BRAVE_UI_LANG_LOCALE = /^([a-z]{2})-([a-z]{2})$/i;

const BRAVE_SEARCH_CACHE = new Map<string, CacheEntry<Record<string, unknown>>>();

type BraveSearchResult = {
  title?: string;
  url?: string;
  description?: string;
  age?: string;
};

type BraveSearchResponse = {
  web?: {
    results?: BraveSearchResult[];
  };
};

export function normalizeBraveSearchLang(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed || !BRAVE_SEARCH_LANG_CODE.test(trimmed)) return undefined;
  return trimmed.toLowerCase();
}

export function normalizeBraveUiLang(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const match = trimmed.match(BRAVE_UI_LANG_LOCALE);
  if (!match) return undefined;
  const [, language, region] = match;
  return `${language.toLowerCase()}-${region.toUpperCase()}`;
}

export function normalizeBraveLanguageParams(params: { search_lang?: string; ui_lang?: string }): {
  search_lang?: string;
  ui_lang?: string;
  invalidField?: "search_lang" | "ui_lang";
} {
  const rawSearchLang = params.search_lang?.trim() || undefined;
  const rawUiLang = params.ui_lang?.trim() || undefined;
  let searchLangCandidate = rawSearchLang;
  let uiLangCandidate = rawUiLang;

  // Recover common LLM mix-up: locale in search_lang + short code in ui_lang.
  if (normalizeBraveUiLang(rawSearchLang) && normalizeBraveSearchLang(rawUiLang)) {
    searchLangCandidate = rawUiLang;
    uiLangCandidate = rawSearchLang;
  }

  const search_lang = normalizeBraveSearchLang(searchLangCandidate);
  if (searchLangCandidate && !search_lang) {
    return { invalidField: "search_lang" };
  }

  const ui_lang = normalizeBraveUiLang(uiLangCandidate);
  if (uiLangCandidate && !ui_lang) {
    return { invalidField: "ui_lang" };
  }

  return { search_lang, ui_lang };
}

export function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map((p) => Number.parseInt(p, 10));
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

export function normalizeFreshness(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  const lower = trimmed.toLowerCase();
  if (BRAVE_FRESHNESS_SHORTCUTS.has(lower)) return lower;

  const match = trimmed.match(BRAVE_FRESHNESS_RANGE);
  if (!match) return undefined;

  const [, start, end] = match;
  if (!isValidIsoDate(start) || !isValidIsoDate(end)) return undefined;
  if (start > end) return undefined;
  return `${start}to${end}`;
}

export async function runBraveSearch(params: {
  config?: OpenClawConfig;
  query: string;
  count?: number;
  apiKey: string;
  country?: string;
  search_lang?: string;
  ui_lang?: string;
  freshness?: string;
  timeoutSeconds?: number;
  cacheTtlMinutes?: number;
}): Promise<Record<string, unknown>> {
  const count = Math.max(1, Math.min(MAX_SEARCH_COUNT, Math.floor(params.count ?? 5)));
  const timeoutSeconds = resolveTimeoutSeconds(
    params.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS,
    DEFAULT_TIMEOUT_SECONDS,
  );
  const cacheTtlMs = resolveCacheTtlMs(params.cacheTtlMinutes, DEFAULT_CACHE_TTL_MINUTES);

  // Use JSON.stringify to avoid collisions when user-controlled `query` or
  // `country` contain `:` (e.g. query="foo:5:US" + country="US" collided with
  // query="foo" + country="US:5:US" under the legacy template).
  // Include a hash of the API key so multi-tenant gateways cannot serve one
  // tenant's cached results to a caller with a different key.
  const cacheKey = normalizeCacheKey(
    JSON.stringify({
      provider: "brave-search",
      keyHash: hashSecretForCacheKey(params.apiKey),
      query: params.query,
      count,
      country: params.country ?? "",
      search_lang: params.search_lang ?? "",
      ui_lang: params.ui_lang ?? "",
      freshness: params.freshness ?? "",
    }),
  );
  const cached = readCache(BRAVE_SEARCH_CACHE, cacheKey);
  if (cached) return { ...cached.value, cached: true };

  const startedAt = Date.now();

  const url = new URL(BRAVE_SEARCH_ENDPOINT);
  url.searchParams.set("q", params.query);
  url.searchParams.set("count", String(count));
  if (params.country) url.searchParams.set("country", params.country);
  if (params.search_lang) url.searchParams.set("search_lang", params.search_lang);
  if (params.ui_lang) url.searchParams.set("ui_lang", params.ui_lang);
  if (params.freshness) url.searchParams.set("freshness", params.freshness);

  const results = await withTrustedWebSearchEndpoint(
    {
      url: url.toString(),
      timeoutSeconds,
      init: {
        method: "GET",
        headers: {
          Accept: "application/json",
          "X-Subscription-Token": params.apiKey,
        },
      },
    },
    async (res) => {
      if (!res.ok) {
        const rawDetail = (await readResponseText(res, { maxBytes: 64_000 })).text;
        const detail = sanitizeUpstreamErrorBody(rawDetail);
        throw new Error(`Brave Search API error (${res.status}): ${detail || res.statusText}`);
      }
      const data = (await res.json()) as BraveSearchResponse;
      const raw = Array.isArray(data.web?.results) ? (data.web?.results ?? []) : [];
      return raw.map((entry) => {
        const description = entry.description ?? "";
        const title = entry.title ?? "";
        const resultUrl = entry.url ?? "";
        return {
          title: title ? wrapWebContent(title, "web_search") : "",
          url: resultUrl,
          description: description ? wrapWebContent(description, "web_search") : "",
          published: entry.age || undefined,
          siteName: resolveSiteName(resultUrl) || undefined,
        };
      });
    },
  );

  const payload: Record<string, unknown> = {
    query: params.query,
    provider: "brave-search",
    count: results.length,
    tookMs: Date.now() - startedAt,
    externalContent: {
      untrusted: true,
      source: "web_search",
      provider: "brave-search",
      wrapped: true,
    },
    results,
  };

  writeCache(BRAVE_SEARCH_CACHE, cacheKey, payload, cacheTtlMs);
  return payload;
}

export const __testing = {
  normalizeBraveSearchLang,
  normalizeBraveUiLang,
  normalizeBraveLanguageParams,
  normalizeFreshness,
  isValidIsoDate,
};
