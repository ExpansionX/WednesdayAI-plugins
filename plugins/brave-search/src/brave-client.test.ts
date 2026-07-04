import { describe, expect, it } from "vitest";
import { __testing, normalizeFreshness } from "./brave-client.js";

const {
  normalizeBraveLanguageParams,
  normalizeBraveSearchLang,
  normalizeBraveUiLang,
  isValidIsoDate,
} = __testing;

describe("normalizeBraveLanguageParams", () => {
  it("normalizes and auto-corrects swapped Brave language params", () => {
    expect(normalizeBraveLanguageParams({ search_lang: "tr-TR", ui_lang: "tr" })).toEqual({
      search_lang: "tr",
      ui_lang: "tr-TR",
    });
    expect(normalizeBraveLanguageParams({ search_lang: "EN", ui_lang: "en-us" })).toEqual({
      search_lang: "en",
      ui_lang: "en-US",
    });
  });

  it("flags invalid Brave language formats", () => {
    expect(normalizeBraveLanguageParams({ search_lang: "en-US" })).toEqual({
      invalidField: "search_lang",
    });
    expect(normalizeBraveLanguageParams({ ui_lang: "en" })).toEqual({
      invalidField: "ui_lang",
    });
  });

  it("returns empty object when no params provided", () => {
    expect(normalizeBraveLanguageParams({})).toEqual({});
  });

  it("passes valid search_lang through normalized", () => {
    expect(normalizeBraveLanguageParams({ search_lang: "DE" })).toEqual({ search_lang: "de" });
  });

  it("passes valid ui_lang through normalized", () => {
    expect(normalizeBraveLanguageParams({ ui_lang: "fr-FR" })).toEqual({ ui_lang: "fr-FR" });
  });
});

describe("normalizeBraveSearchLang", () => {
  it("accepts 2-letter codes", () => {
    expect(normalizeBraveSearchLang("en")).toBe("en");
    expect(normalizeBraveSearchLang("DE")).toBe("de");
  });

  it("rejects locales", () => {
    expect(normalizeBraveSearchLang("en-US")).toBeUndefined();
  });

  it("rejects empty values", () => {
    expect(normalizeBraveSearchLang(undefined)).toBeUndefined();
    expect(normalizeBraveSearchLang("")).toBeUndefined();
  });
});

describe("normalizeBraveUiLang", () => {
  it("accepts language-region locales", () => {
    expect(normalizeBraveUiLang("en-US")).toBe("en-US");
    expect(normalizeBraveUiLang("de-de")).toBe("de-DE");
  });

  it("rejects 2-letter codes", () => {
    expect(normalizeBraveUiLang("en")).toBeUndefined();
  });

  it("rejects empty values", () => {
    expect(normalizeBraveUiLang(undefined)).toBeUndefined();
    expect(normalizeBraveUiLang("")).toBeUndefined();
  });
});

describe("normalizeFreshness", () => {
  it("accepts Brave shortcut values", () => {
    expect(normalizeFreshness("pd")).toBe("pd");
    expect(normalizeFreshness("PW")).toBe("pw");
    expect(normalizeFreshness("pm")).toBe("pm");
    expect(normalizeFreshness("py")).toBe("py");
  });

  it("accepts valid date ranges", () => {
    expect(normalizeFreshness("2024-01-01to2024-01-31")).toBe("2024-01-01to2024-01-31");
  });

  it("rejects invalid date ranges", () => {
    expect(normalizeFreshness("2024-13-01to2024-01-31")).toBeUndefined();
    expect(normalizeFreshness("2024-02-30to2024-03-01")).toBeUndefined();
    expect(normalizeFreshness("2024-03-10to2024-03-01")).toBeUndefined();
  });

  it("rejects unrecognized formats", () => {
    expect(normalizeFreshness("recent")).toBeUndefined();
    expect(normalizeFreshness("")).toBeUndefined();
    expect(normalizeFreshness(undefined)).toBeUndefined();
  });
});

describe("isValidIsoDate", () => {
  it("accepts valid dates", () => {
    expect(isValidIsoDate("2024-01-31")).toBe(true);
    expect(isValidIsoDate("2024-02-29")).toBe(true); // 2024 is a leap year
  });

  it("rejects invalid dates", () => {
    expect(isValidIsoDate("2024-13-01")).toBe(false);
    expect(isValidIsoDate("2024-02-30")).toBe(false);
  });

  it("rejects wrong format", () => {
    expect(isValidIsoDate("01/31/2024")).toBe(false);
    expect(isValidIsoDate("2024-1-1")).toBe(false);
  });
});
