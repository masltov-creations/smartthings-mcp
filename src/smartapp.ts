import crypto from "node:crypto";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { TokenRecord, TokenStore } from "./tokenStore.js";

const KEY_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const keyCache = new Map<string, { key: string; expiresAt: number }>();

function parseSignatureHeader(header: string): Record<string, string> | null {
  if (!header.startsWith("Signature ")) return null;
  const params = header.slice("Signature ".length);
  const pairs = params.match(/([a-zA-Z]+)="([^"]+)"/g);
  if (!pairs) return null;
  const result: Record<string, string> = {};
  for (const pair of pairs) {
    const idx = pair.indexOf("=");
    const key = pair.slice(0, idx);
    const value = pair.slice(idx + 2, -1);
    result[key] = value;
  }
  return result;
}

async function fetchKey(keyId: string): Promise<string> {
  const cached = keyCache.get(keyId);
  if (cached && cached.expiresAt > Date.now()) return cached.key;

  const url = keyId.startsWith("http") ? keyId : `https://key.smartthings.com${keyId}`;
  const res = await fetch(url, { headers: { Accept: "application/x-pem-file" } });
  if (!res.ok) throw new Error(`Failed to fetch SmartThings key: ${res.status}`);
  const key = await res.text();
  keyCache.set(keyId, { key, expiresAt: Date.now() + KEY_CACHE_TTL_MS });
  return key;
}

function computeDigest(rawBody: Buffer): string {
  const hash = crypto.createHash("sha256").update(rawBody).digest("base64");
  return `SHA-256=${hash}`;
}

function withinTolerance(dateHeader: string, toleranceSec: number): boolean {
  const parsed = Date.parse(dateHeader);
  if (Number.isNaN(parsed)) return false;
  const delta = Math.abs(Date.now() - parsed);
  return delta <= toleranceSec * 1000;
}

async function verifySignature(req: any): Promise<boolean> {
  const header = req.headers["authorization"] as string | undefined;
  const digestHeader = Array.isArray(req.headers["digest"]) ? req.headers["digest"][0] : req.headers["digest"];
  const dateHeader = Array.isArray(req.headers["date"]) ? req.headers["date"][0] : req.headers["date"];

  if (!header || !digestHeader || !dateHeader) return false;
  if (!withinTolerance(dateHeader, config.signatureToleranceSec)) return false;

  const parsed = parseSignatureHeader(header);
  if (!parsed?.keyId || !parsed.signature) return false;

  const rawBody: Buffer = req.rawBody ?? Buffer.from("");
  const computedDigest = computeDigest(rawBody);
  if (computedDigest !== digestHeader) return false;

  const headersList = (parsed.headers ?? "(request-target)").split(" ");
  const lines: string[] = [];

  for (const headerName of headersList) {
    const lower = headerName.toLowerCase();
    if (lower === "(request-target)") {
      const path = req.originalUrl || req.url;
      lines.push(`(request-target): ${req.method.toLowerCase()} ${path}`);
      continue;
    }
    const rawValue = req.headers[lower];
    const value = Array.isArray(rawValue) ? rawValue.join(",") : rawValue;
    if (!value) return false;
    lines.push(`${lower}: ${value}`);
  }

  const signingString = lines.join("\n");
  const key = await fetchKey(parsed.keyId);

  return crypto.verify(
    "RSA-SHA256",
    Buffer.from(signingString),
    key,
    Buffer.from(parsed.signature, "base64")
  );
}

function buildConfirmationResponse() {
  return {
    confirmationData: {
      targetUrl: `${config.publicUrl}${config.webhookPath}`
    }
  };
}

function buildInitializeResponse() {
  return {
    configurationData: {
      initialize: {
        name: "SmartThings MCP",
        description: "MCP server for SmartThings with OAuth2",
        permissions: [
          "r:locations:*",
          "r:devices:*",
          "x:devices:*",
          "r:scenes:*",
          "x:scenes:*",
          "r:rules:*",
          "w:rules:*"
        ]
      }
    }
  };
}

function buildPageResponse() {
  return {
    configurationData: {
      page: {
        pageId: "main",
        name: "SmartThings MCP",
        nextPageId: null,
        previousPageId: null,
        complete: true,
        sections: []
      }
    }
  };
}

function extractInstallData(body: any) {
  const installData = body?.installData;
  if (!installData) return null;
  return {
    authToken: installData.authToken,
    refreshToken: installData.refreshToken,
    installedAppId: installData.installedApp?.installedAppId,
    locationId: installData.installedApp?.locationId,
    permissions: installData.permissions ?? []
  };
}

export function createSmartAppHandler(store: TokenStore) {
  return async function smartAppHandler(req: any, res: any) {
    try {
      if (config.verifySignatures) {
        const ok = await verifySignature(req);
        if (!ok) {
          logger.warn("SmartApp signature verification failed");
          return res.status(401).json({ error: "Invalid signature" });
        }
      }

      const body = req.body;
      const lifecycle = body?.lifecycle;

      switch (lifecycle) {
        case "CONFIRMATION":
          return res.status(200).json(buildConfirmationResponse());
        case "CONFIGURATION": {
          const phase = body?.configurationData?.phase;
          if (phase === "INITIALIZE") return res.status(200).json(buildInitializeResponse());
          if (phase === "PAGE") return res.status(200).json(buildPageResponse());
          return res.status(200).json(buildPageResponse());
        }
        case "INSTALL":
        case "UPDATE": {
          const data = extractInstallData(body);
          if (!data?.authToken || !data?.refreshToken || !data?.installedAppId || !data?.locationId) {
            return res.status(400).json({ error: "Missing install data" });
          }

          const existing = await store.get(data.installedAppId);
          const record: TokenRecord = {
            installedAppId: data.installedAppId,
            locationId: data.locationId,
            appId: body?.appId ?? "",
            authToken: data.authToken,
            refreshToken: data.refreshToken,
            expiresAt: new Date(Date.now() + 23 * 60 * 60 * 1000).toISOString(),
            permissions: data.permissions,
            createdAt: existing?.createdAt ?? new Date().toISOString(),
            updatedAt: new Date().toISOString()
          };

          await store.set(record);
          logger.info({ lifecycle, installedAppId: record.installedAppId }, "Stored SmartThings tokens");
          return res.status(200).json({});
        }
        case "EVENT":
          // Event handling can be extended for subscriptions; for now we acknowledge.
          return res.status(200).json({});
        case "UNINSTALL": {
          const installedAppId = body?.uninstallData?.installedAppId;
          if (installedAppId) await store.delete(installedAppId);
          return res.status(200).json({});
        }
        default:
          logger.warn({ lifecycle }, "Unknown lifecycle received");
          return res.status(200).json({});
      }
    } catch (err: any) {
      logger.error({ err }, "SmartApp handler error");
      return res.status(500).json({ error: "Internal server error" });
    }
  };
}
