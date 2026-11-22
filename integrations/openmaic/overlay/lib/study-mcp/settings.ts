import type { ModelSettingsView } from "@/lib/server/model-config/settings";

/** Advertise the same MCP resolver used by generation and classroom, without asking for keys. */
export function mcpSettingsView(view: ModelSettingsView): ModelSettingsView {
  return {
    ...view,
    allowUserKeys: false,
    presets: [],
    providers: [],
    slots: view.slots.map((slot) => ({
      ...slot,
      locked: true,
      source: { kind: "locked" },
      effective:
        slot.capability === "chat"
          ? {
              status: "assigned",
              resolvedAt: slot.slot,
              source: "locked",
              requirements: [],
              providerId: "study-mcp",
              providerSource: "deployment",
              presetId: "study-mcp",
              registryId: "study-mcp",
              modelId: "external-chatbot",
            }
          : { status: "disabled", resolvedAt: slot.slot, source: "locked" },
    })),
  };
}
