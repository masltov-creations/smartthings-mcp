import crypto from "node:crypto";
import { config } from "./config.js";
import { TokenRecord, TokenStore } from "./tokenStore.js";

const STATE_TTL_MS = 10 * 60 * 1000;

class StateStore {
  private readonly entries = new Map<string, number>();

  create(): string {
    const value = crypto.randomUUID();
    this.entries.set(value, Date.now() + STATE_TTL_MS);
    return value;
  }

  verify(state: string): boolean {
    const exp = this.entries.get(state);
    if (!exp) return false;
    this.entries.delete(state);
    return exp >= Date.now();
  }
}

const stateStore = new StateStore();

export function buildAuthorizeUrl(): string {
  const state = stateStore.create();
  const redirectUri = `${config.publicUrl}${config.oauthRedirectPath}`;
  const params = new URLSearchParams({
    client_id: config.clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    scope: config.oauthScopes.join(" "),
    state
  });
  return `${config.oauthAuthorizeUrl}?${params.toString()}`;
}

export async function handleOAuthCallback(store: TokenStore, code: string, state?: string) {
  if (!state || !stateStore.verify(state)) {
    throw new Error("Invalid OAuth state");
  }

  const redirectUri = `${config.publicUrl}${config.oauthRedirectPath}`;
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: config.clientId
  });

  const auth = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64");
  const res = await fetch(config.oauthTokenUrl, {
    method: "POST",
    headers: {
      "Authorization": `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OAuth token exchange failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in?: number;
    scope?: string;
  };

  const expiresAt = data.expires_in
    ? new Date(Date.now() + data.expires_in * 1000).toISOString()
    : new Date(Date.now() + 23 * 60 * 60 * 1000).toISOString();

  const record: TokenRecord = {
    installedAppId: "oauth",
    locationId: "",
    appId: "oauth",
    authToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt,
    permissions: data.scope ? data.scope.split(/\s+/).filter(Boolean) : [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  await store.set(record);
  return record;
}
