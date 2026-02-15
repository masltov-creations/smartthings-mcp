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
import { createGateway } from "./gateway.js";
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

type E2EStatus = {
  status: "pass" | "fail" | "unknown" | "not_authorized" | "disabled";
  checkedAt?: string;
  message?: string;
};

function createE2EChecker(
  smartClient: SmartThingsClient,
  intervalSec: number,
  timeoutMs: number,
  enabled: boolean
) {
  let running = false;
  let last: E2EStatus = enabled ? { status: "unknown" } : { status: "disabled" };

  const classifyError = (err: any): E2EStatus => {
    const msg = String(err?.message ?? err ?? "Unknown error");
    if (/no token records/i.test(msg)) return { status: "not_authorized", message: msg };
    if (/missing required smartthings scope/i.test(msg)) return { status: "not_authorized", message: msg };
    if (/invalid_grant/i.test(msg)) return { status: "not_authorized", message: msg };
    if (/oauth/i.test(msg)) return { status: "not_authorized", message: msg };
    if (/token refresh failed/i.test(msg)) return { status: "not_authorized", message: msg };
    return { status: "fail", message: msg };
  };

  const runNow = async (): Promise<E2EStatus> => {
    if (!enabled) return last;
    if (running) return last;
    running = true;
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("E2E check timed out")), timeoutMs)
    );
    try {
      await Promise.race([smartClient.listLocations(), timeout]);
      last = {
        status: "pass",
        checkedAt: new Date().toISOString(),
        message: "list_locations ok"
      };
    } catch (err) {
      const classified = classifyError(err);
      last = { ...classified, checkedAt: new Date().toISOString() };
    } finally {
      running = false;
    }
    return last;
  };

  if (enabled) {
    setTimeout(() => {
      runNow().catch(() => undefined);
    }, 2000);
    setInterval(() => {
      runNow().catch(() => undefined);
    }, intervalSec * 1000);
  }

  return {
    getStatus: () => last,
    runNow
  };
}

let gatewayStatus: (() => unknown) | undefined;

const e2eChecker = createE2EChecker(
  client,
  config.e2eCheckIntervalSec,
  config.e2eCheckTimeoutMs,
  config.e2eCheckEnabled
);

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

app.get("/healthz", async (req, res) => {
  const runE2E =
    typeof req.query.e2e === "string" && ["1", "true", "yes"].includes(req.query.e2e.toLowerCase());
  const e2e = runE2E ? await e2eChecker.runNow() : e2eChecker.getStatus();
  const go = e2e.status === "pass";
  const gateway = gatewayStatus ? gatewayStatus() : undefined;
  res.status(200).json({
    ok: true,
    service: "smartthings-mcp",
    version: "0.1.0",
    time: new Date().toISOString(),
    uptimeSec: Math.floor(process.uptime()),
    mode: "operational",
    e2e,
    gateway,
    go,
    quip: go ? "Green across the board." : "Poking the toaster. Stand by."
  });
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
  if (config.gatewayEnabled && config.gatewayPath === config.mcpPath) {
    logger.error("MCP_GATEWAY_PATH must differ from MCP_HTTP_PATH");
    process.exit(1);
  }

  const { transport } = await createMcpServer(client);
  let gateway: Awaited<ReturnType<typeof createGateway>> | null = null;
  if (config.gatewayEnabled) {
    try {
      gateway = await createGateway();
    } catch (err) {
      logger.error({ err }, "Gateway failed to start; continuing without gateway");
      gateway = null;
    }
  }
  if (gateway) {
    gatewayStatus = gateway.status;
  }

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

  if (gateway) {
    app.all(config.gatewayPath, async (req, res) => {
      if (!isHostAllowed(req.headers.host)) {
        return res.status(403).json({ error: "Host not allowed" });
      }
      if (!isOriginAllowed(req.headers.origin as string | undefined)) {
        return res.status(403).json({ error: "Origin not allowed" });
      }
      try {
        await gateway.transport.handleRequest(req, res, req.body);
      } catch (err) {
        logger.error({ err }, "Gateway transport error");
        res.status(500).json({ error: "Gateway error" });
      }
    });
  }

  app.listen(config.port, () => {
    logger.info({ port: config.port }, "SmartThings MCP server listening");
  });
})();
