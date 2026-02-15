import crypto from "node:crypto";
import { URL } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ReadResourceRequestSchema
} from "@modelcontextprotocol/sdk/types.js";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { loadUpstreamsConfig, UpstreamConfig } from "./upstreams.js";

type UpstreamState = {
  config: UpstreamConfig;
  client?: Client;
  transport?: StreamableHTTPClientTransport;
  tools: any[];
  prompts: any[];
  resources: any[];
  resourceTemplates: any[];
  status: "connected" | "error" | "disabled";
  lastError?: string;
  lastSync?: string;
  configHash: string;
};

type GatewayStatus = {
  enabled: boolean;
  upstreams: Record<string, {
    status: UpstreamState["status"];
    lastSync?: string;
    lastError?: string;
    url: string;
  }>;
};

const gatewayPrefix = "gateway";
const resourceScheme = "mcp+proxy:";

const emptyObjectSchema = {
  type: "object",
  properties: {},
  additionalProperties: false
};

const reloadSchema = {
  type: "object",
  properties: {
    force: { type: "boolean" }
  },
  additionalProperties: false
};

const toText = (data: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }]
});

const encodeResourceUri = (upstream: string, uri: string) => {
  const encoded = Buffer.from(uri, "utf8").toString("base64url");
  return `${resourceScheme}//${upstream}/${encoded}`;
};

const decodeResourceUri = (uri: string) => {
  try {
    const parsed = new URL(uri);
    if (parsed.protocol !== resourceScheme) {
      return null;
    }
    const upstream = parsed.hostname;
    const encoded = parsed.pathname.replace(/^\//, "");
    if (!upstream || !encoded) return null;
    const original = Buffer.from(encoded, "base64url").toString("utf8");
    return { upstream, original };
  } catch {
    return null;
  }
};

const createFetchWithTimeout = (timeoutMs: number) => {
  return async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const timeoutController = new AbortController();
    const timeoutId = setTimeout(() => timeoutController.abort(), timeoutMs);

    let signal = timeoutController.signal;
    if (init.signal) {
      if (typeof AbortSignal !== "undefined" && "any" in AbortSignal) {
        signal = (AbortSignal as any).any([init.signal, timeoutController.signal]);
      } else {
        const combined = new AbortController();
        init.signal.addEventListener("abort", () => combined.abort(), { once: true });
        timeoutController.signal.addEventListener("abort", () => combined.abort(), { once: true });
        signal = combined.signal;
      }
    }

    try {
      return await fetch(input, { ...init, signal });
    } finally {
      clearTimeout(timeoutId);
    }
  };
};

const hashConfig = (configValue: UpstreamConfig) => JSON.stringify(configValue);

const splitNamespaced = (name: string) => {
  const index = name.indexOf(".");
  if (index === -1) return null;
  return {
    upstream: name.slice(0, index),
    name: name.slice(index + 1)
  };
};

class Gateway {
  private upstreams = new Map<string, UpstreamState>();
  private refreshTimer?: NodeJS.Timeout;
  private refreshing = false;
  private server: Server;

  constructor() {
    this.server = new Server({
      name: "MCP Gateway",
      version: "0.1.0"
    });
    this.server.registerCapabilities({
      tools: { listChanged: true },
      prompts: { listChanged: true },
      resources: { listChanged: true }
    });
  }

  async init() {
    // Load config first; defer upstream connections until after HTTP server starts listening.
    await this.reloadUpstreams(true, false);
    if (config.upstreamsRefreshIntervalSec > 0) {
      this.refreshTimer = setInterval(() => {
        this.reloadUpstreams(false, true).catch((err) => {
          logger.warn({ err }, "Gateway upstream refresh failed");
        });
      }, config.upstreamsRefreshIntervalSec * 1000);
    }
    this.installHandlers();
  }

  stop() {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
    }
  }

  getTransport() {
    return new StreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID()
    });
  }

  async refreshNow(force = true) {
    return await this.reloadUpstreams(force, true);
  }

  getStatus(): GatewayStatus {
    const upstreams: GatewayStatus["upstreams"] = {};
    for (const [name, state] of this.upstreams.entries()) {
      upstreams[name] = {
        status: state.status,
        lastError: state.lastError,
        lastSync: state.lastSync,
        url: state.config.url
      };
    }
    return {
      enabled: true,
      upstreams
    };
  }

  private installHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: this.listTools()
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args, task } = request.params;
      return await this.callTool(name, args, task);
    });

    this.server.setRequestHandler(ListPromptsRequestSchema, async () => ({
      prompts: this.listPrompts()
    }));

    this.server.setRequestHandler(GetPromptRequestSchema, async (request) => {
      return await this.getPrompt(request.params.name, request.params.arguments);
    });

    this.server.setRequestHandler(ListResourcesRequestSchema, async () => ({
      resources: this.listResources()
    }));

    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      return await this.readResource(request.params.uri);
    });

    this.server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({
      resourceTemplates: []
    }));
  }

  private listTools() {
    const tools = [...this.gatewayTools()];
    for (const [name, state] of this.upstreams.entries()) {
      if (!state.tools.length || state.status !== "connected") continue;
      for (const tool of state.tools) {
        const namespaced = `${name}.${tool.name}`;
        tools.push({
          ...tool,
          name: namespaced,
          description: tool.description
            ? `${tool.description} (upstream: ${name})`
            : `Upstream tool from ${name}`,
          _meta: {
            ...(tool._meta ?? {}),
            upstream: {
              name,
              url: state.config.url
            }
          }
        });
      }
    }
    return tools;
  }

  private listPrompts() {
    const prompts: any[] = [];
    for (const [name, state] of this.upstreams.entries()) {
      if (!state.prompts.length || state.status !== "connected") continue;
      for (const prompt of state.prompts) {
        prompts.push({
          ...prompt,
          name: `${name}.${prompt.name}`,
          description: prompt.description
            ? `${prompt.description} (upstream: ${name})`
            : `Upstream prompt from ${name}`,
          _meta: {
            ...(prompt._meta ?? {}),
            upstream: {
              name,
              url: state.config.url
            }
          }
        });
      }
    }
    return prompts;
  }

  private listResources() {
    const resources: any[] = [];
    for (const [name, state] of this.upstreams.entries()) {
      if (!state.resources.length || state.status !== "connected") continue;
      for (const resource of state.resources) {
        resources.push({
          ...resource,
          name: resource.name ? `${name}.${resource.name}` : resource.name,
          uri: encodeResourceUri(name, resource.uri),
          _meta: {
            ...(resource._meta ?? {}),
            upstream: {
              name,
              url: state.config.url,
              uri: resource.uri
            }
          }
        });
      }
    }
    return resources;
  }

  private gatewayTools() {
    return [
      {
        name: `${gatewayPrefix}.list_upstreams`,
        title: "List upstreams",
        description: "List configured upstreams and their current status.",
        inputSchema: emptyObjectSchema
      },
      {
        name: `${gatewayPrefix}.reload_upstreams`,
        title: "Reload upstreams",
        description: "Reload upstream config and refresh cached tool lists.",
        inputSchema: reloadSchema
      }
    ];
  }

  private async callTool(name: string, args?: any, task?: any) {
    if (name === `${gatewayPrefix}.list_upstreams`) {
      return toText(this.getStatus());
    }
    if (name === `${gatewayPrefix}.reload_upstreams`) {
      const force = !!args?.force;
      const result = await this.reloadUpstreams(force, true);
      return toText(result);
    }

    const split = splitNamespaced(name);
    if (!split) {
      throw new McpError(
        ErrorCode.InvalidParams,
        "Tool name must be namespaced as <upstream>.<tool>"
      );
    }

    const state = this.upstreams.get(split.upstream);
    if (!state) {
      throw new McpError(ErrorCode.InvalidParams, `Unknown upstream: ${split.upstream}`);
    }

    if (state.status !== "connected") {
      await this.syncUpstream(state);
    }

    if (!state.client) {
      throw new McpError(ErrorCode.InternalError, `Upstream ${split.upstream} unavailable`);
    }

    return await state.client.callTool({
      name: split.name,
      arguments: args,
      task
    });
  }

  private async getPrompt(name: string, args?: any) {
    const split = splitNamespaced(name);
    if (!split) {
      throw new McpError(
        ErrorCode.InvalidParams,
        "Prompt name must be namespaced as <upstream>.<prompt>"
      );
    }

    const state = this.upstreams.get(split.upstream);
    if (!state) {
      throw new McpError(ErrorCode.InvalidParams, `Unknown upstream: ${split.upstream}`);
    }

    if (state.status !== "connected") {
      await this.syncUpstream(state);
    }
    if (!state.client) {
      throw new McpError(ErrorCode.InternalError, `Upstream ${split.upstream} unavailable`);
    }

    return await state.client.getPrompt({
      name: split.name,
      arguments: args
    });
  }

  private async readResource(uri: string) {
    const decoded = decodeResourceUri(uri);
    if (!decoded) {
      throw new McpError(
        ErrorCode.InvalidParams,
        "Resource URI must be generated by the gateway (mcp+proxy://...)"
      );
    }
    const state = this.upstreams.get(decoded.upstream);
    if (!state) {
      throw new McpError(ErrorCode.InvalidParams, `Unknown upstream: ${decoded.upstream}`);
    }
    if (state.status !== "connected") {
      await this.syncUpstream(state);
    }
    if (!state.client) {
      throw new McpError(ErrorCode.InternalError, `Upstream ${decoded.upstream} unavailable`);
    }
    return await state.client.readResource({ uri: decoded.original });
  }

  private async reloadUpstreams(force: boolean, syncUpstreams: boolean) {
    if (this.refreshing) {
      return { ok: false, message: "Reload already in progress" };
    }
    this.refreshing = true;
    try {
      const configFile = loadUpstreamsConfig(config.upstreamsConfigPath);
      const incoming = configFile.upstreams;

      const reserved = new Set([gatewayPrefix]);
      const gatewayUrls = new Set([
        `${config.publicUrl}${config.gatewayPath}`,
        `http://localhost:${config.port}${config.gatewayPath}`,
        `http://127.0.0.1:${config.port}${config.gatewayPath}`
      ].map((value) => value.replace(/\/$/, "")));
      for (const upstream of incoming) {
        if (reserved.has(upstream.name)) {
          throw new Error(`Upstream name "${upstream.name}" is reserved`);
        }
        const normalized = upstream.url.replace(/\/$/, "");
        if (gatewayUrls.has(normalized)) {
          throw new Error(`Upstream "${upstream.name}" points to the gateway endpoint`);
        }
        try {
          const parsed = new URL(upstream.url);
          const isLocalhost = ["localhost", "127.0.0.1"].includes(parsed.hostname);
          if (parsed.protocol !== "https:" && !isLocalhost) {
            logger.warn({ upstream: upstream.name, url: upstream.url }, "Upstream is not HTTPS");
          }
        } catch {
          throw new Error(`Invalid upstream URL for "${upstream.name}"`);
        }
      }

      const incomingNames = new Set(incoming.map((u) => u.name));

      for (const [name, state] of this.upstreams.entries()) {
        if (!incomingNames.has(name)) {
          if (state.client) {
            await state.client.close().catch(() => undefined);
          }
          this.upstreams.delete(name);
        }
      }

      for (const upstream of incoming) {
        const configHash = hashConfig(upstream);
        const existing = this.upstreams.get(upstream.name);
        if (!existing) {
          this.upstreams.set(upstream.name, {
            config: upstream,
            tools: [],
            prompts: [],
            resources: [],
            resourceTemplates: [],
            status: "disabled",
            configHash
          });
        } else if (existing.configHash !== configHash || force) {
          if (existing.client) {
            await existing.client.close().catch(() => undefined);
          }
          existing.client = undefined;
          existing.transport = undefined;
          existing.config = upstream;
          existing.configHash = configHash;
        }
      }

      if (syncUpstreams) {
        await Promise.all([...this.upstreams.values()].map((state) => this.syncUpstream(state)));
      }

      if (this.server.transport) {
        this.server.sendToolListChanged();
        this.server.sendPromptListChanged();
        this.server.sendResourceListChanged();
      }

      return { ok: true, upstreamCount: this.upstreams.size };
    } finally {
      this.refreshing = false;
    }
  }

  private async syncUpstream(state: UpstreamState) {
    if (!state.config.enabled) {
      state.status = "disabled";
      return;
    }

    try {
      if (!state.client) {
        const transport = new StreamableHTTPClientTransport(new URL(state.config.url), {
          requestInit: state.config.headers ? { headers: state.config.headers } : undefined,
          fetch: createFetchWithTimeout(config.upstreamsRequestTimeoutMs)
        });
        const client = new Client({
          name: "smartthings-mcp-gateway",
          version: "0.1.0"
        });
        await client.connect(transport);
        state.client = client;
        state.transport = transport;
      }

      const toolsResult = await state.client.listTools();
      state.tools = toolsResult.tools ?? [];

      const caps = state.client.getServerCapabilities();
      if (caps?.prompts) {
        const promptsResult = await state.client.listPrompts();
        state.prompts = promptsResult.prompts ?? [];
      } else {
        state.prompts = [];
      }

      if (caps?.resources) {
        const resourcesResult = await state.client.listResources();
        state.resources = resourcesResult.resources ?? [];
      } else {
        state.resources = [];
      }

      state.status = "connected";
      state.lastError = undefined;
      state.lastSync = new Date().toISOString();
    } catch (err) {
      state.status = "error";
      state.lastError = err instanceof Error ? err.message : String(err);
      logger.warn({ err, upstream: state.config.name }, "Failed to sync upstream");
    }
  }

  getServer() {
    return this.server;
  }
}

export async function createGateway() {
  const gateway = new Gateway();
  await gateway.init();
  const transport = gateway.getTransport();
  await gateway.getServer().connect(transport);
  return {
    transport,
    status: () => gateway.getStatus(),
    reload: (force = true) => gateway.refreshNow(force)
  };
}
