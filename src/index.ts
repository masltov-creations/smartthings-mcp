import express from "express";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import { URL } from "node:url";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { TokenStore } from "./tokenStore.js";
import { createSmartAppHandler } from "./smartapp.js";
import { SmartThingsClient } from "./smartthingsApi.js";
import { createMcpServer } from "./mcp.js";
import { buildAuthorizeUrl, handleOAuthCallback } from "./oauth.js";

const app = express();
app.set("trust proxy", true);

app.use(helmet({
  contentSecurityPolicy: false
}));
app.use(pinoHttp({ logger: logger as any }));

app.use(express.json({
  limit: "1mb",
  verify: (req: any, _res, buf) => {
    req.rawBody = buf;
  }
}));

const store = new TokenStore(config.tokenStorePath);
const smartAppHandler = createSmartAppHandler(store);
const client = new SmartThingsClient(store);

const publicHost = (() => {
  try {
    return new URL(config.publicUrl).hostname;
  } catch {
    return null;
  }
})();

const allowedHosts = config.allowedMcpHosts.length
  ? config.allowedMcpHosts
  : ["localhost", "127.0.0.1", publicHost].filter(Boolean) as string[];

function isHostAllowed(hostHeader?: string): boolean {
  if (!hostHeader) return false;
  const host = hostHeader.split(":")[0].toLowerCase();
  return allowedHosts.includes(host);
}

function isOriginAllowed(originHeader?: string): boolean {
  if (!originHeader) return true;
  try {
    const origin = new URL(originHeader);
    return allowedHosts.includes(origin.hostname.toLowerCase());
  } catch {
    return false;
  }
}

app.get("/healthz", async (_req, res) => {
  res.status(200).json({ ok: true });
});

app.post(config.webhookPath, smartAppHandler);

app.get("/oauth/start", (_req, res) => {
  const url = buildAuthorizeUrl();
  res.redirect(url);
});

app.get(config.oauthRedirectPath, async (req, res) => {
  const code = typeof req.query.code === "string" ? req.query.code : "";
  const state = typeof req.query.state === "string" ? req.query.state : undefined;

  if (!code) {
    return res.status(400).json({ error: "Missing code" });
  }

  try {
    await handleOAuthCallback(store, code, state);
    return res.status(200).send("OAuth complete. Tokens stored.");
  } catch (err) {
    logger.error({ err }, "OAuth callback error");
    return res.status(400).json({ error: "OAuth callback failed" });
  }
});

(async () => {
  const { transport } = await createMcpServer(client);

  app.all(config.mcpPath, async (req, res) => {
    if (!isHostAllowed(req.headers.host)) {
      return res.status(403).json({ error: "Host not allowed" });
    }
    if (!isOriginAllowed(req.headers.origin as string | undefined)) {
      return res.status(403).json({ error: "Origin not allowed" });
    }
    try {
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      logger.error({ err }, "MCP transport error");
      res.status(500).json({ error: "MCP error" });
    }
  });

  app.listen(config.port, () => {
    logger.info({ port: config.port }, "SmartThings MCP server listening");
  });
})();
