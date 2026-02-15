# Security

## Security Model
This MCP server is a single-tenant, self-hosted integration that authenticates to SmartThings using OAuth 2.0 Authorization Code flow. The server stores access and refresh tokens and uses them to call SmartThings APIs on behalf of the user.

## Design Goals
- Enforce OAuth2 best practices (strict redirect URI matching, CSRF state validation).
- Minimize SmartThings scopes and reduce blast radius.
- Prevent token leakage in logs and telemetry.
- Restrict outbound requests to SmartThings endpoints.
- Verify SmartApp webhook signatures (HTTP Signatures).

## Operational Guidelines
- Keep secrets in `.env` and never commit them.
- Run the server behind HTTPS only.
- Use a durable public URL (Cloudflare Tunnel recommended).
- Rotate SmartThings client secrets if exposure is suspected.
- Keep the host OS updated.

## Data Handling
- Tokens are stored on disk with strict permissions (`600`).
- Logs are scrubbed of token values.
- No user content is sent anywhere except SmartThings.

## Reporting
If you discover a vulnerability, open a private security advisory or contact the repository owner.
