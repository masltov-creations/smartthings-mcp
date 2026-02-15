import { config } from "./config.js";
import { logger } from "./logger.js";
import { TokenRecord, TokenStore } from "./tokenStore.js";

const EXPIRY_BUFFER_MS = 5 * 60 * 1000;

export class SmartThingsClient {
  constructor(private readonly store: TokenStore) {}

  private async getActiveRecord(installedAppId?: string): Promise<TokenRecord> {
    if (installedAppId) {
      const record = await this.store.get(installedAppId);
      if (!record) throw new Error(`No token record for installedAppId ${installedAppId}`);
      return record;
    }
    if (config.activeInstalledAppId) {
      const record = await this.store.get(config.activeInstalledAppId);
      if (!record) throw new Error(`No token record for ACTIVE_INSTALLED_APP_ID ${config.activeInstalledAppId}`);
      return record;
    }
    const records = await this.store.list();
    if (records.length === 0) throw new Error("No token records available. Install the SmartApp first.");
    return records[0];
  }

  private isExpired(record: TokenRecord): boolean {
    if (!record.expiresAt) return true;
    const exp = new Date(record.expiresAt).getTime();
    return Date.now() + EXPIRY_BUFFER_MS >= exp;
  }

  private async refresh(record: TokenRecord): Promise<TokenRecord> {
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: record.refreshToken
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
      throw new Error(`Token refresh failed (${res.status}): ${text}`);
    }

    const data = (await res.json()) as {
      access_token: string;
      token_type?: string;
      expires_in?: number;
      refresh_token?: string;
    };

    const expiresAt = data.expires_in
      ? new Date(Date.now() + data.expires_in * 1000).toISOString()
      : new Date(Date.now() + 23 * 60 * 60 * 1000).toISOString();

    const updated: TokenRecord = {
      ...record,
      authToken: data.access_token,
      refreshToken: data.refresh_token ?? record.refreshToken,
      expiresAt,
      updatedAt: new Date().toISOString()
    };

    await this.store.set(updated);
    logger.info({ installedAppId: record.installedAppId }, "Refreshed SmartThings token");
    return updated;
  }

  private async ensureFresh(record: TokenRecord): Promise<TokenRecord> {
    if (!this.isExpired(record)) return record;
    return this.refresh(record);
  }

  private hasRequiredScope(record: TokenRecord, required: string): boolean {
    if (!record.permissions || record.permissions.length === 0) return true;
    const [reqAction, reqResource, reqId] = required.split(":");
    return record.permissions.some((perm) => {
      const [act, res, id] = perm.split(":");
      if (act !== reqAction || res !== reqResource) return false;
      if (id === "*") return true;
      if (reqId === "*" && id) return true;
      return id === reqId;
    });
  }

  private assertScopes(record: TokenRecord, required: string[]) {
    for (const scope of required) {
      if (this.hasRequiredScope(record, scope)) return;
    }
    throw new Error(`Missing required SmartThings scope(s): ${required.join(", ")}`);
  }

  private async request(
    method: string,
    path: string,
    body?: unknown,
    installedAppId?: string,
    requiredScopes: string[] = []
  ): Promise<any> {
    let record = await this.getActiveRecord(installedAppId);
    record = await this.ensureFresh(record);
    if (requiredScopes.length > 0) this.assertScopes(record, requiredScopes);

    const url = `${config.apiBaseUrl}${path}`;
    const res = await fetch(url, {
      method,
      headers: {
        "Authorization": `Bearer ${record.authToken}`,
        "Content-Type": "application/json"
      },
      body: body ? JSON.stringify(body) : undefined
    });

    if (res.status === 401) {
      logger.warn({ installedAppId: record.installedAppId }, "Access token expired, attempting refresh");
      record = await this.refresh(record);
      const retry = await fetch(url, {
        method,
        headers: {
          "Authorization": `Bearer ${record.authToken}`,
          "Content-Type": "application/json"
        },
        body: body ? JSON.stringify(body) : undefined
      });
      if (!retry.ok) {
        const text = await retry.text();
        throw new Error(`SmartThings API error (${retry.status}): ${text}`);
      }
      return retry.status === 204 ? null : await retry.json();
    }

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`SmartThings API error (${res.status}): ${text}`);
    }

    return res.status === 204 ? null : await res.json();
  }

  async listLocations(installedAppId?: string) {
    return this.request("GET", "/locations", undefined, installedAppId, ["r:locations:*"]);
  }

  async listDevices(locationId?: string, installedAppId?: string) {
    const query = locationId ? `?locationId=${encodeURIComponent(locationId)}` : "";
    return this.request("GET", `/devices${query}`, undefined, installedAppId, ["r:devices:*"]);
  }

  async getDeviceDetails(deviceId: string, installedAppId?: string) {
    return this.request("GET", `/devices/${deviceId}`, undefined, installedAppId, [
      `r:devices:${deviceId}`,
      "r:devices:*"
    ]);
  }

  async getDeviceStatus(deviceId: string, installedAppId?: string) {
    return this.request("GET", `/devices/${deviceId}/status`, undefined, installedAppId, [
      `r:devices:${deviceId}`,
      "r:devices:*"
    ]);
  }

  async sendDeviceCommand(deviceId: string, commands: any[], installedAppId?: string) {
    return this.request("POST", `/devices/${deviceId}/commands`, { commands }, installedAppId, [
      `x:devices:${deviceId}`,
      "x:devices:*"
    ]);
  }

  async listScenes(installedAppId?: string) {
    return this.request("GET", "/scenes", undefined, installedAppId, ["r:scenes:*"]);
  }

  async executeScene(sceneId: string, installedAppId?: string) {
    return this.request("POST", `/scenes/${sceneId}/execute`, undefined, installedAppId, [
      `x:scenes:${sceneId}`,
      "x:scenes:*"
    ]);
  }

  async listRules(installedAppId?: string) {
    return this.request("GET", "/rules", undefined, installedAppId, ["r:rules:*"]);
  }

  async getRule(ruleId: string, installedAppId?: string) {
    return this.request("GET", `/rules/${ruleId}`, undefined, installedAppId, [
      `r:rules:${ruleId}`,
      "r:rules:*"
    ]);
  }

  async updateRule(ruleId: string, rule: any, installedAppId?: string) {
    return this.request("PUT", `/rules/${ruleId}`, rule, installedAppId, [
      `w:rules:${ruleId}`,
      "w:rules:*"
    ]);
  }
}
