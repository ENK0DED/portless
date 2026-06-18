import * as fs from "node:fs";
import * as path from "node:path";
import type { TunnelAlias } from "./types.js";
import { DIR_MODE, FILE_MODE, isRetryableLockError } from "./routes.js";
import { fixOwnership, isErrnoException, normalizePathPrefix } from "./utils.js";

const STALE_LOCK_THRESHOLD_MS = 10_000;
const LOCK_TIMEOUT_MS = 5_000;
const LOCK_RETRY_BASE_MS = 10;
const LOCK_RETRY_CAP_MS = 500;

function hasControlCharacters(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

export function normalizeTunnelHostname(value: string): string {
  const trimmed = value.trim().toLowerCase();
  if (
    trimmed === "" ||
    trimmed.includes("://") ||
    trimmed.includes("/") ||
    trimmed.includes("\\") ||
    trimmed.includes(":") ||
    trimmed.includes("*") ||
    /\s/.test(trimmed) ||
    hasControlCharacters(trimmed)
  ) {
    throw new Error(
      `Invalid tunnel hostname "${value}": use an exact hostname without scheme, port, path, wildcard, spaces, or control characters`
    );
  }

  const labels = trimmed.split(".");
  if (
    labels.some(
      (label) =>
        label === "" ||
        label.length > 63 ||
        !/^[a-z0-9-]+$/.test(label) ||
        label.startsWith("-") ||
        label.endsWith("-")
    )
  ) {
    throw new Error(`Invalid tunnel hostname "${value}": hostname labels are invalid`);
  }

  return trimmed;
}

function normalizeAlias(alias: TunnelAlias): TunnelAlias {
  const normalized: TunnelAlias = {
    externalHostname: normalizeTunnelHostname(alias.externalHostname),
    targetHostname: normalizeTunnelHostname(alias.targetHostname),
    targetPathPrefix: normalizePathPrefix(alias.targetPathPrefix),
  };
  if (alias.managed !== undefined) normalized.managed = alias.managed;
  if (alias.provider !== undefined) normalized.provider = alias.provider;
  if (alias.url !== undefined) normalized.url = alias.url;
  if (alias.tunnelPid !== undefined) normalized.tunnelPid = alias.tunnelPid;
  if (alias.routeOwnerPid !== undefined) normalized.routeOwnerPid = alias.routeOwnerPid;
  return normalized;
}

function isValidAlias(value: unknown): value is TunnelAlias {
  if (typeof value !== "object" || value === null) return false;
  const alias = value as TunnelAlias;
  if (typeof alias.externalHostname !== "string" || typeof alias.targetHostname !== "string") {
    return false;
  }
  if (alias.targetPathPrefix !== undefined && typeof alias.targetPathPrefix !== "string") {
    return false;
  }
  if (alias.managed !== undefined && typeof alias.managed !== "boolean") return false;
  if (
    alias.provider !== undefined &&
    alias.provider !== "ngrok" &&
    alias.provider !== "cloudflare"
  ) {
    return false;
  }
  if (alias.url !== undefined && typeof alias.url !== "string") return false;
  if (alias.tunnelPid !== undefined && typeof alias.tunnelPid !== "number") return false;
  if (alias.routeOwnerPid !== undefined && typeof alias.routeOwnerPid !== "number") return false;
  try {
    normalizeAlias(alias);
    return true;
  } catch {
    return false;
  }
}

export class TunnelAliasStore {
  readonly dir: string;
  private readonly aliasesPath: string;
  private readonly lockPath: string;
  private readonly onWarning: ((message: string) => void) | undefined;

  constructor(dir: string, options?: { onWarning?: (message: string) => void }) {
    this.dir = dir;
    this.aliasesPath = path.join(dir, "tunnel-aliases.json");
    this.lockPath = path.join(dir, "tunnel-aliases.lock");
    this.onWarning = options?.onWarning;
  }

  ensureDir(): void {
    if (!fs.existsSync(this.dir)) {
      fs.mkdirSync(this.dir, { recursive: true, mode: DIR_MODE });
    }
    try {
      fs.chmodSync(this.dir, DIR_MODE);
    } catch {
      // May fail if directory is owned by another user; non-fatal
    }
    fixOwnership(this.dir);
  }

  getAliasesPath(): string {
    return this.aliasesPath;
  }

  private static readonly sleepBuffer = new Int32Array(new SharedArrayBuffer(4));

  private syncSleep(ms: number): void {
    Atomics.wait(TunnelAliasStore.sleepBuffer, 0, 0, ms);
  }

  private acquireLock(): boolean {
    const deadline = Date.now() + LOCK_TIMEOUT_MS;
    let delay = LOCK_RETRY_BASE_MS;

    while (Date.now() < deadline) {
      try {
        fs.mkdirSync(this.lockPath);
        return true;
      } catch (err: unknown) {
        if (isRetryableLockError(err)) {
          try {
            const stat = fs.statSync(this.lockPath);
            if (Date.now() - stat.mtimeMs > STALE_LOCK_THRESHOLD_MS) {
              fs.rmSync(this.lockPath, { recursive: true, force: true });
              continue;
            }
          } catch {
            // The lock may have disappeared or be temporarily inaccessible.
          }
          const jitter = Math.floor(Math.random() * delay);
          this.syncSleep(delay + jitter);
          delay = Math.min(delay * 2, LOCK_RETRY_CAP_MS);
        } else {
          return false;
        }
      }
    }
    return false;
  }

  private releaseLock(): void {
    try {
      fs.rmSync(this.lockPath, { recursive: true, force: true });
    } catch {
      // Lock may already be removed; non-fatal
    }
  }

  private saveAliases(aliases: TunnelAlias[]): void {
    fs.writeFileSync(this.aliasesPath, JSON.stringify(aliases, null, 2), { mode: FILE_MODE });
    fixOwnership(this.aliasesPath);
  }

  private isProcessAlive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  loadAliases(): TunnelAlias[] {
    if (!fs.existsSync(this.aliasesPath)) return [];
    try {
      const parsed = JSON.parse(fs.readFileSync(this.aliasesPath, "utf-8")) as unknown;
      if (!Array.isArray(parsed)) {
        this.onWarning?.(`Corrupted tunnel aliases file (expected array): ${this.aliasesPath}`);
        return [];
      }
      return parsed.filter(isValidAlias).map(normalizeAlias);
    } catch (err: unknown) {
      if (isErrnoException(err) && err.code === "ENOENT") return [];
      this.onWarning?.(`Corrupted tunnel aliases file (invalid JSON): ${this.aliasesPath}`);
      return [];
    }
  }

  setAlias(alias: TunnelAlias): void {
    const normalized = normalizeAlias(alias);
    this.ensureDir();
    if (!this.acquireLock()) {
      throw new Error("Failed to acquire tunnel alias lock");
    }
    try {
      const aliases = this.loadAliases().filter(
        (entry) => entry.externalHostname !== normalized.externalHostname
      );
      aliases.push(normalized);
      this.saveAliases(aliases);
    } finally {
      this.releaseLock();
    }
  }

  removeAlias(externalHostname: string): boolean {
    const normalizedExternal = normalizeTunnelHostname(externalHostname);
    this.ensureDir();
    if (!this.acquireLock()) {
      throw new Error("Failed to acquire tunnel alias lock");
    }
    try {
      const aliases = this.loadAliases();
      const filtered = aliases.filter((entry) => entry.externalHostname !== normalizedExternal);
      if (filtered.length === aliases.length) return false;
      this.saveAliases(filtered);
      return true;
    } finally {
      this.releaseLock();
    }
  }

  removeManagedAlias(externalHostname: string, routeOwnerPid?: number): boolean {
    const normalizedExternal = normalizeTunnelHostname(externalHostname);
    this.ensureDir();
    if (!this.acquireLock()) {
      throw new Error("Failed to acquire tunnel alias lock");
    }
    try {
      const aliases = this.loadAliases();
      const filtered = aliases.filter(
        (entry) =>
          entry.externalHostname !== normalizedExternal ||
          !entry.managed ||
          (routeOwnerPid !== undefined && entry.routeOwnerPid !== routeOwnerPid)
      );
      if (filtered.length === aliases.length) return false;
      this.saveAliases(filtered);
      return true;
    } finally {
      this.releaseLock();
    }
  }

  pruneManagedAliases(): TunnelAlias[] {
    this.ensureDir();
    if (!this.acquireLock()) {
      throw new Error("Failed to acquire tunnel alias lock");
    }
    try {
      const aliases = this.loadAliases();
      const alive: TunnelAlias[] = [];
      const stale: TunnelAlias[] = [];
      for (const alias of aliases) {
        if (
          !alias.managed ||
          alias.routeOwnerPid === undefined ||
          this.isProcessAlive(alias.routeOwnerPid)
        ) {
          alive.push(alias);
        } else {
          stale.push(alias);
        }
      }
      if (stale.length > 0) {
        this.saveAliases(alive);
      }
      return stale;
    } finally {
      this.releaseLock();
    }
  }
}
