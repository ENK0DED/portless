import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

type UserHomeOptions = {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  homedir?: string;
  passwdHome?: (username: string) => string | null;
};

function readPasswdHome(username: string): string | null {
  try {
    const passwd = fs.readFileSync("/etc/passwd", "utf-8");
    for (const line of passwd.split("\n")) {
      const fields = line.split(":");
      if (fields[0] === username && fields[5]) return fields[5];
    }
  } catch {
    // Fall back to the platform's conventional home directory.
  }
  return null;
}

/**
 * Resolve the home directory that owns portless state. When sudo changes the
 * effective user to root, retain the invoking user's home so elevated proxy
 * processes and unprivileged app processes share the same route store.
 */
export function resolveUserHome(options: UserHomeOptions = {}): string {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const homedir = options.homedir ?? os.homedir();

  if (platform === "win32") return env.USERPROFILE || homedir;

  const sudoUser = env.SUDO_USER;
  if (!sudoUser || sudoUser === "root") return homedir;

  const home = env.HOME;
  if (home && home !== "/root" && home !== "/var/root") return home;

  const passwdHome = (options.passwdHome ?? readPasswdHome)(sudoUser);
  if (passwdHome) return passwdHome;

  return platform === "darwin"
    ? path.posix.join("/Users", sudoUser)
    : path.posix.join("/home", sudoUser);
}

/**
 * When running under sudo, fix file ownership so the real user can
 * read/write the file later without sudo. No-op on Windows or when not
 * running as root.
 */
export function fixOwnership(...paths: string[]): void {
  if (process.platform === "win32") return;
  const uid = process.env.SUDO_UID;
  const gid = process.env.SUDO_GID;
  if (!uid || process.getuid?.() !== 0) return;
  for (const p of paths) {
    try {
      const stat = fs.lstatSync(p);
      if (stat.isSymbolicLink()) continue;
      fs.chownSync(p, parseInt(uid, 10), parseInt(gid || uid, 10));
    } catch {
      // Best-effort
    }
  }
}

/** Type guard for Node.js system errors with an error code. */
export function isErrnoException(err: unknown): err is NodeJS.ErrnoException {
  return (
    err instanceof Error &&
    "code" in err &&
    typeof (err as Record<string, unknown>).code === "string"
  );
}

/**
 * Escape HTML special characters to prevent XSS.
 */
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function hasControlCharacters(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

export function normalizePathPrefix(value: string | undefined): string {
  if (value === undefined) return "/";
  const trimmed = value.trim();
  if (
    trimmed === "" ||
    !trimmed.startsWith("/") ||
    trimmed.includes("?") ||
    trimmed.includes("#") ||
    hasControlCharacters(trimmed)
  ) {
    throw new Error(
      `Invalid path prefix "${value}": must start with / and cannot include query strings, fragments, or control characters`
    );
  }
  return trimmed.replace(/\/+$/, "") || "/";
}

export function matchesPathPrefix(requestPath: string, prefix: string): boolean {
  const normalizedPrefix = normalizePathPrefix(prefix);
  if (normalizedPrefix === "/") return true;
  const pathname = (requestPath || "/").split(/[?#]/, 1)[0] || "/";
  return pathname === normalizedPrefix || pathname.startsWith(`${normalizedPrefix}/`);
}

/**
 * Format a URL for the given hostname. Omits the port when it matches the
 * protocol default (80 for HTTP, 443 for HTTPS). When provided, appends a
 * normalized non-root route path prefix.
 */
export function formatUrl(
  hostname: string,
  proxyPort: number,
  tls = false,
  pathPrefix?: string
): string {
  const proto = tls ? "https" : "http";
  const defaultPort = tls ? 443 : 80;
  const base =
    proxyPort === defaultPort ? `${proto}://${hostname}` : `${proto}://${hostname}:${proxyPort}`;
  const normalizedPathPrefix = normalizePathPrefix(pathPrefix);
  return normalizedPathPrefix === "/" ? base : `${base}${normalizedPathPrefix}`;
}

/**
 * Parse and normalize a hostname input for use as a subdomain of the
 * configured suffix. Strips protocol prefixes, validates characters,
 * and appends the suffix if needed.
 */
export function parseHostname(input: string, tld = "localhost"): string {
  const suffix = `.${tld}`;

  // Remove any protocol prefix
  let hostname = input
    .trim()
    .replace(/^https?:\/\//, "")
    .split("/")[0]
    .toLowerCase();

  // Backward compat: strip default .localhost suffix when switching to a custom TLD
  if (tld !== "localhost" && hostname.endsWith(".localhost")) {
    hostname = hostname.slice(0, -".localhost".length);
  }

  // Validate non-empty
  if (!hostname || hostname === suffix) {
    throw new Error("Hostname cannot be empty");
  }

  // Add TLD suffix if not present
  if (!hostname.endsWith(suffix)) {
    hostname = `${hostname}${suffix}`;
  }

  // Validate hostname characters (letters, digits, hyphens, dots)
  const name = hostname.slice(0, -suffix.length);
  if (name.includes("..")) {
    throw new Error(`Invalid hostname "${name}": consecutive dots are not allowed`);
  }
  if (!/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/.test(name)) {
    throw new Error(
      `Invalid hostname "${name}": must contain only lowercase letters, digits, hyphens, and dots`
    );
  }

  // Validate per-label length (RFC 1035: max 63 characters per label)
  const labels = name.split(".");
  for (const label of labels) {
    if (label.length > 63) {
      throw new Error(
        `Invalid hostname "${name}": label "${label}" exceeds 63-character DNS limit`
      );
    }
  }

  if (hostname.length > 253) {
    throw new Error(`Invalid hostname "${hostname}": exceeds 253-character DNS limit`);
  }

  return hostname;
}

/**
 * Parse a hostname input for every configured TLD. If the input already ends
 * with one of those TLDs, use the stripped base name for the full set.
 */
export function parseHostnames(input: string, tlds: readonly string[] = ["localhost"]): string[] {
  const uniqueTlds = [...new Set(tlds)];
  let baseInput = input
    .trim()
    .replace(/^https?:\/\//, "")
    .split("/")[0]
    .toLowerCase();

  for (const tld of [...uniqueTlds].sort((a, b) => b.length - a.length)) {
    const suffix = `.${tld}`;
    if (baseInput.endsWith(suffix)) {
      baseInput = baseInput.slice(0, -suffix.length);
      break;
    }
  }

  // Skip a TLD that fails for TLD-specific reasons (e.g. app.TLD exceeds the
  // 253-char DNS limit) instead of losing the valid TLDs in the same list.
  // Throw only when no TLD survives, so input-wide errors still surface.
  const hostnames: string[] = [];
  const skipped: string[] = [];
  let firstError: unknown;
  for (const tld of uniqueTlds) {
    try {
      hostnames.push(parseHostname(baseInput, tld));
    } catch (err) {
      firstError ??= err;
      skipped.push(`"${tld}": ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (hostnames.length === 0) throw firstError;
  for (const detail of skipped) {
    console.warn(`Warning: skipping TLD ${detail}`);
  }
  return hostnames;
}
