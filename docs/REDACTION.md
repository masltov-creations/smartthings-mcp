# Safe Sharing Checklist

Before sharing publicly (or zipping the repo), verify the following:

- Remove `.env` and any secret files.
- Remove token stores (`token-store.json`, `tokens.json`, databases).
- Remove Cloudflare tunnel credentials (typically in `.cloudflared/` or `cloudflared/`).
- Scrub logs that might contain URLs or tokens.
- Rotate any exposed SmartThings client secrets.
- Double-check `.gitignore` is intact.

If unsure, assume exposure and rotate secrets.

