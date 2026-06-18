import * as fs from "node:fs";
import * as path from "node:path";
import type { RouteProtocol, TunnelProviderName } from "./types.js";
import { isRetryableLockError } from "./routes.js";
import { fixOwnership, isErrnoException, normalizePathPrefix } from "./utils.js";

const STALE_LOCK_THRESHOLD_MS = 10_000;
const LOCK_TIMEOUT_MS = 5_000;
const LOCK_RETRY_BASE_MS = 10;
const LOCK_RETRY_CAP_MS = 500;

export const BG_DIR_MODE = 0o700;
export const BG_FILE_MODE = 0o600;

export interface BgRouteKey {
  hostname: string;
  pathPrefix: string;
}

export interface BgManagedTunnelOptions {
  provider: TunnelProviderName;
  hostname?: string;
}

export interface BgStartIntent {
  name?: string;
  cwd: string;
  commandArgs: string[];
  explicitCommand: boolean;
  force: boolean;
  appPort?: number;
  protocol?: RouteProtocol;
  pathPrefix: string;
  tunnel?: BgManagedTunnelOptions;
  sharing: {
    tailscale: boolean;
    tailscaleService: boolean;
    tailscaleServiceName?: string;
    funnel: boolean;
    ngrok: boolean;
    netbird: boolean;
    netbirdPassword?: string;
    netbirdPin?: string;
    netbirdGroups?: string;
  };
}

export interface BgProcessEntry {
  version: 1;
  id: string;
  label: string;
  pid: number;
  cwd: string;
  startedAt: string;
  readyAt?: string;
  route?: BgRouteKey;
  url?: string;
  state: "starting" | "ready" | "stopped" | "unknown";
  intent: BgStartIntent;
}

export interface BgPaths {
  rootDir: string;
  registryPath: string;
  lockPath: string;
}

function safeStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

export function isSafeBgId(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 128 &&
    /^[A-Za-z0-9_.-]+$/.test(value) &&
    value !== "." &&
    value !== ".." &&
    !value.includes("..")
  );
}

function isValidState(value: unknown): value is BgProcessEntry["state"] {
  return value === "starting" || value === "ready" || value === "stopped" || value === "unknown";
}

function isValidTunnel(value: unknown): value is BgManagedTunnelOptions {
  if (value === undefined) return true;
  if (typeof value !== "object" || value === null) return false;
  const tunnel = value as BgManagedTunnelOptions;
  if (tunnel.provider !== "cloudflare" && tunnel.provider !== "ngrok") return false;
  if (tunnel.hostname !== undefined && typeof tunnel.hostname !== "string") return false;
  return true;
}

function isValidSharing(value: unknown): value is BgStartIntent["sharing"] {
  if (typeof value !== "object" || value === null) return false;
  const sharing = value as BgStartIntent["sharing"];
  return (
    typeof sharing.tailscale === "boolean" &&
    typeof sharing.tailscaleService === "boolean" &&
    typeof sharing.funnel === "boolean" &&
    typeof sharing.ngrok === "boolean" &&
    typeof sharing.netbird === "boolean" &&
    (sharing.tailscaleServiceName === undefined ||
      typeof sharing.tailscaleServiceName === "string") &&
    (sharing.netbirdPassword === undefined || typeof sharing.netbirdPassword === "string") &&
    (sharing.netbirdPin === undefined || typeof sharing.netbirdPin === "string") &&
    (sharing.netbirdGroups === undefined || typeof sharing.netbirdGroups === "string")
  );
}

function isValidIntent(value: unknown): value is BgStartIntent {
  if (typeof value !== "object" || value === null) return false;
  const intent = value as BgStartIntent;
  if (intent.name !== undefined && typeof intent.name !== "string") return false;
  if (typeof intent.cwd !== "string") return false;
  if (!safeStringArray(intent.commandArgs)) return false;
  if (typeof intent.explicitCommand !== "boolean") return false;
  if (typeof intent.force !== "boolean") return false;
  if (intent.appPort !== undefined && typeof intent.appPort !== "number") return false;
  if (intent.protocol !== undefined && intent.protocol !== "http1" && intent.protocol !== "h2c") {
    return false;
  }
  if (typeof intent.pathPrefix !== "string") return false;
  if (!isValidTunnel(intent.tunnel)) return false;
  if (!isValidSharing(intent.sharing)) return false;
  try {
    normalizePathPrefix(intent.pathPrefix);
  } catch {
    return false;
  }
  return true;
}

function normalizeRoute(route: BgRouteKey): BgRouteKey {
  return {
    hostname: route.hostname.trim().toLowerCase(),
    pathPrefix: normalizePathPrefix(route.pathPrefix),
  };
}

function isValidRoute(value: unknown): value is BgRouteKey {
  if (value === undefined) return true;
  if (typeof value !== "object" || value === null) return false;
  const route = value as BgRouteKey;
  if (typeof route.hostname !== "string" || route.hostname.trim() === "") return false;
  if (typeof route.pathPrefix !== "string") return false;
  try {
    normalizeRoute(route);
    return true;
  } catch {
    return false;
  }
}

function normalizeEntry(entry: BgProcessEntry): BgProcessEntry {
  return {
    ...entry,
    route: entry.route ? normalizeRoute(entry.route) : undefined,
    intent: {
      ...entry.intent,
      pathPrefix: normalizePathPrefix(entry.intent.pathPrefix),
    },
  };
}

function isValidEntry(value: unknown): value is BgProcessEntry {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as BgProcessEntry;
  return (
    entry.version === 1 &&
    typeof entry.id === "string" &&
    isSafeBgId(entry.id) &&
    typeof entry.label === "string" &&
    typeof entry.pid === "number" &&
    typeof entry.cwd === "string" &&
    typeof entry.startedAt === "string" &&
    (entry.readyAt === undefined || typeof entry.readyAt === "string") &&
    isValidRoute(entry.route) &&
    (entry.url === undefined || typeof entry.url === "string") &&
    isValidState(entry.state) &&
    isValidIntent(entry.intent)
  );
}

export class BgStore {
  readonly stateDir: string;
  private readonly paths: BgPaths;
  private readonly onWarning: ((message: string) => void) | undefined;

  constructor(stateDir: string, options?: { onWarning?: (message: string) => void }) {
    this.stateDir = stateDir;
    const rootDir = path.join(stateDir, "bg");
    this.paths = {
      rootDir,
      registryPath: path.join(rootDir, "registry.json"),
      lockPath: path.join(rootDir, "registry.lock"),
    };
    this.onWarning = options?.onWarning;
  }

  getPaths(): BgPaths {
    return { ...this.paths };
  }

  ensureDirs(): void {
    fs.mkdirSync(this.paths.rootDir, { recursive: true, mode: BG_DIR_MODE });
    try {
      fs.chmodSync(this.paths.rootDir, BG_DIR_MODE);
    } catch {
      // Permission repair is best effort.
    }
    fixOwnership(this.paths.rootDir);
  }

  private static readonly sleepBuffer = new Int32Array(new SharedArrayBuffer(4));

  private syncSleep(ms: number): void {
    Atomics.wait(BgStore.sleepBuffer, 0, 0, ms);
  }

  private acquireLock(): boolean {
    const deadline = Date.now() + LOCK_TIMEOUT_MS;
    let delay = LOCK_RETRY_BASE_MS;

    while (Date.now() < deadline) {
      try {
        fs.mkdirSync(this.paths.lockPath);
        return true;
      } catch (err: unknown) {
        if (!isRetryableLockError(err)) return false;
        try {
          const stat = fs.statSync(this.paths.lockPath);
          if (Date.now() - stat.mtimeMs > STALE_LOCK_THRESHOLD_MS) {
            fs.rmSync(this.paths.lockPath, { recursive: true, force: true });
            continue;
          }
        } catch {
          // The lock may have disappeared between attempts.
        }
        const jitter = Math.floor(Math.random() * delay);
        this.syncSleep(delay + jitter);
        delay = Math.min(delay * 2, LOCK_RETRY_CAP_MS);
      }
    }
    return false;
  }

  private releaseLock(): void {
    try {
      fs.rmSync(this.paths.lockPath, { recursive: true, force: true });
    } catch {
      // Lock may already be gone.
    }
  }

  private saveEntries(entries: BgProcessEntry[]): void {
    fs.writeFileSync(this.paths.registryPath, JSON.stringify(entries, null, 2), {
      mode: BG_FILE_MODE,
    });
    try {
      fs.chmodSync(this.paths.registryPath, BG_FILE_MODE);
    } catch {
      // Permission repair is best effort.
    }
    fixOwnership(this.paths.registryPath);
  }

  loadEntries(): BgProcessEntry[] {
    if (!fs.existsSync(this.paths.registryPath)) return [];
    try {
      const parsed = JSON.parse(fs.readFileSync(this.paths.registryPath, "utf-8")) as unknown;
      if (!Array.isArray(parsed)) {
        this.onWarning?.(
          `Corrupted background registry (expected array): ${this.paths.registryPath}`
        );
        return [];
      }
      const entries: BgProcessEntry[] = [];
      for (const value of parsed) {
        if (!isValidEntry(value)) {
          if (
            typeof value === "object" &&
            value !== null &&
            "version" in value &&
            (value as { version?: unknown }).version !== 1
          ) {
            this.onWarning?.(`Ignoring unsupported background registry entry version`);
          }
          continue;
        }
        entries.push(normalizeEntry(value));
      }
      return entries;
    } catch (err: unknown) {
      if (isErrnoException(err) && err.code === "ENOENT") return [];
      this.onWarning?.(`Corrupted background registry (invalid JSON): ${this.paths.registryPath}`);
      return [];
    }
  }

  upsertEntry(entry: BgProcessEntry): void {
    if (!isValidEntry(entry)) throw new Error("Invalid background process entry");
    this.ensureDirs();
    if (!this.acquireLock()) throw new Error("Failed to acquire background registry lock");
    try {
      const normalized = normalizeEntry(entry);
      const entries = this.loadEntries().filter((existing) => existing.id !== normalized.id);
      entries.push(normalized);
      this.saveEntries(entries);
    } finally {
      this.releaseLock();
    }
  }

  updateEntry(id: string, patch: Partial<BgProcessEntry>): boolean {
    if (!isSafeBgId(id)) throw new Error("Invalid background process id");
    this.ensureDirs();
    if (!this.acquireLock()) throw new Error("Failed to acquire background registry lock");
    try {
      let updated = false;
      const entries = this.loadEntries().map((entry) => {
        if (entry.id !== id) return entry;
        updated = true;
        const next = normalizeEntry({ ...entry, ...patch, id, version: 1 });
        if (!isValidEntry(next)) throw new Error("Invalid background process entry update");
        return next;
      });
      if (updated) this.saveEntries(entries);
      return updated;
    } finally {
      this.releaseLock();
    }
  }

  removeEntry(id: string): boolean {
    if (!isSafeBgId(id)) throw new Error("Invalid background process id");
    this.ensureDirs();
    if (!this.acquireLock()) throw new Error("Failed to acquire background registry lock");
    try {
      const entries = this.loadEntries();
      const next = entries.filter((entry) => entry.id !== id);
      if (next.length === entries.length) return false;
      this.saveEntries(next);
      return true;
    } finally {
      this.releaseLock();
    }
  }

  findByRoute(hostname: string, pathPrefix: string): BgProcessEntry | undefined {
    const route = normalizeRoute({ hostname, pathPrefix });
    return this.loadEntries().find(
      (entry) =>
        entry.route?.hostname === route.hostname && entry.route.pathPrefix === route.pathPrefix
    );
  }
}
