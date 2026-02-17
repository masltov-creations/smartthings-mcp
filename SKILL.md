---
name: smartthings-mcp
description: Operate SmartThings through MCP with fast tool routing, safety gates, and human-first output formatting.
---

# SmartThings MCP Operator

## Mission
Use SmartThings MCP tools to answer home-automation questions quickly, clearly, and safely.

## Use This Skill When
- The user asks about locations, devices, status, scenes, or rules.
- The user asks room/device temperature summaries.
- The user asks to execute scenes, send commands, or change rules.

## Required Preconditions
- MCP endpoint is reachable (`/mcp` or namespaced via `/mcp-gateway`).
- OAuth has been completed once at `/oauth/start`.
- `PUBLIC_URL` and `ALLOWED_MCP_HOSTS` are correctly set.
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

If checks fail, stop and return one concrete fix from Troubleshooting.

## Progressive Disclosure Model
1. L1 Answer: one-line direct answer.
2. L2 Summary: compact table/list with counts.
3. L3 Detail: selected rows with key IDs.
4. L4 Raw: full payload only when user asks.

Keep default responses at L1+L2 unless deeper detail is requested.

## Tool Router (Intent -> Tool)
- "What locations/devices do I have?" -> `list_locations`, `list_devices`
- "What temperature is each room/device in?" -> `list_devices_with_room_temperatures`
- "What is this device exactly?" -> `get_device_details`
- "Is this device on/off/online?" -> `get_device_status` (single) or `get_device_statuses` (many)
- "Turn on/off or set device X" -> `send_device_command_and_verify` (preferred, confirmation required)
- "Run scene X" -> `execute_scene` (confirmation required)
- "Show rules/automations" -> `list_rules`
- "Inspect rule X" -> `get_rule_details`
- "Change rule X" -> `update_rule` (confirmation required)

## Fast Paths (Use First)
- Temperature summary requests: `list_devices_with_room_temperatures`
- Multi-device state checks: `get_device_statuses` with explicit `deviceIds` whenever possible.
- Avoid per-device `get_device_status` loops unless user asks for component-level raw state.

## Read Workflow
1. Start with aggregate tools.
2. Prefer names first, IDs second.
3. Expand into details only when needed.
4. Return raw payloads only on request.

## Write Workflow (Safety Gate)
Before any write (`send_device_command_and_verify`, `execute_scene`, `update_rule`):
1. Echo exact target and planned action.
2. Ask for explicit confirmation.
3. Execute only after confirmation.
4. Report concise success/failure with target IDs and timestamp.

For device commands, prefer `send_device_command_and_verify` with concrete expectations.
Example expectation:
- `componentId: "main", capability: "switch", attribute: "switch", equals: "on"`

## Output Contract (Always)
1. Start with one direct sentence.
2. Then present compact, scannable output (table/list).
3. Include trust counts:
- locations
- devices
- rooms
- missing/unknown values
4. Use names first, IDs in parentheses when needed.
5. Use explicit `unknown` for missing values.

Preferred row format for room temperature responses:
- `Device | Room | Temp (F/C) | Notes`

## Output Examples

### Example: Device + Room Temperature Summary
`Found 79 devices across 12 rooms; 7 rooms currently have temperature readings.`

| Device | Room | Temp (F/C) | Notes |
|---|---|---:|---|
| Hallway Sensor | Hallway | 72.1 / 22.3 | source: temperatureMeasurement |
| Kitchen Thermostat | Kitchen | 70.0 / 21.1 | aggregated room temperature |
| Garage Switch | Garage | unknown | no room temperature source |

### Example: Write Confirmation Prompt
`I can turn off "Office Lamp" (deviceId: ...). Confirm and I will execute switch.off now.`

## Gateway Mode Notes
If using `/mcp-gateway`, tools are namespaced:
- `smartthings.list_locations`
- `smartthings.list_devices`
- `smartthings.list_devices_with_room_temperatures`

If a namespaced tool is missing, validate upstream config and reload gateway.

## Troubleshooting
- `403 Host not allowed`
Update `ALLOWED_MCP_HOSTS` and restart.

- `401` / OAuth errors
Re-run `/oauth/start`, then retry `list_locations`.

- `SSE error: Non-200 status code (400|406|502)`
Verify endpoint path and `mcporter` mapping, and ensure client accepts `text/event-stream`.

- Rules/scenes fail with `403`
Re-authorize with required scopes.

- Temperature requests are slow
Use `list_devices_with_room_temperatures` first.

## Security Rules
- Never print/store secrets or tokens.
- Never perform write actions without explicit confirmation.
- Return the minimum data needed for the user’s request.

## Style Note
A little dry wit is fine. Keep it short, clear, and useful.
