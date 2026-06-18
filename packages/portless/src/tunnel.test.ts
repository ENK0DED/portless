import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
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
  it("selects known providers and rejects unknown providers", () => {
    expect(getTunnelProvider("ngrok").name).toBe("ngrok");
    expect(getTunnelProvider("cloudflare").name).toBe("cloudflare");
    expect(() => getTunnelProvider("localtunnel")).toThrow("Unknown tunnel provider");
  });

  it("builds structured Cloudflare quick tunnel arguments", () => {
    expect(buildCloudflareTunnelArgs(443)).toEqual(["tunnel", "--url", "http://127.0.0.1:443"]);
  });

  it("extracts Cloudflare quick tunnel URLs", () => {
    expect(
      extractCloudflareTunnelUrl(
        "Your quick Tunnel has been created! Visit https://abc.trycloudflare.com"
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

    const promise = startCloudflareTunnel(8080, { spawner, timeoutMs: 1000 });

    child.stdout.write("Visit https://abc.trycloudflare.com\n");

    await expect(promise).resolves.toMatchObject({
      provider: "cloudflare",
      url: "https://abc.trycloudflare.com",
      hostname: "abc.trycloudflare.com",
      pid: 23456,
    });
    expect(calls).toEqual([
      {
        command: "cloudflared",
        args: ["tunnel", "--url", "http://127.0.0.1:8080"],
      },
    ]);
  });

  it("throws an install hint when cloudflared is missing", async () => {
    const error = Object.assign(new Error("spawn cloudflared ENOENT"), { code: "ENOENT" });
    const spawner: TunnelSpawner = () => {
      throw error;
    };

    await expect(startCloudflareTunnel(8080, { spawner })).rejects.toThrow(
      "cloudflared CLI not found"
    );
  });
});
