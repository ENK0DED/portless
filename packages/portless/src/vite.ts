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

export function formatViteAllowedHosts(
  tlds: readonly string[],
  routes: readonly RouteMapping[] = []
): string {
  const allowedHosts = new Set<string>();
  for (const configuredTld of tlds) {
    allowedHosts.add(`.${configuredTld}`);
  }

  for (const route of routes) {
    for (const field of sharingUrlFields) {
      const value = route[field];
      if (typeof value !== "string") continue;
      const hostname = parseHostname(value);
      if (hostname) allowedHosts.add(hostname);
    }
  }

  return Array.from(allowedHosts).join(",");
}
