# Threat Model (High Level)

## Assets
- SmartThings OAuth client secret
- Access and refresh tokens
- Device and location identifiers

## Primary Threats
- OAuth code interception
- CSRF during OAuth callback
- Token leakage via logs or backups
- Malicious MCP tool invocation
- Unauthorized webhook requests

## Mitigations
- Strict redirect URI matching and `state` verification
- HTTPS enforced at the tunnel
- No token values in logs
- Input validation and allowlisted tools
- Signature verification or request validation for webhooks (when supported)

## Residual Risks
- Compromise of the host OS
- Misconfigured tunnel exposing endpoints
- Overbroad SmartThings scopes

