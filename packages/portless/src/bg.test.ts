import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseBgStartArgs, parseRunIntent, runArgsFromIntent } from "./bg.js";
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

  describe("worktree prefix intent", () => {
    const baseIntent = (): BgStartIntent => ({
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
        netbird: false,
      },
    });

    let saved: string | undefined;
    beforeEach(() => {
      saved = process.env.PORTLESS_WORKTREE_PREFIX;
      delete process.env.PORTLESS_WORKTREE_PREFIX;
    });
    afterEach(() => {
      if (saved === undefined) delete process.env.PORTLESS_WORKTREE_PREFIX;
      else process.env.PORTLESS_WORKTREE_PREFIX = saved;
    });

    it("forwards both flags through bg start", () => {
      expect(parseBgStartArgs(["--worktree-prefix", "qa", "--", "bun", "dev"]).runArgs).toEqual([
        "--worktree-prefix",
        "qa",
        "--",
        "bun",
        "dev",
      ]);
      expect(parseBgStartArgs(["--no-worktree", "bun", "dev"]).runArgs).toEqual([
        "--no-worktree",
        "bun",
        "dev",
      ]);
    });

    it("rejects an empty --worktree-prefix and points to --no-worktree", () => {
      expect(() => parseBgStartArgs(["--worktree-prefix", "", "bun", "dev"])).toThrow(
        /--no-worktree/
      );
    });

    it("saves an explicit prefix from the flag and replays it", () => {
      const { intent } = parseRunIntent(["--worktree-prefix", "qa", "bun", "dev"], "/tmp/app");
      expect(intent.worktreePrefix).toBe("qa");
      expect(intent.noWorktree).toBeUndefined();
      expect(runArgsFromIntent(intent, false)).toEqual(["--worktree-prefix", "qa"]);
    });

    it("saves the opt-out and replays it", () => {
      const { intent } = parseRunIntent(["--no-worktree", "bun", "dev"], "/tmp/app");
      expect(intent.noWorktree).toBe(true);
      expect(intent.worktreePrefix).toBeUndefined();
      expect(runArgsFromIntent(intent, false)).toEqual(["--no-worktree"]);
    });

    it("captures the environment decision so a restart without the variable replays it", () => {
      process.env.PORTLESS_WORKTREE_PREFIX = "staging";
      const fromEnv = parseRunIntent(["bun", "dev"], "/tmp/app").intent;
      expect(fromEnv.worktreePrefix).toBe("staging");

      process.env.PORTLESS_WORKTREE_PREFIX = "";
      const emptyEnv = parseRunIntent(["bun", "dev"], "/tmp/app").intent;
      expect(emptyEnv.noWorktree).toBe(true);

      delete process.env.PORTLESS_WORKTREE_PREFIX;
      expect(runArgsFromIntent(fromEnv, false)).toEqual(["--worktree-prefix", "staging"]);
      expect(runArgsFromIntent(emptyEnv, false)).toEqual(["--no-worktree"]);
    });

    it("lets a flag override the environment in both directions", () => {
      process.env.PORTLESS_WORKTREE_PREFIX = "staging";
      const optOut = parseRunIntent(["--no-worktree", "bun", "dev"], "/tmp/app").intent;
      expect(optOut.noWorktree).toBe(true);
      expect(optOut.worktreePrefix).toBeUndefined();

      process.env.PORTLESS_WORKTREE_PREFIX = "";
      const prefixed = parseRunIntent(["--worktree-prefix", "qa", "bun", "dev"], "/tmp/app").intent;
      expect(prefixed.worktreePrefix).toBe("qa");
      expect(prefixed.noWorktree).toBeUndefined();
    });

    it("rejects both flags together", () => {
      expect(() =>
        parseRunIntent(["--no-worktree", "--worktree-prefix", "qa", "bun", "dev"], "/tmp/app")
      ).toThrow(/cannot be combined/);
    });

    it("emits nothing for an intent without a worktree decision", () => {
      const args = runArgsFromIntent(baseIntent(), false);
      expect(args).not.toContain("--worktree-prefix");
      expect(args).not.toContain("--no-worktree");
    });
  });
});
