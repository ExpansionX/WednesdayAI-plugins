import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { createBraveWebSearchProvider } from "./src/brave-search-provider.js";

const plugin = {
  id: "brave-search",
  name: "Brave Search",
  description:
    "Web search via Brave Search API. Supports region-specific and localized search. Requires BRAVE_API_KEY.",
  register(api: OpenClawPluginApi) {
    api.registerWebSearchProvider(createBraveWebSearchProvider());
  },
};

export default plugin;
