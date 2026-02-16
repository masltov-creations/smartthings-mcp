---
name: smartthings-mcp
description: Operate SmartThings through MCP with clear read/write safety, fast tool routing, and human-friendly output.
---

# SmartThings MCP Operator

## Mission
Use SmartThings MCP tools to answer home-automation questions fast, accurately, and safely.

## Use This Skill When
- The user wants SmartThings device, location, scene, or rule information.
- The user wants to control a device, run a scene, or modify a rule.
- The user asks for room-temperature or status summaries.

## Required Preconditions
- MCP endpoint is reachable (`/mcp` or namespaced through `/mcp-gateway`).
- OAuth is completed once at `/oauth/start`.
- For OpenClaw, call through `mcporter`.

## Connection Checks (Run In Order)
1. Confirm endpoint config:
```bash
npx -y mcporter config get smartthings --json
```
2. Confirm tools are reachable:
```bash
npx -y mcporter list smartthings --schema
```
3. Confirm account access:
```bash
npx -y mcporter call --server smartthings --tool list_locations --output json
```

If any step fails, stop and report a concrete fix from the troubleshooting section below.

## Tool Router (Intent -> Tool)
- "What devices do I have?" -> `list_devices`
- "What temperature is each room/device in?" -> `list_devices_with_room_temperatures`
- "What is this device?" -> `get_device_details`
- "Is this device on/off/online?" -> `get_device_status`
- "Run scene X" -> `execute_scene` (requires confirmation)
- "Turn off/on/set device X" -> `send_device_command` (requires confirmation)
- "Show my automations/rules" -> `list_rules`
- "Inspect rule X" -> `get_rule_details`
- "Change rule X" -> `update_rule` (requires confirmation)

## Fast Path For Temperature Questions
Never loop `get_device_status` for every device as a first pass.
Use:
- `list_devices_with_room_temperatures`

Only fall back to per-device status reads if the user asks for raw component-level values.

## Read Workflow
1. Start with the smallest read tool that answers the question.
2. Prefer summarized tools before detailed tools.
3. Resolve names first, IDs second.
4. Only expand to raw payload details when asked.

## Write Workflow (Safety Gate)
Before any write operation (`send_device_command`, `execute_scene`, `update_rule`):
1. Echo the exact target and intended action.
2. Ask for explicit confirmation.
3. Execute only after confirmation.
4. Report success/failure with timestamp and target ID.

## Output Contract (Always)
1. Start with a one-line direct answer.
2. Provide a compact result block/table.
3. Include counts for trust:
- locations
- devices
- rooms
- missing/unknown values
4. Prefer this row format for room temps:
- `Device | Room | Temp (F/C) | Notes`
5. Use `unknown` explicitly when data is missing.
6. Put IDs in parentheses only when needed for follow-up actions.

## Output Examples

### Example: Device + Room Temperature Summary
`Found 79 devices across 12 rooms; 7 rooms currently have temperature readings.`

| Device | Room | Temp (F/C) | Notes |
|---|---|---:|---|
| Hallway Sensor | Hallway | 72.1 / 22.3 | source: temperatureMeasurement |
| Kitchen Thermostat | Kitchen | 70.0 / 21.1 | aggregated room temperature |
| Garage Switch | Garage | unknown | no room temperature source |

### Example: Command Confirmation Prompt
`I can turn off "Office Lamp" (deviceId: ...). Confirm and I will execute this command now: switch.off?`

## Gateway Mode Notes
If using `/mcp-gateway`, tools are namespaced:
- `smartthings.list_locations`
- `smartthings.list_devices`
- `smartthings.list_devices_with_room_temperatures`

If a namespaced tool is missing, run upstream validation and reload.

## Troubleshooting
- `403 Host not allowed`
Fix `ALLOWED_MCP_HOSTS` and restart service.

- `401` or OAuth-related errors
Re-run `/oauth/start`, then retest `list_locations`.

- `SSE error: Non-200 status code (400|406|502)`
Verify endpoint path, mcporter config, and that client accepts `text/event-stream`.

- Device list works but scene/rule calls fail with `403`
OAuth token lacks required scopes. Recreate/re-authorize SmartApp with expected scopes.

- Temperature request is slow
Use `list_devices_with_room_temperatures`; avoid per-device status loops by default.

## Security Rules
- Never print, store, or echo tokens/secrets.
- Never perform write actions without explicit user confirmation.
- Minimize tool calls and data exposure to what the user asked for.
