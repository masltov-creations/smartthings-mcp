import { z } from "zod";
import dotenv from "dotenv";

dotenv.config();

const boolFromEnv = (value: string | undefined, defaultValue: boolean) => {
  if (value === undefined) return defaultValue;
  return value.toLowerCase() === "true" || value === "1";
};

const schema = z.object({
  PORT: z.coerce.number().int().positive().default(8080),
  PUBLIC_URL: z.string().url(),
  SMARTTHINGS_CLIENT_ID: z.string().min(1),
  SMARTTHINGS_CLIENT_SECRET: z.string().min(1),
  SMARTTHINGS_OAUTH_TOKEN_URL: z.string().url().default("https://api.smartthings.com/oauth/token"),
  SMARTTHINGS_OAUTH_AUTHORIZE_URL: z.string().url().default("https://api.smartthings.com/oauth/authorize"),
  SMARTTHINGS_API_BASE_URL: z.string().url().default("https://api.smartthings.com/v1"),
  SMARTTHINGS_WEBHOOK_PATH: z.string().default("/smartthings"),
  MCP_HTTP_PATH: z.string().default("/mcp"),
  OAUTH_REDIRECT_PATH: z.string().default("/oauth/callback"),
  OAUTH_SCOPES: z.string().default("r:locations:* r:devices:* x:devices:* r:scenes:* x:scenes:* r:rules:* w:rules:*"),
  TOKEN_STORE_PATH: z.string().default("data/token-store.json"),
  LOG_LEVEL: z.string().default("info"),
  SMARTTHINGS_VERIFY_SIGNATURES: z.string().optional(),
  SIGNATURE_TOLERANCE_SEC: z.coerce.number().int().positive().default(300),
  ALLOWED_MCP_HOSTS: z.string().optional(),
  ACTIVE_INSTALLED_APP_ID: z.string().optional()
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error("Invalid configuration:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

const env = parsed.data;

export const config = {
  port: env.PORT,
  publicUrl: env.PUBLIC_URL.replace(/\/$/, ""),
  clientId: env.SMARTTHINGS_CLIENT_ID,
  clientSecret: env.SMARTTHINGS_CLIENT_SECRET,
  oauthTokenUrl: env.SMARTTHINGS_OAUTH_TOKEN_URL,
  oauthAuthorizeUrl: env.SMARTTHINGS_OAUTH_AUTHORIZE_URL,
  apiBaseUrl: env.SMARTTHINGS_API_BASE_URL.replace(/\/$/, ""),
  webhookPath: env.SMARTTHINGS_WEBHOOK_PATH,
  mcpPath: env.MCP_HTTP_PATH,
  oauthRedirectPath: env.OAUTH_REDIRECT_PATH,
  oauthScopes: env.OAUTH_SCOPES.split(/\s+/).map((s) => s.trim()).filter(Boolean),
  tokenStorePath: env.TOKEN_STORE_PATH,
  logLevel: env.LOG_LEVEL,
  verifySignatures: boolFromEnv(env.SMARTTHINGS_VERIFY_SIGNATURES, true),
  signatureToleranceSec: env.SIGNATURE_TOLERANCE_SEC,
  allowedMcpHosts: env.ALLOWED_MCP_HOSTS
    ? env.ALLOWED_MCP_HOSTS.split(",").map((s) => s.trim()).filter(Boolean)
    : [],
  activeInstalledAppId: env.ACTIVE_INSTALLED_APP_ID
};
