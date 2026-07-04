import type { OpenClawPluginApi } from "openclaw/plugin-sdk";

let gatewayStopCalled = false;

const plugin = {
  id: "lifecycle-fixture",
  name: "Lifecycle Fixture",
  description: "Test fixture exercising api.on() lifecycle hooks.",
  register(api: OpenClawPluginApi) {
    api.on("gateway_stop", () => {
      gatewayStopCalled = true;
    });
  },
};

export default plugin;
export function __wasGatewayStopCalled(): boolean {
  return gatewayStopCalled;
}
