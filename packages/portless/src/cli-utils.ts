import * as fs from "node:fs";
import * as http from "node:http";
import * as https from "node:https";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import * as readline from "node:readline";
import { execSync, spawn } from "node:child_process";
import { resolveScript, resolveScriptRaw } from "./config.js";
import { LOOPBACK_DIAL_OPTIONS, PORTLESS_HEADER, PORTLESS_LISTENER_PORT_HEADER } from "./proxy.js";
import {
  checkHostResolution,
  getManagedHostnames,
  shouldAutoSyncHosts,
  syncHostsFile,
} from "./hosts.js";
import { resolveUserHome } from "./utils.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** True when running on Windows. */
export const isWindows = process.platform === "win32";

/** Unprivileged fallback port used when standard ports are unavailable. */
export const FALLBACK_PROXY_PORT = 1355;

/**
 * @deprecated Use FALLBACK_PROXY_PORT instead. Kept for backward compatibility
 * with tests and external consumers.
 */
export const DEFAULT_PROXY_PORT = FALLBACK_PROXY_PORT;

/** Ports below this threshold require root/sudo to bind (Unix only). */
export const PRIVILEGED_PORT_THRESHOLD = 1024;

/** Internal env var used to preserve an auto-detected LAN IP across daemonization. */
export const INTERNAL_LAN_IP_ENV = "PORTLESS_INTERNAL_LAN_IP";

/** Internal-only flag used to pass an auto-detected LAN IP through re-exec. */
export const INTERNAL_LAN_IP_FLAG = "--lan-ip-auto";

/**
 * @deprecated No longer used. All state now lives in USER_STATE_DIR.
 * Kept as a read-only reference for migration and cleanup of old installs.
 */
export const LEGACY_SYSTEM_STATE_DIR = isWindows
  ? path.join(os.tmpdir(), "portless")
  : "/tmp/portless";

/** Per-user state directory. All proxy state lives here regardless of port. */
export const USER_STATE_DIR = path.join(resolveUserHome(), ".portless");

/** Minimum app port when finding a free port. */
const MIN_APP_PORT = 4000;

/** Maximum app port when finding a free port. */
const MAX_APP_PORT = 4999;

/** Number of random port attempts before sequential scan. */
const RANDOM_PORT_ATTEMPTS = 50;

/**
 * Ports that browsers block for security reasons (WHATWG fetch spec "bad port"
 * list). Frameworks like Next.js also reject these. We skip them when
 * auto-selecting a port so the child process is never handed a port that the
 * browser will refuse to connect to.
 *
 * @see https://fetch.spec.whatwg.org/#port-blocking
 */
export const BLOCKED_PORTS: ReadonlySet<number> = new Set([
  0, 1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79, 87, 95, 101, 102,
  103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 137, 139, 143, 161, 179, 389, 427, 465,
  512, 513, 514, 515, 526, 530, 531, 532, 540, 548, 554, 556, 563, 587, 601, 636, 989, 990, 993,
  995, 1719, 1720, 1723, 2049, 3659, 4045, 4190, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668,
  6669, 6679, 6697, 10080,
]);

/** TCP connect timeout (ms) when checking if something is listening. */
const SOCKET_TIMEOUT_MS = 500;

/** Timeout (ms) for PID lookup when finding a process on a port. */
const PID_LOOKUP_TIMEOUT_MS = 5000;

/** Maximum poll attempts when waiting for the proxy to become ready. */
export const WAIT_FOR_PROXY_MAX_ATTEMPTS = 20;

/** Interval (ms) between proxy readiness polls. */
export const WAIT_FOR_PROXY_INTERVAL_MS = 250;

/** Signal name to signal number mapping for exit code calculation. */
export const SIGNAL_CODES: Record<string, number> = {
  SIGHUP: 1,
  SIGINT: 2,
  SIGQUIT: 3,
  SIGABRT: 6,
  SIGKILL: 9,
  SIGTERM: 15,
};

/** Listener address used when the proxy is only accessible from this machine. */
export const IPV4_LOOPBACK_PROXY_HOST = "127.0.0.1";

/** IPv6 listener address used when the proxy is only accessible from this machine. */
export const IPV6_LOOPBACK_PROXY_HOST = "::1";

/** IPv4 listener address used when LAN mode explicitly exposes the proxy. */
export const IPV4_LAN_PROXY_HOST = "0.0.0.0";

/** IPv6 listener address used when LAN mode explicitly exposes the proxy. */
export const IPV6_LAN_PROXY_HOST = "::";

export type ProxyBindTarget = {
  host: string;
  ipv6Only?: boolean;
};

/** Return explicit IPv4 and IPv6 listener targets for the effective proxy mode. */
export function getProxyBindTargets(lanMode: boolean): ProxyBindTarget[] {
  return lanMode
    ? [{ host: IPV4_LAN_PROXY_HOST }, { host: IPV6_LAN_PROXY_HOST, ipv6Only: true }]
    : [{ host: IPV4_LOOPBACK_PROXY_HOST }, { host: IPV6_LOOPBACK_PROXY_HOST, ipv6Only: true }];
}

/** Start a proxy listener on the selected interface and port. */
export function listenOnProxyInterface(
  server: net.Server,
  port: number,
  target: ProxyBindTarget,
  listener?: () => void
): void {
  server.listen({ port, host: target.host, ipv6Only: target.ipv6Only }, listener);
}

/**
 * Kill a child process and its entire process tree. On Unix, when the child
 * was spawned with `detached: true`, it leads its own process group and
 * process.kill(-pid) reaches every descendant. Falls back to killing just
 * the child on Windows or when the group kill fails.
 */
export function killTree(
  child: ReturnType<typeof spawn>,
  signal: NodeJS.Signals = "SIGTERM"
): void {
  if (!child.pid) {
    child.kill(signal);
    return;
  }
  if (!isWindows) {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch {
      // Process group may already be gone; fall through
    }
  }
  try {
    child.kill(signal);
  } catch {
    // Already dead
  }
}

// ---------------------------------------------------------------------------
// Port configuration
// ---------------------------------------------------------------------------

/**
 * Return the protocol-standard port for the given scheme.
 * HTTPS -> 443, HTTP -> 80.
 */
export function getProtocolPort(tls: boolean): number {
  return tls ? 443 : 80;
}

/**
 * Return the effective default proxy port. Reads the PORTLESS_PORT env var
 * first, then falls back to the protocol-standard port (443 for HTTPS,
 * 80 for HTTP). When `tls` is undefined the legacy fallback (1355) is used
 * so callers that don't yet know the protocol get backward-compatible behavior.
 */
export function getDefaultPort(tls?: boolean): number {
  const envPort = process.env.PORTLESS_PORT;
  if (envPort) {
    const port = parseInt(envPort, 10);
    if (!isNaN(port) && port >= 1 && port <= 65535) return port;
  }
  return tls === undefined ? FALLBACK_PROXY_PORT : getProtocolPort(tls);
}

// ---------------------------------------------------------------------------
// State directory resolution
// ---------------------------------------------------------------------------

/**
 * Determine the state directory for a given proxy port.
 * Always returns USER_STATE_DIR (~/.portless) unless PORTLESS_STATE_DIR is set.
 */
export function resolveStateDir(_port?: number): string {
  if (process.env.PORTLESS_STATE_DIR) return process.env.PORTLESS_STATE_DIR;
  return USER_STATE_DIR;
}

/** Read the proxy port from a given state directory. Returns null if unreadable. */
export function readPortFromDir(dir: string): number | null {
  try {
    const raw = fs.readFileSync(path.join(dir, "proxy.port"), "utf-8").trim();
    const port = parseInt(raw, 10);
    return isNaN(port) ? null : port;
  } catch {
    return null;
  }
}

/** Name of the marker file that indicates the proxy is running with TLS. */
const TLS_MARKER_FILE = "proxy.tls";
const CUSTOM_CERT_MARKER_FILE = "proxy.custom-cert";
const INTERNAL_PAGES_DISABLED_MARKER_FILE = "proxy.internal-pages-disabled";

/** Read the TLS marker from a state directory. */
export function readTlsMarker(dir: string): boolean {
  try {
    return fs.existsSync(path.join(dir, TLS_MARKER_FILE));
  } catch {
    return false;
  }
}

/** Write or remove the TLS marker in the state directory. */
export function writeTlsMarker(dir: string, enabled: boolean): void {
  const markerPath = path.join(dir, TLS_MARKER_FILE);
  if (enabled) {
    fs.writeFileSync(markerPath, "1", { mode: 0o644 });
  } else {
    try {
      fs.unlinkSync(markerPath);
    } catch {
      // Marker may already be absent; non-fatal
    }
  }
}

/** Read whether the active HTTPS proxy uses user-provided certificate files. */
export function readCustomCertMarker(dir: string): boolean {
  try {
    return fs.existsSync(path.join(dir, CUSTOM_CERT_MARKER_FILE));
  } catch {
    return false;
  }
}

/** Persist custom certificate state for read-only diagnostics. */
export function writeCustomCertMarker(dir: string, enabled: boolean): void {
  const markerPath = path.join(dir, CUSTOM_CERT_MARKER_FILE);
  if (enabled) {
    fs.writeFileSync(markerPath, "1", { mode: 0o644 });
  } else {
    try {
      fs.unlinkSync(markerPath);
    } catch {
      // Marker may already be absent; non-fatal
    }
  }
}

/** Read whether the active proxy intentionally disables its internal pages. */
export function readInternalPagesDisabledMarker(dir: string): boolean {
  try {
    return fs.existsSync(path.join(dir, INTERNAL_PAGES_DISABLED_MARKER_FILE));
  } catch {
    return false;
  }
}

/** Persist intentionally disabled internal-page state for diagnostics. */
export function writeInternalPagesDisabledMarker(dir: string, disabled: boolean): void {
  const markerPath = path.join(dir, INTERNAL_PAGES_DISABLED_MARKER_FILE);
  if (disabled) {
    fs.writeFileSync(markerPath, "1", { mode: 0o644 });
  } else {
    try {
      fs.unlinkSync(markerPath);
    } catch {
      // Marker may already be absent; non-fatal
    }
  }
}

/**
 * Name of the marker file that remembers LAN mode across proxy restarts.
 * While the proxy is running, the file stores the last known LAN IP.
 */
const LAN_MARKER_FILE = "proxy.lan";

/** Read the LAN marker from a state directory. Returns the last known IP or null. */
export function readLanMarker(dir: string): string | null {
  try {
    const raw = fs.readFileSync(path.join(dir, LAN_MARKER_FILE), "utf-8").trim();
    return raw || null;
  } catch {
    return null;
  }
}

/** Return whether the LAN marker exists, regardless of whether it has an IP. */
export function hasLanMarker(dir: string): boolean {
  try {
    return fs.existsSync(path.join(dir, LAN_MARKER_FILE));
  } catch {
    return false;
  }
}

/** Write or remove the LAN marker in the state directory. */
export function writeLanMarker(dir: string, ip: string | null): void {
  const markerPath = path.join(dir, LAN_MARKER_FILE);
  if (!ip) {
    try {
      fs.unlinkSync(markerPath);
    } catch {
      // Marker may already be absent; non-fatal
    }
  } else {
    fs.writeFileSync(markerPath, ip, { mode: 0o644 });
  }
}

/** Persist LAN mode even when the current network has no usable IP. */
export function writeLanModeMarker(dir: string, enabled: boolean, ip: string | null): void {
  if (!enabled) {
    writeLanMarker(dir, null);
    return;
  }

  fs.writeFileSync(path.join(dir, LAN_MARKER_FILE), ip ?? "", { mode: 0o644 });
}

/** Name of the marker file that indicates wildcard routing is enabled. */
const WILDCARD_MARKER_FILE = "proxy.wildcard";

/** Read whether wildcard routing is enabled in a state directory. */
export function readWildcardMarker(dir: string): boolean {
  try {
    return fs.existsSync(path.join(dir, WILDCARD_MARKER_FILE));
  } catch {
    return false;
  }
}

/** Write or remove the wildcard routing marker in the state directory. */
export function writeWildcardMarker(dir: string, enabled: boolean): void {
  const markerPath = path.join(dir, WILDCARD_MARKER_FILE);
  if (enabled) {
    fs.writeFileSync(markerPath, "1", { mode: 0o644 });
  } else {
    try {
      fs.unlinkSync(markerPath);
    } catch {
      // Marker may already be absent; non-fatal
    }
  }
}

/** Default suffix when PORTLESS_TLD is not set. */
export const DEFAULT_TLD = "localhost";

/** Preferred environment variable for configuring a custom suffix. */
export const SUFFIX_ENV = "PORTLESS_SUFFIX";

/** Backward-compatible environment variable for configuring a custom suffix. */
export const LEGACY_TLD_ENV = "PORTLESS_TLD";

/** Public suffixes that work but have known pitfalls worth warning about. */
export const RISKY_TLDS = new Map<string, string>([
  ["local", "conflicts with mDNS/Bonjour on macOS"],
  ["dev", "Google-owned; browsers force HTTPS via preloaded HSTS"],
  ["app", "Google-owned; browsers force HTTPS via preloaded HSTS"],
  ["com", "public TLD; DNS requests will leak to the internet"],
  ["org", "public TLD; DNS requests will leak to the internet"],
  ["net", "public TLD; DNS requests will leak to the internet"],
  ["io", "public TLD; DNS requests will leak to the internet"],
  ["edu", "public TLD; DNS requests will leak to the internet"],
  ["gov", "public TLD; DNS requests will leak to the internet"],
  ["mil", "public TLD; DNS requests will leak to the internet"],
  ["int", "public TLD; DNS requests will leak to the internet"],
]);

/**
 * Risky TLDs whose failure mode applies to the whole suffix tree, so
 * multi-segment TLDs under them inherit the risk: mDNS claims all of
 * `*.local`, and the `.dev`/`.app` HSTS preload entries carry
 * includeSubDomains. Ownership-class entries (com, org, ...) only matter
 * for a bare TLD — a multi-segment TLD under a domain the user owns is
 * the recommended setup, not a pitfall.
 */
const SUFFIX_RISKY_TLDS = new Set(["local", "dev", "app"]);

/**
 * Look up the risky-TLD warning for a configured TLD. Matches exact entries
 * ("dev"), plus multi-segment TLDs whose suffix carries a tree-wide risk
 * ("example.dev" inherits the HSTS preload).
 */
export function getRiskyTldReason(tld: string): string | undefined {
  const exact = RISKY_TLDS.get(tld);
  if (exact) return exact;
  for (const risky of SUFFIX_RISKY_TLDS) {
    if (tld.endsWith(`.${risky}`)) return RISKY_TLDS.get(risky);
  }
  return undefined;
}

/**
 * Validate a TLD string. Returns an error message if invalid, or null if OK.
 * Does not check for risky TLDs (those produce warnings, not errors).
 */
export function validateTld(tld: string): string | null {
  if (!tld) return "TLD cannot be empty";
  if (tld.length > 253) {
    return `Invalid TLD "${tld}": exceeds 253-character DNS limit`;
  }

  const labelRe = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
  const labels = tld.split(".");
  for (const label of labels) {
    if (!label) {
      return `Invalid TLD "${tld}": labels cannot be empty`;
    }
    if (label.length > 63) {
      return `Invalid TLD "${tld}": label "${label}" exceeds 63-character DNS limit`;
    }
    if (!labelRe.test(label)) {
      return `Invalid TLD "${tld}": labels must contain only lowercase letters, digits, and interior hyphens`;
    }
  }

  return null;
}

/** Name of the file that stores the proxy's active TLD. */
const TLD_FILE = "proxy.tld";
const TLDS_FILE = "proxy.tlds";

/** Parse a comma-separated suffix list and remove duplicates in order. */
export function parseTldList(value: string, source = "TLD"): string[] {
  const trimmed = value.trim();
  if (!trimmed) return [];

  const tlds: string[] = [];
  const seen = new Set<string>();
  for (const rawPart of trimmed.split(",")) {
    const tld = rawPart.trim().toLowerCase();
    const err = validateTld(tld);
    if (err) throw new Error(source === "TLD" ? err : `${source}: ${err}`);
    if (!seen.has(tld)) {
      seen.add(tld);
      tlds.push(tld);
    }
  }
  return tlds;
}

function readLegacyTldFromDir(dir: string): string {
  try {
    const raw = fs.readFileSync(path.join(dir, TLD_FILE), "utf-8").trim();
    if (!raw) return DEFAULT_TLD;

    const error = validateTld(raw);
    if (error) {
      console.warn(`Warning: ignoring invalid TLD entry in ${TLD_FILE}: ${error}`);
      return DEFAULT_TLD;
    }

    return raw;
  } catch {
    return DEFAULT_TLD;
  }
}

/** Read all persisted suffixes, falling back to the compatibility marker. */
export function readTldsFromDir(dir: string): string[] {
  try {
    const raw = fs.readFileSync(path.join(dir, TLDS_FILE), "utf-8").trim();
    const parsed = raw.startsWith("[")
      ? JSON.parse(raw)
      : raw
          .split(/\r?\n/)
          .flatMap((line) => line.split(","))
          .map((line) => line.trim())
          .filter(Boolean);
    if (!Array.isArray(parsed)) return [readLegacyTldFromDir(dir)];

    const tlds: string[] = [];
    const seen = new Set<string>();
    for (const value of parsed) {
      if (typeof value !== "string") continue;
      try {
        for (const tld of parseTldList(value)) {
          if (!seen.has(tld)) {
            seen.add(tld);
            tlds.push(tld);
          }
        }
      } catch (err) {
        console.warn(
          `Warning: ignoring invalid TLD entry in ${TLDS_FILE}: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
    return tlds.length > 0 ? tlds : [DEFAULT_TLD];
  } catch {
    return [readLegacyTldFromDir(dir)];
  }
}

/** Read the primary persisted suffix. */
export function readTldFromDir(dir: string): string {
  return readTldsFromDir(dir)[0] ?? DEFAULT_TLD;
}

/** Persist all suffixes and retain proxy.tld as the primary compatibility marker. */
export function writeTldsFile(dir: string, tlds: readonly string[]): void {
  const uniqueTlds = [...new Set(tlds.length > 0 ? tlds : [DEFAULT_TLD])];
  const tldsPath = path.join(dir, TLDS_FILE);
  const tldPath = path.join(dir, TLD_FILE);
  if (uniqueTlds.length === 1 && uniqueTlds[0] === DEFAULT_TLD) {
    try {
      fs.unlinkSync(tldsPath);
    } catch {
      // File may already be absent; non-fatal
    }
    try {
      fs.unlinkSync(tldPath);
    } catch {
      // File may already be absent; non-fatal
    }
  } else {
    fs.writeFileSync(tldsPath, `${uniqueTlds.join("\n")}\n`, { mode: 0o644 });
    fs.writeFileSync(tldPath, uniqueTlds[0] ?? DEFAULT_TLD, { mode: 0o644 });
  }
}

/** Write or remove a single suffix through the compatibility API. */
export function writeTldFile(dir: string, tld: string): void {
  writeTldsFile(dir, [tld]);
}

export function getConfiguredTldEnv(): {
  value: string;
  source: typeof SUFFIX_ENV | typeof LEGACY_TLD_ENV;
} | null {
  const preferred = process.env[SUFFIX_ENV]?.trim().toLowerCase();
  if (preferred) {
    return { value: preferred, source: SUFFIX_ENV };
  }

  const legacy = process.env[LEGACY_TLD_ENV]?.trim().toLowerCase();
  if (legacy) {
    return { value: legacy, source: LEGACY_TLD_ENV };
  }

  return null;
}

export function hasConfiguredTldEnv(): boolean {
  return getConfiguredTldEnv() !== null;
}

/**
 * Return the effective suffix. Reads PORTLESS_SUFFIX first, then
 * PORTLESS_TLD for backward compatibility, falling back to DEFAULT_TLD
 * ("localhost"). Throws on invalid values.
 */
export function getDefaultTld(): string {
  return getDefaultTlds()[0] ?? DEFAULT_TLD;
}

/** Return the effective suffix list using fork precedence and validation. */
export function getDefaultTlds(): string[] {
  const configured = getConfiguredTldEnv();
  if (!configured) return [DEFAULT_TLD];
  const tlds = parseTldList(configured.value, configured.source);
  return tlds.length > 0 ? tlds : [DEFAULT_TLD];
}

/**
 * @deprecated Use isHttpsEnvDisabled instead. HTTPS is now enabled by default;
 * check whether it is disabled rather than enabled.
 */
export function isHttpsEnvEnabled(): boolean {
  const val = process.env.PORTLESS_HTTPS;
  return val === "1" || val === "true";
}

/**
 * Return whether HTTPS is explicitly disabled via the PORTLESS_HTTPS env var.
 * PORTLESS_HTTPS=0 is the env-var equivalent of --no-tls.
 */
export function isHttpsEnvDisabled(): boolean {
  const val = process.env.PORTLESS_HTTPS;
  return val === "0" || val === "false";
}

/**
 * Return whether wildcard subdomain fallback is requested via the
 * PORTLESS_WILDCARD env var.
 */
export function isWildcardEnvEnabled(): boolean {
  const val = process.env.PORTLESS_WILDCARD;
  return val === "1" || val === "true";
}

/**
 * Return whether LAN mode is requested via the PORTLESS_LAN env var.
 */
export function isLanEnvEnabled(): boolean {
  const val = process.env.PORTLESS_LAN;
  return val === "1" || val === "true";
}

/**
 * Read the last-known proxy configuration from the state directory on disk.
 * Unlike {@link discoverState}, this does not check whether the proxy is
 * actually running. It simply reads whatever state files exist so a
 * subsequent auto-start can reuse the previous settings.
 *
 * Returns null when no prior state is found.
 */
export function readPersistedProxyState(): {
  port: number;
  tls: boolean;
  tld: string;
  tlds: string[];
  lanMode: boolean;
  useWildcard: boolean;
} | null {
  const dir = process.env.PORTLESS_STATE_DIR || USER_STATE_DIR;
  const port = readPortFromDir(dir);
  if (port !== null) {
    const tls = readTlsMarker(dir);
    const tlds = readTldsFromDir(dir);
    const tld = tlds[0] ?? DEFAULT_TLD;
    const useWildcard = readWildcardMarker(dir);
    return { port, tls, tld, tlds, lanMode: hasLanMarker(dir), useWildcard };
  }

  return null;
}

export function buildSudoEnvArgs(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
  overrides: Record<string, string | undefined> = {}
): string[] {
  const values = new Map<string, string>();

  for (const key of Object.keys(env)) {
    const value = env[key];
    if (key.startsWith("PORTLESS_") && value) {
      values.set(key, value);
    }
  }

  if (env.HOME) {
    values.set("HOME", env.HOME);
  }

  for (const [key, value] of Object.entries(overrides)) {
    if (value) {
      values.set(key, value);
    }
  }

  return [...values.entries()].map(([key, value]) => `${key}=${value}`);
}

export function buildProxyStartConfig(options: {
  useHttps: boolean;
  customCertPath?: string | null;
  customKeyPath?: string | null;
  lanMode: boolean;
  lanIp?: string | null;
  lanIpExplicit?: boolean;
  tld: string;
  tlds?: string[];
  tldsExplicit?: boolean;
  useWildcard?: boolean;
  foreground?: boolean;
  includePort?: boolean;
  proxyPort?: number;
  skipTrust?: boolean;
  routesCleanupIntervalSeconds?: number;
}): { effectiveTld: string; effectiveTlds: string[]; args: string[] } {
  const requestedTlds = [...new Set(options.tlds?.length ? options.tlds : [options.tld])];
  const effectiveTlds = options.lanMode
    ? options.tldsExplicit
      ? requestedTlds.includes("local")
        ? requestedTlds
        : [...requestedTlds, "local"]
      : ["local"]
    : requestedTlds;
  const effectiveTld = effectiveTlds[0] ?? DEFAULT_TLD;
  const args: string[] = [];

  if (options.foreground) {
    args.push("--foreground");
  }

  if (options.includePort && options.proxyPort !== undefined) {
    args.push("--port", options.proxyPort.toString());
  }

  if (options.useHttps) {
    if (options.customCertPath && options.customKeyPath) {
      args.push("--cert", options.customCertPath, "--key", options.customKeyPath);
    } else {
      args.push("--https");
    }
  } else {
    args.push("--no-tls");
  }

  if (options.lanMode) {
    args.push("--lan");
    if (options.tldsExplicit) {
      for (const tld of effectiveTlds) args.push("--suffix", tld);
    }
    if (options.lanIp) {
      if (options.lanIpExplicit) {
        args.push("--ip", options.lanIp);
      } else {
        args.push(INTERNAL_LAN_IP_FLAG, options.lanIp);
      }
    }
  } else if (options.tldsExplicit || effectiveTlds.length > 1 || effectiveTld !== DEFAULT_TLD) {
    for (const tld of effectiveTlds) args.push("--suffix", tld);
  }

  if (options.useWildcard) {
    args.push("--wildcard");
  }

  if (options.skipTrust) {
    args.push("--skip-trust");
  }

  if (options.routesCleanupIntervalSeconds !== undefined) {
    args.push("--routes-cleanup-interval", options.routesCleanupIntervalSeconds.toString());
  }

  return { effectiveTld, effectiveTlds, args };
}

/**
 * Discover the active proxy's state directory, port, TLS mode, TLD, LAN mode,
 * and current LAN IP when available.
 * Checks the user-level dir first, then the legacy /tmp/portless dir as a
 * read-only fallback for proxies started with older versions.
 */
export async function discoverState(): Promise<{
  dir: string;
  port: number;
  tls: boolean;
  tld: string;
  tlds: string[];
  lanMode: boolean;
  lanIp: string | null;
}> {
  // Env var override
  if (process.env.PORTLESS_STATE_DIR) {
    const dir = process.env.PORTLESS_STATE_DIR;
    const port = readPortFromDir(dir) ?? getDefaultPort();
    const lanIp = readLanMarker(dir);
    if ((await isProxyRunning(port)) || (await isPortListening(port))) {
      const tls = readTlsMarker(dir);
      const tlds = readTldsFromDir(dir);
      const tld = tlds[0] ?? DEFAULT_TLD;
      return { dir, port, tls, tld, tlds, lanMode: hasLanMarker(dir), lanIp };
    }

    return {
      dir,
      port,
      tls: readTlsMarker(dir),
      tld: getConfiguredTldEnv() ? getDefaultTld() : readTldFromDir(dir),
      tlds: getConfiguredTldEnv() ? getDefaultTlds() : readTldsFromDir(dir),
      lanMode: hasLanMarker(dir),
      lanIp: null,
    };
  }

  // Check user-level state first (~/.portless)
  const userPort = readPortFromDir(USER_STATE_DIR);
  if (userPort !== null) {
    // Always use plain HTTP for the liveness check. The TLS-enabled proxy
    // accepts plain HTTP via byte-peeking, so this works for both modes and
    // avoids TLS handshake timeouts that can cause false negatives.
    if (await isProxyRunning(userPort)) {
      const tls = readTlsMarker(USER_STATE_DIR);
      const tlds = readTldsFromDir(USER_STATE_DIR);
      const tld = tlds[0] ?? DEFAULT_TLD;
      const lanIp = readLanMarker(USER_STATE_DIR);
      return {
        dir: USER_STATE_DIR,
        port: userPort,
        tls,
        tld,
        tlds,
        lanMode: hasLanMarker(USER_STATE_DIR),
        lanIp,
      };
    }
  }

  // Check legacy system-level state (/tmp/portless) for proxies started with
  // older versions. Read-only: no root operations are performed on this path.
  const legacyPort = readPortFromDir(LEGACY_SYSTEM_STATE_DIR);
  if (legacyPort !== null) {
    if (await isProxyRunning(legacyPort)) {
      const tls = readTlsMarker(LEGACY_SYSTEM_STATE_DIR);
      const tlds = readTldsFromDir(LEGACY_SYSTEM_STATE_DIR);
      const tld = tlds[0] ?? DEFAULT_TLD;
      const lanIp = readLanMarker(LEGACY_SYSTEM_STATE_DIR);
      return {
        dir: LEGACY_SYSTEM_STATE_DIR,
        port: legacyPort,
        tls,
        tld,
        tlds,
        lanMode: hasLanMarker(LEGACY_SYSTEM_STATE_DIR),
        lanIp,
      };
    }
  }

  // State files didn't help. Probe well-known ports as a last resort.
  // Standard ports first (443, 80) since those are the new defaults, then the
  // legacy fallback port, then any PORTLESS_PORT override.
  const configuredPort = getDefaultPort();
  const probePorts = new Set([443, 80, FALLBACK_PROXY_PORT, configuredPort]);
  for (const port of probePorts) {
    if (await isProxyRunning(port)) {
      const dir = resolveStateDir(port);
      const markerTls = readTlsMarker(dir);
      // When the marker is missing, infer TLS from the port:
      // 443 is always HTTPS, 80 is always HTTP.
      const tls = markerTls || port === getProtocolPort(true);
      const tlds = readTldsFromDir(dir);
      const tld = tlds[0] ?? DEFAULT_TLD;
      const lanIp = readLanMarker(dir);
      return { dir, port, tls, tld, tlds, lanMode: hasLanMarker(dir), lanIp };
    }
  }

  const dir = resolveStateDir(configuredPort);
  return {
    dir,
    port: configuredPort,
    tls: readTlsMarker(dir),
    tld: readTldFromDir(dir),
    tlds: readTldsFromDir(dir),
    lanMode: hasLanMarker(dir),
    lanIp: null,
  };
}

// ---------------------------------------------------------------------------
// Port utilities
// ---------------------------------------------------------------------------

/**
 * Find a free port in the given range (default 4000-4999).
 * Tries random ports first for speed, then falls back to sequential scan.
 *
 * Note: There is an inherent TOCTOU race between verifying a port is free
 * and the child process actually binding to it. The random-first strategy
 * minimizes the window.
 */
export async function findFreePort(
  minPort = MIN_APP_PORT,
  maxPort = MAX_APP_PORT
): Promise<number> {
  if (minPort > maxPort) {
    throw new Error(`minPort (${minPort}) must be <= maxPort (${maxPort})`);
  }

  const tryPort = (port: number): Promise<boolean> => {
    return new Promise((resolve) => {
      const server = net.createServer();
      server.listen(port, "127.0.0.1", () => {
        server.close(() => resolve(true));
      });
      server.on("error", () => resolve(false));
    });
  };

  // Try random ports first
  for (let i = 0; i < RANDOM_PORT_ATTEMPTS; i++) {
    const port = minPort + Math.floor(Math.random() * (maxPort - minPort + 1));
    if (!BLOCKED_PORTS.has(port) && (await tryPort(port))) {
      return port;
    }
  }

  // Fall back to sequential
  for (let port = minPort; port <= maxPort; port++) {
    if (!BLOCKED_PORTS.has(port) && (await tryPort(port))) {
      return port;
    }
  }

  throw new Error(`No free port found in range ${minPort}-${maxPort}`);
}

/**
 * Check if a portless proxy is listening on the given port at 127.0.0.1.
 * Makes an HTTP(S) request and verifies the X-Portless response header to
 * distinguish the portless proxy from unrelated services. When available,
 * verifies the listener-port header to avoid false positives from pf/NAT
 * redirects.
 *
 * When `tls` is true, uses HTTPS with certificate verification disabled
 * (the proxy may use a self-signed or locally-trusted CA cert).
 */
export function isProxyRunning(port: number, tls = false): Promise<boolean> {
  return new Promise((resolve) => {
    const requestFn = tls ? https.request : http.request;
    const req = requestFn(
      {
        hostname: "127.0.0.1",
        port,
        path: "/",
        method: "HEAD",
        timeout: SOCKET_TIMEOUT_MS,
        ...(tls ? { rejectUnauthorized: false } : {}),
      },
      (res) => {
        res.resume();
        if (res.headers[PORTLESS_HEADER.toLowerCase()] !== "1") {
          resolve(false);
          return;
        }

        const reportedPort = res.headers[PORTLESS_LISTENER_PORT_HEADER.toLowerCase()];
        if (typeof reportedPort === "string") {
          resolve(parseInt(reportedPort, 10) === port);
          return;
        }
        if (Array.isArray(reportedPort) && reportedPort.length > 0) {
          resolve(parseInt(reportedPort[0], 10) === port);
          return;
        }

        // Older proxies do not report their listener port.
        resolve(true);
      }
    );
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
    req.end();
  });
}

/** Display text shared by every post-registration resolution warning. */
export function hostsUnresolvedMessage(hostnames: string[]): string {
  return `${hostnames.join(", ")} will not resolve. Run: portless hosts sync`;
}

/** Maximum time to wait for the daemon's routes watcher to publish its block. */
export const HOSTS_SYNC_POLL_CEILING_MS = 3500;
const HOSTS_SYNC_POLL_INTERVAL_MS = 100;

/**
 * Wait for the daemon to publish the managed hosts block, then check each
 * hostname once through the system resolver. Polling the block avoids repeated
 * resolver calls, which can preserve a negative DNS result after the block is
 * written.
 */
export async function reportHostsSync(
  hostnames: string[],
  lanMode: boolean,
  onWarn: (message: string) => void,
  resolves: (hostname: string) => Promise<boolean> = checkHostResolution,
  readManaged: () => string[] = getManagedHostnames,
  ceilingMs = HOSTS_SYNC_POLL_CEILING_MS,
  sleep: (delayMs: number) => Promise<void> = (delayMs) =>
    new Promise<void>((resolve) => setTimeout(resolve, delayMs))
): Promise<void> {
  const uniqueHostnames = [...new Set(hostnames)];
  const checkedHostnames = lanMode
    ? uniqueHostnames.filter((hostname) => !hostname.endsWith(".local"))
    : uniqueHostnames;
  if (checkedHostnames.length === 0) return;

  if (!shouldAutoSyncHosts(process.env.PORTLESS_SYNC_HOSTS)) {
    const results = await Promise.all(checkedHostnames.map((hostname) => resolves(hostname)));
    const unresolved = checkedHostnames.filter((_, index) => !results[index]);
    if (unresolved.length > 0) onWarn(hostsUnresolvedMessage(unresolved));
    return;
  }

  const deadline = Date.now() + Math.max(0, ceilingMs);
  while (true) {
    const managed = new Set(readManaged());
    if (checkedHostnames.every((hostname) => managed.has(hostname))) break;

    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await sleep(Math.min(HOSTS_SYNC_POLL_INTERVAL_MS, remaining));
  }

  const results = await Promise.all(checkedHostnames.map((hostname) => resolves(hostname)));
  const unresolved = checkedHostnames.filter((_, index) => !results[index]);
  if (unresolved.length > 0) onWarn(hostsUnresolvedMessage(unresolved));
}

/**
 * Sync the daemon's hosts block and latch only non-empty failures. A successful
 * sync re-arms the warning, while an empty route warm-up cannot spend it.
 */
export function syncHostsWithWarning(
  hostnames: string[],
  alreadyWarned: boolean,
  onWarn: () => void,
  sync: (hostnames: string[]) => boolean = syncHostsFile
): boolean {
  const uniqueHostnames = [...new Set(hostnames)];
  if (sync(uniqueHostnames)) return false;
  if (uniqueHostnames.length === 0) return alreadyWarned;
  if (!alreadyWarned) onWarn();
  return true;
}

/** Check whether any process is listening on the given port on loopback. */
export function isPortListening(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ ...LOOPBACK_DIAL_OPTIONS, port });
    let settled = false;

    const finish = (result: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(SOCKET_TIMEOUT_MS);
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.once("timeout", () => finish(false));
  });
}

// ---------------------------------------------------------------------------
// Process utilities
// ---------------------------------------------------------------------------

/**
 * Parse the PID of a process listening on a given port from netstat output.
 * Exported for testing.
 */
export function parsePidFromNetstat(output: string, port: number): number | null {
  for (const line of output.split(/\r?\n/)) {
    if (!line.includes("LISTENING")) continue;
    const parts = line.trim().split(/\s+/);
    // Format: TCP  0.0.0.0:PORT  0.0.0.0:0  LISTENING  PID
    if (parts.length < 5) continue;
    const localAddr = parts[1];
    const lastColon = localAddr.lastIndexOf(":");
    if (lastColon === -1) continue;
    const addrPort = parseInt(localAddr.substring(lastColon + 1), 10);
    if (addrPort === port) {
      const pid = parseInt(parts[parts.length - 1], 10);
      if (!isNaN(pid) && pid > 0) return pid;
    }
  }
  return null;
}

/**
 * Find all PIDs listening on the given TCP port.
 * Uses lsof on macOS/Linux and netstat on Windows.
 */
export function findPidsOnPort(port: number): number[] {
  try {
    if (isWindows) {
      const output = execSync("netstat -ano -p tcp", {
        encoding: "utf-8",
        timeout: PID_LOOKUP_TIMEOUT_MS,
      });
      const pid = parsePidFromNetstat(output, port);
      return pid === null ? [] : [pid];
    }

    const output = execSync(`lsof -ti tcp:${port} -sTCP:LISTEN`, {
      encoding: "utf-8",
      timeout: PID_LOOKUP_TIMEOUT_MS,
    });
    return output
      .trim()
      .split("\n")
      .map((s) => parseInt(s, 10))
      .filter((n) => !isNaN(n) && n > 0);
  } catch {
    return [];
  }
}

/**
 * Try to find the PID of a process listening on the given TCP port.
 * Uses lsof on macOS/Linux and netstat on Windows.
 * Returns null if the PID cannot be determined.
 */
export function findPidOnPort(port: number): number | null {
  try {
    if (isWindows) {
      const output = execSync("netstat -ano -p tcp", {
        encoding: "utf-8",
        timeout: PID_LOOKUP_TIMEOUT_MS,
      });
      return parsePidFromNetstat(output, port);
    }

    const output = execSync(`lsof -ti tcp:${port} -sTCP:LISTEN`, {
      encoding: "utf-8",
      timeout: PID_LOOKUP_TIMEOUT_MS,
    });
    // lsof may return multiple PIDs (one per line); take the first
    const pid = parseInt(output.trim().split("\n")[0], 10);
    return isNaN(pid) ? null : pid;
  } catch {
    return null;
  }
}

/**
 * Poll until the proxy is listening or the timeout is reached.
 * Returns true if the proxy became ready, false on timeout.
 */
export async function waitForProxy(
  port: number,
  maxAttempts = WAIT_FOR_PROXY_MAX_ATTEMPTS,
  intervalMs = WAIT_FOR_PROXY_INTERVAL_MS,
  tls = false
): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    if (await isProxyRunning(port, tls)) {
      return true;
    }
  }
  return false;
}

/** Escape a string for safe inclusion in a single-quoted shell argument. */
function shellEscape(arg: string): string {
  return `'${arg.replace(/'/g, "'\\''")}'`;
}

/**
 * Walk up from `cwd` to the filesystem root, collecting all
 * `node_modules/.bin` directories that exist. Returns them in
 * nearest-first order so the closest binaries take priority.
 */
function collectBinPaths(cwd: string): string[] {
  const dirs: string[] = [];
  let dir = cwd;
  for (;;) {
    const bin = path.join(dir, "node_modules", ".bin");
    if (fs.existsSync(bin)) {
      dirs.push(bin);
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return dirs;
}

/**
 * Build a PATH string with `node_modules/.bin` directories prepended.
 */
export function augmentedPath(env: NodeJS.ProcessEnv | undefined, cwd?: string): string {
  const source = env ?? process.env;
  // On Windows, the PATH variable may be stored as "Path" (case-insensitive in
  // process.env but case-sensitive in plain objects created via spread).
  const base = source.PATH ?? source.Path ?? "";
  const bins = collectBinPaths(cwd ?? process.cwd());
  // Windows .cmd wrappers in node_modules/.bin need node.exe to be discoverable.
  // On Unix, do not shadow the user's version-manager-selected Node binary.
  if (isWindows) {
    bins.push(path.dirname(process.execPath));
  }
  return bins.join(path.delimiter) + path.delimiter + base;
}

export function resolveWindowsExecutable(cmd: string, pathStr: string): string | null {
  if (path.isAbsolute(cmd) || cmd.includes("\\") || cmd.includes("/")) {
    return fs.existsSync(cmd) ? path.resolve(cmd) : null;
  }

  const pathext = process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD";
  const exts = pathext
    .split(";")
    .map((ext) => ext.toLowerCase())
    .filter(Boolean);

  for (const dir of pathStr.split(path.delimiter)) {
    if (!dir) continue;

    const literal = path.join(dir, cmd);
    if (fs.existsSync(literal)) return literal;

    for (const ext of exts) {
      const candidate = path.join(dir, cmd + ext);
      if (fs.existsSync(candidate)) return candidate;
    }
  }

  return null;
}

/** cmd.exe metacharacters that require caret-escaping. */
const CMD_META_CHARS = /([()\][%!^"\x60<>&|;, *?])/g;

/**
 * Arguments matching this need no escaping for cmd.exe: non-empty, no
 * whitespace, no quotes, and no cmd metacharacters. `=` is deliberately
 * allowed, because cmd only treats it specially in the command token, not in
 * arguments.
 */
const CMD_SAFE_ARG = /^[^\s()\][%!^"\x60<>&|;,*?]+$/;

/**
 * Quote a string per Windows argv rules in a single linear scan. A quote
 * preceded by N backslashes becomes 2N+1 backslashes plus an escaped quote,
 * and N trailing backslashes, which precede the closing quote we append,
 * become 2N. A regex implementation can backtrack quadratically on long
 * backslash runs, so the scan stays deliberately linear.
 */
function windowsArgvQuote(arg: string): string {
  let out = "";
  let backslashes = 0;
  for (const ch of arg) {
    if (ch === "\\") {
      backslashes++;
      continue;
    }
    if (ch === '"') {
      out += "\\".repeat(2 * backslashes + 1) + '"';
    } else {
      out += "\\".repeat(backslashes) + ch;
    }
    backslashes = 0;
  }
  return '"' + out + "\\".repeat(2 * backslashes) + '"';
}

/**
 * Escape a string so cmd.exe passes it to the child as a single literal
 * argument. Safe arguments stay bare because cmd built-ins print added quotes
 * literally. Other arguments use Windows argv quoting followed by caret
 * escaping of cmd.exe metacharacters, including the quote characters.
 */
export function cmdEscape(arg: string): string {
  if (CMD_SAFE_ARG.test(arg)) return arg;
  return windowsArgvQuote(arg).replace(CMD_META_CHARS, "^$1");
}

/**
 * Escape the command token of a cmd.exe command line. Bare PATH-resolved
 * names stay unquoted so %~dp0 continues to resolve correctly in package
 * manager shims. Resolved paths containing whitespace or other command-token
 * metacharacters use plain quotes. Caret-escaping percent signs is required
 * in both forms because quotes do not suppress %VAR% expansion.
 */
export function cmdEscapeCommand(command: string): string {
  const escapedPercent = command.replace(/%/g, "^%");
  if (/[\s()\][!^"\x60<>&|;,=*?]/.test(command)) {
    return '"' + escapedPercent + '"';
  }
  return escapedPercent;
}

export interface WindowsCommandInvocation {
  command: string;
  args: string[];
  windowsVerbatimArguments?: true;
}

export function resolveWindowsCommandInvocation(
  command: string,
  args: string[],
  pathValue: string
): WindowsCommandInvocation | null {
  const resolved = resolveWindowsExecutable(command, pathValue);
  if (!resolved) return null;

  const ext = path.extname(resolved).toLowerCase();
  if (ext === ".cmd" || ext === ".bat") {
    return {
      command: "cmd.exe",
      args: [
        "/d",
        "/v:off",
        "/s",
        "/c",
        '"' + [cmdEscapeCommand(resolved), ...args.map(cmdEscape)].join(" ") + '"',
      ],
      windowsVerbatimArguments: true,
    };
  }

  return {
    command: resolved,
    args,
  };
}

/**
 * Spawn a command with proper signal forwarding, error handling, and exit
 * code propagation. Prepends node_modules/.bin to PATH so local project
 * binaries are found.
 */
export function spawnCommand(
  commandArgs: string[],
  options?: {
    env?: NodeJS.ProcessEnv;
    onCleanup?: () => void;
  }
): void {
  if (commandArgs.length === 0) {
    console.error("spawnCommand called with empty commandArgs");
    process.exit(1);
  }

  const env: Record<string, string | undefined> = {
    ...(options?.env ?? process.env),
    PATH: augmentedPath(options?.env),
  };

  // On Windows, process.env is a case-insensitive Proxy, but spreading it into
  // a plain object creates case-sensitive keys. The path variable may exist as
  // "Path" (Windows convention) alongside the "PATH" we just set above. cmd.exe
  // may read the wrong key, causing tools like bun to be missing from the child
  // process PATH. Delete any residual casing variants so only our "PATH" remains.
  if (isWindows) {
    for (const key of Object.keys(env)) {
      if (key !== "PATH" && key.toUpperCase() === "PATH") {
        delete env[key];
      }
    }
  }

  // On Unix, spawn detached so the child gets its own process group. This
  // lets us kill the entire tree (shell + grandchild dev server) with a
  // single process.kill(-pid, signal) instead of only the immediate child.
  let child: ReturnType<typeof spawn>;
  if (isWindows) {
    const resolved = resolveWindowsExecutable(commandArgs[0]!, env.PATH ?? "");
    if (resolved === null) {
      console.error(`Failed to run command: "${commandArgs[0]}" not found in PATH`);
      console.error(`Is "${commandArgs[0]}" installed and in your PATH?`);
      process.exit(1);
    }

    const ext = path.extname(resolved).toLowerCase();
    if (ext === ".cmd" || ext === ".bat") {
      const cmdline =
        '"' + [cmdEscapeCommand(resolved), ...commandArgs.slice(1).map(cmdEscape)].join(" ") + '"';
      child = spawn("cmd.exe", ["/d", "/v:off", "/s", "/c", cmdline], {
        stdio: "inherit",
        env,
        windowsVerbatimArguments: true,
      });
    } else {
      child = spawn(resolved, commandArgs.slice(1), {
        stdio: "inherit",
        env,
      });
    }
  } else {
    child = spawn("/bin/sh", ["-c", commandArgs.map(shellEscape).join(" ")], {
      stdio: "inherit",
      env,
      detached: true,
    });
  }

  let exiting = false;

  const cleanup = () => {
    process.removeListener("SIGHUP", onSigHup);
    process.removeListener("SIGINT", onSigInt);
    process.removeListener("SIGTERM", onSigTerm);
    options?.onCleanup?.();
  };

  const handleSignal = (signal: NodeJS.Signals) => {
    if (exiting) return;
    exiting = true;
    killTree(child, signal);
    cleanup();
    process.exit(128 + (SIGNAL_CODES[signal] || 15));
  };

  const onSigHup = () => handleSignal("SIGHUP");
  const onSigInt = () => handleSignal("SIGINT");
  const onSigTerm = () => handleSignal("SIGTERM");

  process.on("SIGHUP", onSigHup);
  process.on("SIGINT", onSigInt);
  process.on("SIGTERM", onSigTerm);

  child.on("error", (err) => {
    if (exiting) return;
    exiting = true;
    console.error(`Failed to run command: ${err.message}`);
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      console.error(`Is "${commandArgs[0]}" installed and in your PATH?`);
    }
    cleanup();
    process.exit(1);
  });

  child.on("exit", (code, signal) => {
    if (exiting) return;
    exiting = true;
    cleanup();
    if (signal) {
      process.exit(128 + (SIGNAL_CODES[signal] || 15));
    }
    process.exit(code ?? 1);
  });
}

// ---------------------------------------------------------------------------
// Framework-aware flag injection
// ---------------------------------------------------------------------------

/**
 * Frameworks that ignore the `PORT` env var. `serverSubcommands` lists the
 * subcommands that accept the injected flags, while `defaultIsServer` marks a
 * bare invocation that starts a server. Unknown commands are left untouched
 * because framework CLIs commonly reject server flags on build and inspection
 * commands.
 */
type FrameworkSpec = {
  strictPort: boolean;
  hostFlag?: string;
  serverSubcommands: string[];
  nonServerSubcommands?: string[];
  defaultIsServer: boolean;
  positionalRootIsServer?: boolean;
  valueFlags?: string[];
};

const FRAMEWORKS_NEEDING_PORT: Record<string, FrameworkSpec> = {
  vite: {
    strictPort: true,
    serverSubcommands: ["dev", "serve", "preview"],
    nonServerSubcommands: ["build", "optimize"],
    defaultIsServer: true,
    positionalRootIsServer: true,
    valueFlags: [
      "--assetsDir",
      "--assetsInlineLimit",
      "--base",
      "--configLoader",
      "--host",
      "--manifest",
      "--minify",
      "--open",
      "--outDir",
      "--port",
      "--sourcemap",
      "--ssr",
      "--ssrManifest",
      "--target",
      "-c",
      "--config",
      "-d",
      "--debug",
      "-f",
      "--filter",
      "-l",
      "--logLevel",
      "-m",
      "--mode",
    ],
  },
  vp: { strictPort: true, serverSubcommands: ["dev"], defaultIsServer: false },
  vitepress: {
    strictPort: true,
    serverSubcommands: ["dev", "preview"],
    defaultIsServer: false,
  },
  "react-router": { strictPort: true, serverSubcommands: ["dev"], defaultIsServer: false },
  rsbuild: {
    strictPort: false,
    serverSubcommands: ["dev", "preview"],
    defaultIsServer: true,
    valueFlags: [
      "--base",
      "--config-loader",
      "--dist-path",
      "--env-dir",
      "--env-mode",
      "--environment",
      "--host",
      "--log-level",
      "--output",
      "--port",
      "-c",
      "--config",
      "-m",
      "--mode",
      "-o",
      "--open",
      "-r",
      "--root",
    ],
  },
  astro: { strictPort: false, serverSubcommands: ["dev", "preview"], defaultIsServer: false },
  ng: {
    strictPort: false,
    serverSubcommands: ["serve", "dev", "s"],
    defaultIsServer: false,
  },
  "laravel-artisan": {
    strictPort: false,
    serverSubcommands: [],
    defaultIsServer: true,
  },
  "react-native": { strictPort: false, serverSubcommands: ["start"], defaultIsServer: false },
  expo: {
    strictPort: false,
    serverSubcommands: ["start", "serve"],
    defaultIsServer: true,
  },
  wrangler: {
    strictPort: false,
    hostFlag: "--ip",
    serverSubcommands: ["dev"],
    defaultIsServer: false,
  },
};

type PackageRunnerSpec = {
  subcommands: string[];
  valueFlags?: string[];
};

/** Known package runners. Values list subcommands that run a package. */
const PACKAGE_RUNNERS: Record<string, PackageRunnerSpec> = {
  npm: { subcommands: ["exec"], valueFlags: ["-p", "--package"] },
  npx: {
    subcommands: [],
    valueFlags: ["-c", "--call", "-p", "--package", "-w", "--workspace", "--allow-scripts"],
  },
  bunx: { subcommands: [] },
  // `bun <bin>` and `bun run <bin>` can both execute framework CLIs.
  bun: { subcommands: ["run"] },
  pnpx: { subcommands: [], valueFlags: ["-p", "--package"] },
  yarn: { subcommands: ["dlx", "exec"] },
  pnpm: { subcommands: ["dlx", "exec"] },
};

type FrameworkInvocation = {
  basename: string;
  framework: FrameworkSpec;
  frameworkIndex: number;
  frameworkArgs: string[];
  insertionIndex: number;
};

/**
 * Find the framework command inside `commandArgs`, looking past known package
 * runners and preserving the insertion point before a framework `--` marker.
 */
function parseFrameworkInvocation(commandArgs: string[]): FrameworkInvocation | null {
  if (commandArgs.length === 0) return null;

  const first = path.basename(commandArgs[0]);
  if (
    first === "php" &&
    path.basename(commandArgs[1] ?? "") === "artisan" &&
    commandArgs[2] === "serve"
  ) {
    const framework = FRAMEWORKS_NEEDING_PORT["laravel-artisan"]!;
    const frameworkIndex = 2;
    const optionEnd = commandArgs.indexOf("--", frameworkIndex + 1);
    const insertionIndex = optionEnd === -1 ? commandArgs.length : optionEnd;
    return {
      basename: "laravel-artisan",
      framework,
      frameworkIndex,
      frameworkArgs: commandArgs.slice(frameworkIndex + 1, insertionIndex),
      insertionIndex,
    };
  }

  let frameworkIndex: number | null = FRAMEWORKS_NEEDING_PORT[first] ? 0 : null;

  if (frameworkIndex === null) {
    const runner = PACKAGE_RUNNERS[first];
    if (!runner) return null;

    let i = 1;
    const skipRunnerOptions = () => {
      while (i < commandArgs.length && commandArgs[i]!.startsWith("-")) {
        const option = commandArgs[i]!;
        i++;
        if (option === "--") break;
        if (!option.includes("=") && runner.valueFlags?.includes(option)) i++;
      }
    };

    if (runner.subcommands.length > 0) {
      skipRunnerOptions();
      if (i >= commandArgs.length) return null;
      if (!runner.subcommands.includes(commandArgs[i]!)) {
        const name = path.basename(commandArgs[i]!);
        frameworkIndex = FRAMEWORKS_NEEDING_PORT[name] ? i : null;
      } else {
        i++;
      }
    }

    if (frameworkIndex === null) {
      skipRunnerOptions();
      if (i >= commandArgs.length) return null;
      const name = path.basename(commandArgs[i]!);
      frameworkIndex = FRAMEWORKS_NEEDING_PORT[name] ? i : null;
    }
  }

  if (frameworkIndex === null) return null;
  const basename = path.basename(commandArgs[frameworkIndex]!);
  const framework = FRAMEWORKS_NEEDING_PORT[basename];
  if (!framework) return null;
  const optionEnd = commandArgs.indexOf("--", frameworkIndex + 1);
  const insertionIndex = optionEnd === -1 ? commandArgs.length : optionEnd;
  return {
    basename,
    framework,
    frameworkIndex,
    frameworkArgs: commandArgs.slice(frameworkIndex + 1, insertionIndex),
    insertionIndex,
  };
}

function findFrameworkBasename(commandArgs: string[]): string | null {
  return parseFrameworkInvocation(commandArgs)?.basename ?? null;
}

/**
 * Return framework positionals while consuming known flag values. This keeps
 * a value such as `production` from being mistaken for a build subcommand.
 */
function frameworkPositionals(args: string[], framework: FrameworkSpec): string[] | null {
  const positionals: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--") break;
    if (!arg.startsWith("-")) {
      positionals.push(arg);
      continue;
    }
    if (arg.includes("=")) continue;
    if (framework.valueFlags?.includes(arg)) {
      i++;
      continue;
    }
    if (!framework.valueFlags && positionals.length === 0) return null;
  }

  return positionals;
}

function invokesFrameworkServer(frameworkArgs: string[], framework: FrameworkSpec): boolean {
  const positionals = frameworkPositionals(frameworkArgs, framework);
  if (positionals === null) return false;

  const [subcommand] = positionals;
  if (subcommand === undefined) return framework.defaultIsServer;
  if (framework.serverSubcommands.includes(subcommand)) return true;
  if (framework.nonServerSubcommands?.includes(subcommand)) return false;
  return framework.positionalRootIsServer === true;
}

const PLACEHOLDERS = ["{PORT}", "{HOST}", "{PORTLESS_URL}"] as const;

type PlaceholderVars = {
  PORT: string;
  HOST: string;
  PORTLESS_URL: string;
};

export function hasPlaceholders(commandArgs: string[]): boolean {
  return commandArgs.some((arg) => (PLACEHOLDERS as readonly string[]).includes(arg));
}

export function replacePlaceholders(commandArgs: string[], vars: PlaceholderVars): void {
  const replacements: Record<string, string> = {
    "{PORT}": vars.PORT,
    "{HOST}": vars.HOST,
    "{PORTLESS_URL}": vars.PORTLESS_URL,
  };

  for (let i = 0; i < commandArgs.length; i++) {
    const replacement = replacements[commandArgs[i]];
    if (replacement !== undefined) {
      commandArgs[i] = replacement;
    }
  }
}

/**
 * Check if `commandArgs` invokes a framework that ignores `PORT` and, if so,
 * mutate the array in-place to append the correct CLI flags so the app
 * listens on the expected port and address.
 *
 * Handles both direct invocation (`vite dev`) and invocation via package
 * runners (`bunx --bun vite dev`, `npx vite dev`, `yarn dlx vite dev`).
 *
 * The portless proxy connects to 127.0.0.1 (IPv4), so we also inject
 * `--host 127.0.0.1` to prevent frameworks from binding to IPv6 `::1`.
 *
 * Note: Expo's `--host` flag is *not* a bind address (it is a connection mode:
 * lan|tunnel|localhost). In LAN mode we skip `--host` entirely — Expo defaults
 * to LAN already and injecting the flag alongside HOST=127.0.0.1 causes Metro's
 * HMR WebSocket to degrade. Outside LAN mode, `--host localhost` keeps the
 * server local.
 */
export function injectFrameworkFlags(commandArgs: string[], port: number): string[] {
  const invocation = parseFrameworkInvocation(commandArgs);
  if (!invocation) return [];
  const { basename, framework, frameworkArgs, insertionIndex } = invocation;

  if (!invokesFrameworkServer(frameworkArgs, framework)) return [];

  const flags: string[] = [];
  if (!hasCliOption(frameworkArgs, "--port")) {
    flags.push("--port", port.toString());
    if (framework.strictPort) flags.push("--strictPort");
  }

  const hostFlag = framework.hostFlag ?? "--host";
  const hasHostChoice =
    hasCliOption(frameworkArgs, hostFlag) ||
    (basename === "expo" &&
      ["--localhost", "--lan", "--tunnel"].some((option) => hasCliOption(frameworkArgs, option)));
  if (!hasHostChoice) {
    const isExpoLan = basename === "expo" && isLanEnvEnabled();
    if (!isExpoLan) {
      flags.push(hostFlag, basename === "expo" ? "localhost" : "127.0.0.1");
    }
  }

  commandArgs.splice(insertionIndex, 0, ...flags);
  return flags;
}

/** Package managers whose `run` command delegates to package.json scripts. */
const PACKAGE_SCRIPT_MANAGERS = new Set(["bun", "npm", "pnpm", "yarn"]);

/**
 * Return true when shell syntax means flags appended to the raw script would
 * be sent to a different command or discarded by the shell.
 */
function isUnsafeToAppendArgs(command: string): boolean {
  let inSingle = false;
  let inDouble = false;
  let escaped = false;
  let atWordStart = true;
  const chars = Array.from(command);

  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i]!;
    if (escaped) {
      escaped = false;
      if (ch === "\n" || ch === "\r") continue;
      atWordStart = false;
      continue;
    }
    if (ch === "\\" && !inSingle) {
      escaped = true;
      continue;
    }
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      atWordStart = false;
      continue;
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      atWordStart = false;
      continue;
    }
    if (inSingle || inDouble) continue;

    if (ch === ";" || ch === "\n" || ch === "\r" || ch === "|") return true;
    if (ch === "#" && atWordStart) return true;
    if (ch === "&") {
      const prev = chars[i - 1];
      const next = chars[i + 1];
      if (prev === ">" && next !== undefined && /[0-9-]/.test(next)) continue;
      return true;
    }
    atWordStart = ch === " " || ch === "\t";
  }
  return false;
}

function hasCliOption(args: string[], option: string): boolean {
  return args.some((arg) => arg === option || arg.startsWith(`${option}=`));
}

function resolvePackageScriptTokens(commandArgs: string[], packageDir: string): string[] | null {
  if (commandArgs.length < 3) return null;

  const runner = path.basename(commandArgs[0]!);
  if (!PACKAGE_SCRIPT_MANAGERS.has(runner)) return null;

  const [, runSubcommand, scriptName] = commandArgs;
  if (runSubcommand !== "run" || !scriptName || scriptName.startsWith("-")) return null;

  return resolveScript(scriptName, packageDir);
}

function isSafeToInjectIntoScript(
  scriptName: string,
  rawScript: string[],
  packageDir: string
): boolean {
  const rawScriptText = resolveScriptRaw(scriptName, packageDir);
  if (rawScriptText && isUnsafeToAppendArgs(rawScriptText)) return false;
  if (rawScript.includes("--")) return false;
  return true;
}

/**
 * Resolve the framework reached by a direct command, package runner, or one
 * package-manager script indirection. This identity is intentionally separate
 * from append safety so Expo's LAN environment carve-out still works when a
 * script is deliberately left untouched.
 */
export function resolveFrameworkBasename(
  commandArgs: string[],
  packageDir: string = process.cwd()
): string | null {
  const direct = findFrameworkBasename(commandArgs);
  if (direct) return direct;
  const scriptTokens = resolvePackageScriptTokens(commandArgs, packageDir);
  return scriptTokens ? findFrameworkBasename(scriptTokens) : null;
}

/**
 * Forward framework flags through `<pm> run <script>` without changing the
 * package manager's Windows spawn path. npm needs `--` before script args;
 * Bun, pnpm, and yarn forward the appended args directly.
 */
export function injectPackageScriptFrameworkFlags(
  commandArgs: string[],
  port: number,
  packageDir: string = process.cwd()
): void {
  const rawScript = resolvePackageScriptTokens(commandArgs, packageDir);
  if (!rawScript) return;
  const [, , scriptName] = commandArgs;
  if (!scriptName || !isSafeToInjectIntoScript(scriptName, rawScript, packageDir)) return;

  const userExtras = commandArgs.slice(3).filter((arg) => arg !== "--");
  const probe = [...rawScript, ...userExtras];
  const forwardedFlags = injectFrameworkFlags(probe, port);
  if (forwardedFlags.length === 0) return;

  if (path.basename(commandArgs[0]!) === "npm" && !commandArgs.includes("--")) {
    commandArgs.push("--");
  }
  commandArgs.push(...forwardedFlags);
}

/**
 * Prompt the user for input via readline. Returns empty string if stdin closes.
 */
export function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.on("close", () => resolve(""));
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}
