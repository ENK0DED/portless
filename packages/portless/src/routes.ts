import * as fs from "node:fs";
import * as path from "node:path";
import type { RouteInfo, RouteProtocol, TunnelProviderName } from "./types.js";
import { fixOwnership, isErrnoException, normalizePathPrefix } from "./utils.js";

/** How long (ms) before a lock directory is considered stale and forcibly removed. */
const STALE_LOCK_THRESHOLD_MS = 10_000;

/** Total time budget (ms) for acquiring the file lock before giving up. */
const LOCK_TIMEOUT_MS = 5_000;

/** Initial delay (ms) between lock acquisition retries (doubles each attempt). */
const LOCK_RETRY_BASE_MS = 10;

/** Maximum delay (ms) between lock acquisition retries. */
const LOCK_RETRY_CAP_MS = 500;

/** File permission mode for route and state files. */
export const FILE_MODE = 0o644;

/** Directory permission mode for the state directory. */
export const DIR_MODE = 0o755;

export function isRetryableLockError(err: unknown): boolean {
  return (
    isErrnoException(err) &&
    (err.code === "EEXIST" || err.code === "EPERM" || err.code === "EACCES")
  );
}

export interface RouteMapping extends RouteInfo {
  pid: number;
  tailscaleUrl?: string;
  tailscaleHttpsPort?: number;
  tailscaleFunnel?: boolean;
  tailscaleServiceName?: string;
  tailscaleServiceUrl?: string;
  tailscaleServicePending?: boolean;
  ngrokUrl?: string;
  ngrokPid?: number;
  tunnelProvider?: TunnelProviderName;
  tunnelUrl?: string;
  tunnelExternalHostname?: string;
  tunnelPid?: number;
  netbirdUrl?: string;
  netbirdPid?: number;
}

type RouteMetadataPatch = {
  tailscaleUrl?: string | null;
  tailscaleHttpsPort?: number | null;
  tailscaleFunnel?: boolean | null;
  tailscaleServiceName?: string | null;
  tailscaleServiceUrl?: string | null;
  tailscaleServicePending?: boolean | null;
  ngrokUrl?: string | null;
  ngrokPid?: number | null;
  tunnelProvider?: TunnelProviderName | null;
  tunnelUrl?: string | null;
  tunnelExternalHostname?: string | null;
  tunnelPid?: number | null;
  netbirdUrl?: string | null;
  netbirdPid?: number | null;
};

interface AddRouteOptions {
  protocol?: RouteProtocol;
  pathPrefix?: string;
}

interface RouteKeyOptions {
  pathPrefix?: string;
}

/** Runtime check that a parsed JSON value is a valid RouteMapping. */
function isValidRoute(value: unknown): value is RouteMapping {
  if (
    !(
      typeof value === "object" &&
      value !== null &&
      typeof (value as RouteMapping).hostname === "string" &&
      typeof (value as RouteMapping).port === "number" &&
      typeof (value as RouteMapping).pid === "number"
    )
  ) {
    return false;
  }
  const pathPrefix = (value as RouteMapping).pathPrefix;
  if (pathPrefix !== undefined) {
    if (typeof pathPrefix !== "string") return false;
    try {
      normalizePathPrefix(pathPrefix);
    } catch {
      return false;
    }
  }
  return true;
}

function routePathPrefix(route: Pick<RouteMapping, "pathPrefix">): string {
  return normalizePathPrefix(route.pathPrefix);
}

function routeMatchesKey(route: RouteMapping, hostname: string, pathPrefix: string): boolean {
  return route.hostname === hostname && routePathPrefix(route) === pathPrefix;
}

function routeLabel(hostname: string, pathPrefix: string): string {
  return pathPrefix === "/" ? hostname : `${hostname}${pathPrefix}`;
}

/**
 * Thrown when a route is already registered by a live process and --force was
 * not specified. With --force, the existing process is killed instead.
 */
export class RouteConflictError extends Error {
  readonly hostname: string;
  readonly existingPid: number;
  readonly pathPrefix: string;

  constructor(hostname: string, existingPid: number, pathPrefix = "/") {
    super(
      `"${routeLabel(hostname, pathPrefix)}" is already registered by a running process (PID ${existingPid}). ` +
        `Use --force to override.`
    );
    this.name = "RouteConflictError";
    this.hostname = hostname;
    this.existingPid = existingPid;
    this.pathPrefix = pathPrefix;
  }
}

/**
 * Manages route mappings stored as a JSON file on disk.
 * Supports file locking and stale-route cleanup.
 */
export class RouteStore {
  /** The state directory path. */
  readonly dir: string;
  private readonly routesPath: string;
  private readonly lockPath: string;
  readonly pidPath: string;
  readonly portFilePath: string;
  private readonly onWarning: ((message: string) => void) | undefined;

  constructor(dir: string, options?: { onWarning?: (message: string) => void }) {
    this.dir = dir;
    this.routesPath = path.join(dir, "routes.json");
    this.lockPath = path.join(dir, "routes.lock");
    this.pidPath = path.join(dir, "proxy.pid");
    this.portFilePath = path.join(dir, "proxy.port");
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

  getRoutesPath(): string {
    return this.routesPath;
  }

  // Locking
  // ---------------------------------------------------------------------------

  private static readonly sleepBuffer = new Int32Array(new SharedArrayBuffer(4));

  private syncSleep(ms: number): void {
    Atomics.wait(RouteStore.sleepBuffer, 0, 0, ms);
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

  // Route I/O
  // ---------------------------------------------------------------------------

  private isProcessAlive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Load routes from disk, filtering out stale entries whose owning process
   * is no longer alive. Stale-route cleanup is only persisted when the caller
   * already holds the lock (i.e. inside addRoute/removeRoute) to avoid
   * unprotected concurrent writes.
   */
  loadRoutes(persistCleanup = false): RouteMapping[] {
    if (!fs.existsSync(this.routesPath)) {
      return [];
    }
    try {
      const raw = fs.readFileSync(this.routesPath, "utf-8");
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        this.onWarning?.(`Corrupted routes file (invalid JSON): ${this.routesPath}`);
        return [];
      }
      if (!Array.isArray(parsed)) {
        this.onWarning?.(`Corrupted routes file (expected array): ${this.routesPath}`);
        return [];
      }
      const routes: RouteMapping[] = parsed.filter(isValidRoute);
      // Filter out stale routes whose owning process is no longer alive
      const alive = routes.filter((r) => r.pid === 0 || this.isProcessAlive(r.pid));
      if (persistCleanup && alive.length !== routes.length) {
        // Persist the cleaned-up list so stale entries don't accumulate.
        // Only safe when caller holds the lock.
        try {
          fs.writeFileSync(this.routesPath, JSON.stringify(alive, null, 2), {
            mode: FILE_MODE,
          });
        } catch {
          // Write may fail (permissions); non-fatal
        }
      }
      return alive;
    } catch {
      return [];
    }
  }

  private saveRoutes(routes: RouteMapping[]): void {
    fs.writeFileSync(this.routesPath, JSON.stringify(routes, null, 2), { mode: FILE_MODE });
    fixOwnership(this.routesPath);
  }

  /**
   * Register a route. When `force` is true and the hostname is already claimed
   * by another live process, that process is sent SIGTERM before the route is
   * replaced. Returns the PID of the killed process (if any) so the caller can
   * log it.
   */
  addRoute(
    hostname: string,
    port: number,
    pid: number,
    force = false,
    options: AddRouteOptions = {}
  ): number | undefined {
    this.ensureDir();
    if (!this.acquireLock()) {
      throw new Error("Failed to acquire route lock");
    }
    let killedPid: number | undefined;
    try {
      const routes = this.loadRoutes(true);
      const pathPrefix = normalizePathPrefix(options.pathPrefix);
      const existing = routes.find((r) => routeMatchesKey(r, hostname, pathPrefix));
      if (existing && existing.pid !== pid && this.isProcessAlive(existing.pid)) {
        if (!force) {
          throw new RouteConflictError(hostname, existing.pid, pathPrefix);
        }
        // --force: kill the existing process before taking over
        try {
          process.kill(existing.pid, "SIGTERM");
          killedPid = existing.pid;
        } catch {
          // Process may have exited between the check and the kill; non-fatal
        }
      }
      const filtered = routes.filter((r) => !routeMatchesKey(r, hostname, pathPrefix));
      const entry: RouteMapping = {
        hostname,
        port,
        pid,
        ...(pathPrefix !== "/" ? { pathPrefix } : {}),
        ...(options.protocol && options.protocol !== "http1" ? { protocol: options.protocol } : {}),
      };
      filtered.push(entry);
      this.saveRoutes(filtered);
    } finally {
      this.releaseLock();
    }
    return killedPid;
  }

  /**
   * Load all routes from disk without filtering out dead PIDs. Used by
   * `portless prune` to discover stale entries whose owning CLI is gone
   * but whose dev server may still be holding a port.
   */
  loadRoutesRaw(): RouteMapping[] {
    if (!fs.existsSync(this.routesPath)) {
      return [];
    }
    try {
      const raw = fs.readFileSync(this.routesPath, "utf-8");
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return [];
      }
      if (!Array.isArray(parsed)) {
        return [];
      }
      return parsed.filter(isValidRoute);
    } catch {
      return [];
    }
  }

  /**
   * Remove all route entries whose owning process is dead and persist the
   * result. Returns the removed stale entries so the caller can act on them.
   */
  pruneStaleRoutes(): RouteMapping[] {
    this.ensureDir();
    if (!this.acquireLock()) {
      throw new Error("Failed to acquire route lock");
    }
    try {
      const all = this.loadRoutesRaw();
      const alive: RouteMapping[] = [];
      const stale: RouteMapping[] = [];
      for (const r of all) {
        if (r.pid === 0 || this.isProcessAlive(r.pid)) {
          alive.push(r);
        } else {
          stale.push(r);
        }
      }
      if (stale.length > 0) {
        this.saveRoutes(alive);
      }
      return stale;
    } finally {
      this.releaseLock();
    }
  }

  /**
   * Update metadata on an existing route entry. Only provided fields are
   * merged; the route must already exist (matched by hostname and path prefix).
   */
  updateRoute(hostname: string, fields: RouteMetadataPatch, options: RouteKeyOptions = {}): void {
    this.ensureDir();
    if (!this.acquireLock()) {
      throw new Error("Failed to acquire route lock");
    }
    try {
      const routes = this.loadRoutes(true);
      const pathPrefix = normalizePathPrefix(options.pathPrefix);
      const route = routes.find((r) => routeMatchesKey(r, hostname, pathPrefix));
      if (!route) return;
      if ("tailscaleUrl" in fields) {
        if (fields.tailscaleUrl === null) delete route.tailscaleUrl;
        else if (fields.tailscaleUrl !== undefined) route.tailscaleUrl = fields.tailscaleUrl;
      }
      if ("tailscaleHttpsPort" in fields) {
        if (fields.tailscaleHttpsPort === null) delete route.tailscaleHttpsPort;
        else if (fields.tailscaleHttpsPort !== undefined)
          route.tailscaleHttpsPort = fields.tailscaleHttpsPort;
      }
      if ("tailscaleFunnel" in fields) {
        if (fields.tailscaleFunnel === null) delete route.tailscaleFunnel;
        else if (fields.tailscaleFunnel !== undefined)
          route.tailscaleFunnel = fields.tailscaleFunnel;
      }
      if ("tailscaleServiceName" in fields) {
        if (fields.tailscaleServiceName === null) delete route.tailscaleServiceName;
        else if (fields.tailscaleServiceName !== undefined)
          route.tailscaleServiceName = fields.tailscaleServiceName;
      }
      if ("tailscaleServiceUrl" in fields) {
        if (fields.tailscaleServiceUrl === null) delete route.tailscaleServiceUrl;
        else if (fields.tailscaleServiceUrl !== undefined)
          route.tailscaleServiceUrl = fields.tailscaleServiceUrl;
      }
      if ("tailscaleServicePending" in fields) {
        if (fields.tailscaleServicePending === null) delete route.tailscaleServicePending;
        else if (fields.tailscaleServicePending !== undefined)
          route.tailscaleServicePending = fields.tailscaleServicePending;
      }
      if ("ngrokUrl" in fields) {
        if (fields.ngrokUrl === null) delete route.ngrokUrl;
        else if (fields.ngrokUrl !== undefined) route.ngrokUrl = fields.ngrokUrl;
      }
      if ("ngrokPid" in fields) {
        if (fields.ngrokPid === null) delete route.ngrokPid;
        else if (fields.ngrokPid !== undefined) route.ngrokPid = fields.ngrokPid;
      }
      if ("tunnelProvider" in fields) {
        if (fields.tunnelProvider === null) delete route.tunnelProvider;
        else if (fields.tunnelProvider !== undefined) route.tunnelProvider = fields.tunnelProvider;
      }
      if ("tunnelUrl" in fields) {
        if (fields.tunnelUrl === null) delete route.tunnelUrl;
        else if (fields.tunnelUrl !== undefined) route.tunnelUrl = fields.tunnelUrl;
      }
      if ("tunnelExternalHostname" in fields) {
        if (fields.tunnelExternalHostname === null) delete route.tunnelExternalHostname;
        else if (fields.tunnelExternalHostname !== undefined)
          route.tunnelExternalHostname = fields.tunnelExternalHostname;
      }
      if ("tunnelPid" in fields) {
        if (fields.tunnelPid === null) delete route.tunnelPid;
        else if (fields.tunnelPid !== undefined) route.tunnelPid = fields.tunnelPid;
      }
      if ("netbirdUrl" in fields) {
        if (fields.netbirdUrl === null) delete route.netbirdUrl;
        else if (fields.netbirdUrl !== undefined) route.netbirdUrl = fields.netbirdUrl;
      }
      if ("netbirdPid" in fields) {
        if (fields.netbirdPid === null) delete route.netbirdPid;
        else if (fields.netbirdPid !== undefined) route.netbirdPid = fields.netbirdPid;
      }
      this.saveRoutes(routes);
    } finally {
      this.releaseLock();
    }
  }

  /**
   * Remove a route by hostname. When `ownerPid` is provided, the entry is
   * only removed while it is still owned by that pid. Exit cleanups must
   * pass their own pid: after a `--force` takeover the killed process would
   * otherwise deregister the route the new owner just registered.
   */
  removeRoute(hostname: string, ownerPid?: number, options: RouteKeyOptions = {}): void {
    this.ensureDir();
    if (!this.acquireLock()) {
      throw new Error("Failed to acquire route lock");
    }
    try {
      const pathPrefix = normalizePathPrefix(options.pathPrefix);
      const routes = this.loadRoutes(true).filter(
        (r) =>
          !routeMatchesKey(r, hostname, pathPrefix) ||
          (ownerPid !== undefined && r.pid !== ownerPid)
      );
      this.saveRoutes(routes);
    } finally {
      this.releaseLock();
    }
  }
}
