import fs from "node:fs/promises";
import path from "node:path";

export interface TokenRecord {
  installedAppId: string;
  locationId: string;
  appId: string;
  authToken: string;
  refreshToken: string;
  expiresAt: string;
  permissions: string[];
  createdAt: string;
  updatedAt: string;
}

interface TokenStoreFile {
  version: number;
  records: Record<string, TokenRecord>;
}

export class TokenStore {
  private readonly filePath: string;
  private writeLock: Promise<void> = Promise.resolve();

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  private async ensureDir() {
    const dir = path.dirname(this.filePath);
    await fs.mkdir(dir, { recursive: true });
  }

  private async readFile(): Promise<TokenStoreFile> {
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as TokenStoreFile;
      return {
        version: parsed.version ?? 1,
        records: parsed.records ?? {}
      };
    } catch (err: any) {
      if (err?.code === "ENOENT") {
        return { version: 1, records: {} };
      }
      throw err;
    }
  }

  private async writeFile(data: TokenStoreFile): Promise<void> {
    await this.ensureDir();
    const tmp = `${this.filePath}.tmp`;
    const json = JSON.stringify(data, null, 2);
    await fs.writeFile(tmp, json, { mode: 0o600 });
    await fs.rename(tmp, this.filePath);
    await fs.chmod(this.filePath, 0o600);
  }

  private async withLock<T>(fn: () => Promise<T>): Promise<T> {
    let release: () => void = () => {};
    const ready = new Promise<void>((resolve) => {
      release = resolve;
    });
    const prior = this.writeLock;
    this.writeLock = prior.then(() => ready);
    await prior;
    try {
      return await fn();
    } finally {
      release();
    }
  }

  async get(installedAppId: string): Promise<TokenRecord | null> {
    const data = await this.readFile();
    return data.records[installedAppId] ?? null;
  }

  async list(): Promise<TokenRecord[]> {
    const data = await this.readFile();
    return Object.values(data.records);
  }

  async set(record: TokenRecord): Promise<void> {
    await this.withLock(async () => {
      const data = await this.readFile();
      data.records[record.installedAppId] = record;
      await this.writeFile(data);
    });
  }

  async delete(installedAppId: string): Promise<void> {
    await this.withLock(async () => {
      const data = await this.readFile();
      delete data.records[installedAppId];
      await this.writeFile(data);
    });
  }
}
