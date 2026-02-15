import pino, { DestinationStream, StreamEntry } from "pino";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";

const streams: StreamEntry[] = [{ stream: process.stdout as DestinationStream }];

if (config.logFile) {
  try {
    const dir = path.dirname(config.logFile);
    fs.mkdirSync(dir, { recursive: true });
    streams.push({ stream: pino.destination({ dest: config.logFile, sync: false }) as DestinationStream });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("Failed to initialize log file, falling back to stdout", err);
  }
}

export const logger = pino(
  {
    level: config.logLevel,
    redact: {
      paths: [
        "req.headers.authorization",
        "req.headers.signature",
        "req.headers.digest",
        "accessToken",
        "refreshToken"
      ],
      censor: "[redacted]"
    }
  },
  pino.multistream(streams, { dedupe: true })
);
