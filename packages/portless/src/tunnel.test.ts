import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildCloudflareTunnelArgs,
  extractCloudflareTunnelUrl,
  getTunnelProvider,
  startCloudflareTunnel,
  type TunnelChildProcess,
  type TunnelSpawner,
} from "./tunnel.js";

class MockTunnelChild extends EventEmitter {
  pid = 23456;
  stdout = new PassThrough();
  stderr = new PassThrough();
  killedWith: NodeJS.Signals | undefined;

  kill(signal?: NodeJS.Signals): boolean {
    this.killedWith = signal;
    return true;
  }
}

describe("tunnel providers", () => {
  const dir = mkdtempSync(join(tmpdir(), "portless-tunnel-"));
  const configPath = join(dir, "cloudflared.yml");
  afterEach(() => {
    rmSync(configPath, { force: true });
  });
  it("selects known providers and rejects unknown providers", () => {
    expect(getTunnelProvider("ngrok").name).toBe("ngrok");
    expect(getTunnelProvider("cloudflare").name).toBe("cloudflare");
    expect(() => getTunnelProvider("localtunnel")).toThrow("Unknown tunnel provider");
  });

  it("builds structured Cloudflare quick tunnel arguments", () => {
    expect(buildCloudflareTunnelArgs(443, "app.localhost", configPath)).toEqual([
      "tunnel",
      "--no-autoupdate",
      "--grace-period",
      "1s",
      "--config",
      configPath,
      "--url",
      "http://127.0.0.1:443",
      "--http-host-header",
      "app.localhost",
    ]);
  });

  it("extracts Cloudflare quick tunnel URLs", () => {
    expect(
      extractCloudflareTunnelUrl(
        "Your quick Tunnel has been created! Visit https://abc.trycloudflare.com\nRegistered tunnel connection"
      )
    ).toBe("https://abc.trycloudflare.com");
    expect(extractCloudflareTunnelUrl("Docs: https://developers.cloudflare.com")).toBeNull();
  });

  it("spawns cloudflared without a shell string and resolves the generated URL", async () => {
    const child = new MockTunnelChild();
    const calls: Array<{ command: string; args: string[] }> = [];
    const spawner: TunnelSpawner = (command, args) => {
      calls.push({ command, args });
      return child as unknown as TunnelChildProcess;
    };

    const promise = startCloudflareTunnel(8080, {
      spawner,
      timeoutMs: 1000,
      hostHeader: "app.localhost",
      configPath,
    });

    child.stdout.write("Visit https://abc.trycloudflare.com\nRegistered tunnel connection\n");

    await expect(promise).resolves.toMatchObject({
      provider: "cloudflare",
      url: "https://abc.trycloudflare.com",
      hostname: "abc.trycloudflare.com",
      pid: 23456,
    });
    expect(calls).toEqual([
      {
        command: "cloudflared",
        args: buildCloudflareTunnelArgs(8080, "app.localhost", configPath),
      },
    ]);
  });

  it("throws an install hint when cloudflared is missing", async () => {
    const error = Object.assign(new Error("spawn cloudflared ENOENT"), { code: "ENOENT" });
    const spawner: TunnelSpawner = () => {
      throw error;
    };

    await expect(startCloudflareTunnel(8080, { spawner, configPath })).rejects.toThrow(
      "cloudflared CLI not found"
    );
  });
  it("waits for a registered connection and isolates user Cloudflare config", async () => {
    const child = new MockTunnelChild();
    const resolved = vi.fn();
    const promise = startCloudflareTunnel(8080, { configPath, spawner: () => child }).then(
      resolved
    );
    expect(readFileSync(configPath, "utf-8")).toBe("{}");
    child.stdout.write("https://ready.trycloudflare.com\n");
    await Promise.resolve();
    expect(resolved).not.toHaveBeenCalled();
    child.stderr.write("Registered tunnel connection\n");
    await promise;
    expect(resolved).toHaveBeenCalledOnce();
    expect(
      extractCloudflareTunnelUrl("https://api.trycloudflare.com Registered tunnel connection")
    ).toBeNull();
  });
  it("reports ERR lines rather than incidental Cloudflare output", async () => {
    const child = new MockTunnelChild();
    const promise = startCloudflareTunnel(8080, { configPath, spawner: () => child });
    child.stderr.write("info noise\n2026 ERR cannot connect\n");
    child.emit("exit", 1, null);
    await expect(promise).rejects.toThrow(
      "Failed to start Cloudflare tunnel: 2026 ERR cannot connect (exit 1)"
    );
  });
  it("rewrites ngrok Host and retains stable hostname options through the shared runner", async () => {
    const child = new MockTunnelChild();
    const spawner = vi.fn(() => child);
    const promise = getTunnelProvider("ngrok").start(4567, {
      hostHeader: "app.localhost",
      hostname: "public.example.com",
      spawner,
    });
    child.stdout.write("started tunnel url=https://public.example.com\n");
    await promise;
    expect(spawner).toHaveBeenCalledWith(
      "ngrok",
      expect.arrayContaining([
        "--host-header=app.localhost",
        "--domain=public.example.com",
        "http://127.0.0.1:4567",
      ])
    );
  });
});
