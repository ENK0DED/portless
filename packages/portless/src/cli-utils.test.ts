import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as http from "node:http";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import {
  augmentedPath,
  buildSudoEnvArgs,
  buildProxyStartConfig,
  BLOCKED_PORTS,
  cmdEscape,
  cmdEscapeCommand,
  DEFAULT_TLD,
  FALLBACK_PROXY_PORT,
  hasPlaceholders,
  INTERNAL_LAN_IP_FLAG,
  LEGACY_TLD_ENV,
  LEGACY_SYSTEM_STATE_DIR,
  PRIVILEGED_PORT_THRESHOLD,
  RISKY_TLDS,
  SUFFIX_ENV,
  USER_STATE_DIR,
  discoverState,
  findFreePort,
  getDefaultPort,
  caRegeneratedRestartHint,
  getDefaultTld,
  getDefaultTlds,
  getProtocolPort,
  getProcessStartTime,
  getProxyBindTargets,
  getProxyStatus,
  getRiskyTldReason,
  hasLanMarker,
  hasConfiguredTldEnv,
  injectPackageScriptFrameworkFlags,
  isHttpsEnvDisabled,
  injectFrameworkFlags,
  isPortListening,
  isProxyRunning,
  killOrphanedProcessGroup,
  listenOnProxyInterface,
  ownedProcessIds,
  parsePidFromNetstat,
  parseTldList,
  readLanMarker,
  readCustomCertMarker,
  readInternalPagesDisabledMarker,
  readPersistedProxyState,
  readPidFromDir,
  readTldFromDir,
  readTldsFromDir,
  readWildcardMarker,
  reportHostsSync,
  replacePlaceholders,
  resolveFrameworkBasename,
  resolveWindowsCommandInvocation,
  resolveWindowsExecutable,
  resolveStateDir,
  syncHostsWithWarning,
  triggerHostsSync,
  validateTld,
  writeLanMarker,
  writeCustomCertMarker,
  writeInternalPagesDisabledMarker,
  writeLanModeMarker,
  writeTldFile,
  writeTldsFile,
  writeTlsMarker,
  writeUnprivilegedMarker,
  writeWildcardMarker,
  hasHelpFlag,
} from "./cli-utils.js";
import { PORTLESS_HEADER, PORTLESS_LISTENER_PORT_HEADER } from "./proxy.js";

describe("proxy listener interface", () => {
  it("uses only IPv4 and IPv6 loopback outside LAN mode", () => {
    expect(getProxyBindTargets(false)).toEqual([
      { host: "127.0.0.1" },
      { host: "::1", ipv6Only: true },
    ]);
  });

  it("uses IPv4 and IPv6 unspecified addresses in LAN mode", () => {
    expect(getProxyBindTargets(true)).toEqual([
      { host: "0.0.0.0" },
      { host: "::", ipv6Only: true },
    ]);
  });

  it("binds IPv4 loopback outside LAN mode", async () => {
    const target = getProxyBindTargets(false)[0]!;
    const server = net.createServer();

    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      listenOnProxyInterface(server, 0, target, resolve);
    });

    try {
      const address = server.address();
      expect(address && typeof address !== "string" ? address.address : null).toBe("127.0.0.1");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("binds IPv6 loopback outside LAN mode when available", async (ctx) => {
    const target = getProxyBindTargets(false)[1]!;
    const server = net.createServer();
    const ipv6Available = await new Promise<boolean>((resolve, reject) => {
      server.once("error", (err: NodeJS.ErrnoException) => {
        if (err.code === "EAFNOSUPPORT" || err.code === "EADDRNOTAVAIL") {
          resolve(false);
        } else {
          reject(err);
        }
      });
      listenOnProxyInterface(server, 0, target, () => resolve(true));
    });
    if (!ipv6Available) return ctx.skip();

    try {
      const address = server.address();
      expect(address && typeof address !== "string" ? address.address : null).toBe("::1");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("binds the IPv4 unspecified address in LAN mode", async () => {
    const target = getProxyBindTargets(true)[0]!;
    const server = net.createServer();

    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      listenOnProxyInterface(server, 0, target, resolve);
    });

    try {
      const address = server.address();
      expect(address && typeof address !== "string" ? address.address : null).toBe("0.0.0.0");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

describe("findFreePort", () => {
  it("returns a port in the default range", async () => {
    const port = await findFreePort();
    expect(port).toBeGreaterThanOrEqual(4000);
    expect(port).toBeLessThanOrEqual(4999);
  });

  it("returns a port that is actually bindable", async () => {
    const port = await findFreePort();
    const server = net.createServer();
    await new Promise<void>((resolve, reject) => {
      server.listen(port, () => resolve());
      server.on("error", reject);
    });
    server.close();
  });

  it("respects custom port range", async () => {
    const port = await findFreePort(9000, 9010);
    expect(port).toBeGreaterThanOrEqual(9000);
    expect(port).toBeLessThanOrEqual(9010);
  });

  it("throws when no port is available in a tiny occupied range", async () => {
    // Occupy a single-port range
    const server = net.createServer();
    await new Promise<void>((resolve) => server.listen(9999, "127.0.0.1", () => resolve()));
    try {
      await expect(findFreePort(9999, 9999)).rejects.toThrow("No free port found");
    } finally {
      server.close();
    }
  });

  it("treats ports occupied on 127.0.0.1 as unavailable", async () => {
    const server = net.createServer();
    const port = await new Promise<number>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        if (addr && typeof addr !== "string") {
          resolve(addr.port);
        }
      });
    });

    try {
      await expect(findFreePort(port, port)).rejects.toThrow("No free port found");
    } finally {
      server.close();
    }
  });

  it("throws when minPort > maxPort", async () => {
    await expect(findFreePort(5000, 4000)).rejects.toThrow("minPort");
  });

  it("never returns a blocked port (WHATWG bad ports)", async () => {
    for (let i = 0; i < 20; i++) {
      const port = await findFreePort();
      expect(BLOCKED_PORTS.has(port)).toBe(false);
    }
  });

  it("skips a blocked port even when it is the only one in range", async () => {
    await expect(findFreePort(4045, 4045)).rejects.toThrow("No free port found");
  });
});

describe("isProxyRunning", () => {
  const servers: http.Server[] = [];

  afterEach(async () => {
    for (const s of servers) {
      await new Promise<void>((resolve) => s.close(() => resolve()));
    }
    servers.length = 0;
  });

  it("returns false when nothing is listening", async () => {
    const result = await isProxyRunning(19876);
    expect(result).toBe(false);
  });

  it("returns true when a portless proxy is listening", async () => {
    const server = http.createServer((_req, res) => {
      res.setHeader(PORTLESS_HEADER, "1");
      res.end("ok");
    });
    servers.push(server);

    const port = await new Promise<number>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        if (addr && typeof addr !== "string") {
          resolve(addr.port);
        }
      });
    });

    const result = await isProxyRunning(port);
    expect(result).toBe(true);
  });

  it("returns false when a non-portless server is listening", async () => {
    const server = http.createServer((_req, res) => {
      res.end("not portless");
    });
    servers.push(server);

    const port = await new Promise<number>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        if (addr && typeof addr !== "string") {
          resolve(addr.port);
        }
      });
    });

    const result = await isProxyRunning(port);
    expect(result).toBe(false);
  });

  it("returns false when a portless response reports a different listener port", async () => {
    let listenerPort = 0;
    const server = http.createServer((_req, res) => {
      res.setHeader(PORTLESS_HEADER, "1");
      res.setHeader(PORTLESS_LISTENER_PORT_HEADER, String(listenerPort + 1));
      res.end("redirected");
    });
    servers.push(server);

    listenerPort = await new Promise<number>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        if (addr && typeof addr !== "string") {
          resolve(addr.port);
        }
      });
    });

    const result = await isProxyRunning(listenerPort);
    expect(result).toBe(false);
  });
});

describe("isPortListening", () => {
  const servers: net.Server[] = [];

  afterEach(async () => {
    for (const s of servers) {
      await new Promise<void>((resolve) => s.close(() => resolve()));
    }
    servers.length = 0;
  });

  function listenOn(host: string): Promise<number> {
    const server = net.createServer();
    servers.push(server);
    return new Promise<number>((resolve) => {
      server.listen(0, host, () => {
        const addr = server.address();
        if (addr && typeof addr !== "string") {
          resolve(addr.port);
        }
      });
    });
  }

  it("returns false when nothing is listening", async () => {
    expect(await isPortListening(19877)).toBe(false);
  });

  it("detects a listener on IPv4 loopback", async () => {
    const port = await listenOn("127.0.0.1");
    expect(await isPortListening(port)).toBe(true);
  });

  it("detects a listener on IPv6 loopback only", async () => {
    const port = await listenOn("::1");
    expect(await isPortListening(port)).toBe(true);
  });
});

describe("isPortListening", () => {
  const servers: http.Server[] = [];

  afterEach(async () => {
    for (const s of servers) {
      await new Promise<void>((resolve) => s.close(() => resolve()));
    }
    servers.length = 0;
  });

  it("returns false when nothing is listening", async () => {
    expect(await isPortListening(19877)).toBe(false);
  });

  it("detects a server listening on IPv6 loopback only (issue #320)", async (ctx) => {
    const server = http.createServer((_req, res) => res.end("ok"));
    const ipv6Available = await new Promise<boolean>((resolve) => {
      server.once("error", () => resolve(false));
      server.listen(0, "::1", () => resolve(true));
    });
    if (!ipv6Available) return ctx.skip();
    servers.push(server);
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("no addr");

    expect(await isPortListening(addr.port)).toBe(true);
  });
});

describe("resolveStateDir", () => {
  it("returns user dir for all ports", () => {
    expect(resolveStateDir(80)).toBe(USER_STATE_DIR);
    expect(resolveStateDir(443)).toBe(USER_STATE_DIR);
    expect(resolveStateDir(1023)).toBe(USER_STATE_DIR);
    expect(resolveStateDir(1024)).toBe(USER_STATE_DIR);
    expect(resolveStateDir(8080)).toBe(USER_STATE_DIR);
    expect(resolveStateDir(3000)).toBe(USER_STATE_DIR);
  });

  it.skipIf(process.platform === "win32")(
    "uses the invoking user's home when loaded under sudo",
    async () => {
      const originalHome = process.env.HOME;
      const originalSudoUser = process.env.SUDO_USER;
      const expectedHome = process.platform === "darwin" ? "/Users/alice" : "/home/alice";

      try {
        process.env.HOME = process.platform === "darwin" ? "/var/root" : "/root";
        process.env.SUDO_USER = "alice";
        vi.resetModules();

        const sudoModule = await import("./cli-utils.js");
        expect(sudoModule.USER_STATE_DIR).toBe(path.join(expectedHome, ".portless"));
        expect(sudoModule.resolveStateDir(443)).toBe(path.join(expectedHome, ".portless"));
      } finally {
        if (originalHome === undefined) delete process.env.HOME;
        else process.env.HOME = originalHome;
        if (originalSudoUser === undefined) delete process.env.SUDO_USER;
        else process.env.SUDO_USER = originalSudoUser;
        vi.resetModules();
      }
    }
  );
});

describe("constants", () => {
  it("FALLBACK_PROXY_PORT is 1355", () => {
    expect(FALLBACK_PROXY_PORT).toBe(1355);
  });

  it("PRIVILEGED_PORT_THRESHOLD is 1024", () => {
    expect(PRIVILEGED_PORT_THRESHOLD).toBe(1024);
  });

  it("LEGACY_SYSTEM_STATE_DIR is /tmp/portless on Unix, os.tmpdir() on Windows", () => {
    if (process.platform === "win32") {
      expect(LEGACY_SYSTEM_STATE_DIR).toBe(path.join(os.tmpdir(), "portless"));
    } else {
      expect(LEGACY_SYSTEM_STATE_DIR).toBe("/tmp/portless");
    }
  });

  it("USER_STATE_DIR is in home directory", () => {
    expect(USER_STATE_DIR).toBe(path.join(os.homedir(), ".portless"));
  });
});

describe("parsePidFromNetstat", () => {
  const SAMPLE_OUTPUT = [
    "Active Connections",
    "",
    "  Proto  Local Address          Foreign Address        State           PID",
    "  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       1104",
    "  TCP    0.0.0.0:1355           0.0.0.0:0              LISTENING       9876",
    "  TCP    0.0.0.0:5432           0.0.0.0:0              LISTENING       3200",
    "  TCP    [::]:1355              [::]:0                  LISTENING       9876",
    "  TCP    127.0.0.1:1355         127.0.0.1:52000        ESTABLISHED     9876",
    "  TCP    192.168.1.10:13550     10.0.0.1:443           ESTABLISHED     5500",
  ].join("\r\n");

  it("finds PID for a matching LISTENING port", () => {
    expect(parsePidFromNetstat(SAMPLE_OUTPUT, 1355)).toBe(9876);
  });

  it("returns null when port is not listening", () => {
    expect(parsePidFromNetstat(SAMPLE_OUTPUT, 9999)).toBeNull();
  });

  it("does not match ESTABLISHED connections", () => {
    expect(parsePidFromNetstat(SAMPLE_OUTPUT, 1355)).toBe(9876);
  });

  it("does not false-match on port prefix (13550 vs 1355)", () => {
    expect(parsePidFromNetstat(SAMPLE_OUTPUT, 13550)).toBeNull();
  });

  it("matches IPv6 addresses ([::]:port)", () => {
    const ipv6Only = [
      "  Proto  Local Address          Foreign Address        State           PID",
      "  TCP    [::]:1355              [::]:0                  LISTENING       4444",
    ].join("\r\n");
    expect(parsePidFromNetstat(ipv6Only, 1355)).toBe(4444);
  });

  it("matches 127.0.0.1 bound addresses", () => {
    const loopback = [
      "  Proto  Local Address          Foreign Address        State           PID",
      "  TCP    127.0.0.1:8080         0.0.0.0:0              LISTENING       7777",
    ].join("\r\n");
    expect(parsePidFromNetstat(loopback, 8080)).toBe(7777);
  });

  it("returns null for empty output", () => {
    expect(parsePidFromNetstat("", 1355)).toBeNull();
  });

  it("handles Unix-style line endings", () => {
    const unixOutput = [
      "  TCP    0.0.0.0:3000           0.0.0.0:0              LISTENING       1234",
    ].join("\n");
    expect(parsePidFromNetstat(unixOutput, 3000)).toBe(1234);
  });
});

describe("getProtocolPort", () => {
  it("returns 443 for TLS", () => {
    expect(getProtocolPort(true)).toBe(443);
  });

  it("returns 80 for plain HTTP", () => {
    expect(getProtocolPort(false)).toBe(80);
  });
});

describe("getDefaultPort", () => {
  let originalEnv: string | undefined;

  beforeEach(() => {
    originalEnv = process.env.PORTLESS_PORT;
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.PORTLESS_PORT;
    } else {
      process.env.PORTLESS_PORT = originalEnv;
    }
  });

  it("returns FALLBACK_PROXY_PORT when called without tls argument", () => {
    delete process.env.PORTLESS_PORT;
    expect(getDefaultPort()).toBe(FALLBACK_PROXY_PORT);
  });

  it("returns 443 when tls is true", () => {
    delete process.env.PORTLESS_PORT;
    expect(getDefaultPort(true)).toBe(443);
  });

  it("returns 80 when tls is false", () => {
    delete process.env.PORTLESS_PORT;
    expect(getDefaultPort(false)).toBe(80);
  });

  it("returns PORTLESS_PORT when set, regardless of tls argument", () => {
    process.env.PORTLESS_PORT = "8080";
    expect(getDefaultPort()).toBe(8080);
    expect(getDefaultPort(true)).toBe(8080);
    expect(getDefaultPort(false)).toBe(8080);
  });

  it("returns protocol default when PORTLESS_PORT is invalid", () => {
    process.env.PORTLESS_PORT = "not-a-number";
    expect(getDefaultPort()).toBe(FALLBACK_PROXY_PORT);
    expect(getDefaultPort(true)).toBe(443);
    expect(getDefaultPort(false)).toBe(80);
  });

  it("returns protocol default when PORTLESS_PORT is out of range", () => {
    process.env.PORTLESS_PORT = "0";
    expect(getDefaultPort(true)).toBe(443);

    process.env.PORTLESS_PORT = "70000";
    expect(getDefaultPort(false)).toBe(80);
  });

  it("returns FALLBACK_PROXY_PORT when PORTLESS_PORT is empty and tls is undefined", () => {
    process.env.PORTLESS_PORT = "";
    expect(getDefaultPort()).toBe(FALLBACK_PROXY_PORT);
  });
});

describe("isHttpsEnvDisabled", () => {
  let originalEnv: string | undefined;

  beforeEach(() => {
    originalEnv = process.env.PORTLESS_HTTPS;
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.PORTLESS_HTTPS;
    } else {
      process.env.PORTLESS_HTTPS = originalEnv;
    }
  });

  it("returns true when PORTLESS_HTTPS is '0'", () => {
    process.env.PORTLESS_HTTPS = "0";
    expect(isHttpsEnvDisabled()).toBe(true);
  });

  it("returns true when PORTLESS_HTTPS is 'false'", () => {
    process.env.PORTLESS_HTTPS = "false";
    expect(isHttpsEnvDisabled()).toBe(true);
  });

  it("returns false when PORTLESS_HTTPS is '1'", () => {
    process.env.PORTLESS_HTTPS = "1";
    expect(isHttpsEnvDisabled()).toBe(false);
  });

  it("returns false when PORTLESS_HTTPS is unset", () => {
    delete process.env.PORTLESS_HTTPS;
    expect(isHttpsEnvDisabled()).toBe(false);
  });
});

describe("injectFrameworkFlags", () => {
  it("injects --port, --strictPort, and --host for vite command", () => {
    const args = ["vite", "dev"];
    injectFrameworkFlags(args, 4567);
    expect(args).toEqual(["vite", "dev", "--port", "4567", "--strictPort", "--host", "127.0.0.1"]);
  });

  it("injects flags for absolute/relative vite paths", () => {
    const args = ["./node_modules/.bin/vite", "dev"];
    injectFrameworkFlags(args, 4000);
    expect(args).toEqual([
      "./node_modules/.bin/vite",
      "dev",
      "--port",
      "4000",
      "--strictPort",
      "--host",
      "127.0.0.1",
    ]);
  });

  it("skips --port injection when --port is already present", () => {
    const args = ["vite", "dev", "--port", "3000"];
    injectFrameworkFlags(args, 4567);
    expect(args).toEqual(["vite", "dev", "--port", "3000", "--host", "127.0.0.1"]);
  });

  it("skips --host injection when --host is already present", () => {
    const args = ["vite", "dev", "--host", "0.0.0.0"];
    injectFrameworkFlags(args, 4567);
    expect(args).toEqual(["vite", "dev", "--host", "0.0.0.0", "--port", "4567", "--strictPort"]);
  });

  it("skips all injection when both --port and --host are present", () => {
    const args = ["vite", "dev", "--port", "3000", "--host", "0.0.0.0"];
    injectFrameworkFlags(args, 4567);
    expect(args).toEqual(["vite", "dev", "--port", "3000", "--host", "0.0.0.0"]);
  });

  it("injects --port, --strictPort, and --host for vp (viteplus) command", () => {
    const args = ["vp", "dev"];
    injectFrameworkFlags(args, 4567);
    expect(args).toEqual(["vp", "dev", "--port", "4567", "--strictPort", "--host", "127.0.0.1"]);
  });

  it("injects --port, --strictPort, and --host for vitepress command", () => {
    const args = ["vitepress", "dev"];
    injectFrameworkFlags(args, 4567);
    expect(args).toEqual([
      "vitepress",
      "dev",
      "--port",
      "4567",
      "--strictPort",
      "--host",
      "127.0.0.1",
    ]);
  });

  it("injects for react-router with --strictPort", () => {
    const args = ["react-router", "dev"];
    injectFrameworkFlags(args, 4567);
    expect(args).toEqual([
      "react-router",
      "dev",
      "--port",
      "4567",
      "--strictPort",
      "--host",
      "127.0.0.1",
    ]);
  });

  it("injects for vitepress dev but not build", () => {
    const dev = ["vitepress", "dev", "docs"];
    injectFrameworkFlags(dev, 4567);
    expect(dev).toEqual([
      "vitepress",
      "dev",
      "docs",
      "--port",
      "4567",
      "--strictPort",
      "--host",
      "127.0.0.1",
    ]);

    const build = ["vitepress", "build"];
    injectFrameworkFlags(build, 4567);
    expect(build).toEqual(["vitepress", "build"]);
  });

  it("injects for rsbuild without --strictPort", () => {
    const args = ["rsbuild", "dev"];
    injectFrameworkFlags(args, 4567);
    expect(args).toEqual(["rsbuild", "dev", "--port", "4567", "--host", "127.0.0.1"]);
  });

  it("injects for astro without --strictPort", () => {
    const args = ["astro", "dev"];
    injectFrameworkFlags(args, 4567);
    expect(args).toEqual(["astro", "dev", "--port", "4567", "--host", "127.0.0.1"]);
  });

  it("injects for astro when a global flag precedes the subcommand", () => {
    const devArgs = ["astro", "--root", "apps/web", "dev"];
    injectFrameworkFlags(devArgs, 4567);
    expect(devArgs).toEqual([
      "astro",
      "--root",
      "apps/web",
      "dev",
      "--port",
      "4567",
      "--host",
      "127.0.0.1",
    ]);

    const previewArgs = ["astro", "--config", "astro.config.mjs", "preview"];
    injectFrameworkFlags(previewArgs, 4567);
    expect(previewArgs).toEqual([
      "astro",
      "--config",
      "astro.config.mjs",
      "preview",
      "--port",
      "4567",
      "--host",
      "127.0.0.1",
    ]);
  });

  it.each([[["--host", "0.0.0.0"]], [["--host=0.0.0.0"]]])(
    "preserves an explicit astro host choice before the subcommand: %j",
    (hostArgs) => {
      const command = ["astro", "--root", "apps/web", ...hostArgs, "dev"];
      const args = [...command];
      injectFrameworkFlags(args, 4567);
      expect(args).toEqual([...command, "--port", "4567"]);
    }
  );

  it("injects astro flags before -- without treating trailing host data as an option", () => {
    const args = ["astro", "--root", "apps/web", "dev", "--", "--host=0.0.0.0"];
    injectFrameworkFlags(args, 4567);
    expect(args).toEqual([
      "astro",
      "--root",
      "apps/web",
      "dev",
      "--port",
      "4567",
      "--host",
      "127.0.0.1",
      "--",
      "--host=0.0.0.0",
    ]);
  });

  it.each([
    ["--root", "dev"],
    ["--root", "preview"],
    ["--config", "dev"],
    ["--config", "preview"],
  ])("does not mistake astro %s %s for a server subcommand", (flag, value) => {
    const command = ["astro", flag, value, "build"];
    const args = [...command];
    expect(injectFrameworkFlags(args, 4567)).toEqual([]);
    expect(args).toEqual(command);
  });

  it.each([
    ["--root", "dev"],
    ["--root", "preview"],
    ["--config", "dev"],
    ["--config", "preview"],
  ])("recognizes astro dev after the consumed value %s %s", (flag, value) => {
    const command = ["astro", flag, value, "dev"];
    const args = [...command];
    injectFrameworkFlags(args, 4567);
    expect(args).toEqual([...command, "--port", "4567", "--host", "127.0.0.1"]);
  });

  it("injects for ng without --strictPort", () => {
    const args = ["ng", "serve"];
    injectFrameworkFlags(args, 4567);
    expect(args).toEqual(["ng", "serve", "--port", "4567", "--host", "127.0.0.1"]);
  });

  it("injects for react-native without --strictPort", () => {
    const args = ["react-native", "start"];
    injectFrameworkFlags(args, 4567);
    expect(args).toEqual(["react-native", "start", "--port", "4567", "--host", "127.0.0.1"]);
  });

  it("injects for expo without --strictPort (defaults to localhost)", () => {
    const args = ["expo", "start"];
    injectFrameworkFlags(args, 4567);
    expect(args).toEqual(["expo", "start", "--port", "4567", "--host", "localhost"]);
  });

  it("skips --host for expo in LAN mode (Metro defaults to LAN)", () => {
    const prev = process.env.PORTLESS_LAN;
    process.env.PORTLESS_LAN = "1";
    try {
      const args = ["expo", "start"];
      injectFrameworkFlags(args, 4567);
      expect(args).toEqual(["expo", "start", "--port", "4567"]);
    } finally {
      if (prev === undefined) delete process.env.PORTLESS_LAN;
      else process.env.PORTLESS_LAN = prev;
    }
  });

  it("does not inject for frameworks that read PORT", () => {
    const nextArgs = ["next", "dev"];
    injectFrameworkFlags(nextArgs, 4567);
    expect(nextArgs).toEqual(["next", "dev"]);

    const nuxtArgs = ["nuxt", "dev"];
    injectFrameworkFlags(nuxtArgs, 4567);
    expect(nuxtArgs).toEqual(["nuxt", "dev"]);

    const nodeArgs = ["node", "server.js"];
    injectFrameworkFlags(nodeArgs, 4567);
    expect(nodeArgs).toEqual(["node", "server.js"]);
  });

  it("does nothing for empty args", () => {
    const args: string[] = [];
    injectFrameworkFlags(args, 4567);
    expect(args).toEqual([]);
  });

  // Package runner support (issue #146: bunx --bun vite dev gives 502)

  // Simple runners (npx, bunx, bun, pnpx)

  it("injects flags for bun vite dev", () => {
    const args = ["bun", "vite", "dev"];
    injectFrameworkFlags(args, 4567);
    expect(args).toEqual([
      "bun",
      "vite",
      "dev",
      "--port",
      "4567",
      "--strictPort",
      "--host",
      "127.0.0.1",
    ]);
  });

  it("injects flags for bun --bun vite dev", () => {
    const args = ["bun", "--bun", "vite", "dev"];
    injectFrameworkFlags(args, 4567);
    expect(args).toEqual([
      "bun",
      "--bun",
      "vite",
      "dev",
      "--port",
      "4567",
      "--strictPort",
      "--host",
      "127.0.0.1",
    ]);
  });

  it("injects flags for bun run vite dev", () => {
    const args = ["bun", "run", "vite", "dev"];
    injectFrameworkFlags(args, 4567);
    expect(args).toEqual([
      "bun",
      "run",
      "vite",
      "dev",
      "--port",
      "4567",
      "--strictPort",
      "--host",
      "127.0.0.1",
    ]);
  });

  it("does not inject for bun --bun next dev", () => {
    const args = ["bun", "--bun", "next", "dev"];
    injectFrameworkFlags(args, 4567);
    expect(args).toEqual(["bun", "--bun", "next", "dev"]);
  });

  it("does not inject for bun run with a non-framework script", () => {
    const args = ["bun", "run", "dev"];
    injectFrameworkFlags(args, 4567);
    expect(args).toEqual(["bun", "run", "dev"]);
  });

  it("injects flags for bunx vite dev", () => {
    const args = ["bunx", "vite", "dev"];
    injectFrameworkFlags(args, 4567);
    expect(args).toEqual([
      "bunx",
      "vite",
      "dev",
      "--port",
      "4567",
      "--strictPort",
      "--host",
      "127.0.0.1",
    ]);
  });

  it("injects flags for bunx --bun vite dev", () => {
    const args = ["bunx", "--bun", "vite", "dev"];
    injectFrameworkFlags(args, 4567);
    expect(args).toEqual([
      "bunx",
      "--bun",
      "vite",
      "dev",
      "--port",
      "4567",
      "--strictPort",
      "--host",
      "127.0.0.1",
    ]);
  });

  it("injects flags for npx vite dev", () => {
    const args = ["npx", "vite", "dev"];
    injectFrameworkFlags(args, 4567);
    expect(args).toEqual([
      "npx",
      "vite",
      "dev",
      "--port",
      "4567",
      "--strictPort",
      "--host",
      "127.0.0.1",
    ]);
  });

  it("injects flags for npx with flags before framework", () => {
    const args = ["npx", "--yes", "vite", "dev"];
    injectFrameworkFlags(args, 4567);
    expect(args).toEqual([
      "npx",
      "--yes",
      "vite",
      "dev",
      "--port",
      "4567",
      "--strictPort",
      "--host",
      "127.0.0.1",
    ]);
  });

  it("injects flags for pnpx vite dev", () => {
    const args = ["pnpx", "vite", "dev"];
    injectFrameworkFlags(args, 4567);
    expect(args).toEqual([
      "pnpx",
      "vite",
      "dev",
      "--port",
      "4567",
      "--strictPort",
      "--host",
      "127.0.0.1",
    ]);
  });

  // Subcommand runners (yarn dlx/exec, pnpm dlx/exec)

  it("injects flags for yarn dlx vite dev", () => {
    const args = ["yarn", "dlx", "vite", "dev"];
    injectFrameworkFlags(args, 4567);
    expect(args).toEqual([
      "yarn",
      "dlx",
      "vite",
      "dev",
      "--port",
      "4567",
      "--strictPort",
      "--host",
      "127.0.0.1",
    ]);
  });

  it("injects flags for yarn exec vite dev", () => {
    const args = ["yarn", "exec", "vite", "dev"];
    injectFrameworkFlags(args, 4567);
    expect(args).toEqual([
      "yarn",
      "exec",
      "vite",
      "dev",
      "--port",
      "4567",
      "--strictPort",
      "--host",
      "127.0.0.1",
    ]);
  });

  it("injects flags for pnpm dlx vite dev", () => {
    const args = ["pnpm", "dlx", "vite", "dev"];
    injectFrameworkFlags(args, 4567);
    expect(args).toEqual([
      "pnpm",
      "dlx",
      "vite",
      "dev",
      "--port",
      "4567",
      "--strictPort",
      "--host",
      "127.0.0.1",
    ]);
  });

  it("injects flags for pnpm exec astro dev", () => {
    const args = ["pnpm", "exec", "astro", "dev"];
    injectFrameworkFlags(args, 4567);
    expect(args).toEqual(["pnpm", "exec", "astro", "dev", "--port", "4567", "--host", "127.0.0.1"]);
  });

  it("injects flags for npm exec astro dev with a separator", () => {
    const args = ["npm", "exec", "astro", "dev"];
    injectFrameworkFlags(args, 4567);
    expect(args).toEqual([
      "npm",
      "exec",
      "astro",
      "dev",
      "--",
      "--port",
      "4567",
      "--host",
      "127.0.0.1",
    ]);
  });

  it("injects flags for npm exec -- astro dev without an extra separator", () => {
    const args = ["npm", "exec", "--", "astro", "dev"];
    injectFrameworkFlags(args, 4567);
    expect(args).toEqual([
      "npm",
      "exec",
      "--",
      "astro",
      "dev",
      "--port",
      "4567",
      "--host",
      "127.0.0.1",
    ]);
  });

  it("injects flags for npm x astro dev with a separator", () => {
    const args = ["npm", "x", "astro", "dev"];
    injectFrameworkFlags(args, 4567);
    expect(args).toEqual([
      "npm",
      "x",
      "astro",
      "dev",
      "--",
      "--port",
      "4567",
      "--host",
      "127.0.0.1",
    ]);
  });

  it("injects flags for npm exec --package astro -- astro dev", () => {
    const args = ["npm", "exec", "--package", "astro", "--", "astro", "dev"];
    injectFrameworkFlags(args, 4567);
    expect(args).toEqual([
      "npm",
      "exec",
      "--package",
      "astro",
      "--",
      "astro",
      "dev",
      "--port",
      "4567",
      "--host",
      "127.0.0.1",
    ]);
    const prefixed = ["npm", "--prefix", "./app", "exec", "--", "vite", "dev"];
    injectFrameworkFlags(prefixed, 4567);
    expect(prefixed).toEqual([
      "npm",
      "--prefix",
      "./app",
      "exec",
      "--",
      "vite",
      "dev",
      "--port",
      "4567",
      "--strictPort",
      "--host",
      "127.0.0.1",
    ]);
  });

  it("appends only missing flags after a separator for npm exec astro dev -- --port 3000", () => {
    const args = ["npm", "exec", "astro", "dev", "--", "--port", "3000"];
    injectFrameworkFlags(args, 4567);
    expect(args).toEqual([
      "npm",
      "exec",
      "astro",
      "dev",
      "--",
      "--port",
      "3000",
      "--host",
      "127.0.0.1",
    ]);
  });

  it("injects past an option npm consumes for npm exec vite dev --port=3000", () => {
    const args = ["npm", "exec", "vite", "dev", "--port=3000"];
    injectFrameworkFlags(args, 4567);
    expect(args).toEqual([
      "npm",
      "exec",
      "vite",
      "dev",
      "--port=3000",
      "--",
      "--port",
      "4567",
      "--strictPort",
      "--host",
      "127.0.0.1",
    ]);
  });

  it("does not inject when npm may consume an option value for npm exec vite --loglevel info build", () => {
    const args = ["npm", "exec", "vite", "--loglevel", "info", "build"];
    expect(injectFrameworkFlags(args, 4567)).toEqual([]);
    expect(args).toEqual(["npm", "exec", "vite", "--loglevel", "info", "build"]);
  });

  it("injects flags for npx rsbuild dev", () => {
    const args = ["npx", "rsbuild", "dev"];
    injectFrameworkFlags(args, 4567);
    expect(args).toEqual(["npx", "rsbuild", "dev", "--port", "4567", "--host", "127.0.0.1"]);
  });

  // Implicit bin (yarn <framework>)

  it("injects flags for yarn vite (implicit bin)", () => {
    const args = ["yarn", "vite", "dev"];
    injectFrameworkFlags(args, 4567);
    expect(args).toEqual([
      "yarn",
      "vite",
      "dev",
      "--port",
      "4567",
      "--strictPort",
      "--host",
      "127.0.0.1",
    ]);
  });

  // Runner with multiple flags

  it("skips multiple runner flags before framework", () => {
    const args = ["npx", "--yes", "--quiet", "vite", "dev"];
    injectFrameworkFlags(args, 4567);
    expect(args).toEqual([
      "npx",
      "--yes",
      "--quiet",
      "vite",
      "dev",
      "--port",
      "4567",
      "--strictPort",
      "--host",
      "127.0.0.1",
    ]);
  });

  // Runner + --port / --host already present

  it("skips --port when already present via runner", () => {
    const args = ["bunx", "vite", "dev", "--port", "3000"];
    injectFrameworkFlags(args, 4567);
    expect(args).toContain("3000");
    expect(args).not.toContain("4567");
  });

  it("skips --host when already present via runner", () => {
    const args = ["npx", "vite", "dev", "--host", "0.0.0.0"];
    injectFrameworkFlags(args, 4567);
    expect(args).toEqual([
      "npx",
      "vite",
      "dev",
      "--host",
      "0.0.0.0",
      "--port",
      "4567",
      "--strictPort",
    ]);
  });

  it("skips all injection when both --port and --host present via runner", () => {
    const args = ["bunx", "--bun", "vite", "dev", "--port", "3000", "--host", "0.0.0.0"];
    injectFrameworkFlags(args, 4567);
    expect(args).toEqual(["bunx", "--bun", "vite", "dev", "--port", "3000", "--host", "0.0.0.0"]);
  });

  // Negative cases: runner with non-framework commands

  it("does not inject for bunx with non-framework command", () => {
    const args = ["bunx", "--bun", "next", "dev"];
    injectFrameworkFlags(args, 4567);
    expect(args).toEqual(["bunx", "--bun", "next", "dev"]);
  });

  it("does not inject for npx with non-framework command", () => {
    const args = ["npx", "next", "dev"];
    injectFrameworkFlags(args, 4567);
    expect(args).toEqual(["npx", "next", "dev"]);
  });

  it("does not inject for yarn with unrecognized subcommand", () => {
    const args = ["yarn", "run", "next", "dev"];
    injectFrameworkFlags(args, 4567);
    expect(args).toEqual(["yarn", "run", "next", "dev"]);
  });

  it("does not inject for pnpm with unrecognized subcommand", () => {
    const args = ["pnpm", "run", "vite", "dev"];
    injectFrameworkFlags(args, 4567);
    expect(args).toEqual(["pnpm", "run", "vite", "dev"]);
  });

  // Edge cases

  it("does not inject when runner has only flags and no command", () => {
    const args = ["bunx", "--bun"];
    injectFrameworkFlags(args, 4567);
    expect(args).toEqual(["bunx", "--bun"]);
  });

  it("does not inject for runner alone with no arguments", () => {
    const args = ["npx"];
    injectFrameworkFlags(args, 4567);
    expect(args).toEqual(["npx"]);
  });

  it("does not inject for yarn subcommand with no further arguments", () => {
    const args = ["yarn", "dlx"];
    injectFrameworkFlags(args, 4567);
    expect(args).toEqual(["yarn", "dlx"]);
  });

  it("does not inject for yarn with only flags and no subcommand", () => {
    const args = ["yarn", "--silent"];
    injectFrameworkFlags(args, 4567);
    expect(args).toEqual(["yarn", "--silent"]);
  });

  it("injects --port and --ip for wrangler dev", () => {
    const args = ["wrangler", "dev"];
    injectFrameworkFlags(args, 4567);
    expect(args).toEqual(["wrangler", "dev", "--port", "4567", "--ip", "127.0.0.1"]);
  });

  it("does not inject --host for wrangler because it is not the bind flag", () => {
    const args = ["wrangler", "dev", "--host", "example.com"];
    injectFrameworkFlags(args, 4567);
    expect(args).toEqual([
      "wrangler",
      "dev",
      "--host",
      "example.com",
      "--port",
      "4567",
      "--ip",
      "127.0.0.1",
    ]);
  });

  it("injects --port and --host for vinext dev, which delegates to Vite", () => {
    const args = ["vinext", "dev"];
    injectFrameworkFlags(args, 4567);
    expect(args).toEqual(["vinext", "dev", "--port", "4567", "--host", "127.0.0.1"]);
  });

  it("injects --port and --hostname for vinext start so it does not bind 0.0.0.0", () => {
    const args = ["vinext", "start"];
    injectFrameworkFlags(args, 4567);
    expect(args).toEqual(["vinext", "start", "--port", "4567", "--hostname", "127.0.0.1"]);
  });

  it("injects through package runners for vinext start", () => {
    const args = ["bunx", "vinext", "start"];
    injectFrameworkFlags(args, 4567);
    expect(args).toEqual(["bunx", "vinext", "start", "--port", "4567", "--hostname", "127.0.0.1"]);
  });

  it.each([
    [
      ["vinext", "start", "-H", "0.0.0.0"],
      ["vinext", "start", "-H", "0.0.0.0", "--port", "4567"],
    ],
    [
      ["vinext", "start", "--hostname=::1"],
      ["vinext", "start", "--hostname=::1", "--port", "4567"],
    ],
    [
      ["vinext", "start", "-p", "3000"],
      ["vinext", "start", "-p", "3000", "--hostname", "127.0.0.1"],
    ],
    [
      ["vinext", "dev", "--host", "0.0.0.0"],
      ["vinext", "dev", "--host", "0.0.0.0", "--port", "4567"],
    ],
  ])("respects explicit vinext flags in %j", (input, expected) => {
    const args = [...input];
    injectFrameworkFlags(args, 4567);
    expect(args).toEqual(expected);
  });

  it.each(["init", "build", "check", "lint", "typegen"])(
    "does not inject flags for vinext %s",
    (subcommand) => {
      const args = ["vinext", subcommand];
      injectFrameworkFlags(args, 4567);
      expect(args).toEqual(["vinext", subcommand]);
    }
  );

  it("injects flags for Laravel artisan serve", () => {
    const args = ["php", "artisan", "serve"];
    injectFrameworkFlags(args, 4567);
    expect(args).toEqual(["php", "artisan", "serve", "--port", "4567", "--host", "127.0.0.1"]);
  });

  it("does not inject server flags into a Vite build", () => {
    const args = ["vite", "build"];
    injectFrameworkFlags(args, 4567);
    expect(args).toEqual(["vite", "build"]);
  });

  it("recognizes an existing --port=value option and still adds a missing host", () => {
    const args = ["vite", "dev", "--port=5000"];
    injectFrameworkFlags(args, 4567);
    expect(args).toEqual(["vite", "dev", "--port=5000", "--host", "127.0.0.1"]);
  });
});

describe("injectPackageScriptFrameworkFlags", () => {
  let packageDir: string;

  beforeEach(() => {
    packageDir = fs.mkdtempSync(path.join(os.tmpdir(), "portless-script-injection-"));
  });

  afterEach(() => {
    fs.rmSync(packageDir, { recursive: true, force: true });
  });

  function writeScript(script: string): void {
    writeScripts({ dev: script });
  }

  function writeScripts(scripts: Record<string, string>): void {
    fs.writeFileSync(
      path.join(packageDir, "package.json"),
      JSON.stringify({ name: "test-app", scripts })
    );
  }

  it.each(["bun", "npm", "pnpm", "yarn"])("forwards Vite flags through %s run dev", (pm) => {
    writeScript("vite dev");
    const args = [pm, "run", "dev"];

    injectPackageScriptFrameworkFlags(args, 4567, packageDir);

    expect(args).toEqual([
      pm,
      "run",
      "dev",
      ...(pm === "npm" ? ["--"] : []),
      "--port",
      "4567",
      "--strictPort",
      "--host",
      "127.0.0.1",
    ]);
  });

  it.each([
    ["vitepress", "vitepress dev"],
    ["rsbuild", "rsbuild dev"],
    ["laravel", "php artisan serve"],
    ["wrangler", "wrangler dev"],
  ])("forwards flags for the fork's %s injector", (_name, script) => {
    writeScript(script);
    const args = ["bun", "run", "dev"];

    injectPackageScriptFrameworkFlags(args, 4567, packageDir);

    expect(args.slice(3)).toEqual(
      script.startsWith("vitepress")
        ? ["--port", "4567", "--strictPort", "--host", "127.0.0.1"]
        : script.startsWith("wrangler")
          ? ["--port", "4567", "--ip", "127.0.0.1"]
          : ["--port", "4567", "--host", "127.0.0.1"]
    );
  });

  it("does not append into a compound script or a non-server command", () => {
    writeScript("vite dev && vite build");
    const compoundArgs = ["bun", "run", "dev"];
    injectPackageScriptFrameworkFlags(compoundArgs, 4567, packageDir);
    expect(compoundArgs).toEqual(["bun", "run", "dev"]);

    writeScript("vite build");
    const buildArgs = ["bun", "run", "dev"];
    injectPackageScriptFrameworkFlags(buildArgs, 4567, packageDir);
    expect(buildArgs).toEqual(["bun", "run", "dev"]);
  });

  it("resolves framework identity through a package script independently of append safety", () => {
    writeScript("expo start --port 4567 # already configured");
    expect(resolveFrameworkBasename(["bun", "run", "dev"], packageDir)).toBe("expo");
  });

  it("forwards only the missing host when the script supplies a port", () => {
    writeScript("expo start --port 4567");
    const args = ["bun", "run", "dev"];
    injectPackageScriptFrameworkFlags(args, 4567, packageDir);
    expect(args).toEqual(["bun", "run", "dev", "--host", "localhost"]);
  });

  it.each(["--localhost", "--lan", "--tunnel"])(
    "preserves Expo connection mode %s through a package script",
    (mode) => {
      writeScript(`expo start ${mode}`);
      const args = ["pnpm", "run", "dev"];
      injectPackageScriptFrameworkFlags(args, 4567, packageDir);
      expect(args).toEqual(["pnpm", "run", "dev", "--port", "4567"]);
    }
  );

  it("forwards only the missing port when the script supplies a host", () => {
    writeScript("vite dev --host 127.0.0.1");
    const args = ["bun", "run", "dev", "--", "--host", "0.0.0.0"];
    injectPackageScriptFrameworkFlags(args, 4567, packageDir);
    expect(args).toEqual([
      "bun",
      "run",
      "dev",
      "--",
      "--host",
      "0.0.0.0",
      "--port",
      "4567",
      "--strictPort",
    ]);
  });

  it("does not duplicate a port supplied by script or user trailing args", () => {
    writeScript("vite dev --host 127.0.0.1");
    const userArgs = ["npm", "run", "dev", "--", "--port", "3000"];
    injectPackageScriptFrameworkFlags(userArgs, 4567, packageDir);
    expect(userArgs).toEqual(["npm", "run", "dev", "--", "--port", "3000"]);

    writeScript("vite dev --port=5000 --host=127.0.0.1");
    const scriptArgs = ["bun", "run", "dev"];
    injectPackageScriptFrameworkFlags(scriptArgs, 4567, packageDir);
    expect(scriptArgs).toEqual(["bun", "run", "dev"]);

    writeScript("vite dev --host=127.0.0.1");
    const equalsArgs = ["bun", "run", "dev", "--port=3000"];
    injectPackageScriptFrameworkFlags(equalsArgs, 4567, packageDir);
    expect(equalsArgs).toEqual(["bun", "run", "dev", "--port=3000"]);
  });

  it.each([
    "vite dev && node second.js",
    "vite dev&&node second.js",
    "vite dev\nnode second.js",
    "vite dev | tee log.txt",
    "vite dev # keep this note",
    "vite dev --open  # opens a browser",
    "vite dev \\\n# note",
  ])("does not append flags to unsafe shell script %s", (script) => {
    writeScript(script);
    const args = ["bun", "run", "dev"];
    injectPackageScriptFrameworkFlags(args, 4567, packageDir);
    expect(args).toEqual(["bun", "run", "dev"]);
  });

  it("preserves quoted metacharacters and redirections in a single script", () => {
    for (const script of ["vite dev --open '/foo&bar'", "vite dev >vite.log 2>&1"]) {
      writeScript(script);
      const args = ["bun", "run", "dev"];
      injectPackageScriptFrameworkFlags(args, 4567, packageDir);
      expect(args).toEqual([
        "bun",
        "run",
        "dev",
        "--port",
        "4567",
        "--strictPort",
        "--host",
        "127.0.0.1",
      ]);
    }
  });

  it("does not append past a script's own option terminator", () => {
    writeScript("vite dev -- --extra");
    const args = ["bun", "run", "dev"];
    injectPackageScriptFrameworkFlags(args, 4567, packageDir);
    expect(args).toEqual(["bun", "run", "dev"]);
  });

  it("handles server and non-server framework subcommands", () => {
    writeScripts({
      preview: "vite preview",
      build: "vite build",
      optimize: "vite optimize",
      test: "vp test",
      export: "expo export",
      check: "astro check",
    });

    const previewArgs = ["bun", "run", "preview"];
    injectPackageScriptFrameworkFlags(previewArgs, 4567, packageDir);
    expect(previewArgs).toEqual([
      "bun",
      "run",
      "preview",
      "--port",
      "4567",
      "--strictPort",
      "--host",
      "127.0.0.1",
    ]);

    for (const script of ["build", "optimize", "test", "export", "check"]) {
      const args = ["bun", "run", script];
      injectPackageScriptFrameworkFlags(args, 4567, packageDir);
      expect(args).toEqual(["bun", "run", script]);
    }
  });

  it("handles runner-wrapped and flag-prefixed build scripts conservatively", () => {
    writeScripts({
      build: "bunx vite build",
      mode: "vite --mode production build",
      dev: "bunx vite dev --host 127.0.0.1",
    });

    const buildArgs = ["bun", "run", "build"];
    injectPackageScriptFrameworkFlags(buildArgs, 4567, packageDir);
    expect(buildArgs).toEqual(["bun", "run", "build"]);

    const modeArgs = ["bun", "run", "mode"];
    injectPackageScriptFrameworkFlags(modeArgs, 4567, packageDir);
    expect(modeArgs).toEqual(["bun", "run", "mode"]);

    const runnerArgs = ["bun", "run", "dev"];
    injectPackageScriptFrameworkFlags(runnerArgs, 4567, packageDir);
    expect(runnerArgs).toEqual(["bun", "run", "dev", "--port", "4567", "--strictPort"]);
  });

  it("forwards flags through a script that uses npm exec with a separator", () => {
    writeScripts({ dev: "npm exec -- vite dev" });
    const args = ["npm", "run", "dev"];
    injectPackageScriptFrameworkFlags(args, 4567, packageDir);
    expect(args).toEqual([
      "npm",
      "run",
      "dev",
      "--",
      "--port",
      "4567",
      "--strictPort",
      "--host",
      "127.0.0.1",
    ]);
  });

  it("forwards flags through a script that runs npm exec without its own separator", () => {
    writeScripts({ dev: "npm exec astro dev" });
    const args = ["npm", "run", "dev"];
    injectPackageScriptFrameworkFlags(args, 4567, packageDir);
    // npm run strips the first `--`; the second reaches `npm exec`, which then
    // hands the injected flags to astro instead of reading them itself.
    expect(args).toEqual([
      "npm",
      "run",
      "dev",
      "--",
      "--",
      "--port",
      "4567",
      "--host",
      "127.0.0.1",
    ]);
  });

  it("still declines a script with a separator after the framework name", () => {
    writeScripts({ dev: "npm exec -- vite dev -- --open" });
    const args = ["npm", "run", "dev"];
    injectPackageScriptFrameworkFlags(args, 4567, packageDir);
    expect(args).toEqual(["npm", "run", "dev"]);
  });

  it("ignores missing scripts and commands outside package-manager run", () => {
    writeScripts({ start: "vite dev" });
    for (const args of [
      ["vite", "dev"],
      ["bun", "dev"],
      ["bun", "run", "--bun"],
      ["bunx", "vite", "dev"],
      ["cargo", "run", "dev"],
      ["bun", "run", "dev"],
    ]) {
      const before = [...args];
      injectPackageScriptFrameworkFlags(args, 4567, packageDir);
      expect(args).toEqual(before);
    }
  });

  it("resolves an absolute package-manager path and runner inside the script", () => {
    writeScript("bunx vite dev --host 127.0.0.1");
    const args = ["/usr/local/bin/bun", "run", "dev"];
    injectPackageScriptFrameworkFlags(args, 4567, packageDir);
    expect(args).toEqual(["/usr/local/bin/bun", "run", "dev", "--port", "4567", "--strictPort"]);
  });

  it("keeps comments, escaped spaces, and substitutions classified correctly", () => {
    writeScript("vite dev --tag v1#2");
    const wordArgs = ["bun", "run", "dev"];
    injectPackageScriptFrameworkFlags(wordArgs, 4567, packageDir);
    expect(wordArgs).toContain("--port");

    writeScript("vite dev --open /foo\\ #bar");
    const escapedArgs = ["bun", "run", "dev"];
    injectPackageScriptFrameworkFlags(escapedArgs, 4567, packageDir);
    expect(escapedArgs).toContain("--port");

    writeScript("vite dev --define SHA=$(git rev-parse HEAD)");
    const substitutionArgs = ["bun", "run", "dev"];
    injectPackageScriptFrameworkFlags(substitutionArgs, 4567, packageDir);
    expect(substitutionArgs).toContain("--port");
  });
});

describe("resolveFrameworkBasename", () => {
  let packageDir: string;

  beforeEach(() => {
    packageDir = fs.mkdtempSync(path.join(os.tmpdir(), "portless-framework-resolution-"));
  });

  afterEach(() => {
    fs.rmSync(packageDir, { recursive: true, force: true });
  });

  it("resolves direct and package-runner invocations", () => {
    expect(resolveFrameworkBasename(["vite", "dev"], packageDir)).toBe("vite");
    expect(resolveFrameworkBasename(["bunx", "--bun", "vite", "dev"], packageDir)).toBe("vite");
  });

  it("resolves framework identity through a package script", () => {
    fs.writeFileSync(
      path.join(packageDir, "package.json"),
      JSON.stringify({ scripts: { dev: "expo start" } })
    );
    expect(resolveFrameworkBasename(["bun", "run", "dev"], packageDir)).toBe("expo");
  });

  it("keeps identity resolution independent from append safety", () => {
    fs.writeFileSync(
      path.join(packageDir, "package.json"),
      JSON.stringify({ scripts: { dev: "expo start --port 4567 # note" } })
    );
    expect(resolveFrameworkBasename(["bun", "run", "dev"], packageDir)).toBe("expo");
  });

  it("returns null when no known framework is reached", () => {
    fs.writeFileSync(
      path.join(packageDir, "package.json"),
      JSON.stringify({ scripts: { dev: "node server.js" } })
    );
    expect(resolveFrameworkBasename(["bun", "run", "dev"], packageDir)).toBeNull();
    expect(resolveFrameworkBasename(["node", "server.js"], packageDir)).toBeNull();
  });
});

describe("hasPlaceholders", () => {
  it("returns true when command args contain supported placeholders", () => {
    expect(hasPlaceholders(["my-server", "--port", "{PORT}"])).toBe(true);
    expect(hasPlaceholders(["my-server", "--host", "{HOST}"])).toBe(true);
    expect(hasPlaceholders(["my-server", "--url", "{PORTLESS_URL}"])).toBe(true);
  });

  it("requires exact uppercase placeholder arguments", () => {
    expect(hasPlaceholders(["my-server", "--port={PORT}"])).toBe(false);
    expect(hasPlaceholders(["my-server", "{port}"])).toBe(false);
    expect(hasPlaceholders(["my-server", "{UNKNOWN}"])).toBe(false);
  });
});

describe("replacePlaceholders", () => {
  it("replaces supported placeholders in place", () => {
    const args = ["my-server", "--port", "{PORT}", "--host", "{HOST}", "--url", "{PORTLESS_URL}"];

    replacePlaceholders(args, {
      PORT: "4567",
      HOST: "127.0.0.1",
      PORTLESS_URL: "https://myapp.localhost",
    });

    expect(args).toEqual([
      "my-server",
      "--port",
      "4567",
      "--host",
      "127.0.0.1",
      "--url",
      "https://myapp.localhost",
    ]);
  });

  it("leaves partial, lowercase, and unknown placeholders unchanged", () => {
    const args = ["my-server", "--port={PORT}", "{port}", "{UNKNOWN}"];

    replacePlaceholders(args, {
      PORT: "4567",
      HOST: "127.0.0.1",
      PORTLESS_URL: "https://myapp.localhost",
    });

    expect(args).toEqual(["my-server", "--port={PORT}", "{port}", "{UNKNOWN}"]);
  });
});

describe("DEFAULT_TLD", () => {
  it("is localhost", () => {
    expect(DEFAULT_TLD).toBe("localhost");
  });
});

describe("getDefaultTld", () => {
  let originalLegacyEnv: string | undefined;
  let originalSuffixEnv: string | undefined;

  beforeEach(() => {
    originalLegacyEnv = process.env[LEGACY_TLD_ENV];
    originalSuffixEnv = process.env[SUFFIX_ENV];
  });

  afterEach(() => {
    if (originalLegacyEnv === undefined) {
      delete process.env[LEGACY_TLD_ENV];
    } else {
      process.env[LEGACY_TLD_ENV] = originalLegacyEnv;
    }
    if (originalSuffixEnv === undefined) {
      delete process.env[SUFFIX_ENV];
    } else {
      process.env[SUFFIX_ENV] = originalSuffixEnv;
    }
  });

  it("returns DEFAULT_TLD when no suffix env vars are set", () => {
    delete process.env[LEGACY_TLD_ENV];
    delete process.env[SUFFIX_ENV];
    expect(getDefaultTld()).toBe(DEFAULT_TLD);
  });

  it("returns PORTLESS_SUFFIX when set", () => {
    process.env[SUFFIX_ENV] = "test";
    expect(getDefaultTld()).toBe("test");
  });

  it("lowercases the value", () => {
    process.env[SUFFIX_ENV] = "TEST";
    expect(getDefaultTld()).toBe("test");
  });

  it("trims whitespace", () => {
    process.env[SUFFIX_ENV] = "  test  ";
    expect(getDefaultTld()).toBe("test");
  });

  it("falls back to legacy PORTLESS_TLD when the new env var is unset", () => {
    delete process.env[SUFFIX_ENV];
    process.env[LEGACY_TLD_ENV] = "legacy.test";
    expect(getDefaultTld()).toBe("legacy.test");
  });

  it("prefers PORTLESS_SUFFIX over PORTLESS_TLD", () => {
    process.env[SUFFIX_ENV] = "preferred.test";
    process.env[LEGACY_TLD_ENV] = "legacy.test";
    expect(getDefaultTld()).toBe("preferred.test");
  });

  it("returns the first suffix from a configured list", () => {
    process.env[SUFFIX_ENV] = "preferred.test,localhost";
    expect(getDefaultTld()).toBe("preferred.test");
  });

  it("returns DEFAULT_TLD when both env vars are empty", () => {
    process.env[SUFFIX_ENV] = "";
    process.env[LEGACY_TLD_ENV] = "";
    expect(getDefaultTld()).toBe(DEFAULT_TLD);
  });
});

describe("getDefaultTlds", () => {
  let originalLegacyEnv: string | undefined;
  let originalSuffixEnv: string | undefined;

  beforeEach(() => {
    originalLegacyEnv = process.env[LEGACY_TLD_ENV];
    originalSuffixEnv = process.env[SUFFIX_ENV];
  });

  afterEach(() => {
    if (originalLegacyEnv === undefined) delete process.env[LEGACY_TLD_ENV];
    else process.env[LEGACY_TLD_ENV] = originalLegacyEnv;
    if (originalSuffixEnv === undefined) delete process.env[SUFFIX_ENV];
    else process.env[SUFFIX_ENV] = originalSuffixEnv;
  });

  it("parses, normalizes, and deduplicates PORTLESS_SUFFIX in order", () => {
    process.env[SUFFIX_ENV] = " TEST, server01.Acme.com, test ";
    process.env[LEGACY_TLD_ENV] = "legacy.test";
    expect(getDefaultTlds()).toEqual(["test", "server01.acme.com"]);
  });

  it("falls back to a PORTLESS_TLD list when PORTLESS_SUFFIX is empty", () => {
    process.env[SUFFIX_ENV] = "";
    process.env[LEGACY_TLD_ENV] = "legacy.test,localhost";
    expect(getDefaultTlds()).toEqual(["legacy.test", "localhost"]);
  });

  it("does not treat empty suffix variables as explicit configuration", () => {
    process.env[SUFFIX_ENV] = "";
    process.env[LEGACY_TLD_ENV] = "";
    expect(hasConfiguredTldEnv()).toBe(false);
  });
});

describe("parseTldList", () => {
  it("parses comma-separated suffixes and removes duplicates in order", () => {
    expect(parseTldList(" TEST, localhost, test ")).toEqual(["test", "localhost"]);
  });

  it("rejects empty comma-separated entries", () => {
    expect(() => parseTldList("test,,localhost")).toThrow("TLD cannot be empty");
  });
});

describe("cmdEscape", () => {
  it("leaves safe arguments bare (cmd built-ins print added quotes literally)", () => {
    expect(cmdEscape("dev")).toBe("dev");
    expect(cmdEscape("--force")).toBe("--force");
    expect(cmdEscape("--port=3000")).toBe("--port=3000");
    expect(cmdEscape("C:\\tools\\script.js")).toBe("C:\\tools\\script.js");
  });

  it("preserves paths with spaces as a single argument", () => {
    expect(cmdEscape("C:\\Program Files\\nodejs\\node.exe")).toBe(
      '^"C:\\Program^ Files\\nodejs\\node.exe^"'
    );
  });

  it("caret-escapes cmd metacharacters", () => {
    expect(cmdEscape("console.log(1)")).toBe('^"console.log^(1^)^"');
    expect(cmdEscape("a&&b")).toBe('^"a^&^&b^"');
    expect(cmdEscape("%PATH%")).toBe('^"^%PATH^%^"');
  });

  it("escapes embedded double quotes", () => {
    expect(cmdEscape('say "hi"')).toBe('^"say^ \\^"hi\\^"^"');
  });

  it("escapes quote-toggle injection payloads", () => {
    expect(cmdEscape('a" & echo PORTLESS_INJECTED & "b')).toBe(
      '^"a\\^"^ ^&^ echo^ PORTLESS_INJECTED^ ^&^ \\^"b^"'
    );
  });

  it("caret-escapes percent expansion payloads", () => {
    expect(cmdEscape("%PATH%")).toBe('^"^%PATH^%^"');
  });

  it("doubles backslashes before quotes and before the added closing quote", () => {
    expect(cmdEscape('dir\\"x')).toBe('^"dir\\\\\\^"x^"');
    expect(cmdEscape("trailing \\")).toBe('^"trailing^ \\\\^"');
  });

  it("leaves a bare trailing backslash alone (no quote added, so no doubling)", () => {
    expect(cmdEscape("trailing\\")).toBe("trailing\\");
  });

  it("handles the empty argument", () => {
    expect(cmdEscape("")).toBe('^"^"');
  });

  it("escapes long backslash runs in linear time (regex form is quadratic)", () => {
    const arg = "a " + "\\".repeat(64 * 1024);
    const start = performance.now();
    const escaped = cmdEscape(arg);
    // The old /(\\\\*)"/g implementation takes >10s here; allow generous CI jitter.
    expect(performance.now() - start).toBeLessThan(1000);
    expect(escaped).toBe('^"a^ ' + "\\".repeat(128 * 1024) + '^"');
  });
});

describe("cmdEscapeCommand", () => {
  it("leaves bare PATH-resolved names untouched (quoting breaks %~dp0 in .cmd shims)", () => {
    expect(cmdEscapeCommand("npm")).toBe("npm");
    expect(cmdEscapeCommand("pnpm")).toBe("pnpm");
    expect(cmdEscapeCommand("node")).toBe("node");
    expect(cmdEscapeCommand("C:\\tools\\node.exe")).toBe("C:\\tools\\node.exe");
  });

  it("plain-quotes (no carets) paths with spaces", () => {
    expect(cmdEscapeCommand("C:\\Program Files\\nodejs\\node.exe")).toBe(
      '"C:\\Program Files\\nodejs\\node.exe"'
    );
  });

  it("plain-quotes names containing cmd metacharacters", () => {
    expect(cmdEscapeCommand("foo&bar")).toBe('"foo&bar"');
    expect(cmdEscapeCommand("a(b)c")).toBe('"a(b)c"');
  });

  it("caret-escapes % in bare names (quotes cannot suppress %VAR% expansion)", () => {
    expect(cmdEscapeCommand("probe%PATH%.cmd")).toBe("probe^%PATH^%.cmd");
    expect(cmdEscapeCommand("100%.exe")).toBe("100^%.exe");
  });

  it("caret-escapes % in a resolved path with spaces", () => {
    expect(cmdEscapeCommand("C:\\Program Files\\probe%PATH%.cmd")).toBe(
      '"C:\\Program Files\\probe^%PATH^%.cmd"'
    );
  });
});

describe("buildProxyStartConfig", () => {
  it("preserves an explicit suffix list in LAN mode and appends local", () => {
    expect(
      buildProxyStartConfig({
        useHttps: true,
        lanMode: true,
        lanIp: "192.168.1.42",
        lanIpExplicit: true,
        tld: "test",
        tlds: ["test", "server01.acme.com", "test"],
        tldsExplicit: true,
        useWildcard: true,
        foreground: true,
        includePort: true,
        proxyPort: 8080,
      })
    ).toEqual({
      effectiveTld: "test",
      effectiveTlds: ["test", "server01.acme.com", "local"],
      args: [
        "--foreground",
        "--port",
        "8080",
        "--https",
        "--lan",
        "--suffix",
        "test",
        "--suffix",
        "server01.acme.com",
        "--suffix",
        "local",
        "--ip",
        "192.168.1.42",
        "--wildcard",
      ],
    });
  });

  it("passes auto-detected LAN IP through an internal flag", () => {
    expect(
      buildProxyStartConfig({
        useHttps: false,
        lanMode: true,
        lanIp: "192.168.1.42",
        lanIpExplicit: false,
        tld: "localhost",
      })
    ).toEqual({
      effectiveTld: "local",
      effectiveTlds: ["local"],
      args: ["--no-tls", "--lan", INTERNAL_LAN_IP_FLAG, "192.168.1.42"],
    });
  });

  it("keeps custom suffixes outside LAN mode", () => {
    expect(
      buildProxyStartConfig({
        useHttps: false,
        lanMode: false,
        tld: "test",
      })
    ).toEqual({
      effectiveTld: "test",
      effectiveTlds: ["test"],
      args: ["--no-tls", "--suffix", "test"],
    });
  });

  it("emits every suffix outside LAN mode", () => {
    expect(
      buildProxyStartConfig({
        useHttps: true,
        lanMode: false,
        tld: "localhost",
        tlds: ["localhost", "test"],
        tldsExplicit: true,
      })
    ).toEqual({
      effectiveTld: "localhost",
      effectiveTlds: ["localhost", "test"],
      args: ["--https", "--suffix", "localhost", "--suffix", "test"],
    });
  });

  it("forwards the routes cleanup interval, including zero", () => {
    expect(
      buildProxyStartConfig({
        useHttps: false,
        lanMode: false,
        tld: "localhost",
        routesCleanupIntervalSeconds: 60,
      }).args
    ).toEqual(["--no-tls", "--routes-cleanup-interval", "60"]);

    expect(
      buildProxyStartConfig({
        useHttps: false,
        lanMode: false,
        tld: "localhost",
        routesCleanupIntervalSeconds: 0,
      }).args
    ).toEqual(["--no-tls", "--routes-cleanup-interval", "0"]);
  });
});

describe("buildSudoEnvArgs", () => {
  it("preserves portless env, preserves HOME, and applies overrides", () => {
    expect(
      buildSudoEnvArgs(
        {
          HOME: "/home/alice",
          PATH: "/usr/bin",
          PORTLESS_SUFFIX: "server01.acme.com",
          PORTLESS_STATE_DIR: "/old/state",
        },
        {
          PORTLESS_STATE_DIR: "/home/alice/.portless",
        }
      ).sort()
    ).toEqual(
      [
        "HOME=/home/alice",
        "PORTLESS_STATE_DIR=/home/alice/.portless",
        "PORTLESS_SUFFIX=server01.acme.com",
      ].sort()
    );
  });
});

describe("readLanMarker / writeLanMarker", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "portless-lan-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("writes and reads a LAN IP", () => {
    writeLanMarker(tmpDir, "192.168.1.42");
    expect(readLanMarker(tmpDir)).toBe("192.168.1.42");
  });

  it("removes the file when writing null", () => {
    writeLanMarker(tmpDir, "192.168.1.42");
    expect(fs.existsSync(path.join(tmpDir, "proxy.lan"))).toBe(true);

    writeLanMarker(tmpDir, null);
    expect(fs.existsSync(path.join(tmpDir, "proxy.lan"))).toBe(false);
    expect(readLanMarker(tmpDir)).toBeNull();
  });

  it("retains marker existence when LAN has temporarily lost its IP", () => {
    writeLanModeMarker(tmpDir, true, null);
    expect(hasLanMarker(tmpDir)).toBe(true);
    expect(readLanMarker(tmpDir)).toBeNull();
  });

  it("uses the LAN marker to remember LAN mode when the proxy is stopped", async () => {
    const prevStateDir = process.env.PORTLESS_STATE_DIR;
    const prevSuffix = process.env[SUFFIX_ENV];
    const prevLegacyTld = process.env[LEGACY_TLD_ENV];
    try {
      fs.writeFileSync(path.join(tmpDir, "proxy.port"), "1355");
      writeTldFile(tmpDir, "local");
      writeLanMarker(tmpDir, "192.168.1.42");
      process.env.PORTLESS_STATE_DIR = tmpDir;
      delete process.env[SUFFIX_ENV];
      delete process.env[LEGACY_TLD_ENV];

      await expect(discoverState()).resolves.toMatchObject({
        dir: tmpDir,
        port: 1355,
        tld: "local",
        lanMode: true,
        lanIp: null,
      });
    } finally {
      if (prevStateDir === undefined) {
        delete process.env.PORTLESS_STATE_DIR;
      } else {
        process.env.PORTLESS_STATE_DIR = prevStateDir;
      }
      if (prevSuffix === undefined) {
        delete process.env[SUFFIX_ENV];
      } else {
        process.env[SUFFIX_ENV] = prevSuffix;
      }
      if (prevLegacyTld === undefined) {
        delete process.env[LEGACY_TLD_ENV];
      } else {
        process.env[LEGACY_TLD_ENV] = prevLegacyTld;
      }
    }
  });
});

describe("readCustomCertMarker / writeCustomCertMarker", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "portless-custom-cert-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("records and clears custom certificate state for diagnostics", () => {
    expect(readCustomCertMarker(tmpDir)).toBe(false);

    writeCustomCertMarker(tmpDir, true);
    expect(readCustomCertMarker(tmpDir)).toBe(true);

    writeCustomCertMarker(tmpDir, false);
    expect(readCustomCertMarker(tmpDir)).toBe(false);
  });
});

describe("readInternalPagesDisabledMarker / writeInternalPagesDisabledMarker", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "portless-pages-marker-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("records and clears intentionally disabled internal pages", () => {
    expect(readInternalPagesDisabledMarker(tmpDir)).toBe(false);

    writeInternalPagesDisabledMarker(tmpDir, true);
    expect(readInternalPagesDisabledMarker(tmpDir)).toBe(true);

    writeInternalPagesDisabledMarker(tmpDir, false);
    expect(readInternalPagesDisabledMarker(tmpDir)).toBe(false);
  });
});

describe("readWildcardMarker / writeWildcardMarker", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "portless-wildcard-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("writes and reads wildcard mode", () => {
    writeWildcardMarker(tmpDir, true);
    expect(readWildcardMarker(tmpDir)).toBe(true);
  });

  it("removes the marker when wildcard mode is disabled", () => {
    writeWildcardMarker(tmpDir, true);
    expect(fs.existsSync(path.join(tmpDir, "proxy.wildcard"))).toBe(true);

    writeWildcardMarker(tmpDir, false);
    expect(readWildcardMarker(tmpDir)).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, "proxy.wildcard"))).toBe(false);
  });
});

describe("readTldFromDir / writeTldFile", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "portless-tld-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns DEFAULT_TLD when file does not exist", () => {
    expect(readTldFromDir(tmpDir)).toBe(DEFAULT_TLD);
    expect(readTldsFromDir(tmpDir)).toEqual([DEFAULT_TLD]);
  });

  it("writes and reads a custom TLD", () => {
    writeTldFile(tmpDir, "test");
    expect(readTldFromDir(tmpDir)).toBe("test");
    expect(readTldsFromDir(tmpDir)).toEqual(["test"]);
  });

  it("persists a suffix list while retaining proxy.tld as the primary marker", () => {
    writeTldsFile(tmpDir, ["server01.acme.com", "test"]);

    expect(readTldsFromDir(tmpDir)).toEqual(["server01.acme.com", "test"]);
    expect(fs.readFileSync(path.join(tmpDir, "proxy.tld"), "utf-8")).toBe("server01.acme.com");
  });

  it("skips invalid persisted list entries without discarding valid suffixes", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    fs.writeFileSync(path.join(tmpDir, "proxy.tlds"), "test\nbad_name\ninternal\n");

    expect(readTldsFromDir(tmpDir)).toEqual(["test", "internal"]);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("Warning: ignoring invalid TLD entry in proxy.tlds")
    );

    warn.mockRestore();
  });

  it("ignores an invalid persisted TLD with a warning", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    fs.writeFileSync(path.join(tmpDir, "proxy.tld"), "invalid tld");

    expect(readTldFromDir(tmpDir)).toBe(DEFAULT_TLD);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("Warning: ignoring invalid TLD entry in proxy.tld")
    );

    warn.mockRestore();
  });

  it("removes the file when writing the default TLD", () => {
    writeTldFile(tmpDir, "test");
    expect(fs.existsSync(path.join(tmpDir, "proxy.tld"))).toBe(true);

    writeTldFile(tmpDir, DEFAULT_TLD);
    expect(fs.existsSync(path.join(tmpDir, "proxy.tld"))).toBe(false);
    expect(readTldFromDir(tmpDir)).toBe(DEFAULT_TLD);
  });

  it("handles removing the default TLD file when it does not exist", () => {
    writeTldFile(tmpDir, DEFAULT_TLD);
    expect(readTldFromDir(tmpDir)).toBe(DEFAULT_TLD);
  });
});

describe("getRiskyTldReason", () => {
  it("matches exact risky TLDs", () => {
    expect(getRiskyTldReason("dev")).toMatch(/HSTS/);
    expect(getRiskyTldReason("app")).toMatch(/HSTS/);
    expect(getRiskyTldReason("com")).toMatch(/public TLD/);
  });

  it("matches multi-segment TLDs under tree-wide risky suffixes", () => {
    expect(getRiskyTldReason("example.dev")).toMatch(/HSTS/);
    expect(getRiskyTldReason("myapp.app")).toMatch(/HSTS/);
    expect(getRiskyTldReason("foo.local")).toMatch(/mDNS/);
  });

  it("does not suffix-match ownership-class TLDs", () => {
    expect(getRiskyTldReason("dev.example.com")).toBeUndefined();
    expect(getRiskyTldReason("internal.example.org")).toBeUndefined();
  });

  it("returns undefined for safe TLDs", () => {
    expect(getRiskyTldReason("test")).toBeUndefined();
    expect(getRiskyTldReason("dev.internal")).toBeUndefined();
    expect(getRiskyTldReason("devx")).toBeUndefined();
  });
});

describe("validateTld", () => {
  it("returns null for valid suffixes", () => {
    expect(validateTld("localhost")).toBeNull();
    expect(validateTld("test")).toBeNull();
    expect(validateTld("internal")).toBeNull();
    expect(validateTld("my-tld")).toBeNull();
    expect(validateTld("my.tld")).toBeNull();
    expect(validateTld("server01.acme.com")).toBeNull();
  });

  it("rejects empty string", () => {
    expect(validateTld("")).toMatch(/cannot be empty/);
  });

  it("rejects TLDs with invalid characters", () => {
    expect(validateTld("MY_TLD")).toMatch(/must contain only/);
    expect(validateTld("tld!")).toMatch(/must contain only/);
    expect(validateTld("my tld")).toMatch(/must contain only/);
  });

  it("accepts multi-segment TLDs", () => {
    expect(validateTld("dev.example.com")).toBeNull();
    expect(validateTld("local.example.dev")).toBeNull();
    expect(validateTld("a.b.c.d.e")).toBeNull();
  });

  it("accepts hyphens inside labels", () => {
    expect(validateTld("my-tld")).toBeNull();
    expect(validateTld("dev.my-network.com")).toBeNull();
  });

  it("rejects empty labels", () => {
    expect(validateTld(".example.com")).toMatch(/labels cannot be empty/);
    expect(validateTld("example.com.")).toMatch(/labels cannot be empty/);
    expect(validateTld("example..com")).toMatch(/labels cannot be empty/);
  });

  it("rejects hyphens at label edges", () => {
    expect(validateTld("-bad.example.com")).toMatch(/must contain only/);
    expect(validateTld("bad-.example.com")).toMatch(/must contain only/);
  });

  it("rejects labels over 63 characters", () => {
    expect(validateTld(`${"a".repeat(64)}.example.com`)).toMatch(/63-character/);
  });

  it("rejects TLDs over 253 characters", () => {
    const label = "a".repeat(63);
    const long = [label, label, label, label, "example"].join(".");
    expect(validateTld(long)).toMatch(/253-character/);
  });

  it("allows public TLDs (they produce warnings elsewhere)", () => {
    for (const tld of ["com", "org", "net", "io", "app"]) {
      expect(validateTld(tld)).toBeNull();
      expect(RISKY_TLDS.has(tld)).toBe(true);
    }
  });

  it("allows risky TLDs (they produce warnings elsewhere)", () => {
    for (const tld of ["local", "dev"]) {
      expect(validateTld(tld)).toBeNull();
      expect(RISKY_TLDS.has(tld)).toBe(true);
    }
  });
});

describe("readPersistedProxyState", () => {
  let tmpDir: string;
  let prevStateDir: string | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "portless-persist-test-"));
    prevStateDir = process.env.PORTLESS_STATE_DIR;
    process.env.PORTLESS_STATE_DIR = tmpDir;
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    if (prevStateDir === undefined) {
      delete process.env.PORTLESS_STATE_DIR;
    } else {
      process.env.PORTLESS_STATE_DIR = prevStateDir;
    }
  });

  it("returns null when no state files exist", () => {
    expect(readPersistedProxyState()).toBeNull();
  });

  it("reads port from persisted state", () => {
    fs.writeFileSync(path.join(tmpDir, "proxy.port"), "1355");
    const state = readPersistedProxyState();
    expect(state).not.toBeNull();
    expect(state!.port).toBe(1355);
  });

  it("reads TLS marker from persisted state", () => {
    fs.writeFileSync(path.join(tmpDir, "proxy.port"), "443");
    writeTlsMarker(tmpDir, true);
    const state = readPersistedProxyState();
    expect(state).not.toBeNull();
    expect(state!.tls).toBe(true);
  });

  it("reads TLD from persisted state", () => {
    fs.writeFileSync(path.join(tmpDir, "proxy.port"), "1355");
    writeTldFile(tmpDir, "test");
    const state = readPersistedProxyState();
    expect(state).not.toBeNull();
    expect(state!.tld).toBe("test");
  });

  it("reads all suffixes from persisted state", () => {
    fs.writeFileSync(path.join(tmpDir, "proxy.port"), "1355");
    writeTldsFile(tmpDir, ["test", "local"]);
    const state = readPersistedProxyState();
    expect(state).not.toBeNull();
    expect(state!.tlds).toEqual(["test", "local"]);
  });

  it("does not infer LAN mode from a local suffix without a LAN marker", () => {
    fs.writeFileSync(path.join(tmpDir, "proxy.port"), "1355");
    writeTldsFile(tmpDir, ["test", "local"]);
    const state = readPersistedProxyState();
    expect(state).not.toBeNull();
    expect(state!.lanMode).toBe(false);
  });

  it("reads LAN mode from persisted state", () => {
    fs.writeFileSync(path.join(tmpDir, "proxy.port"), "1355");
    writeLanMarker(tmpDir, "192.168.1.10");
    const state = readPersistedProxyState();
    expect(state).not.toBeNull();
    expect(state!.lanMode).toBe(true);
  });

  it("uses LAN marker existence when its current IP is unavailable", () => {
    fs.writeFileSync(path.join(tmpDir, "proxy.port"), "1355");
    fs.writeFileSync(path.join(tmpDir, "proxy.tld"), "local");
    fs.writeFileSync(path.join(tmpDir, "proxy.lan"), "");
    expect(hasLanMarker(tmpDir)).toBe(true);
    expect(readLanMarker(tmpDir)).toBeNull();
    expect(readPersistedProxyState()).toMatchObject({ lanMode: true });
  });

  it("returns full previous config for a custom proxy setup", () => {
    fs.writeFileSync(path.join(tmpDir, "proxy.port"), "1355");
    writeTlsMarker(tmpDir, true);
    writeTldFile(tmpDir, "local");
    writeLanMarker(tmpDir, "192.168.1.42");
    writeWildcardMarker(tmpDir, true);
    const state = readPersistedProxyState();
    expect(state).toEqual({
      port: 1355,
      tls: true,
      tld: "local",
      tlds: ["local"],
      lanMode: true,
      useWildcard: true,
      unprivileged: false,
    });
  });
});

describe("reportHostsSync", () => {
  const warnings: string[] = [];
  const onWarn = (m: string) => warnings.push(m);
  const acted = async (): Promise<"acted"> => "acted";
  const mute = async (): Promise<"mute"> => "mute";
  const absent = async (): Promise<"absent"> => "absent";
  const disabled = async (): Promise<"disabled"> => "disabled";
  const savedSyncHosts = process.env.PORTLESS_SYNC_HOSTS;

  beforeEach(() => {
    warnings.length = 0;
    delete process.env.PORTLESS_SYNC_HOSTS;
  });

  afterEach(() => {
    if (savedSyncHosts === undefined) delete process.env.PORTLESS_SYNC_HOSTS;
    else process.env.PORTLESS_SYNC_HOSTS = savedSyncHosts;
  });

  it("says nothing when the hostname already resolves", async () => {
    await reportHostsSync(["a.localhost"], 1, false, false, onWarn, acted, async () => true);
    expect(warnings).toEqual([]);
  });

  it("does not warn when the system resolver selects IPv6 loopback", async () => {
    await reportHostsSync(["::1"], 1, false, false, onWarn, acted);
    expect(warnings).toEqual([]);
  });

  it("warns when the system resolver selects non-loopback IPv6", async () => {
    await reportHostsSync(["2001:db8::1"], 1, false, false, onWarn, acted);
    expect(warnings).toEqual(["2001:db8::1 will not resolve. Run: portless hosts sync"]);
  });

  it("warns naming only the hostnames that do not resolve", async () => {
    await reportHostsSync(
      ["good.test", "bad.test"],
      1,
      false,
      false,
      onWarn,
      acted,
      async (hostname) => hostname === "good.test",
      50
    );
    expect(warnings).toEqual(["bad.test will not resolve. Run: portless hosts sync"]);
  });

  it("checks each unique hostname once", async () => {
    const checked: string[] = [];
    await reportHostsSync(
      ["good.test", "bad.test", "bad.test"],
      1,
      false,
      false,
      onWarn,
      acted,
      async (hostname) => {
        checked.push(hostname);
        return hostname === "good.test";
      }
    );
    expect(checked).toEqual(["good.test", "bad.test"]);
    expect(warnings).toEqual(["bad.test will not resolve. Run: portless hosts sync"]);
  });

  it("passes the proxy port and TLS mode to the trigger", async () => {
    const calls: Array<[number, boolean]> = [];
    await reportHostsSync(
      ["a.test"],
      1355,
      true,
      false,
      onWarn,
      async (port, tls) => {
        calls.push([port, tls]);
        return "acted";
      },
      async () => true
    );
    expect(calls).toEqual([[1355, true]]);
  });

  it("gives an older daemon its watcher window", async () => {
    let reads = 0;
    await reportHostsSync(
      ["a.test"],
      1,
      false,
      false,
      onWarn,
      mute,
      async () => true,
      2000,
      () => (++reads >= 3 ? ["a.test"] : [])
    );
    expect(reads).toBeGreaterThan(1);
    expect(warnings).toEqual([]);
  });

  it("checks the resolver only after the managed block is published", async () => {
    let reads = 0;
    await reportHostsSync(
      ["a.test"],
      1,
      false,
      false,
      onWarn,
      mute,
      async () => {
        expect(reads).toBeGreaterThan(1);
        return true;
      },
      500,
      () => (++reads >= 2 ? ["a.test"] : [])
    );
    expect(warnings).toEqual([]);
  });

  it("warns at the ceiling when an older daemon never syncs", async () => {
    const started = Date.now();
    await reportHostsSync(
      ["a.test"],
      1,
      false,
      false,
      onWarn,
      mute,
      async () => false,
      150,
      () => []
    );
    expect(Date.now() - started).toBeGreaterThanOrEqual(150);
    expect(warnings).toHaveLength(1);
  });

  it("does not wait when no producer exists", async () => {
    const started = Date.now();
    await reportHostsSync(["a.test"], 1, false, false, onWarn, absent, async () => false, 3000);
    expect(Date.now() - started).toBeLessThan(200);
    expect(warnings).toHaveLength(1);
  });

  it("does not wait when the daemon has hosts sync disabled", async () => {
    const started = Date.now();
    await reportHostsSync(["a.test"], 1, false, false, onWarn, disabled, async () => false, 3000);
    expect(Date.now() - started).toBeLessThan(200);
    expect(warnings).toHaveLength(1);
  });

  it("neither asks nor waits when PORTLESS_SYNC_HOSTS disables syncing here", async () => {
    process.env.PORTLESS_SYNC_HOSTS = "0";
    let triggered = false;
    let slept = false;
    await reportHostsSync(
      ["missing.test"],
      1,
      false,
      false,
      onWarn,
      async () => {
        triggered = true;
        return "mute";
      },
      async () => false,
      3500,
      () => [],
      async () => {
        slept = true;
      }
    );
    expect(triggered).toBe(false);
    expect(slept).toBe(false);
    expect(warnings).toEqual(["missing.test will not resolve. Run: portless hosts sync"]);
  });

  it("checks custom .local names outside LAN mode", async () => {
    let asked = 0;
    await reportHostsSync(["app.local"], 1, false, false, onWarn, acted, async () => {
      asked += 1;
      return false;
    });
    expect(asked).toBe(1);
    expect(warnings).toHaveLength(1);
  });

  it("skips .local names in active LAN mode", async () => {
    let triggered = false;
    await reportHostsSync(["app.local"], 1, false, true, onWarn, async () => {
      triggered = true;
      return "acted";
    });
    expect(triggered).toBe(false);
    expect(warnings).toEqual([]);
  });
});

describe("triggerHostsSync", () => {
  it("reports absent when nothing is listening", async () => {
    expect(await triggerHostsSync(19899)).toBe("absent");
  });
});

describe("syncHostsWithWarning", () => {
  it("warns once for repeated failed non-empty syncs", () => {
    let warnings = 0;
    const failedSync = () => false;

    let warned = syncHostsWithWarning(["a.localhost"], false, () => warnings++, failedSync);
    warned = syncHostsWithWarning(["a.localhost"], warned, () => warnings++, failedSync);

    expect(warnings).toBe(1);
    expect(warned).toBe(true);
  });

  it("re-arms after success and ignores an empty warm-up failure", () => {
    let warnings = 0;
    const stillUnwarned = syncHostsWithWarning(
      [],
      false,
      () => warnings++,
      () => false
    );
    expect(stillUnwarned).toBe(false);
    expect(warnings).toBe(0);

    const rearmed = syncHostsWithWarning(
      ["a.localhost"],
      true,
      () => warnings++,
      () => true
    );
    expect(rearmed).toBe(false);
    const latched = syncHostsWithWarning(
      ["a.localhost"],
      rearmed,
      () => warnings++,
      () => false
    );
    expect(latched).toBe(true);
    expect(warnings).toBe(1);
  });
});

describe("hasHelpFlag", () => {
  it("finds --help and -h anywhere in the arguments", () => {
    expect(hasHelpFlag(["--help"])).toBe(true);
    expect(hasHelpFlag(["myapp", "5432", "-h"])).toBe(true);
    expect(hasHelpFlag(["--remove", "myapp", "--help"])).toBe(true);
  });

  it("ignores everything else", () => {
    expect(hasHelpFlag([])).toBe(false);
    expect(hasHelpFlag(["myapp", "--json", "--helpful"])).toBe(false);
  });
});

describe("augmentedPath", () => {
  const nodeDir = path.dirname(process.execPath);
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "portless-augmented-path-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("keeps the caller's PATH ahead of the running node's directory", () => {
    const userBin = path.join(tmpDir, "version-manager", "bin");
    const entries = augmentedPath({ PATH: userBin }, tmpDir).split(path.delimiter);
    expect(entries.indexOf(userBin)).toBeGreaterThanOrEqual(0);
    expect(entries.indexOf(userBin)).toBeLessThan(entries.lastIndexOf(nodeDir));
  });

  it("keeps project node_modules/.bin first and node's directory as a fallback", () => {
    const localBin = path.join(tmpDir, "node_modules", ".bin");
    fs.mkdirSync(localBin, { recursive: true });
    const entries = augmentedPath({ PATH: "" }, tmpDir).split(path.delimiter);
    expect(entries[0]).toBe(localBin);
    expect(entries.at(-1)).toBe(nodeDir);
    expect(entries).not.toContain("");
  });

  it("appends node's directory last on every platform when PATH is set", () => {
    const entries = augmentedPath({ PATH: "/usr/bin" }, tmpDir).split(path.delimiter);
    expect(entries.at(-1)).toBe(nodeDir);
    expect(entries).toContain("/usr/bin");
  });

  it("reads the Windows-cased Path variable when PATH is unset", () => {
    const entries = augmentedPath({ Path: "/custom/bin" }, tmpDir).split(path.delimiter);
    expect(entries.indexOf("/custom/bin")).toBeLessThan(entries.lastIndexOf(nodeDir));
  });
});

describe("resolveWindowsExecutable", () => {
  let tmpDir: string;
  let prevPathext: string | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "portless-resolve-test-"));
    prevPathext = process.env.PATHEXT;
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    if (prevPathext === undefined) {
      delete process.env.PATHEXT;
    } else {
      process.env.PATHEXT = prevPathext;
    }
  });

  it("returns the absolute path of an existing absolute path input", () => {
    const file = path.join(tmpDir, "tool.exe");
    fs.writeFileSync(file, "");
    expect(resolveWindowsExecutable(file, "")).toBe(path.resolve(file));
  });

  it("returns null for an absolute path that does not exist", () => {
    const missing = path.join(tmpDir, "nope.exe");
    expect(resolveWindowsExecutable(missing, "")).toBeNull();
  });

  it("walks PATH and matches with PATHEXT extensions", () => {
    process.env.PATHEXT = ".COM;.EXE;.BAT;.CMD";
    const dirA = path.join(tmpDir, "a");
    const dirB = path.join(tmpDir, "b");
    fs.mkdirSync(dirA);
    fs.mkdirSync(dirB);
    const target = path.join(dirB, "tool.cmd");
    fs.writeFileSync(target, "");

    expect(resolveWindowsExecutable("tool", [dirA, dirB].join(path.delimiter))).toBe(target);
  });

  it("returns the first PATH match", () => {
    process.env.PATHEXT = ".COM;.EXE;.BAT;.CMD";
    const dirA = path.join(tmpDir, "a");
    const dirB = path.join(tmpDir, "b");
    fs.mkdirSync(dirA);
    fs.mkdirSync(dirB);
    const first = path.join(dirA, "tool.exe");
    fs.writeFileSync(first, "");
    fs.writeFileSync(path.join(dirB, "tool.exe"), "");

    expect(resolveWindowsExecutable("tool", [dirA, dirB].join(path.delimiter))).toBe(first);
  });

  it("respects PATHEXT priority within one directory", () => {
    process.env.PATHEXT = ".COM;.EXE;.BAT;.CMD";
    const dir = path.join(tmpDir, "bin");
    fs.mkdirSync(dir);
    const exe = path.join(dir, "tool.exe");
    fs.writeFileSync(exe, "");
    fs.writeFileSync(path.join(dir, "tool.cmd"), "");

    expect(resolveWindowsExecutable("tool", dir)).toBe(exe);
  });

  it("falls back to default PATHEXT when PATHEXT is unset", () => {
    delete process.env.PATHEXT;
    const dir = path.join(tmpDir, "bin");
    fs.mkdirSync(dir);
    const target = path.join(dir, "tool.bat");
    fs.writeFileSync(target, "");

    expect(resolveWindowsExecutable("tool", dir)).toBe(target);
  });

  it("returns literal names before extension-appended candidates", () => {
    process.env.PATHEXT = ".COM;.EXE;.BAT;.CMD";
    const dir = path.join(tmpDir, "bin");
    fs.mkdirSync(dir);
    const literal = path.join(dir, "mytool");
    fs.writeFileSync(literal, "");
    fs.writeFileSync(path.join(dir, "mytool.exe"), "");

    expect(resolveWindowsExecutable("mytool", dir)).toBe(literal);
  });

  it("returns null when no PATH entry contains the command", () => {
    process.env.PATHEXT = ".COM;.EXE;.BAT;.CMD";
    const dir = path.join(tmpDir, "bin");
    fs.mkdirSync(dir);

    expect(resolveWindowsExecutable("missing", dir)).toBeNull();
  });

  it("treats slash-containing input as path-like", () => {
    expect(resolveWindowsExecutable("./bin/missing", "")).toBeNull();
    expect(resolveWindowsExecutable(".\\bin\\missing", "")).toBeNull();
  });
});

describe("resolveWindowsCommandInvocation", () => {
  let tmpDir: string;
  let prevPathext: string | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "portless-resolve-invocation-test-"));
    prevPathext = process.env.PATHEXT;
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    if (prevPathext === undefined) {
      delete process.env.PATHEXT;
    } else {
      process.env.PATHEXT = prevPathext;
    }
  });

  it("wraps cmd shims through cmd.exe with /s-safe quoting", () => {
    process.env.PATHEXT = ".COM;.EXE;.BAT;.CMD";
    const binDir = path.join(tmpDir, "bin dir");
    fs.mkdirSync(binDir);
    const shim = path.join(binDir, "cloudflared.cmd");
    fs.writeFileSync(shim, "");

    expect(resolveWindowsCommandInvocation("cloudflared", ["version"], binDir)).toEqual({
      command: "cmd.exe",
      args: ["/d", "/v:off", "/s", "/c", `""${shim}" version"`],
      windowsVerbatimArguments: true,
    });
  });

  it("returns a direct executable invocation for exe files", () => {
    process.env.PATHEXT = ".COM;.EXE;.BAT;.CMD";
    const exe = path.join(tmpDir, "cloudflared.exe");
    fs.writeFileSync(exe, "");

    expect(resolveWindowsCommandInvocation("cloudflared", ["version"], tmpDir)).toEqual({
      command: exe,
      args: ["version"],
    });
  });

  it("returns null when the command cannot be resolved", () => {
    expect(resolveWindowsCommandInvocation("cloudflared", ["version"], tmpDir)).toBeNull();
  });
});

describe("ownedProcessIds", () => {
  const started = 1_000;

  it("collects the root and its descendants in creation order", () => {
    const rows = [
      [10, 1, 900],
      [11, 10, 950],
      [12, 11, 1_200],
      [20, 1, 960],
    ] as const;
    expect(ownedProcessIds(rows, 10, started).sort()).toEqual([10, 11, 12]);
  });

  it("leaves a reused root pid and anything it spawned alone", () => {
    const rows = [
      [10, 1, 1_500],
      [11, 10, 950],
      [12, 10, 1_600],
    ] as const;
    expect(ownedProcessIds(rows, 10, started)).toEqual([11]);
  });

  it("still finds orphaned children once the root exited", () => {
    const rows = [
      [11, 10, 950],
      [12, 11, 1_100],
    ] as const;
    expect(ownedProcessIds(rows, 10, started).sort()).toEqual([11, 12]);
  });

  it("does not follow a descendant pid that was reused by an unrelated process", () => {
    // pid 11 belonged to our child, exited, and was reused later by a process
    // that is not ours. Its former child (12) points at it but predates it.
    const rows = [
      [10, 1, 900],
      [11, 1, 1_700],
      [12, 11, 1_200],
      [13, 11, 1_800],
    ] as const;
    expect(ownedProcessIds(rows, 10, started)).toEqual([10]);
  });

  it("does not adopt a process that predates its claimed parent", () => {
    const rows = [
      [10, 1, 900],
      [11, 10, 1_100],
      [12, 11, 1_050],
    ] as const;
    expect(ownedProcessIds(rows, 10, started).sort()).toEqual([10, 11]);
  });

  it("works when evaluated standalone, as the watcher script embeds it", () => {
    const standalone = new Function(
      `return (${ownedProcessIds.toString()});`
    )() as typeof ownedProcessIds;
    const rows = [
      [10, 1, 900],
      [11, 10, 950],
    ] as const;
    expect(standalone(rows, 10, started).sort()).toEqual([10, 11]);
  });
});

describe.skipIf(process.platform === "win32")("killOrphanedProcessGroup", () => {
  let orphanPid: number | undefined;

  // A detached grandchild leads its own group and outlives its parent, like
  // an orphaned dev server.
  function spawnUnrelatedOrphan(): number {
    const script = `
      const { spawn } = require("node:child_process");
      const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
        detached: true,
        stdio: "ignore",
      });
      child.unref();
      process.stdout.write(String(child.pid));
    `;
    return Number(execFileSync(process.execPath, ["-e", script], { encoding: "utf-8" }));
  }

  function isAlive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  afterEach(() => {
    if (orphanPid && isAlive(orphanPid)) process.kill(orphanPid, "SIGKILL");
    orphanPid = undefined;
  });

  it("does not signal a group leader whose start time was not recorded or differs", () => {
    orphanPid = spawnUnrelatedOrphan();

    expect(killOrphanedProcessGroup(orphanPid, undefined)).toBe(false);
    expect(killOrphanedProcessGroup(orphanPid, "Thu Jan  1 00:00:00 1970")).toBe(false);
    expect(isAlive(orphanPid)).toBe(true);
  });

  it("signals the group when the leader start time matches the recorded one", async () => {
    orphanPid = spawnUnrelatedOrphan();
    const startTime = getProcessStartTime(orphanPid);
    expect(startTime).toBeTruthy();

    expect(killOrphanedProcessGroup(orphanPid, startTime!, "SIGKILL")).toBe(true);
    for (let i = 0; i < 50 && isAlive(orphanPid); i++) {
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(isAlive(orphanPid)).toBe(false);
  });
});

describe("caRegeneratedRestartHint", () => {
  afterEach(() => {
    delete process.env.PORTLESS_PORT;
  });

  it("omits the port flag on the protocol default port", () => {
    delete process.env.PORTLESS_PORT;
    expect(caRegeneratedRestartHint(443, true)).toEqual([
      "The running proxy still serves certificates from the previous CA.",
      "Restart it: portless proxy stop && portless proxy start",
    ]);
  });

  it("repeats a non-default port on both commands", () => {
    delete process.env.PORTLESS_PORT;
    expect(caRegeneratedRestartHint(1355, false)[1]).toBe(
      "Restart it: portless proxy stop -p 1355 && portless proxy start -p 1355"
    );
  });
});

describe("getProxyStatus", () => {
  let tmpDir: string;
  let server: http.Server | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "portless-status-test-"));
    vi.stubEnv("PORTLESS_STATE_DIR", tmpDir);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = undefined;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  /** Listen like a portless proxy: answer every request with the X-Portless header. */
  async function listenAsProxy(): Promise<number> {
    server = http.createServer((_req, res) => {
      res.setHeader("X-Portless", "1");
      res.end();
    });
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    return (server.address() as net.AddressInfo).port;
  }

  it("reports a stopped proxy with null settings and the state directory", async () => {
    fs.writeFileSync(path.join(tmpDir, "proxy.port"), "1355");
    writeTlsMarker(tmpDir, true);
    writeWildcardMarker(tmpDir, true);

    await expect(getProxyStatus()).resolves.toEqual({
      running: false,
      pid: null,
      port: null,
      tls: null,
      tlds: null,
      lan: null,
      unprivileged: null,
      stateDir: tmpDir,
      wildcard: null,
      lanIp: null,
    });
  });

  it("does not take another service on the proxy port for a proxy", async () => {
    const other = http.createServer((_req, res) => res.end());
    await new Promise<void>((resolve) => other.listen(0, "127.0.0.1", resolve));
    try {
      fs.writeFileSync(
        path.join(tmpDir, "proxy.port"),
        String((other.address() as net.AddressInfo).port)
      );
      await expect(getProxyStatus()).resolves.toMatchObject({ running: false, port: null });
    } finally {
      await new Promise<void>((resolve) => other.close(() => resolve()));
    }
  });

  it("reports the running proxy's pid, port, and settings", async () => {
    const port = await listenAsProxy();
    fs.writeFileSync(path.join(tmpDir, "proxy.port"), String(port));
    fs.writeFileSync(path.join(tmpDir, "proxy.pid"), String(process.pid));
    writeTlsMarker(tmpDir, true);
    writeTldsFile(tmpDir, ["localhost", "test"]);
    writeUnprivilegedMarker(tmpDir, true);
    writeWildcardMarker(tmpDir, true);

    await expect(getProxyStatus()).resolves.toEqual({
      running: true,
      pid: process.pid,
      port,
      tls: true,
      tlds: ["localhost", "test"],
      lan: false,
      unprivileged: true,
      stateDir: tmpDir,
      wildcard: true,
      lanIp: null,
    });
  });

  it("reports LAN mode and the LAN IP from the LAN marker", async () => {
    const port = await listenAsProxy();
    fs.writeFileSync(path.join(tmpDir, "proxy.port"), String(port));
    writeTldFile(tmpDir, "local");
    writeLanMarker(tmpDir, "192.168.1.42");

    await expect(getProxyStatus()).resolves.toMatchObject({
      running: true,
      lan: true,
      lanIp: "192.168.1.42",
      tlds: ["local"],
      unprivileged: false,
      wildcard: false,
    });
  });

  it("reports LAN mode without an IP when the marker is empty", async () => {
    const port = await listenAsProxy();
    fs.writeFileSync(path.join(tmpDir, "proxy.port"), String(port));
    fs.writeFileSync(path.join(tmpDir, "proxy.lan"), "");

    await expect(getProxyStatus()).resolves.toMatchObject({
      running: true,
      lan: true,
      lanIp: null,
    });
  });

  it.each([
    ["missing", undefined],
    ["unreadable", "not a pid"],
    ["stale", "999999"],
  ])("reports no pid when the pid file is %s", async (_name, content) => {
    const port = await listenAsProxy();
    fs.writeFileSync(path.join(tmpDir, "proxy.port"), String(port));
    if (content !== undefined) fs.writeFileSync(path.join(tmpDir, "proxy.pid"), content);

    await expect(getProxyStatus()).resolves.toMatchObject({ running: true, pid: null });
  });

  it("writes nothing to the state directory", async () => {
    const port = await listenAsProxy();
    fs.writeFileSync(path.join(tmpDir, "proxy.port"), String(port));
    const before = fs.readdirSync(tmpDir).sort();

    await getProxyStatus();

    expect(fs.readdirSync(tmpDir).sort()).toEqual(before);
  });
});

describe("readPidFromDir", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "portless-pid-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("reads the pid file", () => {
    fs.writeFileSync(path.join(tmpDir, "proxy.pid"), "1841\n");
    expect(readPidFromDir(tmpDir)).toBe(1841);
  });

  it.each([undefined, "", "abc", "0", "-5"])("is null for %j", (content) => {
    if (content !== undefined) fs.writeFileSync(path.join(tmpDir, "proxy.pid"), content);
    expect(readPidFromDir(tmpDir)).toBeNull();
  });
});
