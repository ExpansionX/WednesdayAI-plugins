import type { OpenClawPluginApi } from "openclaw/plugin-sdk";

/**
 * Shohin plugin shell.
 *
 * This is the design-phase placeholder that keeps the package valid for the
 * repo's manifest and catalog checks. It registers nothing. Implementation
 * begins with the Phase 1 vertical slice described in docs/PROGRAM.md and is
 * driven through the WAI workflow (prd-new -> spec -> precheck -> decompose ->
 * execute), never by editing this file ad hoc.
 */
const plugin = {
  id: "shohin",
  name: "Shohin",
  description: "Unified work system for WednesdayAI (design phase).",
  register(api: OpenClawPluginApi) {
    api.logger.info("shohin: design-phase shell loaded; no capabilities registered");
  },
};

export default plugin;
