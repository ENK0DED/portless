import { afterEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as https from "node:https";
import * as os from "node:os";
import * as path from "node:path";
import { ensureCerts } from "./certs.js";
import {
  collectDoctorSnapshot,
  evaluateDoctor,
  modeAllowsIdentityAccess,
  probeDoctorTool,
  requestCertPage,
  resolveDoctorCommandInvocation,
  type DoctorSnapshot,
  type DoctorToolStatus,
} from "./doctor.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "portless-doctor-"));
  tempDirs.push(dir);
  return dir;
}

function tool(status: DoctorToolStatus["status"]): DoctorToolStatus {
  return { status };
}

function healthySnapshot(): DoctorSnapshot {
  return {
    version: "0.15.6000",
    nodeVersion: "24.7.0",
    platform: "linux",
    arch: "x64",
    state: {
      path: "/home/dev/.portless",
      source: "default",
      status: "writable",
    },
    proxy: {
      port: 443,
      tls: true,
      running: true,
      portListening: true,
      pid: 42,
      pidAlive: true,
      portPid: 42,
      lanMode: false,
      lanIp: null,
      configuredBindTargets: ["127.0.0.1", "::1"],
    },
    suffixes: {
      configured: ["localhost", "server01.acme.com"],
      invalidPersisted: [],
    },
    certificates: {
      custom: false,
      internalPages: true,
      ca: true,
      caKey: true,
      serverCert: true,
      serverKey: true,
      trusted: true,
      certPages: {
        localhost: true,
        "server01.acme.com": true,
      },
    },
    routes: [
      {
        hostname: "app.localhost",
        port: 4173,
        pid: 51,
        pidAlive: true,
        portListening: true,
        resolves: true,
        managedHost: true,
      },
      {
        hostname: "app.server01.acme.com",
        port: 4173,
        pid: 51,
        pidAlive: true,
        portListening: true,
        resolves: true,
        managedHost: true,
      },
    ],
    background: [
      {
        label: "web",
        pid: 51,
        pidAlive: true,
        state: "ready",
        routePresent: true,
        sharing: [],
      },
    ],
    mdns: { available: false, reason: "avahi-publish-address not found" },
    tools: {
      openssl: tool("ready"),
      cloudflared: tool("unavailable"),
      ngrok: tool("unavailable"),
      tailscale: tool("unavailable"),
      netbird: tool("unavailable"),
    },
    warnings: [],
  };
}

describe("evaluateDoctor", () => {
  it("recognizes healthy ordered suffixes, dotted certificate pages, loopback bind, hosts, and background state", () => {
    const report = evaluateDoctor(healthySnapshot());

    expect(report.exitCode).toBe(0);
    expect(report.findings.filter((finding) => finding.status === "fail")).toEqual([]);
    expect(report.findings.filter((finding) => finding.status === "warn")).toEqual([]);
    expect(report.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: "Configured suffixes: .localhost, .server01.acme.com.",
        }),
        expect.objectContaining({
          message: "Configured local mode binds only to 127.0.0.1 and ::1.",
        }),
        expect.objectContaining({
          message: "Certificate pages are available at cert.localhost and cert.server01.acme.com.",
        }),
        expect.objectContaining({ message: "Hosts sync covers 2 registered hostnames." }),
        expect.objectContaining({ message: "Background apps: 1 healthy entry." }),
      ])
    );
  });

  it("reports LAN widening, an incomplete LAN suffix list, and missing mDNS tooling", () => {
    const snapshot = healthySnapshot();
    snapshot.proxy.lanMode = true;
    snapshot.proxy.lanIp = "192.168.1.20";
    snapshot.proxy.configuredBindTargets = ["0.0.0.0", "::"];
    snapshot.suffixes.configured = ["server01.acme.com"];
    snapshot.routes = [];
    snapshot.background = [];

    const report = evaluateDoctor(snapshot);

    expect(report.exitCode).toBe(1);
    expect(report.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: "ok",
          message: "Configured LAN mode widens the proxy bind to 0.0.0.0 and ::.",
        }),
        expect.objectContaining({
          status: "warn",
          message: "LAN mode is active, but the persisted suffix list does not include .local.",
        }),
        expect.objectContaining({
          status: "fail",
          message: expect.stringContaining("mDNS tooling is unavailable"),
        }),
      ])
    );
  });

  it("checks hosts sync for non-local suffixes in mixed LAN mode", () => {
    const snapshot = healthySnapshot();
    snapshot.proxy.lanMode = true;
    snapshot.proxy.lanIp = "192.168.1.20";
    snapshot.proxy.configuredBindTargets = ["0.0.0.0", "::"];
    snapshot.suffixes.configured = ["acme.com", "local"];
    snapshot.mdns.available = true;
    snapshot.routes = [
      {
        hostname: "app.local",
        port: 4173,
        pid: 51,
        pidAlive: true,
        portListening: true,
        resolves: true,
        managedHost: false,
      },
      {
        hostname: "app.acme.com",
        port: 4173,
        pid: 51,
        pidAlive: true,
        portListening: true,
        resolves: false,
        managedHost: false,
      },
    ];

    const report = evaluateDoctor(snapshot);

    expect(report.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: "warn",
          message: "app.acme.com does not resolve and is missing from the managed hosts block.",
        }),
        expect.objectContaining({
          status: "warn",
          message: "Hosts sync covers 0 of 1 registered hostnames.",
        }),
      ])
    );
    expect(
      report.findings.some((finding) => finding.message.includes("app.local does not resolve"))
    ).toBe(false);
  });

  it("reports state handoff, stale routes, certificate gaps, and hosts drift without repairing them", () => {
    const snapshot = healthySnapshot();
    snapshot.state = {
      path: "/home/alice/.portless",
      source: "sudo-user",
      status: "unwritable",
      sudoUser: "alice",
      expectedPath: "/home/alice/.portless",
      handoffValid: true,
    };
    snapshot.certificates.caKey = false;
    snapshot.certificates.certPages["server01.acme.com"] = false;
    snapshot.routes[0] = {
      ...snapshot.routes[0]!,
      pidAlive: false,
      portListening: false,
      resolves: false,
      managedHost: false,
    };
    snapshot.background[0] = {
      ...snapshot.background[0]!,
      pidAlive: false,
      state: "ready",
      routePresent: false,
    };

    const report = evaluateDoctor(snapshot);

    expect(report.exitCode).toBe(1);
    expect(report.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: "Sudo state handoff resolves alice to /home/alice/.portless.",
        }),
        expect.objectContaining({
          status: "fail",
          message: "State directory is not writable: /home/alice/.portless.",
        }),
        expect.objectContaining({
          status: "warn",
          message: "Generated CA certificate exists without its private key.",
        }),
        expect.objectContaining({
          status: "warn",
          message: "Certificate page is not responding: cert.server01.acme.com.",
        }),
        expect.objectContaining({
          status: "warn",
          message: expect.stringContaining("stale route"),
        }),
        expect.objectContaining({
          status: "warn",
          message: "app.localhost does not resolve and is missing from the managed hosts block.",
        }),
        expect.objectContaining({
          status: "warn",
          message: "Background app web records PID 51, but that process is not running.",
        }),
      ])
    );
  });

  it("requires provider and mesh binaries only when persisted state uses them", () => {
    const unused = evaluateDoctor(healthySnapshot());
    expect(
      unused.findings.some(
        (finding) => finding.status === "warn" && finding.message.includes("cloudflared")
      )
    ).toBe(false);
    expect(unused.findings).toContainEqual({
      status: "info",
      message: "cloudflared is not installed; no persisted feature requires it.",
    });

    const snapshot = healthySnapshot();
    snapshot.routes[0] = {
      ...snapshot.routes[0]!,
      tunnelProvider: "cloudflare",
      tailscale: true,
      netbird: true,
    };
    snapshot.background[0]!.sharing = ["ngrok"];

    const report = evaluateDoctor(snapshot);

    expect(report.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ status: "warn", message: "cloudflared is not available." }),
        expect.objectContaining({ status: "warn", message: "ngrok is not available." }),
        expect.objectContaining({ status: "warn", message: "Tailscale is not available." }),
        expect.objectContaining({ status: "warn", message: "NetBird is not available." }),
      ])
    );
  });

  it("reports invalid persisted suffixes and hostnames outside the configured suffix list", () => {
    const snapshot = healthySnapshot();
    snapshot.suffixes.invalidPersisted = ["bad..suffix"];
    snapshot.routes[0] = { ...snapshot.routes[0]!, hostname: "app.other.test" };

    const report = evaluateDoctor(snapshot);

    expect(report.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: "warn",
          message: 'Ignored invalid persisted suffix "bad..suffix".',
        }),
        expect.objectContaining({
          status: "warn",
          message: "Route app.other.test does not match any configured suffix.",
        }),
      ])
    );
  });

  it("reports corrupt persisted suffix-list state", () => {
    const snapshot = healthySnapshot();
    snapshot.suffixes.persistedError = "proxy.tlds contains malformed JSON.";

    const report = evaluateDoctor(snapshot);

    expect(report.findings).toContainEqual({
      status: "warn",
      message: "proxy.tlds contains malformed JSON.",
    });
  });

  it("does not claim an invalid sudo state handoff succeeded", () => {
    const snapshot = healthySnapshot();
    snapshot.state = {
      path: "/root/.portless",
      source: "sudo-user",
      status: "writable",
      sudoUser: "alice",
      expectedPath: "/home/alice/.portless",
      handoffValid: false,
    };

    const report = evaluateDoctor(snapshot);

    expect(report.exitCode).toBe(1);
    expect(report.findings).toContainEqual({
      status: "fail",
      message: "Sudo state handoff resolved to /root/.portless instead of /home/alice/.portless.",
    });
  });

  it("probes certificate pages with custom TLS and respects intentionally disabled pages", () => {
    const custom = healthySnapshot();
    custom.certificates.custom = true;

    expect(evaluateDoctor(custom).findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: "ok",
          message: "Certificate pages are available at cert.localhost and cert.server01.acme.com.",
        }),
      ])
    );

    const disabled = healthySnapshot();
    disabled.certificates.internalPages = false;
    disabled.certificates.certPages = { localhost: false, "server01.acme.com": false };
    const disabledReport = evaluateDoctor(disabled);
    expect(disabledReport.findings).toContainEqual({
      status: "info",
      message: "Internal dashboard and certificate pages are intentionally disabled.",
    });
    expect(
      disabledReport.findings.some((finding) =>
        finding.message.includes("Certificate page is not responding")
      )
    ).toBe(false);
  });
});

describe("doctor probes", () => {
  it("checks sudo state permissions as the invoking identity", () => {
    expect(modeAllowsIdentityAccess({ uid: 0, gid: 0, mode: 0o700 }, 1000, 1000, 0b111)).toBe(
      false
    );
    expect(modeAllowsIdentityAccess({ uid: 1000, gid: 1000, mode: 0o700 }, 1000, 1000, 0b111)).toBe(
      true
    );
    expect(modeAllowsIdentityAccess({ uid: 0, gid: 20, mode: 0o770 }, 1000, 20, 0b111)).toBe(true);
  });

  it("uses a Windows command shim invocation", () => {
    const binDir = makeTempDir();
    fs.writeFileSync(path.join(binDir, "ngrok.cmd"), "@echo off\n");

    expect(resolveDoctorCommandInvocation("ngrok", ["version"], "win32", binDir)).toEqual({
      command: "cmd.exe",
      args: ["/d", "/v:off", "/s", "/c", `"${path.join(binDir, "ngrok.cmd")} version"`],
      windowsVerbatimArguments: true,
    });
  });

  it("rejects disconnected or malformed mesh status despite successful commands", () => {
    const tailscale = probeDoctorTool("tailscale", true, {
      runner: (_command, args) => ({
        status: 0,
        stdout: args[0] === "status" ? "{}" : "1.80.0",
        stderr: "",
      }),
    });
    const netbird = probeDoctorTool("netbird", true, {
      runner: () => ({
        status: 0,
        stdout: JSON.stringify({ daemonStatus: "NeedsLogin" }),
        stderr: "",
      }),
    });

    expect(tailscale).toMatchObject({ status: "error" });
    expect(netbird).toMatchObject({
      status: "error",
      detail: expect.stringContaining("NeedsLogin"),
    });
  });

  it("probes a live HTTPS certificate page without SNI or state mutation", async () => {
    const stateDir = makeTempDir();
    const certs = ensureCerts(stateDir);
    let serverName: string | false | null = false;
    const server = https.createServer(
      {
        key: fs.readFileSync(certs.keyPath),
        cert: fs.readFileSync(certs.certPath),
      },
      (request, response) => {
        expect(request.headers.host).toBe("cert.server01.acme.com");
        response.writeHead(200).end("certificate page");
      }
    );
    server.on("secureConnection", (socket) => {
      serverName = socket.servername;
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected a TCP server address.");
    const before = new Map(
      fs.readdirSync(stateDir).map((name) => [name, fs.readFileSync(path.join(stateDir, name))])
    );

    try {
      await expect(requestCertPage(address.port, true, "server01.acme.com")).resolves.toBe(true);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
    }

    const after = new Map(
      fs.readdirSync(stateDir).map((name) => [name, fs.readFileSync(path.join(stateDir, name))])
    );
    expect(serverName).toBe(false);
    expect(after).toEqual(before);
  });
});

describe("collectDoctorSnapshot", () => {
  it("uses the HTTPS port default when no persisted proxy state exists", async () => {
    const stateDir = makeTempDir();
    const previousHttps = process.env.PORTLESS_HTTPS;
    delete process.env.PORTLESS_HTTPS;
    try {
      const snapshot = await collectDoctorSnapshot({
        version: "0.15.6000",
        state: {
          dir: stateDir,
          port: 1355,
          tls: false,
          tld: "localhost",
          tlds: ["localhost"],
          lanMode: false,
          lanIp: null,
        },
        dependencies: {
          isProxyRunning: async () => false,
          isPortListening: async () => false,
          managedHostnames: () => [],
          mdnsSupport: () => ({ supported: false }),
          probeTool: () => ({ status: "unavailable" }),
        },
      });

      expect(snapshot.proxy).toMatchObject({ port: 443, tls: true, running: false });
    } finally {
      if (previousHttps === undefined) delete process.env.PORTLESS_HTTPS;
      else process.env.PORTLESS_HTTPS = previousHttps;
    }
  });

  it("reads multi-suffix, certificate, route, hosts, and background state without changing files", async () => {
    const stateDir = makeTempDir();
    fs.writeFileSync(path.join(stateDir, "proxy.port"), "443\n");
    fs.writeFileSync(path.join(stateDir, "proxy.tls"), "1\n");
    fs.writeFileSync(
      path.join(stateDir, "proxy.tlds"),
      JSON.stringify(["localhost", "server01.acme.com", "bad..suffix"])
    );
    fs.writeFileSync(path.join(stateDir, "proxy.tld"), "localhost\n");
    fs.writeFileSync(path.join(stateDir, "proxy.pid"), "4242\n");
    fs.writeFileSync(path.join(stateDir, "proxy.internal-pages-disabled"), "1\n");
    fs.writeFileSync(path.join(stateDir, "ca.pem"), "public ca\n");
    fs.writeFileSync(path.join(stateDir, "ca-key.pem"), "private ca\n");
    fs.writeFileSync(path.join(stateDir, "server.pem"), "server cert\n");
    fs.writeFileSync(path.join(stateDir, "server-key.pem"), "server key\n");
    fs.writeFileSync(
      path.join(stateDir, "routes.json"),
      JSON.stringify([
        {
          hostname: "app.server01.acme.com",
          port: 4173,
          pid: 5151,
          tunnelProvider: "cloudflare",
          ngrokUrl: "https://abc123.ngrok.app",
          tailscaleUrl: "https://dev.example.ts.net",
          netbirdUrl: "https://app.netbird.cloud",
        },
      ])
    );
    fs.mkdirSync(path.join(stateDir, "bg"));
    fs.writeFileSync(
      path.join(stateDir, "bg", "registry.json"),
      JSON.stringify([
        {
          version: 1,
          id: "web-1",
          label: "web",
          pid: 5151,
          cwd: stateDir,
          startedAt: "2026-08-14T00:00:00.000Z",
          readyAt: "2026-08-14T00:00:01.000Z",
          route: { hostname: "app.server01.acme.com", pathPrefix: "/" },
          state: "ready",
          intent: {
            cwd: stateDir,
            commandArgs: ["bun", "run", "dev"],
            explicitCommand: true,
            force: false,
            pathPrefix: "/",
            tunnel: { provider: "cloudflare" },
            sharing: {
              tailscale: true,
              tailscaleService: false,
              funnel: false,
              ngrok: false,
              netbird: true,
            },
          },
        },
      ])
    );

    const before = new Map(
      fs
        .readdirSync(stateDir, { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => {
          const filePath = path.join(entry.parentPath, entry.name);
          return [path.relative(stateDir, filePath), fs.readFileSync(filePath, "utf-8")];
        })
    );

    const snapshot = await collectDoctorSnapshot({
      version: "0.15.6000",
      state: {
        dir: stateDir,
        port: 443,
        tls: true,
        tld: "localhost",
        tlds: ["localhost", "server01.acme.com"],
        lanMode: false,
        lanIp: null,
      },
      dependencies: {
        isProxyRunning: async () => true,
        isPortListening: async (port) => port === 443 || port === 4173,
        findPidOnPort: () => 4242,
        isProcessAlive: (pid) => pid === 4242 || pid === 5151,
        managedHostnames: () => ["app.server01.acme.com"],
        resolvesHostname: async () => true,
        isCATrusted: () => true,
        certPageResponds: async (_port, _tls, suffix) => suffix === "localhost",
        mdnsSupport: () => ({ supported: false, reason: "not needed" }),
        probeTool: (name) => ({
          status: name === "cloudflared" ? "available" : "unavailable",
        }),
      },
    });

    const after = new Map(
      fs
        .readdirSync(stateDir, { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => {
          const filePath = path.join(entry.parentPath, entry.name);
          return [path.relative(stateDir, filePath), fs.readFileSync(filePath, "utf-8")];
        })
    );

    expect(after).toEqual(before);
    expect(snapshot.suffixes).toEqual({
      configured: ["localhost", "server01.acme.com"],
      invalidPersisted: ["bad..suffix"],
    });
    expect(snapshot.certificates.certPages).toEqual({
      localhost: false,
      "server01.acme.com": false,
    });
    expect(snapshot.certificates.internalPages).toBe(false);
    expect(snapshot.routes[0]).toEqual(
      expect.objectContaining({
        hostname: "app.server01.acme.com",
        tunnelProvider: "cloudflare",
        tailscale: true,
        netbird: true,
        managedHost: true,
      })
    );
    expect(snapshot.background[0]).toEqual(
      expect.objectContaining({
        label: "web",
        pidAlive: true,
        routePresent: true,
        sharing: ["cloudflare", "tailscale", "netbird"],
      })
    );
  });

  it("recognizes direct ngrok metadata and malformed suffix JSON", async () => {
    const stateDir = makeTempDir();
    fs.writeFileSync(path.join(stateDir, "proxy.tlds"), "[not-json");
    fs.writeFileSync(
      path.join(stateDir, "routes.json"),
      JSON.stringify([{ hostname: "app.localhost", port: 4173, pid: 0, ngrokPid: 99 }])
    );

    const snapshot = await collectDoctorSnapshot({
      version: "0.15.6000",
      state: {
        dir: stateDir,
        port: 443,
        tls: true,
        tld: "localhost",
        tlds: ["localhost"],
        lanMode: false,
        lanIp: null,
      },
      dependencies: {
        isProxyRunning: async () => false,
        isPortListening: async () => false,
        managedHostnames: () => [],
        mdnsSupport: () => ({ supported: false }),
        probeTool: (_name, required) => ({ status: required ? "ready" : "unavailable" }),
      },
    });

    expect(snapshot.routes[0]?.tunnelProvider).toBe("ngrok");
    expect(snapshot.tools.ngrok.status).toBe("ready");
    expect(snapshot.suffixes.persistedError).toBe("proxy.tlds contains malformed JSON.");
  });

  it("probes enabled certificate pages when the proxy uses custom TLS", async () => {
    const stateDir = makeTempDir();
    fs.writeFileSync(path.join(stateDir, "proxy.port"), "443\n");
    fs.writeFileSync(path.join(stateDir, "proxy.custom-cert"), "1\n");
    const probed: string[] = [];

    const snapshot = await collectDoctorSnapshot({
      version: "0.15.6000",
      state: {
        dir: stateDir,
        port: 443,
        tls: true,
        tld: "localhost",
        tlds: ["localhost", "server01.acme.com"],
        lanMode: false,
        lanIp: null,
      },
      dependencies: {
        isProxyRunning: async () => true,
        isPortListening: async () => true,
        managedHostnames: () => [],
        certPageResponds: async (_port, _tls, suffix) => {
          probed.push(suffix);
          return true;
        },
        mdnsSupport: () => ({ supported: false }),
        probeTool: () => ({ status: "unavailable" }),
      },
    });

    expect(snapshot.certificates).toMatchObject({
      custom: true,
      internalPages: true,
      certPages: { localhost: true, "server01.acme.com": true },
    });
    expect(probed).toEqual(["localhost", "server01.acme.com"]);
  });

  it("checks resolver state only for non-local routes in mixed LAN mode", async () => {
    const stateDir = makeTempDir();
    fs.writeFileSync(
      path.join(stateDir, "routes.json"),
      JSON.stringify([
        { hostname: "app.local", port: 4173, pid: 0 },
        { hostname: "app.acme.com", port: 4173, pid: 0 },
      ])
    );
    const resolved: string[] = [];

    const snapshot = await collectDoctorSnapshot({
      version: "0.15.6000",
      state: {
        dir: stateDir,
        port: 443,
        tls: true,
        tld: "acme.com",
        tlds: ["acme.com", "local"],
        lanMode: true,
        lanIp: "192.168.1.20",
      },
      dependencies: {
        isProxyRunning: async () => false,
        isPortListening: async () => false,
        managedHostnames: () => [],
        resolvesHostname: async (hostname) => {
          resolved.push(hostname);
          return false;
        },
        mdnsSupport: () => ({ supported: true }),
        probeTool: () => ({ status: "unavailable" }),
      },
    });

    expect(resolved).toEqual(["app.acme.com"]);
    expect(snapshot.routes.map((route) => [route.hostname, route.resolves])).toEqual([
      ["app.local", true],
      ["app.acme.com", false],
    ]);
  });

  it("distinguishes inbound and outbound sudo state handoff", async () => {
    const previous = {
      sudoUser: process.env.SUDO_USER,
      home: process.env.HOME,
      stateDir: process.env.PORTLESS_STATE_DIR,
    };
    const dependencies = {
      isProxyRunning: async () => false,
      isPortListening: async () => false,
      managedHostnames: () => [],
      mdnsSupport: () => ({ supported: false }),
      probeTool: () => ({ status: "unavailable" as const }),
    };
    try {
      process.env.SUDO_USER = "alice";
      process.env.HOME = "/root";
      delete process.env.PORTLESS_STATE_DIR;
      const inbound = await collectDoctorSnapshot({
        version: "0.15.6000",
        state: {
          dir: "/home/alice/.portless",
          port: 443,
          tls: true,
          tld: "localhost",
          tlds: ["localhost"],
          lanMode: false,
          lanIp: null,
        },
        dependencies,
      });

      const outboundDir = makeTempDir();
      process.env.PORTLESS_STATE_DIR = outboundDir;
      const outbound = await collectDoctorSnapshot({
        version: "0.15.6000",
        state: {
          dir: outboundDir,
          port: 443,
          tls: true,
          tld: "localhost",
          tlds: ["localhost"],
          lanMode: false,
          lanIp: null,
        },
        dependencies,
      });

      expect(inbound.state).toMatchObject({
        source: "sudo-user",
        expectedPath: "/home/alice/.portless",
        handoffValid: true,
      });
      expect(outbound.state).toMatchObject({
        source: "sudo-environment",
        expectedPath: outboundDir,
        handoffValid: true,
      });
    } finally {
      if (previous.sudoUser === undefined) delete process.env.SUDO_USER;
      else process.env.SUDO_USER = previous.sudoUser;
      if (previous.home === undefined) delete process.env.HOME;
      else process.env.HOME = previous.home;
      if (previous.stateDir === undefined) delete process.env.PORTLESS_STATE_DIR;
      else process.env.PORTLESS_STATE_DIR = previous.stateDir;
    }
  });
});
