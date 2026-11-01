import { describe, expect, it } from "vitest";
import { parseBgStartArgs, runArgsFromIntent } from "./bg.js";
import type { BgStartIntent } from "./bg-store.js";

describe("bg start parser", () => {
  it("forwards the Cloudflare alias as a run flag", () => {
    expect(parseBgStartArgs(["--cloudflare", "--", "bun", "dev"]).runArgs).toEqual([
      "--cloudflare",
      "--",
      "bun",
      "dev",
    ]);
  });
  it("parses bg start with every current run flag", () => {
    const parsed = parseBgStartArgs([
      "--name",
      "web",
      "--force",
      "--app-port",
      "4100",
      "--h2c",
      "--path",
      "/api",
      "--tunnel",
      "cloudflare",
      "--tunnel-hostname",
      "public.example.com",
      "--tailscale",
      "--tailscale-http",
      "--tailscale-service",
      "--tailscale-service-name",
      "svc",
      "--funnel",
      "--ngrok",
      "--netbird",
      "--netbird-password",
      "placeholder-password",
      "--netbird-pin",
      "0000",
      "--netbird-groups",
      "admins,devs",
      "--wait",
      "12",
      "--json",
      "--",
      "bun",
      "run",
      "dev",
      "--",
      "--child-flag",
    ]);

    expect(parsed.waitSeconds).toBe(12);
    expect(parsed.json).toBe(true);
    expect(parsed.keep).toBe(false);
    expect(parsed.runArgs).toEqual([
      "--name",
      "web",
      "--force",
      "--app-port",
      "4100",
      "--h2c",
      "--path",
      "/api",
      "--tunnel",
      "cloudflare",
      "--tunnel-hostname",
      "public.example.com",
      "--tailscale",
      "--tailscale-http",
      "--tailscale-service",
      "--tailscale-service-name",
      "svc",
      "--funnel",
      "--ngrok",
      "--netbird",
      "--netbird-password",
      "placeholder-password",
      "--netbird-pin",
      "0000",
      "--netbird-groups",
      "admins,devs",
      "--",
      "bun",
      "run",
      "dev",
      "--",
      "--child-flag",
    ]);
  });

  it("uses a readiness wait by default", () => {
    expect(parseBgStartArgs(["bun", "run", "dev"]).waitSeconds).toBe(30);
  });

  it("rejects --keep with --no-wait", () => {
    expect(() => parseBgStartArgs(["--no-wait", "--keep", "bun", "run", "dev"])).toThrow(
      "--keep requires readiness waiting"
    );
  });

  it("rejects invalid --wait values", () => {
    expect(() => parseBgStartArgs(["--wait", "0", "bun", "run", "dev"])).toThrow(
      "--wait must be a positive number of seconds"
    );
  });

  it("keeps command arguments after the CLI separator untouched", () => {
    const parsed = parseBgStartArgs(["--name", "web", "--", "vite", "--host", "0.0.0.0"]);

    expect(parsed.runArgs).toEqual(["--name", "web", "--", "vite", "--host", "0.0.0.0"]);
  });

  it("does not treat child command flags as bg flags after parsing stops", () => {
    const parsed = parseBgStartArgs(["vite", "--no-wait", "--keep"]);

    expect(parsed.waitSeconds).toBe(30);
    expect(parsed.keep).toBe(false);
    expect(parsed.runArgs).toEqual(["vite", "--no-wait", "--keep"]);
  });

  it("forwards --tailscale-http as a run flag", () => {
    const parsed = parseBgStartArgs(["--tailscale-http", "bun", "run", "dev"]);
    expect(parsed.runArgs).toEqual(["--tailscale-http", "bun", "run", "dev"]);
  });

  it("round-trips --tailscale-http through the intent without a plain --tailscale", () => {
    const intent: BgStartIntent = {
      cwd: "/tmp/app",
      commandArgs: ["bun", "run", "dev"],
      explicitCommand: true,
      force: false,
      pathPrefix: "/",
      sharing: {
        tailscale: true,
        tailscaleHttp: true,
        tailscaleService: false,
        funnel: false,
        ngrok: false,
        netbird: false,
      },
    };

    const args = runArgsFromIntent(intent, false);

    expect(args).toContain("--tailscale-http");
    expect(args).not.toContain("--tailscale");
  });

  it("builds restart arguments without NetBird credentials", () => {
    const intent: BgStartIntent = {
      cwd: "/tmp/app",
      commandArgs: ["bun", "run", "dev"],
      explicitCommand: true,
      force: false,
      pathPrefix: "/",
      sharing: {
        tailscale: false,
        tailscaleService: false,
        funnel: false,
        ngrok: false,
        netbird: true,
        netbirdPassword: "placeholder-password",
        netbirdPin: "0000",
      },
    };

    const args = runArgsFromIntent(intent, false);

    expect(args).not.toContain("--netbird-password");
    expect(args).not.toContain("--netbird-pin");
    expect(args).not.toContain("placeholder-password");
    expect(args).not.toContain("0000");
  });
});
