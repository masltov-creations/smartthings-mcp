import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { logger } from "./logger.js";

const nameRegex = /^[A-Za-z0-9_-]{1,32}$/;

const upstreamSchema = z.object({
  name: z.string().regex(nameRegex, "Upstream name must be 1-32 chars: A-Z, a-z, 0-9, _ or -"),
  url: z.string().min(1),
  description: z.string().optional(),
  enabled: z.boolean().optional().default(true),
  headers: z.record(z.string(), z.string()).optional()
});

const upstreamsSchema = z.object({
  upstreams: z.array(upstreamSchema).default([])
});

export type UpstreamConfig = z.infer<typeof upstreamSchema>;
export type UpstreamsConfig = z.infer<typeof upstreamsSchema>;

const envPattern = /\$\{([A-Z0-9_]+)\}/g;

const expandEnvVars = (value: string): string => {
  return value.replace(envPattern, (_match, name: string) => {
    const envValue = process.env[name];
    if (!envValue) {
      throw new Error(`Missing env var ${name} referenced in upstream config`);
    }
    return envValue;
  });
};

const expandHeaders = (headers?: Record<string, string>) => {
  if (!headers) return undefined;
  const expanded: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    expanded[key] = expandEnvVars(value);
  }
  return expanded;
};

const resolveConfigPath = (configPath: string) => {
  if (path.isAbsolute(configPath)) {
    return configPath;
  }
  return path.resolve(process.cwd(), configPath);
};

export function loadUpstreamsConfig(configPath: string): UpstreamsConfig {
  const resolvedPath = resolveConfigPath(configPath);
  if (!fs.existsSync(resolvedPath)) {
    logger.info({ configPath: resolvedPath }, "Upstream config not found; starting with zero upstreams");
    return { upstreams: [] };
  }

  const raw = fs.readFileSync(resolvedPath, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Failed to parse upstream config JSON at ${resolvedPath}`);
  }

  const result = upstreamsSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`Invalid upstream config at ${resolvedPath}`);
  }

  const seen = new Set<string>();
  const upstreams = result.data.upstreams.map((upstream) => {
    if (seen.has(upstream.name)) {
      throw new Error(`Duplicate upstream name: ${upstream.name}`);
    }
    seen.add(upstream.name);
    const url = expandEnvVars(upstream.url);
    const headers = expandHeaders(upstream.headers);
    return {
      ...upstream,
      url,
      headers
    };
  });

  return { upstreams };
}
