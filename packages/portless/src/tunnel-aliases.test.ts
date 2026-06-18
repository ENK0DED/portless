import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TunnelAliasStore, normalizeTunnelHostname } from "./tunnel-aliases.js";

describe("TunnelAliasStore", () => {
  let tmpDir: string;
  let store: TunnelAliasStore;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "portless-tunnel-aliases-"));
    store = new TunnelAliasStore(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns an empty list when no alias file exists", () => {
    expect(store.loadAliases()).toEqual([]);
  });

  it("persists and updates exact tunnel aliases", () => {
    store.setAlias({
      externalHostname: "Public.Example.com",
      targetHostname: "myapp.localhost",
    });
    store.setAlias({
      externalHostname: "public.example.com",
      targetHostname: "api.localhost",
      targetPathPrefix: "/v1",
    });

    expect(store.loadAliases()).toEqual([
      {
        externalHostname: "public.example.com",
        targetHostname: "api.localhost",
        targetPathPrefix: "/v1",
      },
    ]);
  });

  it("removes aliases by external hostname", () => {
    store.setAlias({
      externalHostname: "public.example.com",
      targetHostname: "myapp.localhost",
    });

    expect(store.removeAlias("public.example.com")).toBe(true);
    expect(store.removeAlias("public.example.com")).toBe(false);
    expect(store.loadAliases()).toEqual([]);
  });

  it("rejects invalid external hostnames", () => {
    for (const value of [
      "",
      "https://public.example.com",
      "public.example.com/path",
      "*.example.com",
      "bad host.example",
      "public.example.com:443",
      "public\n.example.com",
    ]) {
      expect(() => normalizeTunnelHostname(value)).toThrow("Invalid tunnel hostname");
    }
  });

  it("removes managed aliases for stale owner pids", () => {
    store.setAlias({
      externalHostname: "public.example.com",
      targetHostname: "myapp.localhost",
      managed: true,
      routeOwnerPid: 123456789,
      tunnelPid: 123456790,
      provider: "cloudflare",
      url: "https://public.example.com",
    });
    store.setAlias({
      externalHostname: "manual.example.com",
      targetHostname: "myapp.localhost",
    });

    const stale = store.pruneManagedAliases();

    expect(stale).toHaveLength(1);
    expect(stale[0].externalHostname).toBe("public.example.com");
    expect(store.loadAliases()).toEqual([
      {
        externalHostname: "manual.example.com",
        targetHostname: "myapp.localhost",
        targetPathPrefix: "/",
      },
    ]);
  });
});
