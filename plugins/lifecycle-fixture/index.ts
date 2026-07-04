import type { OpenClawPluginApi } from "openclaw/plugin-sdk";

let shutdownCalled = false;

const plugin = {
  id: "lifecycle-fixture",
  name: "Lifecycle Fixture",
  description: "Test fixture exercising api.on() lifecycle hooks.",
  register(api: OpenClawPluginApi) {
    api.on("shutdown", () => {
      shutdownCalled = true;
    });
  },
};

export default plugin;
export function __wasShutdownCalled(): boolean {
  return shutdownCalled;
}
