import { config } from "./config.js";
import { logger } from "./logger.js";
import { TokenRecord, TokenStore } from "./tokenStore.js";

const EXPIRY_BUFFER_MS = 5 * 60 * 1000;
const MAX_PAGES = 100;

type TemperatureReading = {
  celsius: number;
  fahrenheit: number;
  unit: string;
};

type DeviceRow = {
  deviceId: string;
  name: string;
  label: string | null;
  roomId: string | null;
  locationId: string | null;
  hasTemperatureCapability: boolean;
};

type RoomTemperature = {
  roomId: string;
  roomName: string | null;
  temperatureC: number | null;
  temperatureF: number | null;
  temperatureSourceCount: number;
  sourceDeviceIds: string[];
};

type DeviceRoomTemperatureItem = {
  deviceId: string;
  name: string;
  label: string | null;
  locationId: string | null;
  roomId: string | null;
  roomName: string | null;
  roomTemperatureC: number | null;
  roomTemperatureF: number | null;
  roomTemperatureSourceCount: number;
};

type RoomTemperaturePayload = {
  summary: {
    generatedAt: string;
    devicesTotal: number;
    temperatureSourceDevices: number;
    roomsTotal: number;
    roomsWithTemperature: number;
    failedTemperatureSourceReads: number;
    cacheTtlSec: number;
  };
  roomTemperatures: RoomTemperature[];
  items: DeviceRoomTemperatureItem[];
};

type DeviceStatusBatchItem = {
  deviceId: string;
  ok: boolean;
  status: any | null;
  error: string | null;
};

type DeviceStatusesPayload = {
  summary: {
    generatedAt: string;
    source: "deviceIds" | "locationDevices";
    requested: number;
    resolved: number;
    failed: number;
    durationMs: number;
    concurrency: number;
  };
  items: DeviceStatusBatchItem[];
};

type CommandExpectation = {
  componentId?: string;
  capability: string;
  attribute: string;
  equals?: unknown;
  oneOf?: unknown[];
  exists?: boolean;
};

type CommandExpectationCheck = {
  componentId: string;
  capability: string;
  attribute: string;
  actual: unknown;
  comparator: "equals" | "oneOf" | "exists" | "notExists";
  expected: unknown;
  passed: boolean;
};

type CommandVerificationResult = {
  ok: boolean;
  deviceId: string;
  attemptsUsed: number;
  durationMs: number;
  commandResponse: any;
  checks: CommandExpectationCheck[];
  error: string | null;
};

export class SmartThingsClient {
  private readonly roomTempCache = new Map<string, { expiresAt: number; data: RoomTemperaturePayload }>();

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
    const res = await this.fetchWithTimeout(config.oauthTokenUrl, {
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

  private toApiUrl(pathOrUrl: string): string {
    if (pathOrUrl.startsWith("http://") || pathOrUrl.startsWith("https://")) return pathOrUrl;
    return `${config.apiBaseUrl}${pathOrUrl}`;
  }

  private async fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.smartThingsRequestTimeoutMs);
    try {
      return await fetch(url, {
        ...init,
        signal: controller.signal
      });
    } catch (err) {
      if ((err as Error)?.name === "AbortError") {
        throw new Error(`SmartThings API timeout after ${config.smartThingsRequestTimeoutMs}ms: ${url}`);
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async makeApiCall(record: TokenRecord, method: string, url: string, body?: unknown): Promise<Response> {
    return this.fetchWithTimeout(url, {
      method,
      headers: {
        "Authorization": `Bearer ${record.authToken}`,
        "Content-Type": "application/json"
      },
      body: body ? JSON.stringify(body) : undefined
    });
  }

  private async request(
    method: string,
    pathOrUrl: string,
    body?: unknown,
    installedAppId?: string,
    requiredScopes: string[] = []
  ): Promise<any> {
    let record = await this.getActiveRecord(installedAppId);
    record = await this.ensureFresh(record);
    if (requiredScopes.length > 0) this.assertScopes(record, requiredScopes);

    const url = this.toApiUrl(pathOrUrl);
    let res = await this.makeApiCall(record, method, url, body);

    if (res.status === 401) {
      logger.warn({ installedAppId: record.installedAppId }, "Access token expired, attempting refresh");
      record = await this.refresh(record);
      res = await this.makeApiCall(record, method, url, body);
    }

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`SmartThings API error (${res.status}): ${text}`);
    }

    return res.status === 204 ? null : await res.json();
  }

  private async requestAllPages(
    pathOrUrl: string,
    installedAppId?: string,
    requiredScopes: string[] = []
  ): Promise<any> {
    const firstPage = await this.request("GET", pathOrUrl, undefined, installedAppId, requiredScopes);
    if (!firstPage || !Array.isArray(firstPage.items)) {
      return firstPage;
    }

    const items = [...firstPage.items];
    let pagesFetched = 1;
    let nextHref = firstPage?._links?.next?.href as string | undefined;
    const seen = new Set<string>();

    while (nextHref && pagesFetched < MAX_PAGES) {
      if (seen.has(nextHref)) {
        logger.warn({ nextHref }, "Stopping pagination loop due to repeated next link");
        break;
      }
      seen.add(nextHref);
      const page = await this.request("GET", nextHref, undefined, installedAppId, requiredScopes);
      pagesFetched += 1;
      if (!page || !Array.isArray(page.items)) break;
      items.push(...page.items);
      nextHref = page?._links?.next?.href as string | undefined;
    }

    return {
      ...firstPage,
      items,
      _pagination: {
        pagesFetched,
        itemCount: items.length,
        hasMore: Boolean(nextHref)
      }
    };
  }

  private deviceHasCapability(device: any, capabilityId: string): boolean {
    if (!Array.isArray(device?.components)) return false;
    return device.components.some((component: any) => (
      Array.isArray(component?.capabilities) &&
      component.capabilities.some((capability: any) => capability?.id === capabilityId)
    ));
  }

  private normalizeTemperature(value: unknown, unit: unknown): TemperatureReading | null {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return null;
    const normalizedUnit = String(unit ?? "").trim().toUpperCase();
    if (normalizedUnit === "F" || normalizedUnit === "FAHRENHEIT") {
      const celsius = (numeric - 32) * (5 / 9);
      return {
        celsius,
        fahrenheit: numeric,
        unit: "F"
      };
    }

    const celsius = numeric;
    return {
      celsius,
      fahrenheit: (numeric * 9) / 5 + 32,
      unit: normalizedUnit || "C"
    };
  }

  private extractTemperature(status: any): TemperatureReading | null {
    const components = status?.components;
    if (!components || typeof components !== "object") return null;

    for (const component of Object.values(components as Record<string, any>)) {
      const temp = component?.temperatureMeasurement?.temperature;
      if (!temp) continue;
      const parsed = this.normalizeTemperature(temp.value, temp.unit);
      if (parsed) return parsed;
    }

    return null;
  }

  private round(value: number, decimals = 1): number {
    const factor = 10 ** decimals;
    return Math.round(value * factor) / factor;
  }

  private dedupeDeviceIds(deviceIds: string[]): string[] {
    const seen = new Set<string>();
    const deduped: string[] = [];
    for (const id of deviceIds) {
      const normalized = id.trim();
      if (normalized.length === 0 || seen.has(normalized)) continue;
      seen.add(normalized);
      deduped.push(normalized);
    }
    return deduped;
  }

  private deepEqual(left: unknown, right: unknown): boolean {
    if (Object.is(left, right)) return true;
    if (typeof left !== typeof right) return false;
    if (left === null || right === null) return left === right;

    if (Array.isArray(left) && Array.isArray(right)) {
      if (left.length !== right.length) return false;
      for (let i = 0; i < left.length; i += 1) {
        if (!this.deepEqual(left[i], right[i])) return false;
      }
      return true;
    }

    if (typeof left === "object" && typeof right === "object") {
      const leftObj = left as Record<string, unknown>;
      const rightObj = right as Record<string, unknown>;
      const leftKeys = Object.keys(leftObj);
      const rightKeys = Object.keys(rightObj);
      if (leftKeys.length !== rightKeys.length) return false;
      for (const key of leftKeys) {
        if (!Object.prototype.hasOwnProperty.call(rightObj, key)) return false;
        if (!this.deepEqual(leftObj[key], rightObj[key])) return false;
      }
      return true;
    }

    return false;
  }

  private getStatusValue(status: any, expectation: CommandExpectation): unknown {
    const componentId = expectation.componentId ?? "main";
    return status?.components?.[componentId]?.[expectation.capability]?.[expectation.attribute]?.value;
  }

  private evaluateCommandExpectations(status: any, expectations: CommandExpectation[]): CommandExpectationCheck[] {
    return expectations.map((expectation) => {
      const componentId = expectation.componentId ?? "main";
      const actual = this.getStatusValue(status, expectation);

      if (expectation.oneOf !== undefined) {
        const passed = expectation.oneOf.some((candidate) => this.deepEqual(actual, candidate));
        return {
          componentId,
          capability: expectation.capability,
          attribute: expectation.attribute,
          actual,
          comparator: "oneOf",
          expected: expectation.oneOf,
          passed
        };
      }

      if (Object.prototype.hasOwnProperty.call(expectation, "equals")) {
        const passed = this.deepEqual(actual, expectation.equals);
        return {
          componentId,
          capability: expectation.capability,
          attribute: expectation.attribute,
          actual,
          comparator: "equals",
          expected: expectation.equals,
          passed
        };
      }

      if (expectation.exists === false) {
        const passed = actual === undefined || actual === null;
        return {
          componentId,
          capability: expectation.capability,
          attribute: expectation.attribute,
          actual,
          comparator: "notExists",
          expected: null,
          passed
        };
      }

      const passed = actual !== undefined && actual !== null;
      return {
        componentId,
        capability: expectation.capability,
        attribute: expectation.attribute,
        actual,
        comparator: "exists",
        expected: true,
        passed
      };
    });
  }

  private async sleep(ms: number): Promise<void> {
    if (ms <= 0) return;
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async mapWithConcurrency<T, R>(
    items: T[],
    concurrency: number,
    mapper: (item: T) => Promise<R>
  ): Promise<R[]> {
    if (items.length === 0) return [];
    const safeConcurrency = Math.max(1, Math.min(concurrency, items.length));
    const results: R[] = new Array(items.length);
    let nextIndex = 0;

    const workers = Array.from({ length: safeConcurrency }, async () => {
      while (true) {
        const index = nextIndex++;
        if (index >= items.length) break;
        results[index] = await mapper(items[index]);
      }
    });

    await Promise.all(workers);
    return results;
  }

  async listLocations(installedAppId?: string) {
    return this.requestAllPages("/locations", installedAppId, ["r:locations:*"]);
  }

  async listDevices(locationId?: string, installedAppId?: string) {
    const query = locationId ? `?locationId=${encodeURIComponent(locationId)}` : "";
    return this.requestAllPages(`/devices${query}`, installedAppId, ["r:devices:*"]);
  }

  async listRooms(locationId: string, installedAppId?: string) {
    return this.requestAllPages(`/locations/${locationId}/rooms`, installedAppId, ["r:locations:*"]);
  }

  async listDevicesWithRoomTemperatures(locationId?: string, installedAppId?: string, refresh = false) {
    const cacheKey = `${installedAppId ?? "default"}:${locationId ?? "*"}`;
    const cached = this.roomTempCache.get(cacheKey);
    if (!refresh && cached && cached.expiresAt > Date.now()) {
      return cached.data;
    }

    const deviceResponse = await this.listDevices(locationId, installedAppId);
    const devices: any[] = Array.isArray(deviceResponse?.items) ? deviceResponse.items : [];

    const rows: DeviceRow[] = devices
      .map((device: any) => ({
        deviceId: String(device?.deviceId ?? ""),
        name: String(device?.label ?? device?.name ?? device?.deviceId ?? "unknown"),
        label: typeof device?.label === "string" ? device.label : null,
        roomId: typeof device?.roomId === "string" ? device.roomId : null,
        locationId: typeof device?.locationId === "string" ? device.locationId : null,
        hasTemperatureCapability: this.deviceHasCapability(device, "temperatureMeasurement")
      }))
      .filter((device) => device.deviceId.length > 0);

    const locationIds = [...new Set(rows.map((row) => row.locationId).filter((id): id is string => Boolean(id)))];
    const rooms = new Map<string, { roomId: string; locationId: string; roomName: string | null }>();
    for (const locId of locationIds) {
      try {
        const roomResponse = await this.listRooms(locId, installedAppId);
        const roomItems: any[] = Array.isArray(roomResponse?.items) ? roomResponse.items : [];
        for (const room of roomItems) {
          if (typeof room?.roomId !== "string") continue;
          rooms.set(room.roomId, {
            roomId: room.roomId,
            locationId: typeof room?.locationId === "string" ? room.locationId : locId,
            roomName: typeof room?.name === "string" ? room.name : null
          });
        }
      } catch (err) {
        logger.warn({ err, locationId: locId }, "Failed to list SmartThings rooms");
      }
    }

    const tempSourceRows = rows.filter((row) => row.hasTemperatureCapability);
    const roomAgg = new Map<string, { celsius: number; count: number; sourceDeviceIds: string[] }>();
    const failedTempReads: string[] = [];

    await this.mapWithConcurrency(
      tempSourceRows,
      config.roomTempStatusConcurrency,
      async (sourceRow) => {
        try {
          const status = await this.getDeviceStatus(sourceRow.deviceId, installedAppId);
          const reading = this.extractTemperature(status);
          if (!reading || !sourceRow.roomId) return;

          const current = roomAgg.get(sourceRow.roomId) ?? { celsius: 0, count: 0, sourceDeviceIds: [] };
          current.celsius += reading.celsius;
          current.count += 1;
          current.sourceDeviceIds.push(sourceRow.deviceId);
          roomAgg.set(sourceRow.roomId, current);
        } catch (err) {
          failedTempReads.push(sourceRow.deviceId);
          logger.warn({ err, deviceId: sourceRow.deviceId }, "Failed to read device status for room temperature map");
        }
      }
    );

    const roomTemperatures: RoomTemperature[] = [...roomAgg.entries()]
      .map(([roomId, values]) => {
        const avgC = values.count > 0 ? values.celsius / values.count : NaN;
        const avgF = (avgC * 9) / 5 + 32;
        return {
          roomId,
          roomName: rooms.get(roomId)?.roomName ?? null,
          temperatureC: Number.isFinite(avgC) ? this.round(avgC, 1) : null,
          temperatureF: Number.isFinite(avgF) ? this.round(avgF, 1) : null,
          temperatureSourceCount: values.count,
          sourceDeviceIds: values.sourceDeviceIds
        };
      })
      .sort((a, b) => (a.roomName ?? a.roomId).localeCompare(b.roomName ?? b.roomId));

    const roomTempById = new Map<string, RoomTemperature>(roomTemperatures.map((room) => [room.roomId, room]));

    const items: DeviceRoomTemperatureItem[] = rows
      .map((row) => {
        const roomMeta = row.roomId ? rooms.get(row.roomId) : undefined;
        const roomTemp = row.roomId ? roomTempById.get(row.roomId) : undefined;
        return {
          deviceId: row.deviceId,
          name: row.name,
          label: row.label,
          locationId: row.locationId,
          roomId: row.roomId,
          roomName: roomMeta?.roomName ?? null,
          roomTemperatureC: roomTemp?.temperatureC ?? null,
          roomTemperatureF: roomTemp?.temperatureF ?? null,
          roomTemperatureSourceCount: roomTemp?.temperatureSourceCount ?? 0
        };
      })
      .sort((a: DeviceRoomTemperatureItem, b: DeviceRoomTemperatureItem) => {
        const roomA = a.roomName ?? a.roomId ?? "";
        const roomB = b.roomName ?? b.roomId ?? "";
        if (roomA !== roomB) return roomA.localeCompare(roomB);
        return (a.name ?? a.deviceId).localeCompare(b.name ?? b.deviceId);
      });

    const payload: RoomTemperaturePayload = {
      summary: {
        generatedAt: new Date().toISOString(),
        devicesTotal: items.length,
        temperatureSourceDevices: tempSourceRows.length,
        roomsTotal: new Set(items.map((item) => item.roomId).filter((roomId): roomId is string => Boolean(roomId))).size,
        roomsWithTemperature: roomTemperatures.length,
        failedTemperatureSourceReads: failedTempReads.length,
        cacheTtlSec: config.roomTempCacheTtlSec
      },
      roomTemperatures,
      items
    };

    if (config.roomTempCacheTtlSec > 0) {
      this.roomTempCache.set(cacheKey, {
        expiresAt: Date.now() + config.roomTempCacheTtlSec * 1000,
        data: payload
      });
    }

    return payload;
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

  async getDeviceStatuses(
    locationId?: string,
    deviceIds?: string[],
    installedAppId?: string,
    concurrency = config.roomTempStatusConcurrency
  ): Promise<DeviceStatusesPayload> {
    const startedAt = Date.now();
    let source: "deviceIds" | "locationDevices" = "deviceIds";
    let targetDeviceIds = this.dedupeDeviceIds(deviceIds ?? []);

    if (targetDeviceIds.length === 0) {
      source = "locationDevices";
      const deviceResponse = await this.listDevices(locationId, installedAppId);
      const devices: any[] = Array.isArray(deviceResponse?.items) ? deviceResponse.items : [];
      targetDeviceIds = this.dedupeDeviceIds(
        devices
          .map((device) => String(device?.deviceId ?? ""))
          .filter((id) => id.length > 0)
      );
    }

    const safeConcurrency = Math.max(1, Math.min(concurrency, 20, targetDeviceIds.length || 1));
    const items = await this.mapWithConcurrency(targetDeviceIds, safeConcurrency, async (deviceId) => {
      try {
        const status = await this.getDeviceStatus(deviceId, installedAppId);
        return {
          deviceId,
          ok: true,
          status,
          error: null
        };
      } catch (err) {
        logger.warn({ err, deviceId }, "Failed to fetch SmartThings device status in batch request");
        return {
          deviceId,
          ok: false,
          status: null,
          error: (err as Error)?.message ?? "Unknown error"
        };
      }
    });

    const resolved = items.filter((item) => item.ok).length;
    return {
      summary: {
        generatedAt: new Date().toISOString(),
        source,
        requested: targetDeviceIds.length,
        resolved,
        failed: targetDeviceIds.length - resolved,
        durationMs: Date.now() - startedAt,
        concurrency: safeConcurrency
      },
      items
    };
  }

  async sendDeviceCommand(deviceId: string, commands: any[], installedAppId?: string) {
    return this.request("POST", `/devices/${deviceId}/commands`, { commands }, installedAppId, [
      `x:devices:${deviceId}`,
      "x:devices:*"
    ]);
  }

  async sendDeviceCommandAndVerify(
    deviceId: string,
    commands: any[],
    expectations: CommandExpectation[],
    attempts: number,
    initialDelayMs: number,
    backoffMultiplier: number,
    installedAppId?: string
  ): Promise<CommandVerificationResult> {
    const startedAt = Date.now();
    const commandResponse = await this.sendDeviceCommand(deviceId, commands, installedAppId);
    let nextDelayMs = Math.max(0, Math.floor(initialDelayMs));
    let lastChecks: CommandExpectationCheck[] = [];
    let lastError: string | null = null;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      await this.sleep(nextDelayMs);
      nextDelayMs = Math.floor(nextDelayMs * backoffMultiplier);

      try {
        const status = await this.getDeviceStatus(deviceId, installedAppId);
        const checks = this.evaluateCommandExpectations(status, expectations);
        lastChecks = checks;

        if (checks.every((check) => check.passed)) {
          return {
            ok: true,
            deviceId,
            attemptsUsed: attempt,
            durationMs: Date.now() - startedAt,
            commandResponse,
            checks,
            error: null
          };
        }
      } catch (err) {
        lastError = (err as Error)?.message ?? "Unknown verification error";
        logger.warn({ err, deviceId, attempt }, "Failed to verify device state after command");
      }
    }

    return {
      ok: false,
      deviceId,
      attemptsUsed: attempts,
      durationMs: Date.now() - startedAt,
      commandResponse,
      checks: lastChecks,
      error: lastError ?? "Expectation mismatch after all verification attempts"
    };
  }

  async listScenes(installedAppId?: string) {
    return this.requestAllPages("/scenes", installedAppId, ["r:scenes:*"]);
  }

  async executeScene(sceneId: string, installedAppId?: string) {
    return this.request("POST", `/scenes/${sceneId}/execute`, undefined, installedAppId, [
      `x:scenes:${sceneId}`,
      "x:scenes:*"
    ]);
  }

  async listRules(installedAppId?: string) {
    return this.requestAllPages("/rules", installedAppId, ["r:rules:*"]);
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
