import { createRequire } from "node:module";
import * as fs from "node:fs";
import * as path from "node:path";
import type { RouteMapping } from "./routes.js";

const sharingUrlFields = [
  "tailscaleUrl",
  "tailscaleServiceUrl",
  "ngrokUrl",
  "tunnelUrl",
  "tunnelExternalHostname",
  "netbirdUrl",
] as const satisfies readonly (keyof RouteMapping)[];

function parseHostname(value: string): string | undefined {
  try {
    const parsed = new URL(value.includes("://") ? value : `https://${value}`);
    const hostname = parsed.hostname.toLowerCase();
    if (!hostname || hostname.startsWith(".") || hostname.includes("*")) return undefined;
    return hostname;
  } catch {
    return undefined;
  }
}

/**
 * Vite reads `__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS` as one host before 8.1
 * and as a comma list from 8.1 on. 8.1 and later also discard the whole value
 * when any entry holds a backslash or a quote.
 */
const RESERVED_ALLOWED_HOSTS_CHARACTERS = /[\\"']/;

export type ViteAllowedHostsOptions = {
  /** Directory of the app whose Vite version decides how the list is serialized. */
  packageDir?: string;
  /** Receives a one-line notice when hosts had to be left out. */
  onNotice?: (message: string) => void;
};

/** True when `localhost` rules already allow the entry in every Vite version. */
function isIntrinsicallyAllowed(tld: string): boolean {
  return tld === "localhost" || tld.endsWith(".localhost");
}

/**
 * Read the Vite version the app at `packageDir` would load, or `undefined`
 * when Vite cannot be resolved from there.
 */
export function resolveViteVersion(packageDir: string): string | undefined {
  try {
    const manifest = createRequire(path.join(packageDir, path.sep)).resolve("vite/package.json");
    const version = (JSON.parse(fs.readFileSync(manifest, "utf-8")) as { version?: unknown })
      .version;
    return typeof version === "string" ? version : undefined;
  } catch {
    return undefined;
  }
}

/** True when this Vite version splits the env var on commas (8.1.0 and later). */
export function viteSupportsAllowedHostsList(version: string | undefined): boolean {
  if (!version) return false;
  const match = /^(\d+)\.(\d+)\.(\d+)(-.+)?/.exec(version);
  if (!match) return false;
  const [major, minor, patch] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const prerelease = match[4] !== undefined;
  if (major !== 8) return major > 8;
  if (minor === 1 && patch === 0 && prerelease) return false;
  return minor >= 1;
}

/**
 * Build the value for Vite's additional allowed hosts. Hosts are exact: the
 * persisted sharing hostnames plus a `.suffix` entry per configured suffix
 * Vite does not already allow (`localhost` and `*.localhost`).
 *
 * Vite older than 8.1, or an unresolvable version, reads the whole value as
 * one host, so a list would match nothing. Then one host is passed, preferring
 * a sharing hostname (a remote browser has no other way in) over a suffix, and
 * `onNotice` names what was left out.
 */
export function formatViteAllowedHosts(
  tlds: readonly string[],
  routes: readonly RouteMapping[] = [],
  options: ViteAllowedHostsOptions = {}
): string {
  const suffixHosts = new Set<string>();
  for (const configuredTld of tlds) {
    if (isIntrinsicallyAllowed(configuredTld)) continue;
    suffixHosts.add(`.${configuredTld}`);
  }

  const sharingHosts = new Set<string>();
  for (const route of routes) {
    for (const field of sharingUrlFields) {
      const value = route[field];
      if (typeof value !== "string") continue;
      const hostname = parseHostname(value);
      if (hostname) sharingHosts.add(hostname);
    }
  }

  const usable = (host: string) => !RESERVED_ALLOWED_HOSTS_CHARACTERS.test(host);
  const listed = [...suffixHosts, ...sharingHosts].filter(usable);
  if (listed.length <= 1) return listed.join(",");

  const version = resolveViteVersion(options.packageDir ?? process.cwd());
  if (viteSupportsAllowedHostsList(version)) return listed.join(",");

  const prioritized = [...sharingHosts, ...suffixHosts].filter(usable);
  const [chosen, ...left] = prioritized;
  const detail = version ? `Vite ${version}` : "This Vite version (not found, or older than 8.1)";
  options.onNotice?.(
    `${detail} reads one additional allowed host, so only ${chosen} is passed. ` +
      `Left out: ${left.join(", ")}. ` +
      "Add them to server.allowedHosts in your Vite config, or use Vite 8.1 or later."
  );
  return chosen!;
}
