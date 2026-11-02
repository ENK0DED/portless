import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { RouteMapping } from "./routes.js";
import {
  formatViteAllowedHosts,
  resolveViteVersion,
  viteSupportsAllowedHostsList,
} from "./vite.js";

function route(metadata: Partial<RouteMapping> = {}): RouteMapping {
  return {
    hostname: "app.localhost",
    port: 4173,
    pid: 1234,
    ...metadata,
  };
}

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "portless-vite-")));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

/** Create an app directory whose `node_modules/vite` reports `version`. */
function appWithVite(version: string | null): string {
  const appDir = path.join(tmpDir, "app");
  fs.mkdirSync(appDir, { recursive: true });
  if (version !== null) {
    const viteDir = path.join(appDir, "node_modules", "vite");
    fs.mkdirSync(viteDir, { recursive: true });
    fs.writeFileSync(
      path.join(viteDir, "package.json"),
      JSON.stringify({ name: "vite", version, exports: { "./package.json": "./package.json" } })
    );
  }
  return appDir;
}

const allShareRoute = route({
  tailscaleUrl: "HTTPS://Node.Example.TS.NET:443",
  tailscaleServiceUrl: "https://Service.Example.TS.NET/",
  ngrokUrl: "https://Public.Ngrok.App/",
  tunnelUrl: "https://Tunnel.TryCloudflare.Com/",
  tunnelExternalHostname: "Alias.Example.Com",
  netbirdUrl: "https://Peer.Netbird.Cloud/",
});

describe("viteSupportsAllowedHostsList", () => {
  it.each([
    ["8.1.0", true],
    ["8.1.3", true],
    ["8.3.5", true],
    ["9.0.0", true],
    ["8.0.16", false],
    ["8.0.0", false],
    ["7.3.7", false],
    ["6.4.1", false],
    ["8.1.0-beta.0", false],
    ["8.1.1-beta.0", true],
    ["not-a-version", false],
    [undefined, false],
  ])("treats %s as %s", (version, expected) => {
    expect(viteSupportsAllowedHostsList(version)).toBe(expected);
  });
});

describe("resolveViteVersion", () => {
  it("reads the version from the app's node_modules", () => {
    expect(resolveViteVersion(appWithVite("7.3.7"))).toBe("7.3.7");
  });

  it("finds a hoisted Vite above the app directory", () => {
    const appDir = appWithVite(null);
    const hoisted = path.join(tmpDir, "node_modules", "vite");
    fs.mkdirSync(hoisted, { recursive: true });
    fs.writeFileSync(path.join(hoisted, "package.json"), JSON.stringify({ version: "8.2.0" }));
    expect(resolveViteVersion(appDir)).toBe("8.2.0");
  });

  it("returns undefined when Vite cannot be resolved", () => {
    expect(resolveViteVersion(appWithVite(null))).toBeUndefined();
  });
});

describe("formatViteAllowedHosts", () => {
  it("passes nothing extra when only intrinsic localhost suffixes are configured", () => {
    expect(formatViteAllowedHosts(["localhost"], [])).toBe("");
    expect(formatViteAllowedHosts(["localhost", "dev.localhost"], [])).toBe("");
  });

  it("keeps a custom suffix when no sharing route is persisted", () => {
    expect(formatViteAllowedHosts(["test"], [])).toBe(".test");
  });

  it("emits a single working host for the default suffix plus one sharing host on any Vite", () => {
    const notices: string[] = [];
    for (const version of ["7.3.7", "8.0.16", "8.1.0", null]) {
      const hosts = formatViteAllowedHosts(
        ["localhost"],
        [route({ tailscaleUrl: "https://node.example.ts.net" })],
        { packageDir: appWithVite(version), onNotice: (message) => notices.push(message) }
      );
      expect(hosts).toBe("node.example.ts.net");
      fs.rmSync(path.join(tmpDir, "app"), { recursive: true, force: true });
    }
    expect(notices).toEqual([]);
  });

  it("adds exact lowercase hosts for every persisted sharing URL on Vite 8.1 and later", () => {
    const hosts = formatViteAllowedHosts(["localhost"], [allShareRoute], {
      packageDir: appWithVite("8.1.0"),
    });

    expect(hosts.split(",")).toEqual([
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

  it("keeps non-intrinsic suffixes beside sharing hosts on Vite 8.1 and later", () => {
    const hosts = formatViteAllowedHosts(
      ["localhost", "test"],
      [route({ tunnelUrl: "https://tunnel.trycloudflare.com" })],
      { packageDir: appWithVite("8.3.5") }
    );
    expect(hosts).toBe(".test,tunnel.trycloudflare.com");
  });

  describe("on Vite older than 8.1 or an unknown version", () => {
    it.each([["7.3.7"], ["8.0.16"], [null]])(
      "passes one prioritized host and a notice (Vite %s)",
      (version) => {
        const notices: string[] = [];
        const hosts = formatViteAllowedHosts(["localhost", "test"], [allShareRoute], {
          packageDir: appWithVite(version),
          onNotice: (message) => notices.push(message),
        });

        expect(hosts).toBe("node.example.ts.net");
        expect(hosts).not.toContain(",");
        expect(notices).toHaveLength(1);
        expect(notices[0]).toContain("only node.example.ts.net is passed");
        expect(notices[0]).toContain(".test");
        expect(notices[0]).toContain("peer.netbird.cloud");
        expect(notices[0]).toContain("server.allowedHosts");
        fs.rmSync(path.join(tmpDir, "app"), { recursive: true, force: true });
      }
    );

    it("prefers a sharing hostname over a suffix", () => {
      const hosts = formatViteAllowedHosts(
        ["test"],
        [route({ ngrokUrl: "https://public.ngrok.app" })],
        { packageDir: appWithVite("7.3.7") }
      );
      expect(hosts).toBe("public.ngrok.app");
    });

    it("falls back to the first suffix when several suffixes and no sharing host remain", () => {
      const notices: string[] = [];
      const hosts = formatViteAllowedHosts(["test", "example.com"], [], {
        packageDir: appWithVite("8.0.16"),
        onNotice: (message) => notices.push(message),
      });
      expect(hosts).toBe(".test");
      expect(notices[0]).toContain(".example.com");
    });

    it("stays quiet when the list has a single entry", () => {
      const notices: string[] = [];
      expect(
        formatViteAllowedHosts(["test"], [], {
          packageDir: appWithVite("7.3.7"),
          onNotice: (message) => notices.push(message),
        })
      ).toBe(".test");
      expect(notices).toEqual([]);
    });
  });

  it("drops entries Vite 8.1 would reject wholesale", () => {
    const hosts = formatViteAllowedHosts(['bad"suffix', "ok"], [], {
      packageDir: appWithVite("8.1.0"),
    });
    expect(hosts).toBe(".ok");
    expect(formatViteAllowedHosts(["it's", "back\\slash"], [])).toBe("");
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
