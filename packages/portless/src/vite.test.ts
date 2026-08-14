import { describe, expect, it } from "vitest";
import type { RouteMapping } from "./routes.js";
import { formatViteAllowedHosts } from "./vite.js";

function route(metadata: Partial<RouteMapping> = {}): RouteMapping {
  return {
    hostname: "app.localhost",
    port: 4173,
    pid: 1234,
    ...metadata,
  };
}

describe("formatViteAllowedHosts", () => {
  it("keeps only suffix hosts when no sharing route is persisted", () => {
    expect(formatViteAllowedHosts(["localhost"], [])).toBe(".localhost");
  });

  it("adds exact lowercase hosts for every persisted sharing URL", () => {
    const hosts = formatViteAllowedHosts(
      ["localhost"],
      [
        route({
          tailscaleUrl: "HTTPS://Node.Example.TS.NET:443",
          tailscaleServiceUrl: "https://Service.Example.TS.NET/",
          ngrokUrl: "https://Public.Ngrok.App/",
          tunnelUrl: "https://Tunnel.TryCloudflare.Com/",
          tunnelExternalHostname: "Alias.Example.Com",
          netbirdUrl: "https://Peer.Netbird.Cloud/",
        }),
      ]
    );

    expect(hosts.split(",")).toEqual([
      ".localhost",
      "node.example.ts.net",
      "service.example.ts.net",
      "public.ngrok.app",
      "tunnel.trycloudflare.com",
      "alias.example.com",
      "peer.netbird.cloud",
    ]);
    const entries = hosts.split(",");
    expect(entries).not.toContain(".ts.net");
    expect(entries).not.toContain(".node.example.ts.net");
  });

  it("refreshes the exact host when persisted sharing metadata changes", () => {
    const before = formatViteAllowedHosts(
      ["localhost"],
      [route({ tunnelUrl: "https://old.trycloudflare.com" })]
    );
    const after = formatViteAllowedHosts(
      ["localhost"],
      [route({ tunnelUrl: "https://new.trycloudflare.com" })]
    );

    expect(before).toContain("old.trycloudflare.com");
    expect(before).not.toContain("new.trycloudflare.com");
    expect(after).toContain("new.trycloudflare.com");
    expect(after).not.toContain("old.trycloudflare.com");
  });
});
