/**
 * Example fixture plugin — exercises the CI contract.
 * NOT published (package.json private:true). Deleted in task 005 or kept as a template.
 */

/** @typedef {{ greeting?: string }} ExampleConfig */
/** @typedef {{ register: (api: import("./types.js").PluginApi) => void }} PluginDefinition */

export default {
  id: "example",
  name: "Example Plugin",
  description: "A minimal fixture plugin for CI validation.",
  register(api) {
    api.log?.info?.("example plugin registered");
  },
};
