import express from "express";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import { URL } from "node:url";
import crypto from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
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

function getSessionIdFromHeaders(headers: express.Request["headers"]): string | undefined {
  const raw = headers["mcp-session-id"];
  if (Array.isArray(raw)) {
    return raw[0];
  }
  return typeof raw === "string" && raw.length > 0 ? raw : undefined;
}

type TransportConnectable = {
  connect: (transport: StreamableHTTPServerTransport) => Promise<void>;
};

function createStreamableEndpointHandler(server: TransportConnectable, label: string) {
  const transports = new Map<string, StreamableHTTPServerTransport>();
  let activeTransport: StreamableHTTPServerTransport | null = null;

  return async (req: express.Request, res: express.Response) => {
    const sessionId = getSessionIdFromHeaders(req.headers);
    let transport = sessionId ? transports.get(sessionId) : undefined;
    const isInitRequest = req.method === "POST" && isInitializeRequest(req.body);

    try {
      if (!transport) {
        if (sessionId || !isInitRequest) {
          return res.status(400).json({
            jsonrpc: "2.0",
            error: {
              code: -32000,
              message: "Bad Request: No valid session ID provided"
            },
            id: null
          });
        }

        if (activeTransport) {
          try {
            await activeTransport.close();
          } catch (err) {
            logger.warn({ err, label }, "Failed closing previous transport session");
          } finally {
            activeTransport = null;
            transports.clear();
          }
        }

        let initializedSessionId: string | undefined;
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => crypto.randomUUID(),
          onsessioninitialized: (sid) => {
            initializedSessionId = sid;
            transports.set(sid, transport!);
          }
        });

        transport.onclose = () => {
          if (activeTransport === transport) {
            activeTransport = null;
          }
          const sid = transport?.sessionId ?? initializedSessionId;
          if (sid) {
            transports.delete(sid);
          }
        };

        await server.connect(transport);
        activeTransport = transport;
      }

      if (req.method === "GET" || req.method === "DELETE") {
        await transport.handleRequest(req, res);
      } else {
        await transport.handleRequest(req, res, req.body);
      }
    } catch (err) {
      logger.error({ err, label, path: req.path, method: req.method, sessionId }, "Streamable endpoint error");
      if (!res.headersSent) {
        res.status(500).json({ error: `${label} error` });
      }
    }
  };
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

  const { server: mcpServer } = await createMcpServer(client);
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

  const handleMcpEndpoint = createStreamableEndpointHandler(mcpServer as unknown as TransportConnectable, "MCP");
  app.all(config.mcpPath, async (req, res) => {
    if (!isHostAllowed(req.headers.host)) {
      return res.status(403).json({ error: "Host not allowed" });
    }
    if (!isOriginAllowed(req.headers.origin as string | undefined)) {
      return res.status(403).json({ error: "Origin not allowed" });
    }
    await handleMcpEndpoint(req, res);
  });

  if (gateway) {
    const handleGatewayEndpoint = createStreamableEndpointHandler(gateway.server, "Gateway");
    app.all(config.gatewayPath, async (req, res) => {
      if (!isHostAllowed(req.headers.host)) {
        return res.status(403).json({ error: "Host not allowed" });
      }
      if (!isOriginAllowed(req.headers.origin as string | undefined)) {
        return res.status(403).json({ error: "Origin not allowed" });
      }
      await handleGatewayEndpoint(req, res);
    });
  }

  app.listen(config.port, () => {
    logger.info({ port: config.port }, "SmartThings MCP server listening");
    if (gateway) {
      gateway.reload(true).catch((err) => {
        logger.warn({ err }, "Initial gateway upstream sync failed");
      });
    }
  });
})();
