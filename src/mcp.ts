import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SmartThingsClient } from "./smartthingsApi.js";
import {
  deviceIdSchema,
  listDevicesSchema,
  roomTemperatureMapSchema,
  ruleSchema,
  sceneSchema,
  sendCommandSchema,
  updateRuleSchema
} from "./validators.js";

const toText = (data: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }]
});

export async function createMcpServer(client: SmartThingsClient) {
  const server = new McpServer({
    name: "SmartThings MCP",
    version: "0.1.0"
  });

  const empty: Record<string, never> = {};

  server.tool("list_locations", empty, async (_input, _extra) => {
    const data = await client.listLocations();
    return toText(data);
  });

  server.tool("list_devices", listDevicesSchema, async (input, _extra) => {
    const data = await client.listDevices(input.locationId, input.installedAppId);
    return toText(data);
  });

  server.tool("list_devices_with_room_temperatures", roomTemperatureMapSchema, async (input, _extra) => {
    const data = await client.listDevicesWithRoomTemperatures(
      input.locationId,
      input.installedAppId,
      input.refresh ?? false
    );
    return toText(data);
  });

  server.tool("get_device_details", deviceIdSchema, async (input, _extra) => {
    const data = await client.getDeviceDetails(input.deviceId, input.installedAppId);
    return toText(data);
  });

  server.tool("get_device_status", deviceIdSchema, async (input, _extra) => {
    const data = await client.getDeviceStatus(input.deviceId, input.installedAppId);
    return toText(data);
  });

  server.tool("send_device_command", sendCommandSchema, async (input, _extra) => {
    const data = await client.sendDeviceCommand(input.deviceId, input.commands, input.installedAppId);
    return toText(data ?? { ok: true });
  });

  server.tool("list_scenes", empty, async (_input, _extra) => {
    const data = await client.listScenes();
    return toText(data);
  });

  server.tool("execute_scene", sceneSchema, async (input, _extra) => {
    const data = await client.executeScene(input.sceneId, input.installedAppId);
    return toText(data ?? { ok: true });
  });

  server.tool("list_rules", empty, async (_input, _extra) => {
    const data = await client.listRules();
    return toText(data);
  });

  server.tool("get_rule_details", ruleSchema, async (input, _extra) => {
    const data = await client.getRule(input.ruleId, input.installedAppId);
    return toText(data);
  });

  server.tool("update_rule", updateRuleSchema, async (input, _extra) => {
    const data = await client.updateRule(input.ruleId, input.rule, input.installedAppId);
    return toText(data ?? { ok: true });
  });

  return { server };
}
