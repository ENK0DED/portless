import { describe, expect, it } from "vitest";
import { parseBgStartArgs } from "./bg.js";

describe("bg start parser", () => {
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
      "--tailscale-service",
      "--tailscale-service-name",
      "svc",
      "--funnel",
      "--ngrok",
      "--netbird",
      "--netbird-password",
      "secret",
      "--netbird-pin",
      "123456",
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
      "--tailscale-service",
      "--tailscale-service-name",
      "svc",
      "--funnel",
      "--ngrok",
      "--netbird",
      "--netbird-password",
      "secret",
      "--netbird-pin",
      "123456",
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
});
