import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { spawn, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as http from "node:http";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { getBgLogPaths } from "./bg-logs.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI_PATH = path.resolve(__dirname, "../dist/cli.js");
const GIT_AVAILABLE = (() => {
  if (spawnSync("git", ["--version"], { stdio: "ignore" }).status !== 0) return false;
  const probe = fs.mkdtempSync(path.join(os.tmpdir(), "portless-git-probe-"));
  try {
    return spawnSync("git", ["init"], { cwd: probe, stdio: "ignore" }).status === 0;
  } finally {
    fs.rmSync(probe, { recursive: true, force: true });
  }
})();
const TEST_CA_PEM = `-----BEGIN CERTIFICATE-----
MIIDFzCCAf+gAwIBAgIUEVh0YNawusstUaCfwLYo2qUO7D8wDQYJKoZIhvcNAQEL
BQAwGzEZMBcGA1UEAwwQcG9ydGxlc3MtdGVzdC1jYTAeFw0yNjA1MjAyMTIzNDBa
Fw0zNjA1MTcyMTIzNDBaMBsxGTAXBgNVBAMMEHBvcnRsZXNzLXRlc3QtY2EwggEi
MA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQDXVX2d5DSfOOdipeP+k27Omgxd
UV0C35Yx5wKAQiHVBOWNsLPQVoJzyCASMkroul5idmoSr+9IWDh/oizEqN5iRzzA
MYGAAaNOXVZHN6Y12p0dFaP77+unD2eOgt4cIqZ2VA7K+j8O1hrLbhQ1Ogiw7Xh0
WjtgNoge9rv9OIr+2eoQmkJCkY66oa1Pe+lTjjhUcXBCK0j4u/3cTxAzjzLaOnzC
KDnZU2lZT/1v3Fo8YwB/18eVsoxupMRTsXcai2VnazZMcUwQR5HSa9jJ97Jj5H35
dRvWFlRU5mqO+0COQUvg0naMvaIGXJG4xBljNAcWbQbW2/bMpfK9Z2c3H8M1AgMB
AAGjUzBRMB0GA1UdDgQWBBT86mpMdHyIkUBVn+C5r6MGyjFfFjAfBgNVHSMEGDAW
gBT86mpMdHyIkUBVn+C5r6MGyjFfFjAPBgNVHRMBAf8EBTADAQH/MA0GCSqGSIb3
DQEBCwUAA4IBAQCM0eVaH2I4PUYB3R8GEpfOzM0nqRkcKz5r3eeGfbYabtdKyurQ
lTFT75LiGsMmIuTGlDjP7iKxbeY7cYn5gTUttPVQGwYVOY1qKkLHGst4GaBK/w5Y
9Ag42CGCYhk172EMJ0H5zGqYvU7itOXU5QERDOxAfHWXIBN4Al/fkRUoCWZZIkAM
2AqvSowxptbcbnlRn8/l+RgKMrG+88Pj8J1ei3PtiUBx2haYSxPkoBcMOLH52Cdx
KnZk8J8eqG+Nc2L778YxXPRDS4egacbNc3FoEIAN/zBk+RWc22V5bVODCM69I4Qa
VeuruL5f30jD8PbGa2A91T5e1oaoL5ap6bdl
-----END CERTIFICATE-----
`;

/** Run the CLI with the given args and optional env/cwd overrides. */
function run(args: string[], options?: { env?: Record<string, string | undefined>; cwd?: string }) {
  const env: Record<string, string | undefined> = {
    ...process.env,
    NO_COLOR: "1",
  };
  for (const key of Object.keys(env)) {
    if (key.startsWith("PORTLESS")) {
      delete env[key];
    }
  }
  delete env.NODE_EXTRA_CA_CERTS;
  Object.assign(env, options?.env);
  if (process.platform === "win32" && env.PATH !== undefined) {
    for (const key of Object.keys(env)) {
      if (key !== "PATH" && key.toUpperCase() === "PATH") {
        delete env[key];
      }
    }
  }
  // Test runners may set package-manager env vars; strip the pnpm/npm ones so
  // the CLI child does not look like pnpm dlx or npx.
  delete env.PNPM_SCRIPT_SRC_DIR;
  if (env.npm_command === "exec") {
    delete env.npm_command;
  }
  const result = spawnSync(process.execPath, [CLI_PATH, ...args], {
    encoding: "utf-8",
    timeout: 10_000,
    env,
    cwd: options?.cwd,
  });
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function runGit(cwd: string, args: string[]): void {
  const result = spawnSync("git", ["-c", "commit.gpgsign=false", ...args], {
    cwd,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  }
}

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + "\n");
}

function nodePrintScript(text: string): string {
  return `${JSON.stringify(process.execPath)} -e "console.log(process.argv[1])" ${text}`;
}

function prependPath(dir: string): string {
  return `${dir}${path.delimiter}${process.env.PATH ?? process.env.Path ?? ""}`;
}

interface TestBgEntry {
  id: string;
  label: string;
  cwd?: string;
  pid: number;
  state: string;
  url?: string;
  route?: {
    hostname: string;
    pathPrefix: string;
  };
}

function readBgRegistry(stateDir: string): TestBgEntry[] {
  try {
    const raw = fs.readFileSync(path.join(stateDir, "bg", "registry.json"), "utf-8");
    return JSON.parse(raw) as TestBgEntry[];
  } catch {
    return [];
  }
}

function writeBgRegistry(stateDir: string, entries: Array<Record<string, unknown>>): void {
  writeJson(path.join(stateDir, "bg", "registry.json"), entries);
}

function makeBgEntry(
  overrides: Partial<Record<string, unknown>> & { id: string; label: string; pid: number }
) {
  const pathPrefix =
    typeof overrides.route === "object" &&
    overrides.route !== null &&
    "pathPrefix" in overrides.route &&
    typeof (overrides.route as { pathPrefix?: unknown }).pathPrefix === "string"
      ? (overrides.route as { pathPrefix: string }).pathPrefix
      : "/";
  return {
    version: 1,
    cwd: process.cwd(),
    startedAt: new Date().toISOString(),
    state: "ready",
    intent: {
      cwd: process.cwd(),
      commandArgs: [process.execPath, "-e", "setInterval(() => {}, 1000)"],
      explicitCommand: true,
      force: false,
      pathPrefix,
      sharing: {
        tailscale: false,
        tailscaleService: false,
        funnel: false,
        ngrok: false,
        netbird: false,
      },
    },
    ...overrides,
  };
}

function readRoutesFile(stateDir: string): Array<Record<string, unknown>> {
  try {
    return JSON.parse(fs.readFileSync(path.join(stateDir, "routes.json"), "utf-8")) as Array<
      Record<string, unknown>
    >;
  } catch {
    return [];
  }
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function killProcessGroup(pid: number): void {
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // Process may already have exited.
    }
  }
}

async function waitForFileIncludes(filePath: string, text: string, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    try {
      if (fs.readFileSync(filePath, "utf-8").includes(text)) return true;
    } catch {
      // Log file may not exist yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}

async function waitForPidGone(pid: number, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    if (!isPidAlive(pid)) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}

function writeExpoShim(dir: string): void {
  const captureScriptPath = path.join(dir, "capture-expo.js");
  fs.writeFileSync(
    captureScriptPath,
    [
      'const fs = require("node:fs");',
      "const capturePath = process.env.PORTLESS_TEST_CAPTURE_FILE;",
      "const payload = {",
      "  args: process.argv.slice(2),",
      "  env: {",
      "    PORT: process.env.PORT,",
      "    HOST: process.env.HOST,",
      "    PORTLESS_LAN: process.env.PORTLESS_LAN,",
      "    PORTLESS_URL: process.env.PORTLESS_URL,",
      "  },",
      "};",
      "fs.writeFileSync(capturePath, JSON.stringify(payload));",
    ].join("\n") + "\n"
  );

  if (process.platform === "win32") {
    fs.writeFileSync(
      path.join(dir, "expo.cmd"),
      `@echo off\r\n"${process.execPath}" "${captureScriptPath}" %*\r\n`
    );
    return;
  }

  const shimPath = path.join(dir, "expo");
  fs.writeFileSync(shimPath, `#!/bin/sh\n"${process.execPath}" "${captureScriptPath}" "$@"\n`);
  fs.chmodSync(shimPath, 0o755);
}

function writeCloudflaredShim(dir: string, url = "https://abc.trycloudflare.com"): void {
  const scriptPath = path.join(dir, "cloudflared-shim.js");
  fs.writeFileSync(
    scriptPath,
    [
      "if (process.argv.includes('version')) { console.log('cloudflared version test'); process.exit(0); }",
      `console.log(${JSON.stringify(url)});`,
      "setInterval(() => {}, 1000);",
      "process.on('SIGTERM', () => process.exit(0));",
    ].join("\n") + "\n"
  );

  if (process.platform === "win32") {
    fs.writeFileSync(
      path.join(dir, "cloudflared.cmd"),
      `@echo off\r\n"${process.execPath}" "${scriptPath}" %*\r\n`
    );
    return;
  }

  const shimPath = path.join(dir, "cloudflared");
  fs.writeFileSync(shimPath, `#!/bin/sh\n"${process.execPath}" "${scriptPath}" "$@"\n`);
  fs.chmodSync(shimPath, 0o755);
}

async function getFreePort(): Promise<number> {
  const server = http.createServer();
  try {
    const port = await new Promise<number>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        if (addr && typeof addr !== "string") {
          resolve(addr.port);
        }
      });
    });
    return port;
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe("CLI", () => {
  beforeAll(() => {
    if (!fs.existsSync(CLI_PATH)) {
      throw new Error(
        `Built CLI not found at ${CLI_PATH}. Run 'bun run build' before running tests.`
      );
    }
  });

  describe("--help", () => {
    it("prints help and exits 0 with --help", () => {
      const { status, stdout } = run(["--help"]);
      expect(status).toBe(0);
      expect(stdout).toContain("portless");
      expect(stdout).toContain("Usage:");
      expect(stdout).toContain("Examples:");
      expect(stdout).toContain("proxy start");
      expect(stdout).toContain("service install");
      expect(stdout).toContain("portless run");
      expect(stdout).toContain("portless get");
      expect(stdout).toContain("portless bg start");
      expect(stdout).toContain("portless bg status");
      expect(stdout).toContain("portless bg logs");
      expect(stdout).toContain("portless bg restart");
      expect(stdout).toContain("--no-wait");
      expect(stdout).toContain("portless completion <shell>");
      expect(stdout).toContain("run [--name <name>]");
      expect(stdout).toContain("--port");
      expect(stdout).toContain("-p");
      expect(stdout).toContain("--foreground");
      expect(stdout).toContain("PORTLESS_STATE_DIR");
      expect(stdout).toContain("PORTLESS_URL");
      expect(stdout).toContain("--ngrok");
      expect(stdout).toContain("PORTLESS_NGROK");
      expect(stdout).toContain("PORTLESS_NGROK_URL");
      expect(stdout).toContain("portless clean");
      expect(stdout).toContain("--h2c");
      expect(stdout).toContain("PORTLESS_H2C");
      expect(stdout).toContain("--path");
      expect(stdout).toContain("PORTLESS_PATH");
    });

    it("prints help and exits 0 with -h", () => {
      const { status, stdout } = run(["-h"]);
      expect(status).toBe(0);
      expect(stdout).toContain("Usage:");
    });

    it("prints help and exits 0 with no args when no dev script exists", () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "portless-cli-help-"));
      try {
        fs.writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify({ name: "test-app" }));
        const { status, stdout } = run([], { cwd: tmpDir });
        expect(status).toBe(0);
        expect(stdout).toContain("Usage:");
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });

  describe("--version", () => {
    it("prints version and exits 0 with --version", () => {
      const { status, stdout } = run(["--version"]);
      expect(status).toBe(0);
      // Version should be a semver-like string
      expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
    });

    it("prints version and exits 0 with -v", () => {
      const { status, stdout } = run(["-v"]);
      expect(status).toBe(0);
      expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
    });
  });

  describe("completion", () => {
    it("prints completion usage with bare command", () => {
      const { status, stdout } = run(["completion"]);
      expect(status).toBe(0);
      expect(stdout).toContain("portless completion <shell>");
      expect(stdout).toContain("bash");
      expect(stdout).toContain("zsh");
      expect(stdout).toContain("fish");
    });

    it("prints completion usage with --help", () => {
      const { status, stdout } = run(["completion", "--help"]);
      expect(status).toBe(0);
      expect(stdout).toContain("portless completion <shell>");
    });

    it("prints bash completion with current commands and flags", () => {
      const { status, stdout } = run(["completion", "bash"]);
      expect(status).toBe(0);
      expect(stdout).toContain("_portless_completions");
      expect(stdout).toContain("complete -F _portless_completions portless");
      expect(stdout).toContain("bg");
      expect(stdout).toContain("service");
      expect(stdout).toContain("clean");
      expect(stdout).toContain("prune");
      expect(stdout).toContain("--suffix");
      expect(stdout).toContain("--wildcard");
      expect(stdout).toContain("--lan");
      expect(stdout).toContain("--netbird-groups");
      expect(stdout).toContain("--ngrok");
    });

    it("prints zsh completion with current commands and flags", () => {
      const { status, stdout } = run(["completion", "zsh"]);
      expect(status).toBe(0);
      expect(stdout).toContain("#compdef portless");
      expect(stdout).toContain("_portless");
      expect(stdout).toContain("service:Manage startup service");
      expect(stdout).toContain("--netbird-groups");
      expect(stdout).toContain("--suffix");
    });

    it("prints fish completion with current commands and flags", () => {
      const { status, stdout } = run(["completion", "fish"]);
      expect(status).toBe(0);
      expect(stdout).toContain("complete -c portless");
      expect(stdout).toContain('complete -c portless -n "__fish_is_nth_token 1" -f');
      expect(stdout).toContain('-a "service"');
      expect(stdout).toContain("-l netbird-groups");
      expect(stdout).toContain("-l suffix");
    });

    it("exits 1 for an unknown shell", () => {
      const { status, stderr } = run(["completion", "pwsh"]);
      expect(status).toBe(1);
      expect(stderr).toContain('Unknown shell "pwsh"');
    });
  });

  describe("list", () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "portless-cli-list-"));
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it("shows no active routes message when none registered", () => {
      // Note: the CLI discovers the state dir dynamically. We just verify
      // it doesn't crash and returns 0.
      const { status } = run(["list"]);
      expect(status).toBe(0);
    });

    it.each(["ls", "status"])("supports %s as a list alias", (cmd) => {
      const { status } = run([cmd]);
      expect(status).toBe(0);
    });

    it.each(["ls", "status"])("preserves %s as an app name when followed by a command", (cmd) => {
      const { status, stdout } = run(
        [cmd, process.execPath, "-e", `console.log(${JSON.stringify(`app-named-${cmd}`)})`],
        {
          env: { PORTLESS: "0" },
        }
      );
      expect(status).toBe(0);
      expect(stdout.trim()).toBe(`app-named-${cmd}`);
    });

    it("outputs active routes as JSON", () => {
      fs.writeFileSync(path.join(tmpDir, "proxy.port"), "1355");
      fs.writeFileSync(
        path.join(tmpDir, "routes.json"),
        JSON.stringify([
          { hostname: "myapp.localhost", port: 4100, pid: process.pid },
          { hostname: "redis.localhost", port: 6379, pid: 0 },
        ])
      );

      const { status, stdout } = run(["list", "--json"], {
        env: { PORTLESS_STATE_DIR: tmpDir },
      });

      expect(status).toBe(0);
      expect(JSON.parse(stdout)).toEqual([
        {
          hostname: "myapp.localhost",
          url: "http://myapp.localhost:1355",
          target_port: 4100,
          path_prefix: "/",
          upstream_protocol: "http1",
          pid: process.pid,
          kind: "app",
        },
        {
          hostname: "redis.localhost",
          url: "http://redis.localhost:1355",
          target_port: 6379,
          path_prefix: "/",
          upstream_protocol: "http1",
          pid: 0,
          kind: "alias",
        },
      ]);
    });

    it.each(["ls", "status"])("outputs JSON through the %s alias", (cmd) => {
      fs.writeFileSync(path.join(tmpDir, "proxy.port"), "1355");
      fs.writeFileSync(
        path.join(tmpDir, "routes.json"),
        JSON.stringify([{ hostname: "myapp.localhost", port: 4100, pid: process.pid }])
      );

      const { status, stdout } = run([cmd, "--json"], {
        env: { PORTLESS_STATE_DIR: tmpDir },
      });

      expect(status).toBe(0);
      expect(JSON.parse(stdout)[0]).toMatchObject({
        hostname: "myapp.localhost",
        kind: "app",
        upstream_protocol: "http1",
      });
    });

    it("outputs h2c protocol metadata in JSON", () => {
      fs.writeFileSync(path.join(tmpDir, "proxy.port"), "1355");
      fs.writeFileSync(
        path.join(tmpDir, "routes.json"),
        JSON.stringify([{ hostname: "grpc.localhost", port: 50051, pid: 0, protocol: "h2c" }])
      );

      const { status, stdout } = run(["list", "--json"], {
        env: { PORTLESS_STATE_DIR: tmpDir },
      });

      expect(status).toBe(0);
      expect(JSON.parse(stdout)).toEqual([
        {
          hostname: "grpc.localhost",
          url: "http://grpc.localhost:1355",
          target_port: 50051,
          path_prefix: "/",
          upstream_protocol: "h2c",
          pid: 0,
          kind: "alias",
        },
      ]);
    });

    it("outputs path prefixes in JSON URLs", () => {
      fs.writeFileSync(path.join(tmpDir, "proxy.port"), "1355");
      fs.writeFileSync(
        path.join(tmpDir, "routes.json"),
        JSON.stringify([
          { hostname: "api.localhost", port: 4100, pid: process.pid, pathPrefix: "/v1" },
        ])
      );

      const { status, stdout } = run(["list", "--json"], {
        env: { PORTLESS_STATE_DIR: tmpDir },
      });

      expect(status).toBe(0);
      expect(JSON.parse(stdout)).toMatchObject([
        {
          hostname: "api.localhost",
          url: "http://api.localhost:1355/v1",
          path_prefix: "/v1",
        },
      ]);
    });

    it("prints list help with --json documented", () => {
      const { status, stdout } = run(["list", "--help"]);
      expect(status).toBe(0);
      expect(stdout).toContain("--json");
      expect(stdout).toContain("target_port");
    });
  });

  describe("proxy", () => {
    it("shows proxy usage hint for bare 'proxy' command", () => {
      const { status, stdout } = run(["proxy"]);
      expect(status).toBe(0);
      expect(stdout).toContain("proxy start");
      expect(stdout).toContain("proxy stop");
      expect(stdout).toContain("--foreground");
    });

    it("exits 1 for unknown proxy subcommand", () => {
      const { status, stdout } = run(["proxy", "unknown"]);
      expect(status).toBe(1);
      expect(stdout).toContain("proxy start");
    });
  });

  describe("service", () => {
    it("prints service help", () => {
      const { status, stdout } = run(["service", "--help"]);
      expect(status).toBe(0);
      expect(stdout).toContain("portless service");
      expect(stdout).toContain("service install");
      expect(stdout).toContain("service uninstall");
      expect(stdout).toContain("service status");
    });

    it("still dispatches service help when PORTLESS=0", () => {
      const { status, stdout } = run(["service", "--help"], {
        env: { PORTLESS: "0" },
      });
      expect(status).toBe(0);
      expect(stdout).toContain("portless service");
      expect(stdout).toContain("service install");
    });
  });

  describe("error: no command provided", () => {
    it("exits 1 when only a name is given without a command", () => {
      const { status, stderr } = run(["myapp"]);
      expect(status).toBe(1);
      expect(stderr).toContain("No command provided");
    });
  });

  describe("bg", () => {
    it("prints bg help", () => {
      const { status, stdout } = run(["bg", "--help"]);
      expect(status).toBe(0);
      expect(stdout).toContain("portless bg");
      expect(stdout).toContain("bg start");
      expect(stdout).toContain("bg stop");
      expect(stdout).toContain("bg restart");
      expect(stdout).toContain("bg logs");
      expect(stdout).toContain("bg clean");
    });

    it("prints implemented lifecycle help", () => {
      const cases = [
        ["stop", "--force"],
        ["restart", "--no-wait"],
        ["clean", "--all"],
      ] as const;
      for (const [subcommand, expectedFlag] of cases) {
        const { status, stdout } = run(["bg", subcommand, "--help"]);
        expect(status).toBe(0);
        expect(stdout).toContain(`portless bg ${subcommand}`);
        expect(stdout).toContain(expectedFlag);
        expect(stdout).not.toContain("follow-up lifecycle commits");
      }
    });

    it("still dispatches bg help when PORTLESS=0", () => {
      const { status, stdout } = run(["bg", "--help"], {
        env: { PORTLESS: "0" },
      });
      expect(status).toBe(0);
      expect(stdout).toContain("portless bg");
    });

    it("rejects unknown bg subcommands", () => {
      const { status, stderr } = run(["bg", "unknown"]);
      expect(status).toBe(1);
      expect(stderr).toContain('Unknown bg subcommand "unknown"');
    });

    describe.skipIf(process.platform === "win32")("start", () => {
      let tmpDir: string;
      let proxyPort: number;

      const bgEnv = (extra?: Record<string, string | undefined>) => ({
        PORTLESS_STATE_DIR: tmpDir,
        PORTLESS_PORT: String(proxyPort),
        PORTLESS_HTTPS: "0",
        PORTLESS_SYNC_HOSTS: "0",
        ...extra,
      });

      const longRunningCommand = () => [process.execPath, "-e", "setInterval(() => {}, 1000)"];

      beforeEach(async () => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "portless-cli-bg-"));
        proxyPort = await getFreePort();
      });

      afterEach(() => {
        for (const entry of readBgRegistry(tmpDir)) {
          killProcessGroup(entry.pid);
        }
        run(["proxy", "stop"], { env: bgEnv() });
        fs.rmSync(tmpDir, { recursive: true, force: true });
      });

      it("starts a background process and records the ready route", async () => {
        const appPort = await getFreePort();
        const { status, stdout, stderr } = run(
          ["bg", "start", "--name", "web", "--app-port", String(appPort), ...longRunningCommand()],
          { env: bgEnv() }
        );

        const entries = readBgRegistry(tmpDir);

        expect({ status, stdout, stderr }).toMatchObject({ status: 0 });
        expect(entries).toHaveLength(1);
        expect(entries[0]).toMatchObject({
          label: "web",
          state: "ready",
          route: { hostname: "web.localhost", pathPrefix: "/" },
        });
        expect(entries[0].url).toContain(`http://web.localhost:${proxyPort}`);
        expect(isPidAlive(entries[0].pid)).toBe(true);
      });

      it("sets state to starting when --no-wait is used", async () => {
        const appPort = await getFreePort();
        const { status } = run(
          [
            "bg",
            "start",
            "--no-wait",
            "--name",
            "starting",
            "--app-port",
            String(appPort),
            ...longRunningCommand(),
          ],
          { env: bgEnv() }
        );

        const entries = readBgRegistry(tmpDir);

        expect(status).toBe(0);
        expect(entries).toHaveLength(1);
        expect(entries[0]).toMatchObject({ label: "starting", state: "starting" });
      });

      it("kills and removes a timed-out start by default", async () => {
        const appPort = await getFreePort();
        const { status, stderr } = run(
          [
            "bg",
            "start",
            "--wait",
            "0.001",
            "--name",
            "timeout",
            "--app-port",
            String(appPort),
            ...longRunningCommand(),
          ],
          { env: bgEnv() }
        );

        expect(status).toBe(1);
        expect(stderr).toContain("timed out waiting for readiness");
        expect(readBgRegistry(tmpDir)).toEqual([]);
      });

      it("keeps a timed-out process when --keep is used", async () => {
        const appPort = await getFreePort();
        const { status, stderr } = run(
          [
            "bg",
            "start",
            "--wait",
            "0.001",
            "--keep",
            "--name",
            "kept",
            "--app-port",
            String(appPort),
            ...longRunningCommand(),
          ],
          { env: bgEnv() }
        );

        const entries = readBgRegistry(tmpDir);

        expect(status).toBe(1);
        expect(stderr).toContain("timed out waiting for readiness");
        expect(entries).toHaveLength(1);
        expect(entries[0]).toMatchObject({ label: "kept", state: "unknown" });
        expect(isPidAlive(entries[0].pid)).toBe(true);
      });

      it("passes --path through and records the path-scoped URL", async () => {
        const appPort = await getFreePort();
        const { status } = run(
          [
            "bg",
            "start",
            "--name",
            "api",
            "--path",
            "/api",
            "--app-port",
            String(appPort),
            ...longRunningCommand(),
          ],
          { env: bgEnv() }
        );

        const [entry] = readBgRegistry(tmpDir);

        expect(status).toBe(0);
        expect(entry.route).toEqual({ hostname: "api.localhost", pathPrefix: "/api" });
        expect(entry.url).toContain("/api");
      });

      it("passes --h2c through and records h2c route metadata", async () => {
        const appPort = await getFreePort();
        const { status } = run(
          [
            "bg",
            "start",
            "--name",
            "grpc",
            "--h2c",
            "--app-port",
            String(appPort),
            ...longRunningCommand(),
          ],
          { env: bgEnv() }
        );

        const routes = readRoutesFile(tmpDir);

        expect(status).toBe(0);
        expect(routes.find((route) => route.hostname === "grpc.localhost")).toMatchObject({
          protocol: "h2c",
        });
      });

      it("passes managed tunnel flags through and records PORTLESS_TUNNEL_URL in child logs", async () => {
        const appPort = await getFreePort();
        writeCloudflaredShim(tmpDir, "https://bg-test.trycloudflare.com");
        const { status } = run(
          [
            "bg",
            "start",
            "--name",
            "tunnel",
            "--tunnel",
            "cloudflare",
            "--app-port",
            String(appPort),
            process.execPath,
            "-e",
            "console.log(process.env.PORTLESS_TUNNEL_URL); setInterval(() => {}, 1000)",
          ],
          { env: bgEnv({ PATH: prependPath(tmpDir) }) }
        );

        const [entry] = readBgRegistry(tmpDir);
        const logs = getBgLogPaths(tmpDir, entry.id);

        expect(status).toBe(0);
        expect(entry.url).toContain("tunnel.localhost");
        await expect(
          waitForFileIncludes(logs.stdout, "https://bg-test.trycloudflare.com")
        ).resolves.toBe(true);
      });

      it("prints current bg status with URL and route state", async () => {
        const appPort = await getFreePort();
        expect(
          run(
            [
              "bg",
              "start",
              "--name",
              "status-web",
              "--app-port",
              String(appPort),
              ...longRunningCommand(),
            ],
            {
              env: bgEnv(),
            }
          ).status
        ).toBe(0);

        const { status, stdout } = run(["bg", "status", "status-web"], { env: bgEnv() });

        expect(status).toBe(0);
        expect(stdout).toContain("status-web");
        expect(stdout).toContain("ready");
        expect(stdout).toContain(`http://status-web.localhost:${proxyPort}`);
      });

      it("prints JSON status with route and log paths", async () => {
        const appPort = await getFreePort();
        expect(
          run(
            [
              "bg",
              "start",
              "--name",
              "json-web",
              "--app-port",
              String(appPort),
              ...longRunningCommand(),
            ],
            {
              env: bgEnv(),
            }
          ).status
        ).toBe(0);

        const { status, stdout } = run(["bg", "status", "json-web", "--json"], {
          env: bgEnv(),
        });
        const parsed = JSON.parse(stdout) as TestBgEntry & { logs: Record<string, string> };

        expect(status).toBe(0);
        expect(parsed.route).toEqual({ hostname: "json-web.localhost", pathPrefix: "/" });
        expect(parsed.logs.stdout).toContain(".stdout.log");
        expect(parsed.logs.stderr).toContain(".stderr.log");
      });

      it("lists all background entries sorted by label", async () => {
        const alphaPort = await getFreePort();
        const zetaPort = await getFreePort();
        expect(
          run(
            [
              "bg",
              "start",
              "--name",
              "zeta",
              "--app-port",
              String(zetaPort),
              ...longRunningCommand(),
            ],
            {
              env: bgEnv(),
            }
          ).status
        ).toBe(0);
        expect(
          run(
            [
              "bg",
              "start",
              "--name",
              "alpha",
              "--app-port",
              String(alphaPort),
              ...longRunningCommand(),
            ],
            {
              env: bgEnv(),
            }
          ).status
        ).toBe(0);

        const { status, stdout } = run(["bg", "list", "--json"], { env: bgEnv() });
        const entries = JSON.parse(stdout) as TestBgEntry[];

        expect(status).toBe(0);
        expect(entries.map((entry) => entry.label)).toEqual(["alpha", "zeta"]);
      });

      it("marks entries stopped when the pid is no longer alive", async () => {
        const appPort = await getFreePort();
        expect(
          run(
            [
              "bg",
              "start",
              "--name",
              "dead-web",
              "--app-port",
              String(appPort),
              ...longRunningCommand(),
            ],
            {
              env: bgEnv(),
            }
          ).status
        ).toBe(0);
        const [entry] = readBgRegistry(tmpDir);
        killProcessGroup(entry.pid);
        await expect(waitForPidGone(entry.pid)).resolves.toBe(true);

        const { status, stdout } = run(["bg", "status", "dead-web", "--json"], {
          env: bgEnv(),
        });
        const parsed = JSON.parse(stdout) as TestBgEntry;

        expect(status).toBe(0);
        expect(parsed.state).toBe("stopped");
      });

      it("resolves route identity by hostname and path prefix", async () => {
        const appPort = await getFreePort();
        expect(
          run(
            [
              "bg",
              "start",
              "--name",
              "path-web",
              "--path",
              "/api",
              "--app-port",
              String(appPort),
              ...longRunningCommand(),
            ],
            { env: bgEnv() }
          ).status
        ).toBe(0);

        const { status, stdout } = run(["bg", "status", "path-web", "--path", "/api", "--json"], {
          env: bgEnv(),
        });
        const parsed = JSON.parse(stdout) as TestBgEntry;

        expect(status).toBe(0);
        expect(parsed.route).toEqual({ hostname: "path-web.localhost", pathPrefix: "/api" });
      });

      it("prints background logs and returns no lines for --tail 0", async () => {
        const appPort = await getFreePort();
        expect(
          run(
            [
              "bg",
              "start",
              "--name",
              "log-web",
              "--app-port",
              String(appPort),
              process.execPath,
              "-e",
              "console.log('out-one'); console.log('out-two'); console.error('err-one'); setInterval(() => {}, 1000)",
            ],
            { env: bgEnv() }
          ).status
        ).toBe(0);

        const [entry] = readBgRegistry(tmpDir);
        const logs = getBgLogPaths(tmpDir, entry.id);
        await expect(waitForFileIncludes(logs.stdout, "out-two")).resolves.toBe(true);
        await expect(waitForFileIncludes(logs.stderr, "err-one")).resolves.toBe(true);

        const tailOne = run(["bg", "logs", "log-web", "--tail", "1"], { env: bgEnv() });
        const tailZero = run(["bg", "logs", "log-web", "--tail", "0"], { env: bgEnv() });
        const errors = run(["bg", "logs", "log-web", "--errors"], { env: bgEnv() });
        const lifecycle = run(["bg", "logs", "log-web", "--bg"], { env: bgEnv() });

        expect(tailOne.stdout).toContain("out-two");
        expect(tailOne.stdout).not.toContain("out-one");
        expect(tailZero.stdout).toBe("");
        expect(errors.stdout).toContain("err-one");
        expect(lifecycle.stdout).toContain("ready");
      });

      it("stops a live background process gracefully", async () => {
        const appPort = await getFreePort();
        expect(
          run(
            [
              "bg",
              "start",
              "--name",
              "stop-web",
              "--app-port",
              String(appPort),
              ...longRunningCommand(),
            ],
            {
              env: bgEnv(),
            }
          ).status
        ).toBe(0);
        const [entry] = readBgRegistry(tmpDir);

        const { status, stdout } = run(["bg", "stop", "stop-web"], { env: bgEnv() });

        expect(status).toBe(0);
        expect(stdout).toContain("Stopped stop-web");
        await expect(waitForPidGone(entry.pid)).resolves.toBe(true);
        expect(readBgRegistry(tmpDir)).toEqual([]);
      });

      it("keeps the registry entry when graceful stop times out", async () => {
        const stubborn = spawn(
          process.execPath,
          ["-e", "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"],
          { detached: true, stdio: "ignore" }
        );
        stubborn.unref();
        const id = "stubborn";
        writeBgRegistry(tmpDir, [
          makeBgEntry({
            id,
            label: "stubborn",
            pid: stubborn.pid!,
            state: "ready",
          }),
        ]);

        const { status, stderr } = run(["bg", "stop", "stubborn"], { env: bgEnv() });

        expect(status).toBe(1);
        expect(stderr).toContain("did not exit");
        expect(readBgRegistry(tmpDir)).toHaveLength(1);
        killProcessGroup(stubborn.pid!);
        try {
          process.kill(-stubborn.pid!, "SIGKILL");
        } catch {
          // Process may already be gone.
        }
      }, 8000);

      it("force stop removes only the exact route owned by the bg pid", async () => {
        const appPort = await getFreePort();
        expect(
          run(
            [
              "bg",
              "start",
              "--name",
              "exact",
              "--path",
              "/api",
              "--app-port",
              String(appPort),
              ...longRunningCommand(),
            ],
            { env: bgEnv() }
          ).status
        ).toBe(0);
        const [entry] = readBgRegistry(tmpDir);
        writeJson(path.join(tmpDir, "routes.json"), [
          {
            hostname: "exact.localhost",
            pathPrefix: "/api",
            port: appPort,
            pid: entry.pid,
          },
          {
            hostname: "other.localhost",
            port: appPort,
            pid: 0,
          },
        ]);

        expect(
          run(["bg", "stop", "exact", "--path", "/api", "--force"], { env: bgEnv() }).status
        ).toBe(0);

        expect(readRoutesFile(tmpDir)).toEqual([
          { hostname: "other.localhost", port: appPort, pid: 0 },
        ]);
      });

      it("force stop does not kill unrelated processes on the same port", async () => {
        const appPort = await getFreePort();
        const unrelated = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
          detached: true,
          stdio: "ignore",
        });
        unrelated.unref();
        expect(
          run(
            [
              "bg",
              "start",
              "--name",
              "safe-stop",
              "--app-port",
              String(appPort),
              ...longRunningCommand(),
            ],
            {
              env: bgEnv(),
            }
          ).status
        ).toBe(0);

        expect(run(["bg", "stop", "safe-stop", "--force"], { env: bgEnv() }).status).toBe(0);

        expect(isPidAlive(unrelated.pid!)).toBe(true);
        try {
          process.kill(-unrelated.pid!, "SIGKILL");
        } catch {
          // Process may already be gone.
        }
      });

      it("restart preserves cwd and original command intent", async () => {
        const appDir = fs.mkdtempSync(path.join(os.tmpdir(), "portless-bg-restart-"));
        const appPort = await getFreePort();
        try {
          expect(
            run(
              [
                "bg",
                "start",
                "--name",
                "restart-web",
                "--app-port",
                String(appPort),
                ...longRunningCommand(),
              ],
              { env: bgEnv(), cwd: appDir }
            ).status
          ).toBe(0);
          const [before] = readBgRegistry(tmpDir);

          const { status } = run(["bg", "restart", "restart-web"], { env: bgEnv() });
          const [after] = readBgRegistry(tmpDir);

          expect(status).toBe(0);
          expect(after.cwd).toBe(appDir);
          expect(after.pid).not.toBe(before.pid);
        } finally {
          fs.rmSync(appDir, { recursive: true, force: true });
        }
      });

      it("bg clean removes dead entries and their logs", async () => {
        const appPort = await getFreePort();
        expect(
          run(
            [
              "bg",
              "start",
              "--name",
              "dead-clean",
              "--app-port",
              String(appPort),
              ...longRunningCommand(),
            ],
            {
              env: bgEnv(),
            }
          ).status
        ).toBe(0);
        const [entry] = readBgRegistry(tmpDir);
        const logs = getBgLogPaths(tmpDir, entry.id);
        killProcessGroup(entry.pid);
        await expect(waitForPidGone(entry.pid)).resolves.toBe(true);

        expect(run(["bg", "clean", "--all"], { env: bgEnv() }).status).toBe(0);

        expect(readBgRegistry(tmpDir)).toEqual([]);
        expect(fs.existsSync(logs.stdout)).toBe(false);
      });

      it("bg clean does not stop live entries", async () => {
        const appPort = await getFreePort();
        expect(
          run(
            [
              "bg",
              "start",
              "--name",
              "live-clean",
              "--app-port",
              String(appPort),
              ...longRunningCommand(),
            ],
            {
              env: bgEnv(),
            }
          ).status
        ).toBe(0);
        const [entry] = readBgRegistry(tmpDir);

        expect(run(["bg", "clean", "--all"], { env: bgEnv() }).status).toBe(0);

        expect(isPidAlive(entry.pid)).toBe(true);
        expect(readBgRegistry(tmpDir)).toHaveLength(1);
      });

      it("portless clean stops bg entries before removing state", async () => {
        const appPort = await getFreePort();
        expect(
          run(
            [
              "bg",
              "start",
              "--name",
              "clean-all",
              "--app-port",
              String(appPort),
              ...longRunningCommand(),
            ],
            {
              env: bgEnv(),
            }
          ).status
        ).toBe(0);
        const [entry] = readBgRegistry(tmpDir);

        expect(run(["clean"], { env: bgEnv() }).status).toBe(0);

        await expect(waitForPidGone(entry.pid)).resolves.toBe(true);
        expect(fs.existsSync(path.join(tmpDir, "bg"))).toBe(false);
      });

      it("portless prune removes dead bg entries without stopping live entries", async () => {
        const livePort = await getFreePort();
        const deadPort = await getFreePort();
        expect(
          run(
            [
              "bg",
              "start",
              "--name",
              "live-prune",
              "--app-port",
              String(livePort),
              ...longRunningCommand(),
            ],
            {
              env: bgEnv(),
            }
          ).status
        ).toBe(0);
        expect(
          run(
            [
              "bg",
              "start",
              "--name",
              "dead-prune",
              "--app-port",
              String(deadPort),
              ...longRunningCommand(),
            ],
            {
              env: bgEnv(),
            }
          ).status
        ).toBe(0);
        const entries = readBgRegistry(tmpDir);
        const live = entries.find((entry) => entry.label === "live-prune")!;
        const dead = entries.find((entry) => entry.label === "dead-prune")!;
        killProcessGroup(dead.pid);
        await expect(waitForPidGone(dead.pid)).resolves.toBe(true);

        expect(run(["prune"], { env: bgEnv() }).status).toBe(0);

        const labels = readBgRegistry(tmpDir).map((entry) => entry.label);
        expect(labels).toEqual(["live-prune"]);
        expect(isPidAlive(live.pid)).toBe(true);
      });

      it("managed tunnel aliases are removed for stopped bg entries", async () => {
        const appPort = await getFreePort();
        writeCloudflaredShim(tmpDir, "https://stop-bg.trycloudflare.com");
        expect(
          run(
            [
              "bg",
              "start",
              "--name",
              "tunnel-stop",
              "--tunnel",
              "cloudflare",
              "--app-port",
              String(appPort),
              ...longRunningCommand(),
            ],
            { env: bgEnv({ PATH: prependPath(tmpDir) }) }
          ).status
        ).toBe(0);
        expect(fs.existsSync(path.join(tmpDir, "tunnel-aliases.json"))).toBe(true);

        expect(run(["bg", "stop", "tunnel-stop", "--force"], { env: bgEnv() }).status).toBe(0);

        const aliases = JSON.parse(
          fs.readFileSync(path.join(tmpDir, "tunnel-aliases.json"), "utf-8")
        ) as unknown[];
        expect(aliases).toEqual([]);
      });
    });
  });

  describe("PORTLESS=0 bypass", () => {
    it("runs command directly when PORTLESS=0 is set", () => {
      const { status, stdout } = run(["myapp", "echo", "hello"], {
        env: { PORTLESS: "0" },
      });
      expect(status).toBe(0);
      expect(stdout.trim()).toBe("hello");
    });

    it("runs command directly when PORTLESS=skip is set", () => {
      const { status, stdout } = run(["myapp", "echo", "bypassed"], {
        env: { PORTLESS: "skip" },
      });
      expect(status).toBe(0);
      expect(stdout.trim()).toBe("bypassed");
    });

    it("does not bypass proxy commands when PORTLESS=0 is set", async () => {
      // 'proxy stop' should still be handled as a proxy command, not bypassed
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "portless-bypass-proxy-"));
      const proxyPort = await getFreePort();
      const { stderr } = run(["proxy", "stop"], {
        env: {
          PORTLESS: "0",
          PORTLESS_PORT: proxyPort.toString(),
          PORTLESS_STATE_DIR: tmpDir,
        },
      });
      fs.rmSync(tmpDir, { recursive: true, force: true });
      // Should not try to run "stop" as a shell command
      expect(stderr).not.toContain("ENOENT");
    });

    it("passes through exit code from bypassed command", () => {
      const { status } = run(["myapp", "node", "-e", "process.exit(42)"], {
        env: { PORTLESS: "0" },
      });
      expect(status).toBe(42);
    });

    it("hoists leading child env assignments in named mode", () => {
      const { status, stdout } = run(
        ["myapp", "GREETING=hi", process.execPath, "-e", "console.log(process.env.GREETING)"],
        { env: { PORTLESS: "0" } }
      );
      expect(status).toBe(0);
      expect(stdout.trim()).toBe("hi");
    });

    it("hoists multiple leading child env assignments", () => {
      const { status, stdout } = run(
        [
          "myapp",
          "A=one",
          "B=two",
          process.execPath,
          "-e",
          "console.log(`${process.env.A}:${process.env.B}`)",
        ],
        { env: { PORTLESS: "0" } }
      );
      expect(status).toBe(0);
      expect(stdout.trim()).toBe("one:two");
    });
  });

  describe("PORTLESS=0 bypass with run subcommand", () => {
    it("runs command directly in run mode", () => {
      const { status, stdout } = run(["run", "echo", "hello"], {
        env: { PORTLESS: "0" },
      });
      expect(status).toBe(0);
      expect(stdout.trim()).toBe("hello");
    });

    it("strips --force but passes child --force through", () => {
      const { status, stdout } = run(["run", "--force", "echo", "--force", "kept"], {
        env: { PORTLESS: "0" },
      });
      expect(status).toBe(0);
      expect(stdout.trim()).toBe("--force kept");
    });

    it("passes -- separator through to child command", () => {
      const { status, stdout } = run(["run", "--", "echo", "hello"], {
        env: { PORTLESS: "0" },
      });
      expect(status).toBe(0);
      expect(stdout.trim()).toBe("hello");
    });

    it("hoists leading child env assignments in run mode", () => {
      const { status, stdout } = run(
        ["run", "GREETING=hi", process.execPath, "-e", "console.log(process.env.GREETING)"],
        {
          env: { PORTLESS: "0" },
        }
      );
      expect(status).toBe(0);
      expect(stdout.trim()).toBe("hi");
    });

    it("does not hoist env assignments after an explicit separator", () => {
      const { status, stdout, stderr } = run(
        ["run", "--", "GREETING=hi", process.execPath, "-e", "console.log(process.env.GREETING)"],
        {
          env: { PORTLESS: "0" },
        }
      );
      expect(status).not.toBe(0);
      expect(stdout.trim()).toBe("");
      expect(stderr).toContain("GREETING=hi");
    });
  });

  describe("--force positioning", () => {
    it("accepts --force before name (PORTLESS=0)", () => {
      const { status, stdout } = run(["--force", "myapp", "echo", "ok"], {
        env: { PORTLESS: "0" },
      });
      expect(status).toBe(0);
      expect(stdout.trim()).toBe("ok");
    });

    it("accepts --force after name (PORTLESS=0)", () => {
      const { status, stdout } = run(["myapp", "--force", "echo", "ok"], {
        env: { PORTLESS: "0" },
      });
      expect(status).toBe(0);
      expect(stdout.trim()).toBe("ok");
    });

    it("does not strip child command --force (PORTLESS=0)", () => {
      const { status, stdout } = run(["myapp", "echo", "--force", "kept"], {
        env: { PORTLESS: "0" },
      });
      expect(status).toBe(0);
      expect(stdout.trim()).toBe("--force kept");
    });
  });

  describe("unknown flag detection", () => {
    it("rejects unknown flags before command", () => {
      const { status, stderr } = run(["--forec", "myapp", "echo", "test"]);
      expect(status).toBe(1);
      expect(stderr).toContain("Unknown flag");
    });

    it("explains that --wildcard belongs to proxy start in run mode", () => {
      const { status, stderr } = run(["run", "--wildcard", "echo", "test"]);
      expect(status).toBe(1);
      expect(stderr).toContain("--wildcard is a proxy-level flag");
      expect(stderr).toContain("portless proxy stop && portless proxy start --wildcard");
    });

    it("explains that --wildcard belongs to proxy start in named mode", () => {
      const { status, stderr } = run(["myapp", "--wildcard", "echo", "test"]);
      expect(status).toBe(1);
      expect(stderr).toContain("--wildcard is a proxy-level flag");
      expect(stderr).toContain("portless proxy stop && portless proxy start --wildcard");
    });
  });

  describe("invalid hostname", () => {
    it("exits 1 for hostname with invalid characters", () => {
      // The proxy won't be running, but parseHostname should fail first
      // Note: this will try to runApp which checks proxy first in non-TTY mode
      const { status, stderr } = run(["my@app", "echo", "test"]);
      expect(status).toBe(1);
      expect(stderr).toContain("Invalid hostname");
    });
  });

  describe("run subcommand dispatch", () => {
    it("exits 1 with 'No command provided' when no args follow run and no dev script", () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "portless-cli-run-"));
      try {
        fs.writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify({ name: "test-app" }));
        const { status, stderr } = run(["run"], { cwd: tmpDir });
        expect(status).toBe(1);
        expect(stderr).toContain("No command provided");
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it("does not dispatch 'list' as the global list command", () => {
      // With PORTLESS=0, "run list" should try to exec "list" as a child
      // process (which will ENOENT), not show routes.
      const { stdout } = run(["run", "list"], {
        env: { PORTLESS: "0" },
      });
      // If it mistakenly ran the global "list" handler, status would be 0
      // and stdout would contain route output. Instead it should try to
      // spawn "list" which doesn't exist.
      expect(stdout).not.toContain("Active routes");
      expect(stdout).not.toContain("No active routes");
    });

    it("does not print version for run --version", () => {
      // parseRunArgs rejects unknown flags
      const { status, stderr } = run(["run", "--version"]);
      expect(status).toBe(1);
      expect(stderr).toContain("Unknown flag");
    });

    it("prints run-specific help for run --help", () => {
      const { status, stdout } = run(["run", "--help"]);
      expect(status).toBe(0);
      expect(stdout).toContain("portless run");
      expect(stdout).toContain("--force");
      expect(stdout).toContain("--app-port");
      expect(stdout).toContain("--path");
    });

    it("prints run-specific help for run -h", () => {
      const { status, stdout } = run(["run", "-h"]);
      expect(status).toBe(0);
      expect(stdout).toContain("portless run");
    });
  });

  describe("--app-port flag", () => {
    it("passes --app-port through in bypass mode (PORTLESS=0)", () => {
      const { status, stdout } = run(["run", "--app-port", "4567", "echo", "ok"], {
        env: { PORTLESS: "0" },
      });
      expect(status).toBe(0);
      expect(stdout.trim()).toBe("ok");
    });

    it("rejects invalid --app-port value", () => {
      const { status, stderr } = run(["run", "--app-port", "abc", "echo", "ok"], {
        env: { PORTLESS: "0" },
      });
      expect(status).toBe(1);
      expect(stderr).toContain("Invalid app port");
    });

    it("rejects browser-blocked --app-port values", () => {
      const { status, stderr } = run(["run", "--app-port", "4045", "echo", "ok"], {
        env: { PORTLESS: "0" },
      });
      expect(status).toBe(1);
      expect(stderr).toContain("blocked by browsers");
    });

    it("rejects --app-port without a value", () => {
      const { status, stderr } = run(["run", "--app-port"], {
        env: { PORTLESS: "0" },
      });
      expect(status).toBe(1);
      expect(stderr).toContain("--app-port requires");
    });

    it("accepts --app-port in named mode (PORTLESS=0)", () => {
      const { status, stdout } = run(["myapp", "--app-port", "3000", "echo", "ok"], {
        env: { PORTLESS: "0" },
      });
      expect(status).toBe(0);
      expect(stdout.trim()).toBe("ok");
    });

    it("accepts --h2c in named mode (PORTLESS=0)", () => {
      const { status, stdout } = run(["myapp", "--h2c", "echo", "ok"], {
        env: { PORTLESS: "0" },
      });
      expect(status).toBe(0);
      expect(stdout.trim()).toBe("ok");
    });

    it("accepts PORTLESS_H2C=1 in run mode (PORTLESS=0)", () => {
      const { status, stdout } = run(["run", "echo", "ok"], {
        env: { PORTLESS: "0", PORTLESS_H2C: "1" },
      });
      expect(status).toBe(0);
      expect(stdout.trim()).toBe("ok");
    });

    it("accepts global --h2c before run in bypass mode (PORTLESS=0)", () => {
      const { status, stdout } = run(["--h2c", "run", "echo", "ok"], {
        env: { PORTLESS: "0" },
      });
      expect(status).toBe(0);
      expect(stdout.trim()).toBe("ok");
    });

    it("accepts --path in named mode (PORTLESS=0)", () => {
      const { status, stdout } = run(["myapp", "--path", "/api", "echo", "ok"], {
        env: { PORTLESS: "0" },
      });
      expect(status).toBe(0);
      expect(stdout.trim()).toBe("ok");
    });

    it("accepts --path in run mode (PORTLESS=0)", () => {
      const { status, stdout } = run(["run", "--path", "/api", "echo", "ok"], {
        env: { PORTLESS: "0" },
      });
      expect(status).toBe(0);
      expect(stdout.trim()).toBe("ok");
    });

    it("accepts PORTLESS_PATH in run mode (PORTLESS=0)", () => {
      const { status, stdout } = run(["run", "echo", "ok"], {
        env: { PORTLESS: "0", PORTLESS_PATH: "/api" },
      });
      expect(status).toBe(0);
      expect(stdout.trim()).toBe("ok");
    });

    it("rejects invalid --path values before running the child command", () => {
      const { status, stderr, stdout } = run(["run", "--path", "api", "echo", "ok"], {
        env: { PORTLESS: "0" },
      });
      expect(status).toBe(1);
      expect(stderr).toContain("Invalid path prefix");
      expect(stdout).not.toContain("ok");
    });

    it("rejects browser-blocked PORTLESS_APP_PORT values", () => {
      const { status, stderr } = run(["run", "echo", "ok"], {
        env: { PORTLESS: "0", PORTLESS_APP_PORT: "4045" },
      });
      expect(status).toBe(1);
      expect(stderr).toContain("blocked by browsers");
    });
  });

  describe("alias subcommand", () => {
    it("prints help with --help", () => {
      const { status, stdout } = run(["alias", "--help"]);
      expect(status).toBe(0);
      expect(stdout).toContain("portless alias");
      expect(stdout).toContain("--remove");
      expect(stdout).toContain("--h2c");
    });

    it("prints help with -h", () => {
      const { status, stdout } = run(["alias", "-h"]);
      expect(status).toBe(0);
      expect(stdout).toContain("portless alias");
    });

    it("exits 1 with usage when no args given", () => {
      const { status, stderr } = run(["alias"]);
      expect(status).toBe(1);
      expect(stderr).toContain("Missing arguments");
    });

    it("exits 1 with usage when only name is given", () => {
      const { status, stderr } = run(["alias", "mydb"]);
      expect(status).toBe(1);
      expect(stderr).toContain("Missing arguments");
    });

    it("exits 1 for invalid port", () => {
      const { status, stderr } = run(["alias", "mydb", "notaport"]);
      expect(status).toBe(1);
      expect(stderr).toContain("Invalid port");
    });

    it("exits 1 when --remove has no name", () => {
      const { status, stderr } = run(["alias", "--remove"]);
      expect(status).toBe(1);
      expect(stderr).toContain("No alias name");
    });

    it("registers an h2c alias route", () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "portless-cli-alias-h2c-"));
      try {
        const { status, stdout } = run(["alias", "grpc", "50051", "--h2c"], {
          env: { PORTLESS_STATE_DIR: tmpDir },
        });

        expect(status).toBe(0);
        expect(stdout).toContain("(h2c)");
        expect(JSON.parse(fs.readFileSync(path.join(tmpDir, "routes.json"), "utf-8"))).toEqual([
          {
            hostname: "grpc.localhost",
            port: 50051,
            pid: 0,
            protocol: "h2c",
          },
        ]);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it("registers an alias route at a path prefix", () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "portless-cli-alias-path-"));
      try {
        const { status, stdout } = run(["alias", "api", "4100", "--path", "/v1"], {
          env: { PORTLESS_STATE_DIR: tmpDir },
        });

        expect(status).toBe(0);
        expect(stdout).toContain("/v1");
        expect(JSON.parse(fs.readFileSync(path.join(tmpDir, "routes.json"), "utf-8"))).toEqual([
          {
            hostname: "api.localhost",
            port: 4100,
            pid: 0,
            pathPrefix: "/v1",
          },
        ]);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it("rejects unknown alias flags", () => {
      const { status, stderr } = run(["alias", "grpc", "50051", "--typo"]);
      expect(status).toBe(1);
      expect(stderr).toContain("Unknown flag");
    });
  });

  describe("hosts subcommand", () => {
    it("prints help with --help", () => {
      const { status, stdout } = run(["hosts", "--help"]);
      expect(status).toBe(0);
      expect(stdout).toContain("portless hosts");
      expect(stdout).toContain("sync");
      expect(stdout).toContain("clean");
    });

    it("prints help with -h", () => {
      const { status, stdout } = run(["hosts", "-h"]);
      expect(status).toBe(0);
      expect(stdout).toContain("portless hosts");
    });

    it("shows usage for bare 'hosts' without subcommand", () => {
      const { status, stdout } = run(["hosts"]);
      expect(status).toBe(0);
      expect(stdout).toContain("sync");
      expect(stdout).toContain("clean");
    });

    it("rejects unknown hosts subcommand", () => {
      const { status, stderr } = run(["hosts", "typo"]);
      expect(status).toBe(1);
      expect(stderr).toContain("Unknown hosts subcommand");
    });
  });

  describe("clean subcommand", () => {
    it("prints help with --help", () => {
      const { status, stdout } = run(["clean", "--help"]);
      expect(status).toBe(0);
      expect(stdout).toContain("portless clean");
      expect(stdout).toContain("trust store");
    });

    it("prints help with -h", () => {
      const { status, stdout } = run(["clean", "-h"]);
      expect(status).toBe(0);
      expect(stdout).toContain("portless clean");
    });

    it("rejects unknown arguments", () => {
      const { status, stderr } = run(["clean", "typo"]);
      expect(status).toBe(1);
      expect(stderr).toContain("Unknown argument");
    });

    it("does not bypass when PORTLESS=0 is set", () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "portless-bypass-clean-"));
      const { stderr } = run(["clean"], {
        env: {
          PORTLESS: "0",
          PORTLESS_STATE_DIR: tmpDir,
        },
      });
      fs.rmSync(tmpDir, { recursive: true, force: true });
      expect(stderr).not.toContain("ENOENT");
    });

    it("does not bypass clean with extra args when PORTLESS=0", () => {
      const { status, stderr } = run(["clean", "typo"], { env: { PORTLESS: "0" } });
      expect(status).toBe(1);
      expect(stderr).toContain("Unknown argument");
    });
  });

  describe("tunnel subcommand", () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "portless-cli-tunnel-test-"));
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it("prints help with --help", () => {
      const { status, stdout } = run(["tunnel", "--help"]);
      expect(status).toBe(0);
      expect(stdout).toContain("portless tunnel");
      expect(stdout).toContain("map");
      expect(stdout).toContain("unmap");
      expect(stdout).toContain("list");
    });

    it("maps, lists, and unmaps exact tunnel aliases", () => {
      const env = { PORTLESS_STATE_DIR: tmpDir };

      const mapped = run(["tunnel", "map", "myapp", "public.example.com", "--path", "/api"], {
        env,
      });
      expect(mapped.status).toBe(0);
      expect(mapped.stdout).toContain("public.example.com");

      const listed = run(["tunnel", "list", "--json"], { env });
      expect(listed.status).toBe(0);
      expect(JSON.parse(listed.stdout)).toEqual([
        {
          externalHostname: "public.example.com",
          targetHostname: "myapp.localhost",
          targetPathPrefix: "/api",
        },
      ]);

      const unmapped = run(["tunnel", "unmap", "public.example.com"], { env });
      expect(unmapped.status).toBe(0);
      expect(unmapped.stdout).toContain("Removed tunnel alias");
      expect(
        JSON.parse(fs.readFileSync(path.join(tmpDir, "tunnel-aliases.json"), "utf-8"))
      ).toEqual([]);
    });

    it("rejects invalid external tunnel hostnames", () => {
      const { status, stderr } = run(["tunnel", "map", "myapp", "https://public.example.com"], {
        env: { PORTLESS_STATE_DIR: tmpDir },
      });

      expect(status).toBe(1);
      expect(stderr).toContain("Invalid tunnel hostname");
    });
  });

  describe("proxy subcommand", () => {
    it("prints help with --help", () => {
      const { status, stdout } = run(["proxy", "--help"]);
      expect(status).toBe(0);
      expect(stdout).toContain("portless proxy");
      expect(stdout).toContain("start");
      expect(stdout).toContain("stop");
    });

    it("prints help with -h", () => {
      const { status, stdout } = run(["proxy", "-h"]);
      expect(status).toBe(0);
      expect(stdout).toContain("portless proxy");
    });

    it("shows usage for bare 'proxy' without subcommand", () => {
      const { status, stdout } = run(["proxy"]);
      expect(status).toBe(0);
      expect(stdout).toContain("start");
      expect(stdout).toContain("stop");
    });

    it("exits 1 for unknown proxy subcommand", () => {
      const { status } = run(["proxy", "typo"]);
      expect(status).toBe(1);
    });

    it("warns when a running proxy uses a different explicit config", async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "portless-cli-running-proxy-"));
      const server = http.createServer((_req, res) => {
        res.setHeader("X-Portless", "1");
        res.end("ok");
      });

      try {
        const proxyPort = await new Promise<number>((resolve) => {
          server.listen(0, "127.0.0.1", () => {
            const addr = server.address();
            if (addr && typeof addr !== "string") {
              resolve(addr.port);
            }
          });
        });

        fs.writeFileSync(path.join(tmpDir, "proxy.port"), proxyPort.toString());

        const { status, stderr } = run(["proxy", "start", "--lan"], {
          env: { PORTLESS_STATE_DIR: tmpDir },
        });

        expect(status).toBe(1);
        expect(stderr).toContain("Proxy is already running on port");
        expect(stderr).toContain("requested LAN mode");
        expect(stderr).toContain("portless proxy stop");
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });

  describe("persisted LAN marker", () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "portless-cli-lan-marker-"));
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it.skipIf(process.platform === "win32")(
      "reuses persisted LAN mode when starting the proxy again",
      async () => {
        const proxyPort = await getFreePort();
        const emptyPath = fs.mkdtempSync(path.join(os.tmpdir(), "portless-empty-path-"));

        fs.writeFileSync(path.join(tmpDir, "proxy.lan"), "192.168.1.42");

        try {
          const { status, stderr } = run(["proxy", "start"], {
            env: {
              PATH: emptyPath,
              PORTLESS_STATE_DIR: tmpDir,
              PORTLESS_PORT: proxyPort.toString(),
            },
          });

          expect(status).toBe(1);
          expect(stderr).toContain("LAN mode requires mDNS publishing");
        } finally {
          fs.rmSync(emptyPath, { recursive: true, force: true });
        }
      }
    );

    it("PORTLESS_LAN=0 overrides the LAN marker on a fresh start", async () => {
      const proxyPort = await getFreePort();
      const env = {
        PORTLESS_STATE_DIR: tmpDir,
        PORTLESS_PORT: proxyPort.toString(),
        PORTLESS_LAN: "0",
        PORTLESS_HTTPS: "0",
      };

      fs.writeFileSync(path.join(tmpDir, "proxy.lan"), "192.168.1.42");

      try {
        const { status, stdout } = run(["myapp", "node", "-e", "process.exit(0)"], { env });
        expect(status).toBe(0);
        expect(stdout).toContain(`http://myapp.localhost:${proxyPort}`);
        expect(fs.existsSync(path.join(tmpDir, "proxy.lan"))).toBe(false);
      } finally {
        run(["proxy", "stop"], { env });
      }
    });
  });

  describe("LAN mode", () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "portless-cli-lan-test-"));
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it.skipIf(process.platform === "win32")("warns when --lan and --tld are both provided", () => {
      // Use an empty PATH so the mDNS check fails early, causing the
      // process to exit without needing a running proxy server (spawnSync
      // blocks the parent event loop, preventing a fake server from responding).
      const emptyPath = fs.mkdtempSync(path.join(os.tmpdir(), "portless-empty-path-"));
      try {
        const { status, stderr } = run(
          ["proxy", "start", "--lan", "--tld", "test", "--ip", "192.168.1.42"],
          {
            env: {
              PATH: emptyPath,
              PORTLESS_STATE_DIR: tmpDir,
              PORTLESS_PORT: "19876",
            },
          }
        );
        expect(status).toBe(1);
        expect(stderr).toContain("--lan forces .local suffix");
        expect(stderr).toContain("Ignoring --tld test");
      } finally {
        fs.rmSync(emptyPath, { recursive: true, force: true });
      }
    });

    it.skipIf(process.platform === "win32")(
      "fails early when the mDNS publisher binary is missing",
      () => {
        const emptyPath = fs.mkdtempSync(path.join(os.tmpdir(), "portless-empty-path-"));
        try {
          const { status, stderr, stdout } = run(
            ["proxy", "start", "--foreground", "--lan", "--ip", "192.168.1.42"],
            {
              env: {
                PATH: emptyPath,
                PORTLESS_PORT: "19876",
                PORTLESS_STATE_DIR: tmpDir,
              },
            }
          );

          expect(status).toBe(1);
          expect(stderr).toContain("LAN mode requires mDNS publishing");
          expect(stderr).toContain(
            process.platform === "linux" ? "avahi-publish-address not found" : "dns-sd not found"
          );
          expect(stdout).not.toContain("LAN mode active");
        } finally {
          fs.rmSync(emptyPath, { recursive: true, force: true });
        }
      }
    );

    it("propagates the LAN marker into expo child commands", async () => {
      const server = http.createServer((_req, res) => {
        res.setHeader("X-Portless", "1");
        res.end("ok");
      });
      const shimDir = fs.mkdtempSync(path.join(os.tmpdir(), "portless-expo-shim-"));
      const capturePath = path.join(shimDir, "capture.json");

      try {
        const proxyPort = await new Promise<number>((resolve) => {
          server.listen(0, "127.0.0.1", () => {
            const addr = server.address();
            if (addr && typeof addr !== "string") {
              resolve(addr.port);
            }
          });
        });

        fs.writeFileSync(path.join(tmpDir, "proxy.port"), proxyPort.toString());
        fs.writeFileSync(path.join(tmpDir, "proxy.tld"), "local");
        fs.writeFileSync(path.join(tmpDir, "proxy.lan"), "192.168.1.42");
        writeExpoShim(shimDir);

        const { status } = run(["run", "--name", "mobile", "--app-port", "4567", "expo", "start"], {
          env: {
            PATH: prependPath(shimDir),
            PORTLESS_STATE_DIR: tmpDir,
            PORTLESS_TEST_CAPTURE_FILE: capturePath,
            PORTLESS_HTTPS: "0",
          },
        });

        expect(status).toBe(0);

        const capture = JSON.parse(fs.readFileSync(capturePath, "utf-8")) as {
          args: string[];
          env: Record<string, string>;
        };

        // In LAN mode, Expo gets no --host flag (Metro defaults to LAN)
        // and no HOST env var (avoids conflict with Metro's LAN networking)
        expect(capture.args).toEqual(["start", "--port", "4567"]);
        expect(capture.env).toMatchObject({
          PORT: "4567",
          PORTLESS_LAN: "1",
          PORTLESS_URL: `http://mobile.local:${proxyPort}`,
        });
        expect(capture.env.HOST).toBeUndefined();
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
        fs.rmSync(shimDir, { recursive: true, force: true });
      }
    });
  });

  describe("Rsbuild flag injection", () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "portless-cli-rsbuild-test-"));
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    function writeRsbuildShim(dir: string): void {
      const captureScriptPath = path.join(dir, "capture-rsbuild.js");
      fs.writeFileSync(
        captureScriptPath,
        [
          'const fs = require("node:fs");',
          "const capturePath = process.env.PORTLESS_TEST_CAPTURE_FILE;",
          "const payload = {",
          "  args: process.argv.slice(2),",
          "  env: {",
          "    PORT: process.env.PORT,",
          "    HOST: process.env.HOST,",
          "    PORTLESS_URL: process.env.PORTLESS_URL,",
          "  },",
          "};",
          "fs.writeFileSync(capturePath, JSON.stringify(payload));",
        ].join("\n") + "\n"
      );

      if (process.platform === "win32") {
        fs.writeFileSync(
          path.join(dir, "rsbuild.cmd"),
          `@echo off\r\n"${process.execPath}" "${captureScriptPath}" %*\r\n`
        );
        return;
      }

      const shimPath = path.join(dir, "rsbuild");
      fs.writeFileSync(shimPath, `#!/bin/sh\n"${process.execPath}" "${captureScriptPath}" "$@"\n`);
      fs.chmodSync(shimPath, 0o755);
    }

    it("injects --port and --host into rsbuild child commands", async () => {
      const server = http.createServer((_req, res) => {
        res.setHeader("X-Portless", "1");
        res.end("ok");
      });
      const shimDir = fs.mkdtempSync(path.join(os.tmpdir(), "portless-rsbuild-shim-"));
      const capturePath = path.join(shimDir, "capture.json");

      try {
        const proxyPort = await new Promise<number>((resolve) => {
          server.listen(0, "127.0.0.1", () => {
            const addr = server.address();
            if (addr && typeof addr !== "string") {
              resolve(addr.port);
            }
          });
        });

        fs.writeFileSync(path.join(tmpDir, "proxy.port"), proxyPort.toString());

        writeRsbuildShim(shimDir);

        const { status } = run(["run", "--name", "myapp", "--app-port", "4567", "rsbuild", "dev"], {
          env: {
            PATH: prependPath(shimDir),
            PORTLESS_STATE_DIR: tmpDir,
            PORTLESS_TEST_CAPTURE_FILE: capturePath,
            PORTLESS_HTTPS: "0",
          },
        });

        expect(status).toBe(0);

        const capture = JSON.parse(fs.readFileSync(capturePath, "utf-8")) as {
          args: string[];
          env: Record<string, string>;
        };

        expect(capture.args).toEqual(["dev", "--port", "4567", "--host", "127.0.0.1"]);
        expect(capture.env).toMatchObject({
          PORT: "4567",
          HOST: "127.0.0.1",
          PORTLESS_URL: `http://myapp.localhost:${proxyPort}`,
        });
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
        fs.rmSync(shimDir, { recursive: true, force: true });
      }
    });
  });

  describe("NODE_EXTRA_CA_CERTS injection", () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "portless-cli-ca-test-"));
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    async function runWithMockProxy(opts: {
      tls?: boolean;
      writeCaPem?: boolean;
      env?: Record<string, string | undefined>;
    }): Promise<{ status: number | null; capture: Record<string, unknown> }> {
      const server = http.createServer((_req, res) => {
        res.setHeader("X-Portless", "1");
        res.end("ok");
      });

      try {
        const proxyPort = await new Promise<number>((resolve) => {
          server.listen(0, "127.0.0.1", () => {
            const addr = server.address();
            if (addr && typeof addr !== "string") {
              resolve(addr.port);
            }
          });
        });

        fs.writeFileSync(path.join(tmpDir, "proxy.port"), proxyPort.toString());
        if (opts.tls !== false) {
          fs.writeFileSync(path.join(tmpDir, "proxy.tls"), "1");
        }
        if (opts.writeCaPem !== false) {
          fs.writeFileSync(path.join(tmpDir, "ca.pem"), TEST_CA_PEM);
        }

        const capturePath = path.join(tmpDir, "capture.json");
        const scriptPath = path.join(tmpDir, "capture-env.js");
        fs.writeFileSync(
          scriptPath,
          [
            'const fs = require("node:fs");',
            `fs.writeFileSync(${JSON.stringify(capturePath)}, JSON.stringify({`,
            "  NODE_EXTRA_CA_CERTS: process.env.NODE_EXTRA_CA_CERTS,",
            "}));",
          ].join("\n") + "\n"
        );

        const { status } = run(["run", "--name", "testapp", "node", scriptPath], {
          env: { PORTLESS_STATE_DIR: tmpDir, ...opts.env },
        });

        const capture = fs.existsSync(capturePath)
          ? JSON.parse(fs.readFileSync(capturePath, "utf-8"))
          : {};
        return { status, capture };
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    }

    it("sets NODE_EXTRA_CA_CERTS when TLS is active and ca.pem exists", async () => {
      const { status, capture } = await runWithMockProxy({
        env: { NODE_EXTRA_CA_CERTS: undefined },
      });
      expect(status).toBe(0);
      expect(capture.NODE_EXTRA_CA_CERTS).toBe(path.join(tmpDir, "ca.pem"));
    });

    it("does not set NODE_EXTRA_CA_CERTS when TLS is disabled", async () => {
      const { status, capture } = await runWithMockProxy({
        tls: false,
        env: { PORTLESS_HTTPS: "0", NODE_EXTRA_CA_CERTS: undefined },
      });
      expect(status).toBe(0);
      expect(capture.NODE_EXTRA_CA_CERTS).toBeUndefined();
    });

    it("does not set NODE_EXTRA_CA_CERTS when ca.pem is missing", async () => {
      const { status, capture } = await runWithMockProxy({
        writeCaPem: false,
        env: { NODE_EXTRA_CA_CERTS: undefined },
      });
      expect(status).toBe(0);
      expect(capture.NODE_EXTRA_CA_CERTS).toBeUndefined();
    });

    it("does not override user-set NODE_EXTRA_CA_CERTS", async () => {
      const userCaPath = "/custom/ca.pem";
      const { status, capture } = await runWithMockProxy({
        env: { NODE_EXTRA_CA_CERTS: userCaPath },
      });
      expect(status).toBe(0);
      expect(capture.NODE_EXTRA_CA_CERTS).toBe(userCaPath);
    });

    it("does not apply child PORTLESS env assignments to portless itself", async () => {
      const server = http.createServer((_req, res) => {
        res.setHeader("X-Portless", "1");
        res.end("ok");
      });

      try {
        const proxyPort = await new Promise<number>((resolve) => {
          server.listen(0, "127.0.0.1", () => {
            const addr = server.address();
            if (addr && typeof addr !== "string") {
              resolve(addr.port);
            }
          });
        });

        fs.writeFileSync(path.join(tmpDir, "proxy.port"), proxyPort.toString());

        const { status, stdout, stderr } = run(
          [
            "myapp",
            "PORTLESS_TAILSCALE=1",
            process.execPath,
            "-e",
            "console.log(process.env.PORTLESS_TAILSCALE)",
          ],
          {
            env: {
              PORTLESS_STATE_DIR: tmpDir,
              PORTLESS_HTTPS: "0",
              PATH: "/tmp/portless-no-ts-path",
            },
          }
        );

        expect(status).toBe(0);
        expect(stdout).toContain("\n1\n");
        expect(stderr).not.toContain("Tailscale");
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });
  });

  describe("get subcommand", () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "portless-cli-get-test-"));
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    const getEnv = () => ({ PORTLESS_STATE_DIR: tmpDir });

    it("prints help with --help", () => {
      const { status, stdout } = run(["get", "--help"]);
      expect(status).toBe(0);
      expect(stdout).toContain("portless get");
      expect(stdout).toContain("--no-worktree");
      expect(stdout).toContain("--json");
      expect(stdout).toContain("--path");
    });

    it("prints help with -h", () => {
      const { status, stdout } = run(["get", "-h"]);
      expect(status).toBe(0);
      expect(stdout).toContain("portless get");
    });

    it("prints help through the url alias", () => {
      const { status, stdout } = run(["url", "--help"]);
      expect(status).toBe(0);
      expect(stdout).toContain("portless get");
      expect(stdout).toContain("--no-worktree");
    });

    it("exits 1 with usage when no name given", () => {
      const { status, stderr } = run(["get"]);
      expect(status).toBe(1);
      expect(stderr).toContain("Missing service name");
    });

    it("exits 1 with usage when no name is given through the url alias", () => {
      const { status, stderr } = run(["url"]);
      expect(status).toBe(1);
      expect(stderr).toContain("Missing service name");
    });

    it("prints URL for a given service name", () => {
      const { status, stdout } = run(["get", "backend"], { env: getEnv() });
      expect(status).toBe(0);
      expect(stdout.trim()).toMatch(/^https?:\/\/backend\.localhost(:\d+)?$/);
    });

    it("prints URL for a dotted service name", () => {
      const { status, stdout } = run(["get", "api.backend"], { env: getEnv() });
      expect(status).toBe(0);
      expect(stdout.trim()).toMatch(/^https?:\/\/api\.backend\.localhost(:\d+)?$/);
    });

    it("prints URL through the url alias", () => {
      const { status, stdout } = run(["url", "backend"], { env: getEnv() });
      expect(status).toBe(0);
      expect(stdout.trim()).toMatch(/^https?:\/\/backend\.localhost(:\d+)?$/);
    });

    it("prints service info as JSON", () => {
      fs.writeFileSync(path.join(tmpDir, "proxy.port"), "443");
      fs.writeFileSync(path.join(tmpDir, "proxy.tls"), "1");

      const { status, stdout } = run(["get", "backend", "--json"], { env: getEnv() });

      expect(status).toBe(0);
      expect(JSON.parse(stdout)).toEqual({
        name: "backend",
        hostname: "backend.localhost",
        url: "https://backend.localhost",
        path_prefix: "/",
        proxy_port: 443,
        tls: true,
        tld: "localhost",
      });
    });

    it("prints service URL with a path prefix", () => {
      fs.writeFileSync(path.join(tmpDir, "proxy.port"), "1355");

      const { status, stdout } = run(["get", "backend", "--path", "/api"], { env: getEnv() });

      expect(status).toBe(0);
      expect(stdout.trim()).toBe("http://backend.localhost:1355/api");
    });

    it("prints service JSON with a path prefix from PORTLESS_PATH", () => {
      fs.writeFileSync(path.join(tmpDir, "proxy.port"), "1355");

      const { status, stdout } = run(["get", "backend", "--json"], {
        env: { ...getEnv(), PORTLESS_PATH: "/api" },
      });

      expect(status).toBe(0);
      expect(JSON.parse(stdout)).toMatchObject({
        hostname: "backend.localhost",
        url: "http://backend.localhost:1355/api",
        path_prefix: "/api",
      });
    });

    it("prints service info as JSON through the url alias", () => {
      fs.writeFileSync(path.join(tmpDir, "proxy.port"), "1355");

      const { status, stdout } = run(["url", "backend", "--json"], { env: getEnv() });

      expect(status).toBe(0);
      expect(JSON.parse(stdout)).toMatchObject({
        name: "backend",
        hostname: "backend.localhost",
        url: "http://backend.localhost:1355",
        proxy_port: 1355,
        tls: false,
        tld: "localhost",
      });
    });

    it("preserves url as an app name when followed by a command", () => {
      const { status, stdout } = run(
        ["url", process.execPath, "-e", "console.log('app-named-url')"],
        {
          env: { PORTLESS: "0" },
        }
      );
      expect(status).toBe(0);
      expect(stdout.trim()).toBe("app-named-url");
    });

    it("rejects unknown flags", () => {
      const { status, stderr } = run(["get", "--typo", "backend"]);
      expect(status).toBe(1);
      expect(stderr).toContain("Unknown flag");
    });

    it("accepts --no-worktree flag", () => {
      const { status, stdout } = run(["get", "--no-worktree", "backend"], { env: getEnv() });
      expect(status).toBe(0);
      expect(stdout.trim()).toMatch(/^https?:\/\/backend\.localhost(:\d+)?$/);
    });

    it("accepts --no-worktree before the name through the url alias", () => {
      const { status, stdout } = run(["url", "--no-worktree", "backend"], { env: getEnv() });
      expect(status).toBe(0);
      expect(stdout.trim()).toMatch(/^https?:\/\/backend\.localhost(:\d+)?$/);
    });

    it("accepts --no-worktree after the name through the url alias", () => {
      const { status, stdout } = run(["url", "backend", "--no-worktree"], { env: getEnv() });
      expect(status).toBe(0);
      expect(stdout.trim()).toMatch(/^https?:\/\/backend\.localhost(:\d+)?$/);
    });

    it("exits 1 for invalid hostname", () => {
      const { status, stderr } = run(["get", "my@app"]);
      expect(status).toBe(1);
      expect(stderr).toContain("Invalid hostname");
    });
  });

  describe("--name flag", () => {
    it("treats reserved word as app name with PORTLESS=0", () => {
      const { status, stdout } = run(["--name", "run", "echo", "ok"], {
        env: { PORTLESS: "0" },
      });
      expect(status).toBe(0);
      expect(stdout.trim()).toBe("ok");
    });

    it("passes --force through with --name (PORTLESS=0)", () => {
      const { status, stdout } = run(["--name", "alias", "--force", "echo", "ok"], {
        env: { PORTLESS: "0" },
      });
      expect(status).toBe(0);
      expect(stdout.trim()).toBe("ok");
    });

    it("exits 1 when --name has no value", () => {
      const { status, stderr } = run(["--name"]);
      expect(status).toBe(1);
      expect(stderr).toContain("--name requires");
    });

    it("exits 1 when --name has name but no command", () => {
      const { status, stderr } = run(["--name", "myapp"]);
      expect(status).toBe(1);
      expect(stderr).toContain("No command provided");
    });
  });

  describe("run --name flag", () => {
    it("shows --name in run help", () => {
      const { status, stdout } = run(["run", "--help"]);
      expect(status).toBe(0);
      expect(stdout).toContain("--name");
    });

    it("strips --name and passes command through (PORTLESS=0)", () => {
      const { status, stdout } = run(["run", "--name", "custom", "echo", "ok"], {
        env: { PORTLESS: "0" },
      });
      expect(status).toBe(0);
      expect(stdout.trim()).toBe("ok");
    });

    it("exits 1 when --name has no value", () => {
      const { status, stderr } = run(["run", "--name"]);
      expect(status).toBe(1);
      expect(stderr).toContain("--name requires");
    });

    it("exits 1 when --name value looks like a flag", () => {
      const { status, stderr } = run(["run", "--name", "--force", "echo", "ok"]);
      expect(status).toBe(1);
      expect(stderr).toContain("--name requires");
    });

    it("combines --name with --force (PORTLESS=0)", () => {
      const { status, stdout } = run(["run", "--name", "foo", "--force", "echo", "ok"], {
        env: { PORTLESS: "0" },
      });
      expect(status).toBe(0);
      expect(stdout.trim()).toBe("ok");
    });

    it("does not consume --name after -- separator (PORTLESS=0)", () => {
      const { status, stdout } = run(["run", "--", "echo", "--name", "foo"], {
        env: { PORTLESS: "0" },
      });
      expect(status).toBe(0);
      expect(stdout.trim()).toBe("--name foo");
    });
  });

  describe("proxy start/stop lifecycle", () => {
    let tmpDir: string;
    let testPort: number;

    const proxyEnv = () => ({
      PORTLESS_PORT: String(testPort),
      PORTLESS_HTTPS: "0",
      PORTLESS_STATE_DIR: tmpDir,
    });

    beforeEach(async () => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "portless-lifecycle-"));
      testPort = await getFreePort();
    });

    afterEach(() => {
      // Ensure proxy is stopped even if a test fails
      run(["proxy", "stop"], { env: proxyEnv() });
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it("starts the proxy and stops it cleanly", () => {
      const start = run(["proxy", "start"], { env: proxyEnv() });
      expect(start.status).toBe(0);
      expect(start.stdout).toContain(`proxy started on port ${testPort}`);

      const stop = run(["proxy", "stop"], { env: proxyEnv() });
      expect(stop.status).toBe(0);
      expect(stop.stdout).toContain("Proxy stopped");
    });

    it("reports not running when stopped twice", () => {
      const start = run(["proxy", "start"], { env: proxyEnv() });
      expect(start.status).toBe(0);

      const stop1 = run(["proxy", "stop"], { env: proxyEnv() });
      expect(stop1.status).toBe(0);

      const stop2 = run(["proxy", "stop"], { env: proxyEnv() });
      expect(stop2.stdout).toContain("not running");
    });

    it("detects an already-running proxy on start", () => {
      const start1 = run(["proxy", "start"], { env: proxyEnv() });
      expect(start1.status).toBe(0);

      const start2 = run(["proxy", "start"], { env: proxyEnv() });
      expect(start2.stdout).toContain("already running");
    });

    it("does not report a config mismatch when an already-running proxy uses wildcard mode", () => {
      const start1 = run(["proxy", "start", "--wildcard"], { env: proxyEnv() });
      expect(start1.status).toBe(0);

      const start2 = run(["proxy", "start", "--wildcard"], { env: proxyEnv() });
      expect(start2.stdout).toContain("already running");
      expect(start2.stderr).not.toContain("different config");
    });

    it("rejects widening a running strict proxy to wildcard mode without restart", () => {
      const start1 = run(["proxy", "start"], { env: proxyEnv() });
      expect(start1.status).toBe(0);

      const start2 = run(["proxy", "start", "--wildcard"], { env: proxyEnv() });
      expect(start2.status).toBe(1);
      expect(start2.stderr).toContain("different config");
      expect(start2.stderr).toContain("wildcard");
    });

    it.skipIf(process.platform === "win32")(
      "warns when LAN mode and wildcard mode are both requested",
      () => {
        const emptyPath = fs.mkdtempSync(path.join(os.tmpdir(), "portless-empty-path-"));
        try {
          const { status, stderr } = run(
            ["proxy", "start", "--lan", "--wildcard", "--ip", "192.168.1.42"],
            {
              env: {
                PATH: emptyPath,
                PORTLESS_STATE_DIR: tmpDir,
                PORTLESS_PORT: String(testPort),
              },
            }
          );
          expect(status).toBe(1);
          expect(stderr).toContain("--wildcard has no effect in LAN mode");
        } finally {
          fs.rmSync(emptyPath, { recursive: true, force: true });
        }
      }
    );

    it("stops proxy using explicit -p flag instead of env var", () => {
      const start = run(["proxy", "start"], { env: proxyEnv() });
      expect(start.status).toBe(0);

      // Stop without PORTLESS_PORT, using -p instead
      const stop = run(["proxy", "stop", "-p", String(testPort)], {
        env: { PORTLESS_HTTPS: "0", PORTLESS_STATE_DIR: tmpDir },
      });
      expect(stop.status).toBe(0);
      expect(stop.stdout).toContain("Proxy stopped");
    });

    it("accepts --suffix for proxy start", () => {
      const start = run(["proxy", "start", "--suffix", "server01.acme.com"], { env: proxyEnv() });
      expect(start.status).toBe(0);
      expect(start.stdout).toContain(`proxy started on port ${testPort}`);
      expect(fs.readFileSync(path.join(tmpDir, "proxy.tld"), "utf-8").trim()).toBe(
        "server01.acme.com"
      );
    });

    it("persists wildcard mode while the proxy runs and clears it on stop", () => {
      const start = run(["proxy", "start", "--wildcard"], { env: proxyEnv() });
      expect(start.status).toBe(0);
      expect(fs.existsSync(path.join(tmpDir, "proxy.wildcard"))).toBe(true);

      const stop = run(["proxy", "stop"], { env: proxyEnv() });
      expect(stop.status).toBe(0);
      expect(fs.existsSync(path.join(tmpDir, "proxy.wildcard"))).toBe(false);
    });
  });

  describe("HTTPS proxy with broken security binary (#228)", () => {
    let fakeBinDir: string;
    let tmpDir: string;
    let testPort: number;

    beforeEach(async () => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "portless-trust-timeout-"));
      testPort = await getFreePort();

      // Create a fake `security` binary that always fails, simulating the
      // macOS Keychain Services daemon being unresponsive. The real issue
      // (#228) is a slow/hanging securityd, but an instant failure exercises
      // the same error-handling code path without making the test wait minutes.
      fakeBinDir = fs.mkdtempSync(path.join(os.tmpdir(), "portless-fake-bin-"));
      const fakeSecurityPath = path.join(fakeBinDir, "security");
      fs.writeFileSync(fakeSecurityPath, "#!/bin/sh\nexit 1\n");
      fs.chmodSync(fakeSecurityPath, 0o755);
    });

    afterEach(() => {
      run(["proxy", "stop", "-p", String(testPort)], {
        env: { PORTLESS_STATE_DIR: tmpDir },
      });
      fs.rmSync(tmpDir, { recursive: true, force: true });
      fs.rmSync(fakeBinDir, { recursive: true, force: true });
    });

    it.skipIf(process.platform !== "darwin")(
      "starts HTTPS proxy when security commands fail",
      () => {
        const env = {
          PORTLESS_PORT: String(testPort),
          PORTLESS_STATE_DIR: tmpDir,
          // Put fake security first in PATH; real openssl is still reachable
          PATH: prependPath(fakeBinDir),
        };

        // HTTPS is on by default (no PORTLESS_HTTPS=0), so this exercises
        // cert generation, the failing trust check, and daemon startup.
        const start = spawnSync(process.execPath, [CLI_PATH, "proxy", "start"], {
          encoding: "utf-8",
          timeout: 30_000,
          env: { ...process.env, ...env, NO_COLOR: "1" },
        });

        // The proxy should start despite the broken security binary.
        // Before the fix, the daemon would re-run the failing trust flow,
        // potentially stalling long enough for waitForProxy to time out.
        // After the fix, the parent passes --skip-trust to the daemon.
        expect(start.status).toBe(0);
        expect(start.stdout).toContain(`proxy started on port ${testPort}`);

        // Parent should warn that trust failed
        const combined = start.stdout + start.stderr;
        expect(combined).toContain("Could not add CA to system trust store");

        // Daemon log should NOT contain trust attempts (--skip-trust was passed)
        const logPath = path.join(tmpDir, "proxy.log");
        if (fs.existsSync(logPath)) {
          const log = fs.readFileSync(logPath, "utf-8");
          expect(log).not.toContain("Adding CA to system trust store");
          expect(log).toContain("HTTPS/2 proxy listening");
        }
      }
    );
  });

  describe("portless config", () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "portless-cli-config-"));
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it("portless (no args) runs dev script without portless.json", () => {
      fs.writeFileSync(
        path.join(tmpDir, "package.json"),
        JSON.stringify({
          name: "test-app",
          packageManager: "bun@1.3.14",
          scripts: { dev: nodePrintScript("hello") },
        })
      );
      const { status, stdout } = run([], {
        cwd: tmpDir,
        env: { PORTLESS: "0" },
      });
      expect(status).toBe(0);
      expect(stdout).toContain("hello");
    });

    it("prints package.json as the name source for package portless config", async () => {
      const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "portless-cli-config-state-"));
      const proxyPort = await getFreePort();
      const env = {
        PORTLESS_HTTPS: "0",
        PORTLESS_PORT: String(proxyPort),
        PORTLESS_STATE_DIR: stateDir,
      };

      try {
        fs.writeFileSync(
          path.join(tmpDir, "package.json"),
          JSON.stringify({
            name: "test-app",
            packageManager: "bun@1.3.14",
            scripts: { dev: nodePrintScript("ready") },
            portless: { name: "pkg-name" },
          })
        );

        const { status, stdout } = run([], { cwd: tmpDir, env });

        expect(status).toBe(0);
        expect(stdout).toContain('Name "pkg-name" (from package.json)');
        expect(stdout).not.toContain('Name "pkg-name" (from portless config)');
      } finally {
        run(["proxy", "stop"], { env });
        fs.rmSync(stateDir, { recursive: true, force: true });
      }
    });

    it("portless (no args) forwards Vite port flags through bun run dev", async () => {
      const server = http.createServer((_req, res) => {
        res.setHeader("X-Portless", "1");
        res.end("ok");
      });
      const shimDir = fs.mkdtempSync(path.join(os.tmpdir(), "portless-bun-shim-"));
      const capturePath = path.join(shimDir, "capture.json");

      try {
        const proxyPort = await new Promise<number>((resolve) => {
          server.listen(0, "127.0.0.1", () => {
            const addr = server.address();
            if (addr && typeof addr !== "string") {
              resolve(addr.port);
            }
          });
        });

        fs.writeFileSync(path.join(tmpDir, "proxy.port"), proxyPort.toString());
        fs.writeFileSync(
          path.join(tmpDir, "package.json"),
          JSON.stringify({
            name: "test-app",
            packageManager: "bun@1.3.14",
            portless: { appPort: 4567 },
            scripts: { dev: "vite dev --host 127.0.0.1" },
          })
        );

        const captureScriptPath = path.join(shimDir, "capture-bun.js");
        fs.writeFileSync(
          captureScriptPath,
          [
            'const fs = require("node:fs");',
            "const capturePath = process.env.PORTLESS_TEST_CAPTURE_FILE;",
            "const payload = {",
            "  args: process.argv.slice(2),",
            "  env: {",
            "    PORT: process.env.PORT,",
            "    HOST: process.env.HOST,",
            "    PORTLESS_URL: process.env.PORTLESS_URL,",
            "  },",
            "};",
            "fs.writeFileSync(capturePath, JSON.stringify(payload));",
          ].join("\n") + "\n"
        );

        if (process.platform === "win32") {
          fs.writeFileSync(
            path.join(shimDir, "bun.cmd"),
            `@echo off\r\n"${process.execPath}" "${captureScriptPath}" %*\r\n`
          );
        } else {
          const shimPath = path.join(shimDir, "bun");
          fs.writeFileSync(
            shimPath,
            `#!/bin/sh\n"${process.execPath}" "${captureScriptPath}" "$@"\n`
          );
          fs.chmodSync(shimPath, 0o755);
        }

        const { status } = run([], {
          cwd: tmpDir,
          env: {
            PATH: prependPath(shimDir),
            PORTLESS_STATE_DIR: tmpDir,
            PORTLESS_TEST_CAPTURE_FILE: capturePath,
            PORTLESS_HTTPS: "0",
          },
        });

        expect(status).toBe(0);

        const capture = JSON.parse(fs.readFileSync(capturePath, "utf-8")) as {
          args: string[];
          env: Record<string, string>;
        };

        expect(capture.args).toEqual(["run", "dev", "--port", "4567", "--strictPort"]);
        expect(capture.env).toMatchObject({
          PORT: "4567",
          HOST: "127.0.0.1",
          PORTLESS_URL: `http://test-app.localhost:${proxyPort}`,
        });
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
        fs.rmSync(shimDir, { recursive: true, force: true });
      }
    });

    it("replaces command placeholders and skips framework flag injection", async () => {
      const server = http.createServer((_req, res) => {
        res.setHeader("X-Portless", "1");
        res.end("ok");
      });
      const shimDir = fs.mkdtempSync(path.join(os.tmpdir(), "portless-vite-shim-"));
      const capturePath = path.join(shimDir, "capture.json");

      try {
        const proxyPort = await new Promise<number>((resolve) => {
          server.listen(0, "127.0.0.1", () => {
            const addr = server.address();
            if (addr && typeof addr !== "string") {
              resolve(addr.port);
            }
          });
        });

        fs.writeFileSync(path.join(tmpDir, "proxy.port"), proxyPort.toString());

        const captureScriptPath = path.join(shimDir, "capture-vite.js");
        fs.writeFileSync(
          captureScriptPath,
          [
            'const fs = require("node:fs");',
            "const capturePath = process.env.PORTLESS_TEST_CAPTURE_FILE;",
            "const payload = {",
            "  args: process.argv.slice(2),",
            "  env: {",
            "    PORT: process.env.PORT,",
            "    HOST: process.env.HOST,",
            "    PORTLESS_URL: process.env.PORTLESS_URL,",
            "  },",
            "};",
            "fs.writeFileSync(capturePath, JSON.stringify(payload));",
          ].join("\n") + "\n"
        );

        if (process.platform === "win32") {
          fs.writeFileSync(
            path.join(shimDir, "vite.cmd"),
            `@echo off\r\n"${process.execPath}" "${captureScriptPath}" %*\r\n`
          );
        } else {
          const shimPath = path.join(shimDir, "vite");
          fs.writeFileSync(
            shimPath,
            `#!/bin/sh\n"${process.execPath}" "${captureScriptPath}" "$@"\n`
          );
          fs.chmodSync(shimPath, 0o755);
        }

        const { status } = run(
          [
            "run",
            "--name",
            "web",
            "--app-port",
            "4567",
            "vite",
            "dev",
            "--listen",
            "{HOST}",
            "--public-url",
            "{PORTLESS_URL}",
          ],
          {
            cwd: tmpDir,
            env: {
              PATH: prependPath(shimDir),
              PORTLESS_STATE_DIR: tmpDir,
              PORTLESS_TEST_CAPTURE_FILE: capturePath,
              PORTLESS_HTTPS: "0",
            },
          }
        );

        expect(status).toBe(0);

        const capture = JSON.parse(fs.readFileSync(capturePath, "utf-8")) as {
          args: string[];
          env: Record<string, string>;
        };

        const url = `http://web.localhost:${proxyPort}`;
        expect(capture.args).toEqual(["dev", "--listen", "127.0.0.1", "--public-url", url]);
        expect(capture.args).not.toContain("--port");
        expect(capture.env).toMatchObject({
          PORT: "4567",
          HOST: "127.0.0.1",
          PORTLESS_URL: url,
        });
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
        fs.rmSync(shimDir, { recursive: true, force: true });
      }
    });

    it("omits HOST for bun --bun commands so Next.js fast refresh can validate proxy origins", async () => {
      const server = http.createServer((_req, res) => {
        res.setHeader("X-Portless", "1");
        res.end("ok");
      });
      const shimDir = fs.mkdtempSync(path.join(os.tmpdir(), "portless-bun-native-shim-"));
      const capturePath = path.join(shimDir, "capture.json");

      try {
        const proxyPort = await new Promise<number>((resolve) => {
          server.listen(0, "127.0.0.1", () => {
            const addr = server.address();
            if (addr && typeof addr !== "string") {
              resolve(addr.port);
            }
          });
        });

        fs.writeFileSync(path.join(tmpDir, "proxy.port"), proxyPort.toString());

        const captureScriptPath = path.join(shimDir, "capture-bun-native.js");
        fs.writeFileSync(
          captureScriptPath,
          [
            'const fs = require("node:fs");',
            "const capturePath = process.env.PORTLESS_TEST_CAPTURE_FILE;",
            "const payload = {",
            "  args: process.argv.slice(2),",
            "  env: {",
            "    PORT: process.env.PORT,",
            "    HOST: process.env.HOST,",
            "    PORTLESS_URL: process.env.PORTLESS_URL,",
            "  },",
            "};",
            "fs.writeFileSync(capturePath, JSON.stringify(payload));",
          ].join("\n") + "\n"
        );

        if (process.platform === "win32") {
          fs.writeFileSync(
            path.join(shimDir, "bun.cmd"),
            `@echo off\r\n"${process.execPath}" "${captureScriptPath}" %*\r\n`
          );
        } else {
          const shimPath = path.join(shimDir, "bun");
          fs.writeFileSync(
            shimPath,
            `#!/bin/sh\n"${process.execPath}" "${captureScriptPath}" "$@"\n`
          );
          fs.chmodSync(shimPath, 0o755);
        }

        const { status } = run(
          ["run", "--name", "web", "--app-port", "4567", "bun", "--bun", "next", "dev"],
          {
            cwd: tmpDir,
            env: {
              PATH: prependPath(shimDir),
              PORTLESS_STATE_DIR: tmpDir,
              PORTLESS_TEST_CAPTURE_FILE: capturePath,
              PORTLESS_HTTPS: "0",
            },
          }
        );

        expect(status).toBe(0);

        const capture = JSON.parse(fs.readFileSync(capturePath, "utf-8")) as {
          args: string[];
          env: Record<string, string>;
        };

        expect(capture.args).toEqual(["--bun", "next", "dev"]);
        expect(capture.env).toMatchObject({
          PORT: "4567",
          PORTLESS_URL: `http://web.localhost:${proxyPort}`,
        });
        expect(capture.env.HOST).toBeUndefined();
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
        fs.rmSync(shimDir, { recursive: true, force: true });
      }
    });

    it.skipIf(!GIT_AVAILABLE)(
      "prefixes workspace app URLs in linked git worktrees",
      async () => {
        const server = http.createServer((_req, res) => {
          res.setHeader("X-Portless", "1");
          res.end("ok");
        });
        const repoDir = path.join(tmpDir, "repo");
        const worktreeDir = path.join(tmpDir, "feature-auth-worktree");
        const stateDir = path.join(tmpDir, "state");
        const shimDir = fs.mkdtempSync(path.join(os.tmpdir(), "portless-pnpm-shim-"));

        try {
          fs.mkdirSync(repoDir, { recursive: true });
          writeJson(path.join(repoDir, "package.json"), {
            private: true,
            name: "sound-lab",
            packageManager: "pnpm@11.1.3",
            workspaces: ["apps/*"],
          });
          writeJson(path.join(repoDir, "portless.json"), {
            name: "custom",
            turbo: false,
            apps: {
              "apps/api": { name: "api.custom" },
            },
          });
          writeJson(path.join(repoDir, "apps", "api", "package.json"), {
            name: "@sound-lab/api",
            scripts: { dev: 'node -e "process.exit(0)"' },
          });
          writeJson(path.join(repoDir, "apps", "web", "package.json"), {
            name: "@sound-lab/web",
            scripts: { dev: 'node -e "process.exit(0)"' },
          });

          runGit(repoDir, ["init"]);
          runGit(repoDir, ["config", "user.name", "Portless Test"]);
          runGit(repoDir, ["config", "user.email", "portless-test@example.com"]);
          runGit(repoDir, ["branch", "-M", "main"]);
          runGit(repoDir, ["add", "."]);
          runGit(repoDir, ["commit", "-m", "init"]);
          runGit(repoDir, ["worktree", "add", "-b", "feature-auth", worktreeDir]);

          const proxyPort = await new Promise<number>((resolve) => {
            server.listen(0, "127.0.0.1", () => {
              const addr = server.address();
              if (addr && typeof addr !== "string") {
                resolve(addr.port);
              }
            });
          });
          fs.mkdirSync(stateDir, { recursive: true });
          fs.writeFileSync(path.join(stateDir, "proxy.port"), proxyPort.toString());

          if (process.platform === "win32") {
            fs.writeFileSync(path.join(shimDir, "pnpm.cmd"), "@echo off\r\nexit /b 0\r\n");
          } else {
            const shimPath = path.join(shimDir, "pnpm");
            fs.writeFileSync(shimPath, "#!/bin/sh\nexit 0\n");
            fs.chmodSync(shimPath, 0o755);
          }

          const { status, stdout, stderr } = run([], {
            cwd: worktreeDir,
            env: {
              PATH: prependPath(shimDir),
              PORTLESS_STATE_DIR: stateDir,
              PORTLESS_HTTPS: "0",
            },
          });

          expect(stderr).toBe("");
          expect(status).toBe(0);
          expect(stdout).toContain(`http://feature-auth.api.custom.localhost:${proxyPort}`);
          expect(stdout).toContain(`http://feature-auth.web.custom.localhost:${proxyPort}`);
          expect(stdout).not.toContain(`http://api.custom.localhost:${proxyPort}`);
          expect(stdout).not.toContain(`http://web.custom.localhost:${proxyPort}`);
        } finally {
          await new Promise<void>((resolve) => server.close(() => resolve()));
          fs.rmSync(shimDir, { recursive: true, force: true });
        }
      },
      10_000
    );

    it("portless run (no command) with portless.json resolves dev script", () => {
      fs.writeFileSync(
        path.join(tmpDir, "package.json"),
        JSON.stringify({
          name: "test-app",
          packageManager: "bun@1.3.14",
          scripts: { dev: nodePrintScript("config-dev") },
        })
      );
      fs.writeFileSync(path.join(tmpDir, "portless.json"), JSON.stringify({ name: "myapp" }));
      const { stdout } = run(["run"], {
        cwd: tmpDir,
        env: { PORTLESS: "0" },
      });
      expect(stdout).toContain("config-dev");
    });

    it("portless run (no command) with .config/portless.json resolves dev script", () => {
      fs.writeFileSync(
        path.join(tmpDir, "package.json"),
        JSON.stringify({
          name: "test-app",
          packageManager: "bun@1.3.14",
          scripts: { dev: nodePrintScript("config-dir-dev") },
        })
      );
      fs.mkdirSync(path.join(tmpDir, ".config"), { recursive: true });
      fs.writeFileSync(
        path.join(tmpDir, ".config", "portless.json"),
        JSON.stringify({ name: "myapp" })
      );
      const { stdout } = run(["run"], {
        cwd: tmpDir,
        env: { PORTLESS: "0" },
      });
      expect(stdout).toContain("config-dir-dev");
    });

    it("portless run (no command) without portless.json resolves dev script", () => {
      fs.writeFileSync(
        path.join(tmpDir, "package.json"),
        JSON.stringify({
          name: "test-app",
          packageManager: "bun@1.3.14",
          scripts: { dev: nodePrintScript("hello") },
        })
      );
      const { stdout } = run(["run"], {
        cwd: tmpDir,
        env: { PORTLESS: "0" },
      });
      expect(stdout).toContain("hello");
    });

    it("portless run with explicit command ignores config script", () => {
      fs.writeFileSync(
        path.join(tmpDir, "package.json"),
        JSON.stringify({
          name: "test-app",
          packageManager: "bun@1.3.14",
          scripts: { dev: nodePrintScript("from-config") },
        })
      );
      fs.writeFileSync(
        path.join(tmpDir, "portless.json"),
        JSON.stringify({ name: "myapp", script: "dev" })
      );
      const { stdout } = run(["run", "echo", "from-cli"], {
        cwd: tmpDir,
        env: { PORTLESS: "0" },
      });
      expect(stdout).toContain("from-cli");
      expect(stdout).not.toContain("from-config");
    });

    it("portless run with portless.json script field uses that script", () => {
      fs.writeFileSync(
        path.join(tmpDir, "package.json"),
        JSON.stringify({
          name: "test-app",
          packageManager: "bun@1.3.14",
          scripts: { dev: nodePrintScript("from-dev"), start: nodePrintScript("from-start") },
        })
      );
      fs.writeFileSync(
        path.join(tmpDir, "portless.json"),
        JSON.stringify({ name: "myapp", script: "start" })
      );
      const { stdout } = run(["run"], {
        cwd: tmpDir,
        env: { PORTLESS: "0" },
      });
      expect(stdout).toContain("from-start");
    });

    it("portless run prefers root portless.json over .config/portless.json", () => {
      fs.writeFileSync(
        path.join(tmpDir, "package.json"),
        JSON.stringify({
          name: "test-app",
          packageManager: "bun@1.3.14",
          scripts: { dev: nodePrintScript("from-dev"), start: nodePrintScript("from-start") },
        })
      );
      fs.writeFileSync(path.join(tmpDir, "portless.json"), JSON.stringify({ script: "start" }));
      fs.mkdirSync(path.join(tmpDir, ".config"), { recursive: true });
      fs.writeFileSync(
        path.join(tmpDir, ".config", "portless.json"),
        JSON.stringify({ script: "dev" })
      );
      const { stdout } = run(["run"], {
        cwd: tmpDir,
        env: { PORTLESS: "0" },
      });
      expect(stdout).toContain("from-start");
      expect(stdout).not.toContain("from-dev");
    });

    it("--script flag overrides config script field", () => {
      fs.writeFileSync(
        path.join(tmpDir, "package.json"),
        JSON.stringify({
          name: "test-app",
          packageManager: "bun@1.3.14",
          scripts: { dev: nodePrintScript("from-dev"), start: nodePrintScript("from-start") },
        })
      );
      fs.writeFileSync(
        path.join(tmpDir, "portless.json"),
        JSON.stringify({ name: "myapp", script: "dev" })
      );
      const { stdout } = run(["--script", "start", "run"], {
        cwd: tmpDir,
        env: { PORTLESS: "0" },
      });
      expect(stdout).toContain("from-start");
    });

    it("--name overrides portless.json name", () => {
      fs.writeFileSync(
        path.join(tmpDir, "package.json"),
        JSON.stringify({ name: "test-app", scripts: { dev: "echo hello" } })
      );
      fs.writeFileSync(path.join(tmpDir, "portless.json"), JSON.stringify({ name: "config-name" }));
      // With PORTLESS=0, the name doesn't matter (command runs directly)
      // but we can verify via the run subcommand help text or named mode.
      // Let's test it goes through without error.
      const { stdout } = run(["--name", "override-name", "echo", "works"], {
        cwd: tmpDir,
        env: { PORTLESS: "0" },
      });
      expect(stdout).toContain("works");
    });

    it("portless run with missing script errors clearly", () => {
      fs.writeFileSync(
        path.join(tmpDir, "package.json"),
        JSON.stringify({ name: "test-app", scripts: {} })
      );
      fs.writeFileSync(
        path.join(tmpDir, "portless.json"),
        JSON.stringify({ name: "myapp", script: "nonexistent" })
      );
      const { status, stderr } = run(["run"], { cwd: tmpDir });
      expect(status).toBe(1);
      expect(stderr).toContain("No command provided");
    });

    it("portless.json validation rejects invalid appPort", () => {
      fs.writeFileSync(
        path.join(tmpDir, "package.json"),
        JSON.stringify({ name: "test-app", scripts: { dev: "echo hello" } })
      );
      fs.writeFileSync(
        path.join(tmpDir, "portless.json"),
        JSON.stringify({ appPort: "not-a-number" })
      );
      const { status, stderr } = run(["run"], { cwd: tmpDir });
      expect(status).toBe(1);
      expect(stderr).toContain("appPort");
    });

    it(".config/portless.json validation rejects invalid appPort", () => {
      fs.writeFileSync(
        path.join(tmpDir, "package.json"),
        JSON.stringify({ name: "test-app", scripts: { dev: "echo hello" } })
      );
      fs.mkdirSync(path.join(tmpDir, ".config"), { recursive: true });
      fs.writeFileSync(
        path.join(tmpDir, ".config", "portless.json"),
        JSON.stringify({ appPort: "not-a-number" })
      );
      const { status, stderr } = run(["run"], { cwd: tmpDir });
      expect(status).toBe(1);
      expect(stderr).toContain("appPort");
    });
  });

  describe("--tailscale flag", () => {
    it("shows --tailscale in help output", () => {
      const { status, stdout } = run(["--help"]);
      expect(status).toBe(0);
      expect(stdout).toContain("--tailscale");
      expect(stdout).toContain("--tailscale-service");
      expect(stdout).toContain("--funnel");
      expect(stdout).toContain("PORTLESS_TAILSCALE");
      expect(stdout).toContain("PORTLESS_TAILSCALE_SERVICE");
      expect(stdout).toContain("MagicDNS");
      expect(stdout).toContain("HTTPS certificates");
    });

    it("fails with actionable message when tailscale is not installed", () => {
      const { status, stderr } = run(["--tailscale", "myapp", "echo", "hello"], {
        env: { PATH: "/tmp/portless-no-ts-path" },
      });
      expect(status).toBe(1);
      expect(stderr).toContain("Tailscale");
    });

    it("fails with --funnel when tailscale is not installed", () => {
      const { status, stderr } = run(["--funnel", "myapp", "echo", "hello"], {
        env: { PATH: "/tmp/portless-no-ts-path" },
      });
      expect(status).toBe(1);
      expect(stderr).toContain("Tailscale");
    });

    it("accepts PORTLESS_TAILSCALE=1 env var", () => {
      const { status, stderr } = run(["myapp", "echo", "hello"], {
        env: { PORTLESS_TAILSCALE: "1", PATH: "/tmp/portless-no-ts-path" },
      });
      expect(status).toBe(1);
      expect(stderr).toContain("Tailscale");
    });

    it("accepts PORTLESS_TAILSCALE_SERVICE=1 env var", () => {
      const { status, stderr } = run(["myapp", "echo", "hello"], {
        env: { PORTLESS_TAILSCALE_SERVICE: "1", PATH: "/tmp/portless-no-ts-path" },
      });
      expect(status).toBe(1);
      expect(stderr).toContain("Tailscale");
    });

    it("accepts --tailscale after app name", () => {
      const { status, stderr } = run(["myapp", "--tailscale", "echo", "hello"], {
        env: { PATH: "/tmp/portless-no-ts-path" },
      });
      expect(status).toBe(1);
      expect(stderr).toContain("Tailscale");
    });

    it("accepts --tailscale-service and explicit service name after app name", () => {
      const { status, stderr } = run(
        ["myapp", "--tailscale-service", "--tailscale-service-name", "api", "echo", "hello"],
        {
          env: { PATH: "/tmp/portless-no-ts-path" },
        }
      );
      expect(status).toBe(1);
      expect(stderr).toContain("Tailscale");
    });

    it("accepts --tailscale in run subcommand", () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "portless-cli-ts-run-"));
      try {
        fs.writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify({ name: "test-app" }));
        const { status, stderr } = run(["run", "--tailscale", "echo", "hello"], {
          cwd: tmpDir,
          env: { PATH: "/tmp/portless-no-ts-path" },
        });
        expect(status).toBe(1);
        expect(stderr).toContain("Tailscale");
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it("accepts --tailscale-service in run subcommand", () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "portless-cli-ts-service-run-"));
      try {
        fs.writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify({ name: "test-app" }));
        const { status, stderr } = run(["run", "--tailscale-service", "echo", "hello"], {
          cwd: tmpDir,
          env: { PATH: "/tmp/portless-no-ts-path" },
        });
        expect(status).toBe(1);
        expect(stderr).toContain("Tailscale");
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it("rejects combining --tailscale-service with --funnel", () => {
      const { status, stderr } = run(["--tailscale-service", "--funnel", "myapp", "echo", "ok"]);
      expect(status).toBe(1);
      expect(stderr).toContain("--tailscale-service cannot be combined with --funnel");
    });
  });

  describe("--ngrok flag", () => {
    it("shows --ngrok in help output", () => {
      const { status, stdout } = run(["--help"]);
      expect(status).toBe(0);
      expect(stdout).toContain("--ngrok");
      expect(stdout).toContain("PORTLESS_NGROK");
      expect(stdout).toContain("PORTLESS_NGROK_URL");
    });

    it("fails with actionable message when ngrok is not installed", () => {
      const { status, stderr } = run(["--ngrok", "myapp", "echo", "hello"], {
        env: { PATH: "/tmp/portless-no-ngrok-path" },
      });
      expect(status).toBe(1);
      expect(stderr).toContain("ngrok CLI not found");
    });

    it("accepts PORTLESS_NGROK=1 env var", () => {
      const { status, stderr } = run(["myapp", "echo", "hello"], {
        env: { PORTLESS_NGROK: "1", PATH: "/tmp/portless-no-ngrok-path" },
      });
      expect(status).toBe(1);
      expect(stderr).toContain("ngrok CLI not found");
    });

    it("accepts --ngrok after app name", () => {
      const { status, stderr } = run(["myapp", "--ngrok", "echo", "hello"], {
        env: { PATH: "/tmp/portless-no-ngrok-path" },
      });
      expect(status).toBe(1);
      expect(stderr).toContain("ngrok CLI not found");
    });

    it("accepts --ngrok in run subcommand", () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "portless-cli-ngrok-run-"));
      try {
        fs.writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify({ name: "test-app" }));
        const { status, stderr } = run(["run", "--ngrok", "echo", "hello"], {
          cwd: tmpDir,
          env: { PATH: "/tmp/portless-no-ngrok-path" },
        });
        expect(status).toBe(1);
        expect(stderr).toContain("ngrok CLI not found");
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });

  describe("--tunnel flag", () => {
    it("shows generic tunnel options in help output", () => {
      const { status, stdout } = run(["--help"]);
      expect(status).toBe(0);
      expect(stdout).toContain("--tunnel");
      expect(stdout).toContain("PORTLESS_TUNNEL");
      expect(stdout).toContain("PORTLESS_TUNNEL_URL");
    });

    it("fails with actionable message when cloudflared is not installed", () => {
      const { status, stderr } = run(["--tunnel", "cloudflare", "myapp", "echo", "hello"], {
        env: { PATH: "/tmp/portless-no-cloudflared-path" },
      });

      expect(status).toBe(1);
      expect(stderr).toContain("cloudflared CLI not found");
    });

    it("activates Cloudflare from PORTLESS_TUNNEL", () => {
      const { status, stderr } = run(["myapp", "echo", "hello"], {
        env: { PORTLESS_TUNNEL: "cloudflare", PATH: "/tmp/portless-no-cloudflared-path" },
      });

      expect(status).toBe(1);
      expect(stderr).toContain("cloudflared CLI not found");
    });

    it("sets PORTLESS_TUNNEL_URL for managed tunnel child commands", async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "portless-cli-managed-tunnel-"));
      const binDir = fs.mkdtempSync(path.join(os.tmpdir(), "portless-cloudflared-bin-"));
      const server = http.createServer((_req, res) => {
        res.setHeader("X-Portless", "1");
        res.end("ok");
      });
      try {
        const proxyPort = await new Promise<number>((resolve) => {
          server.listen(0, "127.0.0.1", () => {
            const addr = server.address();
            if (addr && typeof addr !== "string") {
              resolve(addr.port);
            }
          });
        });
        fs.writeFileSync(path.join(tmpDir, "proxy.port"), proxyPort.toString());
        writeCloudflaredShim(binDir);

        const capturePath = path.join(tmpDir, "capture.json");
        const scriptPath = path.join(tmpDir, "capture-env.js");
        fs.writeFileSync(
          scriptPath,
          [
            'const fs = require("node:fs");',
            `fs.writeFileSync(${JSON.stringify(capturePath)}, JSON.stringify({`,
            "  PORTLESS_URL: process.env.PORTLESS_URL,",
            "  PORTLESS_TUNNEL_URL: process.env.PORTLESS_TUNNEL_URL,",
            "}));",
          ].join("\n") + "\n"
        );

        const { status, stdout, stderr } = run(
          [
            "run",
            "--name",
            "myapp",
            "--app-port",
            "4567",
            "--tunnel",
            "cloudflare",
            process.execPath,
            scriptPath,
          ],
          {
            env: {
              PATH: prependPath(binDir),
              PORTLESS_STATE_DIR: tmpDir,
              PORTLESS_HTTPS: "0",
            },
          }
        );

        expect({ status, stdout, stderr }).toMatchObject({ status: 0 });
        expect(stdout).toContain("Cloudflare Tunnel");
        expect(JSON.parse(fs.readFileSync(capturePath, "utf-8"))).toMatchObject({
          PORTLESS_URL: `http://myapp.localhost:${proxyPort}`,
          PORTLESS_TUNNEL_URL: "https://abc.trycloudflare.com",
        });
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
        fs.rmSync(tmpDir, { recursive: true, force: true });
        fs.rmSync(binDir, { recursive: true, force: true });
      }
    });
  });

  describe("--netbird flag", () => {
    it("shows --netbird and auth flags in help output", () => {
      const { status, stdout } = run(["--help"]);
      expect(status).toBe(0);
      expect(stdout).toContain("--netbird");
      expect(stdout).toContain("--netbird-password");
      expect(stdout).toContain("--netbird-pin");
      expect(stdout).toContain("--netbird-groups");
      expect(stdout).toContain("PORTLESS_NETBIRD");
      expect(stdout).toContain("PORTLESS_NETBIRD_URL");
    });

    it("fails with actionable message when netbird is not installed", () => {
      const { status, stderr } = run(["--netbird", "myapp", "echo", "hello"], {
        env: { PATH: "/tmp/portless-no-netbird-path" },
      });
      expect(status).toBe(1);
      expect(stderr).toContain("NetBird CLI not found");
    });

    it("accepts auth flags before app name and implies NetBird sharing", () => {
      const { status, stderr } = run(
        [
          "--netbird-password",
          "secret",
          "--netbird-pin",
          "123456",
          "--netbird-groups",
          "devops,Backend",
          "myapp",
          "echo",
          "hello",
        ],
        {
          env: { PATH: "/tmp/portless-no-netbird-path" },
        }
      );
      expect(status).toBe(1);
      expect(stderr).toContain("NetBird CLI not found");
    });

    it("accepts --netbird in run subcommand", () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "portless-cli-netbird-run-"));
      try {
        fs.writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify({ name: "test-app" }));
        const { status, stderr } = run(["run", "--netbird", "echo", "hello"], {
          cwd: tmpDir,
          env: { PATH: "/tmp/portless-no-netbird-path" },
        });
        expect(status).toBe(1);
        expect(stderr).toContain("NetBird CLI not found");
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });
});
