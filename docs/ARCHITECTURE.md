# Architecture

## Components
- **MCP Server**: Exposes tools and translates them to SmartThings REST calls.
- **MCP Gateway (optional)**: Aggregates multiple MCP servers under one endpoint with namespaced tools.
- **SmartApp Webhook**: Receives lifecycle events and manages installation state.
- **OAuth Handler**: Exchanges codes for tokens and refreshes them on schedule.
- **Token Store**: Local storage with strict permissions.
- **Tunnel**: Cloudflare Tunnel provides a stable HTTPS URL.
 - **Request Verification**: SmartApp webhooks are verified via HTTP Signatures.

## Data Flow
1. User installs SmartApp -> SmartThings calls `/smartthings` lifecycle.
2. Server responds with configuration pages and OAuth redirect.
3. OAuth callback returns authorization code to `/oauth/callback`.
4. Server exchanges code for tokens and stores them.
5. MCP tool calls use stored tokens to call SmartThings APIs.
6. Gateway (if enabled) calls upstream MCP servers and returns aggregated results.

## Trust Boundaries
- Public HTTPS endpoint terminates at Cloudflare and is forwarded to local WSL2 service.
- OAuth tokens never leave the host except to SmartThings API endpoints.
- MCP server validates input and enforces scope checks before API calls.
- MCP endpoint enforces host allowlist to mitigate DNS rebinding.
- Gateway only forwards to explicitly configured upstreams.

## Reliability
- Systemd auto-restarts for MCP server and tunnel.
- Health endpoint for liveness probes.
