import { describe, it, expect, afterAll, afterEach, beforeAll, vi } from "vitest";
import * as fs from "node:fs";
import * as http from "node:http";
import * as http2 from "node:http2";
import * as https from "node:https";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import * as tls from "node:tls";
import type { Duplex } from "node:stream";
import {
  createProxyServer,
  LOOPBACK_DIAL_OPTIONS,
  PORTLESS_HEADER,
  PORTLESS_LISTENER_PORT_HEADER,
} from "./proxy.js";
import type { ProxyServer } from "./proxy.js";
import type { RouteInfo, TunnelAlias } from "./types.js";
import { ensureCerts } from "./certs.js";
import { computeWebSocketAccept } from "./h2-websocket.js";

const TEST_PROXY_PORT = 1355;

/** Helper type covering plain HTTP, HTTP/2, and proxy wrapper servers. */
type AnyServer = http.Server | http2.Http2Server | http2.Http2SecureServer | ProxyServer;

function request(
  server: AnyServer,
  options: {
    host?: string;
    path?: string;
    method?: string;
    accept?: string | null;
    headers?: Record<string, string>;
    body?: string;
  }
): Promise<{
  status: number;
  headers: http.IncomingHttpHeaders;
  trailers: http.IncomingHttpHeaders;
  body: string;
}> {
  return new Promise((resolve, reject) => {
    const addr = server.address();
    if (!addr || typeof addr === "string") {
      return reject(new Error("Server not listening"));
    }
    const headers: Record<string, string> = { host: options.host || "", ...options.headers };
    if (options.accept !== null) {
      headers.accept = options.accept ?? "text/html";
    }
    if (options.body !== undefined && !headers["content-length"]) {
      headers["content-length"] = Buffer.byteLength(options.body).toString();
    }
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: addr.port,
        path: options.path || "/",
        method: options.method || "GET",
        headers,
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () =>
          resolve({ status: res.statusCode!, headers: res.headers, trailers: res.trailers, body })
        );
      }
    );
    req.on("error", reject);
    req.end(options.body);
  });
}

function listen(server: AnyServer): Promise<void> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
}

/** Reserve a TCP port nothing listens on. */
function unusedPort(): Promise<number> {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.listen(0, "127.0.0.1", () => {
      const addr = probe.address();
      if (!addr || typeof addr === "string") throw new Error("no addr");
      probe.close(() => resolve(addr.port));
    });
  });
}

/**
 * Send a POST with a large body followed by a pipelined GET over one raw
 * HTTP/1.1 connection and count the responses with the given status line. A
 * proxy that leaves the POST body undrained after an upstream error stalls the
 * connection, so the second response never arrives.
 */
function pipelinedErrorResponses(
  connect: () => net.Socket,
  host: string,
  expectedStatus: number
): Promise<number> {
  return new Promise((resolve, reject) => {
    const socket = connect();
    const body = Buffer.alloc(1024 * 1024, "a");
    let received = "";
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(received.split(`HTTP/1.1 ${expectedStatus}`).length - 1);
    };
    const timer = setTimeout(finish, 3000);
    socket.on("data", (chunk) => {
      received += chunk.toString("latin1");
      if (received.split(`HTTP/1.1 ${expectedStatus}`).length - 1 >= 2) finish();
    });
    socket.on("error", (err) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(err);
      }
    });
    const send = (): void => {
      socket.write(
        `POST /upload HTTP/1.1\r\nHost: ${host}\r\nAccept: application/json\r\nContent-Length: ${body.length}\r\n\r\n`
      );
      socket.write(body);
      socket.write(`GET /next HTTP/1.1\r\nHost: ${host}\r\nAccept: application/json\r\n\r\n`);
    };
    if (socket.connecting) socket.once("connect", send);
    else socket.once("secureConnect", send);
  });
}

describe("createProxyServer", () => {
  const servers: AnyServer[] = [];

  function trackServer<T extends AnyServer>(server: T): T {
    servers.push(server);
    return server;
  }

  afterEach(async () => {
    vi.useRealTimers();
    for (const s of servers) {
      await new Promise<void>((resolve) => s.close(() => resolve()));
    }
    servers.length = 0;
  });

  describe("request routing", () => {
    it("returns 404 when Host header has no matching route", async () => {
      const routes: RouteInfo[] = [];
      const server = trackServer(
        createProxyServer({ getRoutes: () => routes, proxyPort: TEST_PROXY_PORT })
      );
      await listen(server);

      const res = await request(server, { host: "nonexistent.localhost" });
      expect(res.status).toBe(404);
      expect(res.body).toContain("Not Found");
    });

    it("returns 404 with HTML page for unknown host", async () => {
      const routes: RouteInfo[] = [];
      const server = trackServer(
        createProxyServer({ getRoutes: () => routes, proxyPort: TEST_PROXY_PORT })
      );
      await listen(server);

      const res = await request(server, { host: "unknown.localhost" });
      expect(res.status).toBe(404);
      expect(res.headers["content-type"]).toBe("text/html");
      expect(res.body).toContain("Not Found");
      expect(res.body).toContain("unknown.localhost");
      expect(res.body).toContain("No apps running.");
    });

    it("returns a JSON 404 without the app list for non-browser clients", async () => {
      const routes: RouteInfo[] = [
        { hostname: "myapp.localhost", port: 4001 },
        { hostname: "api.localhost", port: 4002 },
      ];
      const server = trackServer(
        createProxyServer({ getRoutes: () => routes, proxyPort: TEST_PROXY_PORT })
      );
      await listen(server);

      const res = await request(server, { host: "other.localhost", accept: null });
      expect(res.status).toBe(404);
      expect(res.headers["content-type"]).toBe("application/json; charset=utf-8");
      expect(res.headers.vary).toBe("Accept");
      const body = JSON.parse(res.body);
      expect(body.error).toBe("not_found");
      expect(body.upstream).toBe("other.localhost");
      expect(body.message).toContain("No app registered for other.localhost");
      expect(body.message).toContain("portless other your-command");
      expect(body.message).toContain("portless list");
      expect(res.body).not.toContain("myapp.localhost");
      expect(res.body).not.toContain("api.localhost");
    });

    it("keeps wantsHtml strict: a substring of text/html does not select HTML", async () => {
      const server = trackServer(
        createProxyServer({ getRoutes: () => [], proxyPort: TEST_PROXY_PORT })
      );
      await listen(server);

      const res = await request(server, {
        host: "other.localhost",
        accept: "application/x-text/html-ish",
      });
      expect(res.headers["content-type"]).toBe("application/json; charset=utf-8");
      expect(res.headers.vary).toBe("Accept");
    });

    it("sets Vary: Accept on HTML error pages too", async () => {
      const server = trackServer(
        createProxyServer({ getRoutes: () => [], proxyPort: TEST_PROXY_PORT })
      );
      await listen(server);

      const res = await request(server, { host: "other.localhost" });
      expect(res.headers["content-type"]).toBe("text/html");
      expect(res.headers.vary).toBe("Accept");
    });

    it("answers 421 for hosts outside every configured suffix", async () => {
      const routes: RouteInfo[] = [{ hostname: "secret-app.localhost", port: 4001 }];
      const server = trackServer(
        createProxyServer({ getRoutes: () => routes, proxyPort: TEST_PROXY_PORT })
      );
      await listen(server);

      const json = await request(server, { host: "ads.example.com", accept: null });
      expect(json.status).toBe(421);
      expect(json.headers.vary).toBe("Accept");
      expect(JSON.parse(json.body)).toMatchObject({
        error: "misdirected_request",
        upstream: "ads.example.com",
      });
      expect(json.body).not.toContain("secret-app");

      const html = await request(server, { host: "ads.example.com" });
      expect(html.status).toBe(421);
      expect(html.body).toContain("Misdirected Request");
      expect(html.body).not.toContain("secret-app");
    });

    it("keeps 404 for configured suffixes, trailing-dot names, and IP literals", async () => {
      const routes: RouteInfo[] = [{ hostname: "myapp.localhost", port: 4001 }];
      const server = trackServer(
        createProxyServer({
          getRoutes: () => routes,
          proxyPort: TEST_PROXY_PORT,
          tlds: ["localhost", "test"],
        })
      );
      await listen(server);

      for (const host of ["nope.localhost", "nope.test", "nope.localhost.", "NOPE.TEST"]) {
        expect((await request(server, { host })).status, host).toBe(404);
      }
      expect((await request(server, { host: "127.0.0.1" })).status).toBe(404);
      expect((await request(server, { host: "[::1]" })).status).toBe(404);
      expect((await request(server, { host: "other.example" })).status).toBe(421);
    });

    it("hides the app list from an exact tunnel alias host whose path matches no route", async () => {
      const routes: RouteInfo[] = [
        { hostname: "myapp.localhost", port: 4001, pathPrefix: "/api" },
        { hostname: "other.localhost", port: 4002 },
      ];
      const aliases: TunnelAlias[] = [
        {
          externalHostname: "public.example.com",
          targetHostname: "myapp.localhost",
          targetPathPrefix: "/api",
        },
      ];
      const server = trackServer(
        createProxyServer({
          getRoutes: () => routes,
          getTunnelAliases: () => aliases,
          proxyPort: TEST_PROXY_PORT,
        })
      );
      await listen(server);

      for (const accept of [null, "text/html"]) {
        const res = await request(server, { host: "public.example.com", path: "/nope", accept });
        expect(res.status).toBe(404);
        expect(res.body).not.toContain("myapp.localhost");
        expect(res.body).not.toContain("other.localhost");
        expect(res.body).not.toContain("your-command");
        expect(res.body).not.toContain("portless list");
      }
    });

    it("hides the app list from a Tailscale host whose path matches no route", async () => {
      const routes: RouteInfo[] = [
        {
          hostname: "myapp.localhost",
          port: 4001,
          pathPrefix: "/api",
          tailscaleUrl: "https://my-device.tail1234.ts.net",
        },
        { hostname: "other.localhost", port: 4002 },
      ];
      const server = trackServer(
        createProxyServer({ getRoutes: () => routes, proxyPort: TEST_PROXY_PORT })
      );
      await listen(server);

      const res = await request(server, {
        host: "my-device.tail1234.ts.net",
        path: "/nope",
        accept: null,
      });
      expect(res.status).toBe(404);
      expect(res.body).not.toContain("other.localhost");
      expect(res.body).not.toContain("your-command");
    });

    it("shows active routes in 404 page when routes exist", async () => {
      const routes: RouteInfo[] = [
        { hostname: "myapp.localhost", port: 4001 },
        { hostname: "api.localhost", port: 4002 },
      ];
      const server = trackServer(
        createProxyServer({ getRoutes: () => routes, proxyPort: TEST_PROXY_PORT })
      );
      await listen(server);

      const res = await request(server, { host: "other.localhost" });
      expect(res.status).toBe(404);
      expect(res.body).toContain("Apps");
      expect(res.body).toContain("myapp.localhost");
      expect(res.body).toContain("api.localhost");
    });

    it("includes correct port in 404 page links", async () => {
      const routes: RouteInfo[] = [{ hostname: "myapp.localhost", port: 4001 }];
      const server = trackServer(createProxyServer({ getRoutes: () => routes, proxyPort: 8080 }));
      await listen(server);

      const res = await request(server, { host: "other.localhost" });
      expect(res.status).toBe(404);
      expect(res.body).toContain('href="http://myapp.localhost:8080"');
    });

    it("preserves request path in 404 page links", async () => {
      const routes: RouteInfo[] = [{ hostname: "myapp.localhost", port: 4001 }];
      const server = trackServer(createProxyServer({ getRoutes: () => routes, proxyPort: 8080 }));
      await listen(server);

      const res = await request(server, {
        host: "other.localhost",
        path: "/oauth/callback",
      });
      expect(res.status).toBe(404);
      expect(res.body).toContain('href="http://myapp.localhost:8080/oauth/callback"');
    });

    it("preserves request path and query in 404 page links", async () => {
      const routes: RouteInfo[] = [{ hostname: "myapp.localhost", port: 4001 }];
      const server = trackServer(createProxyServer({ getRoutes: () => routes, proxyPort: 8080 }));
      await listen(server);

      const res = await request(server, {
        host: "other.localhost",
        path: "/oauth/callback?code=abc&state=xyz",
      });
      expect(res.status).toBe(404);
      expect(res.body).toContain(
        'href="http://myapp.localhost:8080/oauth/callback?code=abc&amp;state=xyz"'
      );
    });

    it("omits root path from 404 page links", async () => {
      const routes: RouteInfo[] = [{ hostname: "myapp.localhost", port: 4001 }];
      const server = trackServer(createProxyServer({ getRoutes: () => routes, proxyPort: 8080 }));
      await listen(server);

      const res = await request(server, { host: "other.localhost", path: "/" });
      expect(res.status).toBe(404);
      expect(res.body).toContain('href="http://myapp.localhost:8080"');
      expect(res.body).not.toContain('href="http://myapp.localhost:8080/"');
    });

    it("omits port 80 in 404 page links", async () => {
      const routes: RouteInfo[] = [{ hostname: "myapp.localhost", port: 4001 }];
      const server = trackServer(createProxyServer({ getRoutes: () => routes, proxyPort: 80 }));
      await listen(server);

      const res = await request(server, { host: "other.localhost" });
      expect(res.status).toBe(404);
      expect(res.body).toContain('href="http://myapp.localhost"');
      expect(res.body).not.toContain(":80");
    });

    it("proxies request to matching route", async () => {
      const backend = trackServer(
        http.createServer((_req, res) => {
          res.writeHead(200, { "Content-Type": "text/plain" });
          res.end("hello from backend");
        })
      );
      await listen(backend);
      const backendAddr = backend.address();
      if (!backendAddr || typeof backendAddr === "string") throw new Error("no addr");

      const routes: RouteInfo[] = [{ hostname: "myapp.localhost", port: backendAddr.port }];
      const server = trackServer(
        createProxyServer({ getRoutes: () => routes, proxyPort: TEST_PROXY_PORT })
      );
      await listen(server);

      const res = await request(server, { host: "myapp.localhost" });
      expect(res.status).toBe(200);
      expect(res.body).toBe("hello from backend");
    });

    it("routes exact tunnel aliases to their target route", async () => {
      const backend = trackServer(http.createServer((_req, res) => res.end("via alias")));
      await listen(backend);
      const backendAddr = backend.address();
      if (!backendAddr || typeof backendAddr === "string") throw new Error("no addr");

      const routes: RouteInfo[] = [{ hostname: "myapp.localhost", port: backendAddr.port }];
      const aliases: TunnelAlias[] = [
        {
          externalHostname: "public.example.com",
          targetHostname: "myapp.localhost",
          targetPathPrefix: "/",
        },
      ];
      const server = trackServer(
        createProxyServer({
          getRoutes: () => routes,
          getTunnelAliases: () => aliases,
          proxyPort: TEST_PROXY_PORT,
        })
      );
      await listen(server);

      const res = await request(server, { host: "public.example.com" });
      expect(res.status).toBe(200);
      expect(res.body).toBe("via alias");
    });

    it("honors multiplex cookies through a manual alias and chooses a stable default", async () => {
      const a = trackServer(http.createServer((_req, res) => res.end("alpha")));
      const b = trackServer(http.createServer((_req, res) => res.end("beta")));
      await listen(a);
      await listen(b);
      const aAddr = a.address();
      const bAddr = b.address();
      if (!aAddr || typeof aAddr === "string" || !bAddr || typeof bAddr === "string")
        throw new Error("no addr");
      const routes: RouteInfo[] = [
        { hostname: "shared.localhost", port: bAddr.port, label: "beta", pid: 2 },
        { hostname: "shared.localhost", port: aAddr.port, label: "alpha", pid: 1 },
      ];
      const aliases: TunnelAlias[] = [
        { externalHostname: "public.example.com", targetHostname: "shared.localhost" },
      ];
      const server = trackServer(
        createProxyServer({
          getRoutes: () => routes,
          getTunnelAliases: () => aliases,
          proxyPort: TEST_PROXY_PORT,
        })
      );
      await listen(server);
      expect((await request(server, { host: "public.example.com" })).body).toBe("alpha");
      expect(
        (
          await request(server, {
            host: "public.example.com",
            headers: { cookie: "portless_app=beta" },
          })
        ).body
      ).toBe("beta");
      expect(
        (
          await request(server, {
            host: "public.example.com",
            headers: { cookie: "portless_app=stale" },
          })
        ).body
      ).toBe("alpha");
      aliases[0].routeOwnerPid = 2;
      expect(
        (
          await request(server, {
            host: "public.example.com",
            headers: { cookie: "portless_app=alpha" },
          })
        ).body
      ).toBe("beta");
    });

    it("uses the tunnel alias provider as the only alias source for repeated requests", async () => {
      const backend = trackServer(http.createServer((_req, res) => res.end("via provider")));
      await listen(backend);
      const backendAddr = backend.address();
      if (!backendAddr || typeof backendAddr === "string") throw new Error("no addr");

      const routes: RouteInfo[] = [{ hostname: "myapp.localhost", port: backendAddr.port }];
      const aliases: TunnelAlias[] = [
        {
          externalHostname: "public.example.com",
          targetHostname: "myapp.localhost",
          targetPathPrefix: "/",
        },
      ];
      const getTunnelAliases = vi.fn(() => aliases);
      const server = trackServer(
        createProxyServer({
          getRoutes: () => routes,
          getTunnelAliases,
          proxyPort: TEST_PROXY_PORT,
        })
      );
      await listen(server);

      const responses = await Promise.all([
        request(server, { host: "public.example.com" }),
        request(server, { host: "public.example.com" }),
        request(server, { host: "public.example.com" }),
      ]);

      expect(responses.map((response) => response.body)).toEqual([
        "via provider",
        "via provider",
        "via provider",
      ]);
      expect(getTunnelAliases).toHaveBeenCalledTimes(3);
      expect(getTunnelAliases.mock.results.every(({ value }) => value === aliases)).toBe(true);
    });

    it("does not route arbitrary public hosts without an explicit tunnel alias", async () => {
      const backend = trackServer(http.createServer((_req, res) => res.end("private app")));
      await listen(backend);
      const backendAddr = backend.address();
      if (!backendAddr || typeof backendAddr === "string") throw new Error("no addr");

      const routes: RouteInfo[] = [{ hostname: "myapp.localhost", port: backendAddr.port }];
      const server = trackServer(
        createProxyServer({
          getRoutes: () => routes,
          getTunnelAliases: () => [],
          proxyPort: TEST_PROXY_PORT,
          strict: false,
        })
      );
      await listen(server);

      const res = await request(server, { host: "random.example.com" });
      expect(res.status).toBe(421);
      expect(res.body).not.toBe("private app");
    });

    it("prefers a direct route over a tunnel alias with the same hostname", async () => {
      const directBackend = trackServer(http.createServer((_req, res) => res.end("direct")));
      const aliasBackend = trackServer(http.createServer((_req, res) => res.end("alias")));
      await listen(directBackend);
      await listen(aliasBackend);
      const directAddr = directBackend.address();
      const aliasAddr = aliasBackend.address();
      if (
        !directAddr ||
        typeof directAddr === "string" ||
        !aliasAddr ||
        typeof aliasAddr === "string"
      ) {
        throw new Error("no addr");
      }

      const routes: RouteInfo[] = [
        { hostname: "public.example.com", port: directAddr.port },
        { hostname: "myapp.localhost", port: aliasAddr.port },
      ];
      const aliases: TunnelAlias[] = [
        {
          externalHostname: "public.example.com",
          targetHostname: "myapp.localhost",
          targetPathPrefix: "/",
        },
      ];
      const server = trackServer(
        createProxyServer({
          getRoutes: () => routes,
          getTunnelAliases: () => aliases,
          proxyPort: TEST_PROXY_PORT,
        })
      );
      await listen(server);

      const res = await request(server, { host: "public.example.com" });
      expect(res.status).toBe(200);
      expect(res.body).toBe("direct");
    });

    it("composes tunnel aliases with path-scoped target routes", async () => {
      const rootBackend = trackServer(http.createServer((_req, res) => res.end("root")));
      const apiBackend = trackServer(http.createServer((_req, res) => res.end("api")));
      await listen(rootBackend);
      await listen(apiBackend);
      const rootAddr = rootBackend.address();
      const apiAddr = apiBackend.address();
      if (!rootAddr || typeof rootAddr === "string" || !apiAddr || typeof apiAddr === "string") {
        throw new Error("no addr");
      }

      const routes: RouteInfo[] = [
        { hostname: "myapp.localhost", port: rootAddr.port },
        { hostname: "myapp.localhost", port: apiAddr.port, pathPrefix: "/api" },
      ];
      const aliases: TunnelAlias[] = [
        {
          externalHostname: "public.example.com",
          targetHostname: "myapp.localhost",
          targetPathPrefix: "/api",
        },
      ];
      const server = trackServer(
        createProxyServer({
          getRoutes: () => routes,
          getTunnelAliases: () => aliases,
          proxyPort: TEST_PROXY_PORT,
        })
      );
      await listen(server);

      expect((await request(server, { host: "public.example.com", path: "/api/users" })).body).toBe(
        "api"
      );
      expect(
        (await request(server, { host: "other.public.example.com", path: "/api" })).status
      ).toBe(421);
      expect((await request(server, { host: "public.example.com", path: "/users" })).status).toBe(
        404
      );
    });

    it.each([
      ["Serve", "https://my-device.tail1234.ts.net", undefined],
      ["Funnel", "https://my-device.tail1234.ts.net:8443", true],
    ])("routes a request addressed to a Tailscale %s hostname", async (_mode, url, funnel) => {
      const backend = trackServer(http.createServer((_req, res) => res.end("tailscale app")));
      await listen(backend);
      const backendAddr = backend.address();
      if (!backendAddr || typeof backendAddr === "string") throw new Error("no addr");

      const routes: RouteInfo[] = [
        {
          hostname: "myapp.localhost",
          port: backendAddr.port,
          tailscaleUrl: url,
          tailscaleFunnel: funnel,
        },
      ];
      const server = trackServer(
        createProxyServer({ getRoutes: () => routes, proxyPort: TEST_PROXY_PORT })
      );
      await listen(server);

      const res = await request(server, { host: new URL(url).host });
      expect(res.status).toBe(200);
      expect(res.body).toBe("tailscale app");
    });

    it("routes a request addressed to a Tailscale Service hostname", async () => {
      const backend = trackServer(http.createServer((_req, res) => res.end("service app")));
      await listen(backend);
      const backendAddr = backend.address();
      if (!backendAddr || typeof backendAddr === "string") throw new Error("no addr");

      const serviceUrl = "https://api.tail1234.ts.net";
      const routes: RouteInfo[] = [
        {
          hostname: "api.localhost",
          port: backendAddr.port,
          tailscaleServiceUrl: serviceUrl,
        },
      ];
      const server = trackServer(
        createProxyServer({ getRoutes: () => routes, proxyPort: TEST_PROXY_PORT })
      );
      await listen(server);

      const res = await request(server, { host: new URL(serviceUrl).hostname });
      expect(res.status).toBe(200);
      expect(res.body).toBe("service app");
    });

    it("uses the longest path prefix for a Tailscale hostname", async () => {
      const rootBackend = trackServer(http.createServer((_req, res) => res.end("tailscale root")));
      const apiBackend = trackServer(http.createServer((_req, res) => res.end("tailscale api")));
      await listen(rootBackend);
      await listen(apiBackend);
      const rootAddr = rootBackend.address();
      const apiAddr = apiBackend.address();
      if (!rootAddr || typeof rootAddr === "string" || !apiAddr || typeof apiAddr === "string") {
        throw new Error("no addr");
      }

      const tailscaleUrl = "https://my-device.tail1234.ts.net";
      const routes: RouteInfo[] = [
        { hostname: "myapp.localhost", port: rootAddr.port, tailscaleUrl },
        {
          hostname: "myapp.localhost",
          port: apiAddr.port,
          pathPrefix: "/api",
          tailscaleUrl,
        },
      ];
      const server = trackServer(
        createProxyServer({ getRoutes: () => routes, proxyPort: TEST_PROXY_PORT })
      );
      await listen(server);

      const res = await request(server, {
        host: "my-device.tail1234.ts.net",
        path: "/api/users",
      });
      expect(res.status).toBe(200);
      expect(res.body).toBe("tailscale api");
    });

    it("rejects an unrelated .ts.net host", async () => {
      const backend = trackServer(http.createServer((_req, res) => res.end("private app")));
      await listen(backend);
      const backendAddr = backend.address();
      if (!backendAddr || typeof backendAddr === "string") throw new Error("no addr");

      const routes: RouteInfo[] = [
        {
          hostname: "myapp.localhost",
          port: backendAddr.port,
          tailscaleUrl: "https://my-device.tail1234.ts.net",
        },
      ];
      const server = trackServer(
        createProxyServer({ getRoutes: () => routes, proxyPort: TEST_PROXY_PORT, strict: false })
      );
      await listen(server);

      const res = await request(server, { host: "other-device.tail1234.ts.net" });
      expect(res.status).toBe(421);
      expect(res.body).not.toBe("private app");
    });

    it("uses the longest matching path prefix for the same hostname", async () => {
      const rootBackend = trackServer(http.createServer((_req, res) => res.end("root")));
      const apiBackend = trackServer(http.createServer((_req, res) => res.end("api")));
      const v1Backend = trackServer(http.createServer((_req, res) => res.end("v1")));
      await listen(rootBackend);
      await listen(apiBackend);
      await listen(v1Backend);
      const rootAddr = rootBackend.address();
      const apiAddr = apiBackend.address();
      const v1Addr = v1Backend.address();
      if (
        !rootAddr ||
        typeof rootAddr === "string" ||
        !apiAddr ||
        typeof apiAddr === "string" ||
        !v1Addr ||
        typeof v1Addr === "string"
      ) {
        throw new Error("no addr");
      }

      const routes: RouteInfo[] = [
        { hostname: "myapp.localhost", port: rootAddr.port },
        { hostname: "myapp.localhost", port: apiAddr.port, pathPrefix: "/api" },
        { hostname: "myapp.localhost", port: v1Addr.port, pathPrefix: "/api/v1" },
      ];
      const server = trackServer(
        createProxyServer({ getRoutes: () => routes, proxyPort: TEST_PROXY_PORT })
      );
      await listen(server);

      expect((await request(server, { host: "myapp.localhost", path: "/" })).body).toBe("root");
      expect((await request(server, { host: "myapp.localhost", path: "/api/users" })).body).toBe(
        "api"
      );
      expect((await request(server, { host: "myapp.localhost", path: "/api/v1/users" })).body).toBe(
        "v1"
      );
    });

    it("does not match partial path segments", async () => {
      const rootBackend = trackServer(http.createServer((_req, res) => res.end("root")));
      const apiBackend = trackServer(http.createServer((_req, res) => res.end("api")));
      await listen(rootBackend);
      await listen(apiBackend);
      const rootAddr = rootBackend.address();
      const apiAddr = apiBackend.address();
      if (!rootAddr || typeof rootAddr === "string" || !apiAddr || typeof apiAddr === "string") {
        throw new Error("no addr");
      }

      const routes: RouteInfo[] = [
        { hostname: "myapp.localhost", port: rootAddr.port },
        { hostname: "myapp.localhost", port: apiAddr.port, pathPrefix: "/api" },
      ];
      const server = trackServer(
        createProxyServer({ getRoutes: () => routes, proxyPort: TEST_PROXY_PORT })
      );
      await listen(server);

      const res = await request(server, { host: "myapp.localhost", path: "/api-v2/users" });
      expect(res.status).toBe(200);
      expect(res.body).toBe("root");
    });

    it("forwards the full request path without stripping the matched prefix", async () => {
      const backend = trackServer(http.createServer((req, res) => res.end(req.url)));
      await listen(backend);
      const backendAddr = backend.address();
      if (!backendAddr || typeof backendAddr === "string") throw new Error("no addr");

      const routes: RouteInfo[] = [
        { hostname: "myapp.localhost", port: backendAddr.port, pathPrefix: "/api" },
      ];
      const server = trackServer(
        createProxyServer({ getRoutes: () => routes, proxyPort: TEST_PROXY_PORT })
      );
      await listen(server);

      const res = await request(server, { host: "myapp.localhost", path: "/api/users?active=1" });
      expect(res.status).toBe(200);
      expect(res.body).toBe("/api/users?active=1");
    });

    it.each(["/api/../admin?raw=1", "/api/%2Fadmin?raw=1"])(
      "matches and forwards the raw request target %s verbatim",
      async (target) => {
        const backend = trackServer(http.createServer((req, res) => res.end(req.url)));
        await listen(backend);
        const backendAddr = backend.address();
        if (!backendAddr || typeof backendAddr === "string") throw new Error("no addr");

        const server = trackServer(
          createProxyServer({
            getRoutes: () => [
              { hostname: "myapp.localhost", port: backendAddr.port, pathPrefix: "/api" },
            ],
            proxyPort: TEST_PROXY_PORT,
          })
        );
        await listen(server);

        const res = await request(server, { host: "myapp.localhost", path: target });
        expect(res.status).toBe(200);
        expect(res.body).toBe(target);
      }
    );

    it("accepts matching absolute-form targets and forwards origin-form", async () => {
      const backend = trackServer(http.createServer((req, res) => res.end(req.url)));
      await listen(backend);
      const backendAddr = backend.address();
      if (!backendAddr || typeof backendAddr === "string") throw new Error("no addr");

      const server = trackServer(
        createProxyServer({
          getRoutes: () => [
            { hostname: "myapp.localhost", port: backendAddr.port, pathPrefix: "/api" },
          ],
          proxyPort: TEST_PROXY_PORT,
        })
      );
      await listen(server);

      const res = await request(server, {
        host: "myapp.localhost",
        path: "http://MYAPP.localhost:80/api/../admin?raw=1",
      });
      expect(res.status).toBe(200);
      expect(res.body).toBe("/api/../admin?raw=1");
    });

    it.each([
      "http://other.localhost/api",
      "https://myapp.localhost/api",
      "http://myapp.localhost:8080/api",
    ])("returns 400 for an absolute-form authority mismatch: %s", async (target) => {
      let backendRequests = 0;
      const backend = trackServer(
        http.createServer((_req, res) => {
          backendRequests++;
          res.end("unexpected");
        })
      );
      await listen(backend);
      const backendAddr = backend.address();
      if (!backendAddr || typeof backendAddr === "string") throw new Error("no addr");

      const server = trackServer(
        createProxyServer({
          getRoutes: () => [{ hostname: "myapp.localhost", port: backendAddr.port }],
          proxyPort: TEST_PROXY_PORT,
        })
      );
      await listen(server);

      const res = await request(server, { host: "myapp.localhost", path: target });
      expect(res.status).toBe(400);
      expect(backendRequests).toBe(0);
    });

    it("returns 400 for authority-form outside CONNECT instead of routing it as root", async () => {
      let backendRequests = 0;
      const backend = trackServer(
        http.createServer((_req, res) => {
          backendRequests++;
          res.end("unexpected");
        })
      );
      await listen(backend);
      const backendAddr = backend.address();
      if (!backendAddr || typeof backendAddr === "string") throw new Error("no addr");

      const server = trackServer(
        createProxyServer({
          getRoutes: () => [{ hostname: "myapp.localhost", port: backendAddr.port }],
          proxyPort: TEST_PROXY_PORT,
        })
      );
      await listen(server);

      const res = await request(server, { host: "myapp.localhost", path: "other.localhost:80" });
      expect(res.status).toBe(400);
      expect(backendRequests).toBe(0);
    });

    it("preserves OPTIONS * for a root route", async () => {
      const backend = trackServer(
        http.createServer((req, res) => res.end(`${req.method} ${req.url}`))
      );
      await listen(backend);
      const backendAddr = backend.address();
      if (!backendAddr || typeof backendAddr === "string") throw new Error("no addr");

      const server = trackServer(
        createProxyServer({
          getRoutes: () => [{ hostname: "myapp.localhost", port: backendAddr.port }],
          proxyPort: TEST_PROXY_PORT,
        })
      );
      await listen(server);

      const res = await request(server, {
        host: "myapp.localhost",
        path: "*",
        method: "OPTIONS",
      });
      expect(res.status).toBe(200);
      expect(res.body).toBe("OPTIONS *");
    });

    it("routes wildcard subdomains with path prefixes when strict is false", async () => {
      const backend = trackServer(http.createServer((_req, res) => res.end("wildcard path")));
      await listen(backend);
      const backendAddr = backend.address();
      if (!backendAddr || typeof backendAddr === "string") throw new Error("no addr");

      const routes: RouteInfo[] = [
        { hostname: "myapp.localhost", port: backendAddr.port, pathPrefix: "/api" },
      ];
      const server = trackServer(
        createProxyServer({
          getRoutes: () => routes,
          proxyPort: TEST_PROXY_PORT,
          strict: false,
        })
      );
      await listen(server);

      const res = await request(server, { host: "tenant.myapp.localhost", path: "/api/users" });
      expect(res.status).toBe(200);
      expect(res.body).toBe("wildcard path");
    });

    it("proxies to a backend listening on IPv6 loopback only (issue #320)", async (ctx) => {
      const backend = http.createServer((_req, res) => {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("hello from ipv6 backend");
      });
      const ipv6Available = await new Promise<boolean>((resolve) => {
        backend.once("error", () => resolve(false));
        backend.listen(0, "::1", () => resolve(true));
      });
      if (!ipv6Available) return ctx.skip();
      trackServer(backend);
      const backendAddr = backend.address();
      if (!backendAddr || typeof backendAddr === "string") throw new Error("no addr");

      const routes: RouteInfo[] = [{ hostname: "myapp.localhost", port: backendAddr.port }];
      const server = trackServer(
        createProxyServer({ getRoutes: () => routes, proxyPort: TEST_PROXY_PORT })
      );
      await listen(server);

      const res = await request(server, { host: "myapp.localhost" });
      expect(res.status).toBe(200);
      expect(res.body).toBe("hello from ipv6 backend");
    });

    it("routes wildcard subdomain to matching parent route when strict is false", async () => {
      const backend = trackServer(
        http.createServer((_req, res) => {
          res.writeHead(200, { "Content-Type": "text/plain" });
          res.end("wildcard hit");
        })
      );
      await listen(backend);
      const backendAddr = backend.address();
      if (!backendAddr || typeof backendAddr === "string") throw new Error("no addr");

      const routes: RouteInfo[] = [{ hostname: "myapp.localhost", port: backendAddr.port }];
      const server = trackServer(
        createProxyServer({
          getRoutes: () => routes,
          proxyPort: TEST_PROXY_PORT,
          strict: false,
        })
      );
      await listen(server);

      const res = await request(server, { host: "tenant.myapp.localhost" });
      expect(res.status).toBe(200);
      expect(res.body).toBe("wildcard hit");
    });

    it("prefers exact match over wildcard subdomain match", async () => {
      const exactBackend = trackServer(
        http.createServer((_req, res) => {
          res.writeHead(200, { "Content-Type": "text/plain" });
          res.end("exact");
        })
      );
      await listen(exactBackend);
      const exactAddr = exactBackend.address();
      if (!exactAddr || typeof exactAddr === "string") throw new Error("no addr");

      const wildcardBackend = trackServer(
        http.createServer((_req, res) => {
          res.writeHead(200, { "Content-Type": "text/plain" });
          res.end("wildcard");
        })
      );
      await listen(wildcardBackend);
      const wildcardAddr = wildcardBackend.address();
      if (!wildcardAddr || typeof wildcardAddr === "string") throw new Error("no addr");

      const routes: RouteInfo[] = [
        { hostname: "tenant.myapp.localhost", port: exactAddr.port },
        { hostname: "myapp.localhost", port: wildcardAddr.port },
      ];
      const server = trackServer(
        createProxyServer({
          getRoutes: () => routes,
          proxyPort: TEST_PROXY_PORT,
          strict: false,
        })
      );
      await listen(server);

      const res = await request(server, { host: "tenant.myapp.localhost" });
      expect(res.status).toBe(200);
      expect(res.body).toBe("exact");
    });

    it("returns 404 when subdomain does not match any route", async () => {
      const routes: RouteInfo[] = [{ hostname: "myapp.localhost", port: 4001 }];
      const server = trackServer(
        createProxyServer({ getRoutes: () => routes, proxyPort: TEST_PROXY_PORT })
      );
      await listen(server);

      const res = await request(server, { host: "other.localhost" });
      expect(res.status).toBe(404);
    });

    it("strips port from Host header for matching", async () => {
      const backend = trackServer(
        http.createServer((_req, res) => {
          res.writeHead(200, { "Content-Type": "text/plain" });
          res.end("matched");
        })
      );
      await listen(backend);
      const backendAddr = backend.address();
      if (!backendAddr || typeof backendAddr === "string") throw new Error("no addr");

      const routes: RouteInfo[] = [{ hostname: "myapp.localhost", port: backendAddr.port }];
      const server = trackServer(
        createProxyServer({ getRoutes: () => routes, proxyPort: TEST_PROXY_PORT })
      );
      await listen(server);

      const res = await request(server, { host: "myapp.localhost:80" });
      expect(res.status).toBe(200);
      expect(res.body).toBe("matched");
    });

    it("returns 404 for unregistered subdomain prefix by default", async () => {
      const backend = trackServer(
        http.createServer((_req, res) => {
          res.writeHead(200, { "Content-Type": "text/plain" });
          res.end("should not reach");
        })
      );
      await listen(backend);
      const backendAddr = backend.address();
      if (!backendAddr || typeof backendAddr === "string") throw new Error("no addr");

      const routes: RouteInfo[] = [{ hostname: "myapp.localhost", port: backendAddr.port }];
      const server = trackServer(
        createProxyServer({ getRoutes: () => routes, proxyPort: TEST_PROXY_PORT })
      );
      await listen(server);

      const res = await request(server, { host: "unknown.myapp.localhost" });
      expect(res.status).toBe(404);
      expect(res.body).toContain("Not Found");
    });

    it("still routes exact matches by default", async () => {
      const backend = trackServer(
        http.createServer((_req, res) => {
          res.writeHead(200, { "Content-Type": "text/plain" });
          res.end("exact match");
        })
      );
      await listen(backend);
      const backendAddr = backend.address();
      if (!backendAddr || typeof backendAddr === "string") throw new Error("no addr");

      const routes: RouteInfo[] = [{ hostname: "myapp.localhost", port: backendAddr.port }];
      const server = trackServer(
        createProxyServer({ getRoutes: () => routes, proxyPort: TEST_PROXY_PORT })
      );
      await listen(server);

      const res = await request(server, { host: "myapp.localhost" });
      expect(res.status).toBe(200);
      expect(res.body).toBe("exact match");
    });

    it("routes registered subdomain prefix but not unregistered ones", async () => {
      const parentBackend = trackServer(
        http.createServer((_req, res) => {
          res.writeHead(200, { "Content-Type": "text/plain" });
          res.end("parent");
        })
      );
      await listen(parentBackend);
      const parentAddr = parentBackend.address();
      if (!parentAddr || typeof parentAddr === "string") throw new Error("no addr");

      const childBackend = trackServer(
        http.createServer((_req, res) => {
          res.writeHead(200, { "Content-Type": "text/plain" });
          res.end("child");
        })
      );
      await listen(childBackend);
      const childAddr = childBackend.address();
      if (!childAddr || typeof childAddr === "string") throw new Error("no addr");

      const routes: RouteInfo[] = [
        { hostname: "myapp.localhost", port: parentAddr.port },
        { hostname: "feat.myapp.localhost", port: childAddr.port },
      ];
      const server = trackServer(
        createProxyServer({ getRoutes: () => routes, proxyPort: TEST_PROXY_PORT })
      );
      await listen(server);

      // Registered prefix routes to its own backend
      const childRes = await request(server, { host: "feat.myapp.localhost" });
      expect(childRes.status).toBe(200);
      expect(childRes.body).toBe("child");

      // Unregistered prefix returns 404
      const unknownRes = await request(server, { host: "other.myapp.localhost" });
      expect(unknownRes.status).toBe(404);

      // Parent still works
      const parentRes = await request(server, { host: "myapp.localhost" });
      expect(parentRes.status).toBe(200);
      expect(parentRes.body).toBe("parent");
    });
  });

  describe("upstream connections", () => {
    it("preserves an IPv4 loopback connection across an event-loop stall", async () => {
      const backend = trackServer(http.createServer((_req, res) => res.end("ok")));
      await listen(backend);
      const socket = net.connect({
        ...LOOPBACK_DIAL_OPTIONS,
        port: (backend.address() as net.AddressInfo).port,
      });
      const connected = new Promise<void>((resolve, reject) => {
        socket.once("connect", resolve);
        socket.once("error", reject);
      });
      try {
        expect(LOOPBACK_DIAL_OPTIONS.autoSelectFamilyAttemptTimeout).toBeGreaterThanOrEqual(2_000);
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 320);
        await connected;
      } finally {
        socket.destroy();
      }
    });

    it("serves requests while 80 upstream streams remain open", async () => {
      const backend = trackServer(
        http.createServer((req, res) => {
          if (req.url === "/stream") {
            res.writeHead(200);
            res.write("stream");
          } else res.end("ok");
        })
      );
      await listen(backend);
      const port = (backend.address() as net.AddressInfo).port;
      const server = trackServer(
        createProxyServer({
          getRoutes: () => [{ hostname: "myapp.localhost", port }],
          proxyPort: TEST_PROXY_PORT,
        })
      );
      await listen(server);
      const proxyPort = (server.address() as net.AddressInfo).port;
      const streams: http.ClientRequest[] = [];
      try {
        await Promise.all(
          Array.from(
            { length: 80 },
            () =>
              new Promise<void>((resolve, reject) => {
                const req = http.get(
                  {
                    host: "127.0.0.1",
                    port: proxyPort,
                    path: "/stream",
                    headers: { host: "myapp.localhost" },
                    agent: false,
                  },
                  (res) => {
                    res.on("error", () => {});
                    res.once("data", () => resolve());
                  }
                );
                streams.push(req);
                req.on("error", reject);
              })
          )
        );
        expect((await request(server, { host: "myapp.localhost" })).body).toBe("ok");
      } finally {
        streams.forEach((req) => req.destroy());
      }
    });

    it("reuses one upstream connection across ordinary requests", async () => {
      const connections = new Set<net.Socket>();
      const backend = trackServer(http.createServer((_req, res) => res.end("ok")));
      backend.on("connection", (socket) => connections.add(socket));
      await listen(backend);
      const backendAddr = backend.address();
      if (!backendAddr || typeof backendAddr === "string") throw new Error("no addr");

      const routes: RouteInfo[] = [{ hostname: "myapp.localhost", port: backendAddr.port }];
      const server = trackServer(
        createProxyServer({ getRoutes: () => routes, proxyPort: TEST_PROXY_PORT })
      );
      await listen(server);

      for (let i = 0; i < 5; i++) {
        const res = await request(server, { host: "myapp.localhost" });
        expect(res.status).toBe(200);
        expect(res.body).toBe("ok");
      }

      expect(connections.size).toBe(1);
    });

    it("strips connection-token headers before ordinary forwarding", async () => {
      let receivedHeaders: http.IncomingHttpHeaders = {};
      const backend = trackServer(
        http.createServer((req, res) => {
          receivedHeaders = req.headers;
          res.end("ok");
        })
      );
      await listen(backend);
      const backendAddr = backend.address();
      if (!backendAddr || typeof backendAddr === "string") throw new Error("no addr");

      const routes: RouteInfo[] = [{ hostname: "myapp.localhost", port: backendAddr.port }];
      const server = trackServer(
        createProxyServer({ getRoutes: () => routes, proxyPort: TEST_PROXY_PORT })
      );
      await listen(server);

      const res = await request(server, {
        host: "myapp.localhost",
        headers: {
          connection: "keep-alive, X-Forwarded-Unit",
          "x-forwarded-unit": "secret",
          "x-forwarded-value": "preserve",
        },
      });

      expect(res.status).toBe(200);
      expect(receivedHeaders.connection).toBe("keep-alive");
      expect(receivedHeaders["x-forwarded-unit"]).toBeUndefined();
      expect(receivedHeaders["x-forwarded-value"]).toBe("preserve");
    });

    it("replays a bodyless idempotent request when a reused socket resets", async () => {
      const handled = new WeakMap<net.Socket, number>();
      let resets = 0;
      const backend = trackServer(
        http.createServer((req, res) => {
          const count = (handled.get(req.socket) ?? 0) + 1;
          handled.set(req.socket, count);
          if (count === 1) return res.end("ok");
          resets++;
          req.socket.resetAndDestroy();
        })
      );
      await listen(backend);
      const backendAddr = backend.address();
      if (!backendAddr || typeof backendAddr === "string") throw new Error("no addr");

      const errors: string[] = [];
      const routes: RouteInfo[] = [{ hostname: "myapp.localhost", port: backendAddr.port }];
      const server = trackServer(
        createProxyServer({
          getRoutes: () => routes,
          proxyPort: TEST_PROXY_PORT,
          onError: (message) => errors.push(message),
        })
      );
      await listen(server);

      for (let i = 0; i < 4; i++) {
        const res = await request(server, { host: "myapp.localhost", accept: null });
        expect(res.status).toBe(200);
        expect(res.body).toBe("ok");
      }

      expect(resets).toBeGreaterThan(0);
      expect(errors).toEqual([]);
    });

    it("destroys pooled upstream sockets when a plain server closes", async () => {
      let upstreamSocket: net.Socket | undefined;
      let resolveClosed: (() => void) | undefined;
      const upstreamClosed = new Promise<void>((resolve) => {
        resolveClosed = resolve;
      });
      const backend = trackServer(http.createServer((_req, res) => res.end("ok")));
      backend.on("connection", (socket) => {
        upstreamSocket = socket;
        socket.once("close", () => resolveClosed?.());
      });
      await listen(backend);
      const backendAddr = backend.address();
      if (!backendAddr || typeof backendAddr === "string") throw new Error("no addr");

      const routes: RouteInfo[] = [{ hostname: "myapp.localhost", port: backendAddr.port }];
      const server = trackServer(
        createProxyServer({ getRoutes: () => routes, proxyPort: TEST_PROXY_PORT })
      );
      await listen(server);
      await request(server, { host: "myapp.localhost" });

      try {
        await new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        });
        await Promise.race([
          upstreamClosed,
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("upstream socket stayed open")), 500)
          ),
        ]);
      } finally {
        upstreamSocket?.destroy();
      }
    });

    it("does not replay non-idempotent or body-bearing requests", async () => {
      const handled = new WeakMap<net.Socket, number>();
      let resets = 0;
      let requests = 0;
      const backend = trackServer(
        http.createServer((req, res) => {
          requests++;
          const count = (handled.get(req.socket) ?? 0) + 1;
          handled.set(req.socket, count);
          if (count === 1) return res.end("ok");
          resets++;
          req.socket.resetAndDestroy();
        })
      );
      await listen(backend);
      const backendAddr = backend.address();
      if (!backendAddr || typeof backendAddr === "string") throw new Error("no addr");

      const errors: string[] = [];
      const routes: RouteInfo[] = [{ hostname: "myapp.localhost", port: backendAddr.port }];
      const server = trackServer(
        createProxyServer({
          getRoutes: () => routes,
          proxyPort: TEST_PROXY_PORT,
          onError: (message) => errors.push(message),
        })
      );
      await listen(server);

      expect((await request(server, { host: "myapp.localhost", accept: null })).status).toBe(200);

      const post = await request(server, {
        host: "myapp.localhost",
        method: "POST",
        accept: null,
        body: "payload",
      });
      expect(post.status).toBe(502);

      expect((await request(server, { host: "myapp.localhost", accept: null })).status).toBe(200);

      const getWithBody = await request(server, {
        host: "myapp.localhost",
        method: "GET",
        accept: null,
        body: "payload",
      });
      expect(getWithBody.status).toBe(502);
      expect(requests).toBe(4);
      expect(resets).toBe(2);
      expect(errors).toHaveLength(2);
    });
  });

  describe("missing Host header", () => {
    it("returns 400 when Host header is missing", async () => {
      const routes: RouteInfo[] = [];
      const server = trackServer(
        createProxyServer({ getRoutes: () => routes, proxyPort: TEST_PROXY_PORT })
      );
      await listen(server);

      const addr = server.address();
      if (!addr || typeof addr === "string") throw new Error("no addr");

      // Use raw TCP to send HTTP request without a Host header
      const response = await new Promise<string>((resolve, reject) => {
        const socket = net.createConnection(addr.port, "127.0.0.1", () => {
          socket.write("GET / HTTP/1.0\r\n\r\n");
        });
        let data = "";
        socket.on("data", (chunk) => (data += chunk));
        socket.on("end", () => resolve(data));
        socket.on("error", reject);
      });

      expect(response).toContain("400");
      expect(response).toContain("Missing Host header");
    });
  });

  describe("error handling", () => {
    it("returns 502 when backend is not running", async () => {
      const errors: string[] = [];
      const routes: RouteInfo[] = [{ hostname: "dead.localhost", port: 59999 }];
      const server = trackServer(
        createProxyServer({
          getRoutes: () => routes,
          proxyPort: TEST_PROXY_PORT,
          onError: (msg) => errors.push(msg),
        })
      );
      await listen(server);

      const res = await request(server, { host: "dead.localhost" });
      expect(res.status).toBe(502);
      expect(res.body).toContain("Bad Gateway");
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toContain("dead.localhost");
    });

    it("returns JSON 502 with the target port for non-browser clients", async () => {
      const unusedPort = await new Promise<number>((resolve) => {
        const probe = net.createServer();
        probe.listen(0, "127.0.0.1", () => {
          const addr = probe.address();
          if (!addr || typeof addr === "string") throw new Error("no addr");
          probe.close(() => resolve(addr.port));
        });
      });
      const routes: RouteInfo[] = [{ hostname: "dead.localhost", port: unusedPort }];
      const server = trackServer(
        createProxyServer({ getRoutes: () => routes, proxyPort: TEST_PROXY_PORT })
      );
      await listen(server);

      const res = await request(server, { host: "dead.localhost", accept: "application/json" });
      expect(res.status).toBe(502);
      expect(res.headers["content-type"]).toBe("application/json; charset=utf-8");
      expect(res.headers.vary).toBe("Accept");
      const body = JSON.parse(res.body);
      expect(body.error).toBe("bad_gateway");
      expect(body.upstream).toBe("dead.localhost");
      expect(body.message).toContain(`127.0.0.1:${unusedPort}`);
      expect(body.message).toContain("portless list");
    });
  });

  describe("X-Portless header", () => {
    it("includes X-Portless header on 404 responses", async () => {
      const routes: RouteInfo[] = [];
      const server = trackServer(
        createProxyServer({ getRoutes: () => routes, proxyPort: TEST_PROXY_PORT })
      );
      await listen(server);
      const addr = server.address();
      if (!addr || typeof addr === "string") throw new Error("no addr");

      const res = await request(server, { host: "unknown.localhost" });
      expect(res.headers[PORTLESS_HEADER.toLowerCase()]).toBe("1");
      expect(res.headers[PORTLESS_LISTENER_PORT_HEADER.toLowerCase()]).toBe(String(addr.port));
    });

    it("includes X-Portless header on 400 responses", async () => {
      const routes: RouteInfo[] = [];
      const server = trackServer(
        createProxyServer({ getRoutes: () => routes, proxyPort: TEST_PROXY_PORT })
      );
      await listen(server);
      const addr = server.address();
      if (!addr || typeof addr === "string") throw new Error("no addr");

      const res = await request(server, { host: "" });
      expect(res.headers[PORTLESS_HEADER.toLowerCase()]).toBe("1");
      expect(res.headers[PORTLESS_LISTENER_PORT_HEADER.toLowerCase()]).toBe(String(addr.port));
    });
  });

  describe("proxy loop detection", () => {
    it("returns 508 when X-Portless-Hops reaches the threshold", async () => {
      const backend = trackServer(
        http.createServer((_req, res) => {
          res.writeHead(200);
          res.end("should not reach here");
        })
      );
      await listen(backend);
      const backendAddr = backend.address();
      if (!backendAddr || typeof backendAddr === "string") throw new Error("no addr");

      const routes: RouteInfo[] = [{ hostname: "app.localhost", port: backendAddr.port }];
      const errors: string[] = [];
      const server = trackServer(
        createProxyServer({
          getRoutes: () => routes,
          proxyPort: TEST_PROXY_PORT,
          onError: (msg) => errors.push(msg),
        })
      );
      await listen(server);

      const addr = server.address();
      if (!addr || typeof addr === "string") throw new Error("no addr");

      const res = await new Promise<{ status: number; body: string }>((resolve, reject) => {
        const req = http.request(
          {
            hostname: "127.0.0.1",
            port: addr.port,
            path: "/",
            method: "GET",
            headers: {
              host: "app.localhost",
              accept: "text/html",
              "x-portless-hops": "5",
            },
          },
          (res) => {
            let body = "";
            res.on("data", (chunk) => (body += chunk));
            res.on("end", () => resolve({ status: res.statusCode!, body }));
          }
        );
        req.on("error", reject);
        req.end();
      });

      expect(res.status).toBe(508);
      expect(res.body).toContain("Loop Detected");
      expect(res.body).toContain("changeOrigin");
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toContain("Loop detected");
    });

    it("allows requests with hops below the threshold", async () => {
      const backend = trackServer(
        http.createServer((_req, res) => {
          res.writeHead(200, { "Content-Type": "text/plain" });
          res.end("ok");
        })
      );
      await listen(backend);
      const backendAddr = backend.address();
      if (!backendAddr || typeof backendAddr === "string") throw new Error("no addr");

      const routes: RouteInfo[] = [{ hostname: "app.localhost", port: backendAddr.port }];
      const server = trackServer(
        createProxyServer({ getRoutes: () => routes, proxyPort: TEST_PROXY_PORT })
      );
      await listen(server);

      const addr = server.address();
      if (!addr || typeof addr === "string") throw new Error("no addr");

      const res = await new Promise<{ status: number; body: string }>((resolve, reject) => {
        const req = http.request(
          {
            hostname: "127.0.0.1",
            port: addr.port,
            path: "/",
            method: "GET",
            headers: {
              host: "app.localhost",
              "x-portless-hops": "2",
            },
          },
          (res) => {
            let body = "";
            res.on("data", (chunk) => (body += chunk));
            res.on("end", () => resolve({ status: res.statusCode!, body }));
          }
        );
        req.on("error", reject);
        req.end();
      });

      expect(res.status).toBe(200);
      expect(res.body).toBe("ok");
    });

    it("increments X-Portless-Hops when forwarding to backend", async () => {
      let receivedHops = "";
      const backend = trackServer(
        http.createServer((req, res) => {
          receivedHops = req.headers["x-portless-hops"] as string;
          res.writeHead(200);
          res.end("ok");
        })
      );
      await listen(backend);
      const backendAddr = backend.address();
      if (!backendAddr || typeof backendAddr === "string") throw new Error("no addr");

      const routes: RouteInfo[] = [{ hostname: "myapp.localhost", port: backendAddr.port }];
      const server = trackServer(
        createProxyServer({ getRoutes: () => routes, proxyPort: TEST_PROXY_PORT })
      );
      await listen(server);

      // Request with no existing hops header; should be set to 1
      await request(server, { host: "myapp.localhost" });
      expect(receivedHops).toBe("1");

      // Request with existing hops; should be incremented
      const addr = server.address();
      if (!addr || typeof addr === "string") throw new Error("no addr");

      await new Promise<void>((resolve, reject) => {
        const req = http.request(
          {
            hostname: "127.0.0.1",
            port: addr.port,
            path: "/",
            method: "GET",
            headers: {
              host: "myapp.localhost",
              "x-portless-hops": "3",
            },
          },
          (res) => {
            res.resume();
            res.on("end", () => resolve());
          }
        );
        req.on("error", reject);
        req.end();
      });
      expect(receivedHops).toBe("4");
    });

    it("closes socket on WebSocket upgrade when hops exceed threshold", async () => {
      const backend = trackServer(http.createServer());
      backend.on("upgrade", (_req, socket) => {
        socket.write(
          "HTTP/1.1 101 Switching Protocols\r\n" +
            "Upgrade: websocket\r\n" +
            "Connection: Upgrade\r\n" +
            "\r\n"
        );
        socket.end();
      });
      await listen(backend);
      const backendAddr = backend.address();
      if (!backendAddr || typeof backendAddr === "string") throw new Error("no addr");

      const routes: RouteInfo[] = [{ hostname: "ws.localhost", port: backendAddr.port }];
      const errors: string[] = [];
      const server = trackServer(
        createProxyServer({
          getRoutes: () => routes,
          proxyPort: TEST_PROXY_PORT,
          onError: (msg) => errors.push(msg),
        })
      );
      await listen(server);

      const addr = server.address();
      if (!addr || typeof addr === "string") throw new Error("no addr");

      const destroyed = await new Promise<boolean>((resolve) => {
        const req = http.request({
          hostname: "127.0.0.1",
          port: addr.port,
          path: "/",
          headers: {
            host: "ws.localhost",
            connection: "Upgrade",
            upgrade: "websocket",
            "x-portless-hops": "5",
          },
        });
        req.on("error", () => resolve(true));
        req.on("close", () => resolve(true));
        req.on("upgrade", () => resolve(false));
        req.end();
      });

      expect(destroyed).toBe(true);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toContain("WebSocket loop detected");
    });

    it("detects loop with real proxy loop scenario", async () => {
      const routes: RouteInfo[] = [];
      const proxyServer = trackServer(
        createProxyServer({
          getRoutes: () => routes,
          proxyPort: TEST_PROXY_PORT,
          onError: () => {},
        })
      );
      await listen(proxyServer);
      const proxyAddr = proxyServer.address();
      if (!proxyAddr || typeof proxyAddr === "string") throw new Error("no addr");

      // Backend that proxies /api requests back through portless with the
      // same Host header (simulates Vite without changeOrigin: true)
      const loopingBackend = trackServer(
        http.createServer((req, res) => {
          if (req.url?.startsWith("/api")) {
            const proxyReq = http.request(
              {
                hostname: "127.0.0.1",
                port: proxyAddr.port,
                path: req.url,
                method: req.method,
                headers: { ...req.headers },
              },
              (proxyRes) => {
                res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
                proxyRes.pipe(res);
              }
            );
            proxyReq.on("error", () => {
              if (!res.headersSent) {
                res.writeHead(502);
                res.end("proxy error");
              }
            });
            req.pipe(proxyReq);
          } else {
            res.writeHead(200);
            res.end("frontend page");
          }
        })
      );
      await listen(loopingBackend);
      const backendAddr = loopingBackend.address();
      if (!backendAddr || typeof backendAddr === "string") throw new Error("no addr");

      routes.push({ hostname: "frontend.localhost", port: backendAddr.port });

      const res = await new Promise<{ status: number; body: string }>((resolve, reject) => {
        const req = http.request(
          {
            hostname: "127.0.0.1",
            port: proxyAddr.port,
            path: "/api/tasks",
            method: "GET",
            headers: { host: "frontend.localhost" },
          },
          (res) => {
            let body = "";
            res.on("data", (chunk) => (body += chunk));
            res.on("end", () => resolve({ status: res.statusCode!, body }));
          }
        );
        req.on("error", reject);
        req.setTimeout(5000, () => {
          req.destroy();
          reject(new Error("timeout - loop was not detected"));
        });
        req.end();
      });

      expect(res.status).toBe(508);
      const body = JSON.parse(res.body);
      expect(body.error).toBe("loop_detected");
      expect(body.upstream).toBe("frontend.localhost");
      expect(body.message).toContain("changeOrigin");
    });
  });

  describe("proxy error and routing fixes", () => {
    it("sends a JSON 508 with the fix in the message for non-browser clients", async () => {
      const server = trackServer(
        createProxyServer({
          getRoutes: () => [],
          proxyPort: TEST_PROXY_PORT,
          onError: () => {},
        })
      );
      await listen(server);

      const res = await request(server, {
        host: "frontend.localhost",
        accept: null,
        headers: { "x-portless-hops": "5" },
      });
      expect(res.status).toBe(508);
      expect(res.headers.vary).toBe("Accept");
      const body = JSON.parse(res.body);
      expect(body.error).toBe("loop_detected");
      expect(body.message).toContain("changeOrigin");
    });

    it.each([
      ["http1", undefined],
      ["h2c", "h2c" as const],
    ])("negotiates the 502 body for a dead %s upstream", async (_name, protocol) => {
      const port = await unusedPort();
      const routes: RouteInfo[] = [
        { hostname: "dead.localhost", port, ...(protocol ? { protocol } : {}) },
      ];
      const server = trackServer(
        createProxyServer({
          getRoutes: () => routes,
          proxyPort: TEST_PROXY_PORT,
          onError: () => {},
        })
      );
      await listen(server);

      const json = await request(server, { host: "dead.localhost", accept: null });
      expect(json.status).toBe(502);
      expect(json.headers["content-type"]).toBe("application/json; charset=utf-8");
      expect(json.headers.vary).toBe("Accept");
      expect(JSON.parse(json.body)).toMatchObject({
        error: "bad_gateway",
        upstream: "dead.localhost",
      });
      expect(JSON.parse(json.body).message).toContain(`127.0.0.1:${port}`);

      const html = await request(server, { host: "dead.localhost" });
      expect(html.status).toBe(502);
      expect(html.headers["content-type"]).toBe("text/html");
      expect(html.headers.vary).toBe("Accept");
      expect(html.body).toContain("Bad Gateway");
    });

    it.each([
      ["http1", undefined],
      ["h2c", "h2c" as const],
    ])("drains an undelivered request body after a %s 502", async (_name, protocol) => {
      const port = await unusedPort();
      const routes: RouteInfo[] = [
        { hostname: "dead.localhost", port, ...(protocol ? { protocol } : {}) },
      ];
      const server = trackServer(
        createProxyServer({
          getRoutes: () => routes,
          proxyPort: TEST_PROXY_PORT,
          onError: () => {},
        })
      );
      await listen(server);
      const addr = server.address();
      if (!addr || typeof addr === "string") throw new Error("no addr");

      const count = await pipelinedErrorResponses(
        () => net.connect(addr.port, "127.0.0.1"),
        "dead.localhost",
        502
      );
      expect(count).toBe(2);
    });

    it("does not forward keep-alive, proxy-connection, or upgrade headers", async () => {
      let seen: http.IncomingHttpHeaders = {};
      const backend = trackServer(
        http.createServer((req, res) => {
          seen = req.headers;
          res.end("ok");
        })
      );
      await listen(backend);
      const backendAddr = backend.address();
      if (!backendAddr || typeof backendAddr === "string") throw new Error("no addr");

      const routes: RouteInfo[] = [{ hostname: "myapp.localhost", port: backendAddr.port }];
      const server = trackServer(
        createProxyServer({ getRoutes: () => routes, proxyPort: TEST_PROXY_PORT })
      );
      await listen(server);

      for (const connection of ["keep-alive", "close"]) {
        const res = await request(server, {
          host: "myapp.localhost",
          headers: {
            connection,
            "keep-alive": "timeout=5",
            "proxy-connection": "keep-alive",
            upgrade: "h2c",
            "x-kept": "1",
          },
        });
        expect(res.status).toBe(200);
        expect(seen["x-kept"]).toBe("1");
        expect(seen["keep-alive"]).toBeUndefined();
        expect(seen["proxy-connection"]).toBeUndefined();
        expect(seen.upgrade).toBeUndefined();
      }
    });

    it("strips hop-by-hop headers from plain HTTP responses but keeps transfer-encoding", async () => {
      const backend = trackServer(
        http.createServer((_req, res) => {
          res.writeHead(200, {
            Connection: "keep-alive, X-Scoped",
            "Keep-Alive": "timeout=77",
            "Proxy-Connection": "keep-alive",
            Upgrade: "h2c",
            "X-Scoped": "backend-only",
            "X-Kept": "1",
          });
          res.write("chunk-one;");
          res.end("chunk-two");
        })
      );
      await listen(backend);
      const backendAddr = backend.address();
      if (!backendAddr || typeof backendAddr === "string") throw new Error("no addr");

      const routes: RouteInfo[] = [{ hostname: "myapp.localhost", port: backendAddr.port }];
      const server = trackServer(
        createProxyServer({ getRoutes: () => routes, proxyPort: TEST_PROXY_PORT })
      );
      await listen(server);

      const res = await request(server, { host: "myapp.localhost" });
      expect(res.status).toBe(200);
      expect(res.body).toBe("chunk-one;chunk-two");
      expect(res.headers["x-kept"]).toBe("1");
      expect(res.headers["x-scoped"]).toBeUndefined();
      // Node adds its own Keep-Alive for the client hop; the backend value must not leak.
      expect(res.headers["keep-alive"]).not.toBe("timeout=77");
      expect(res.headers["proxy-connection"]).toBeUndefined();
      expect(res.headers.upgrade).toBeUndefined();
      expect(res.headers["transfer-encoding"]).toBe("chunked");
    });

    it("does not relay a backend Connection: close to the client", async () => {
      const backend = trackServer(
        http.createServer((_req, res) => {
          res.writeHead(200, { Connection: "close", "Content-Length": "2" });
          res.end("ok");
        })
      );
      await listen(backend);
      const backendAddr = backend.address();
      if (!backendAddr || typeof backendAddr === "string") throw new Error("no addr");

      const routes: RouteInfo[] = [{ hostname: "myapp.localhost", port: backendAddr.port }];
      const server = trackServer(
        createProxyServer({ getRoutes: () => routes, proxyPort: TEST_PROXY_PORT })
      );
      await listen(server);

      const res = await request(server, {
        host: "myapp.localhost",
        headers: { connection: "keep-alive" },
      });
      expect(res.status).toBe(200);
      expect(res.headers.connection).not.toBe("close");
    });

    it("adds the hostname filter and uptime to the 404 page above five routes only", async () => {
      const now = Date.now();
      const makeRoutes = (count: number): RouteInfo[] =>
        Array.from({ length: count }, (_, i) => ({
          hostname: `app${i}.localhost`,
          port: 4000 + i,
          pid: 10 + i,
          registeredAt: now - (i + 1) * 60_000,
        }));
      let routes = makeRoutes(5);
      const server = trackServer(
        createProxyServer({ getRoutes: () => routes, proxyPort: TEST_PROXY_PORT })
      );
      await listen(server);

      const few = await request(server, { host: "missing.localhost" });
      expect(few.body).not.toContain('class="filter"');
      expect(few.body).not.toContain("Newest first");
      expect(few.body).toContain("up 1m");

      routes = makeRoutes(6);
      const many = await request(server, { host: "missing.localhost" });
      expect(many.body).toContain('class="filter"');
      expect(many.body).toContain("Newest first");
      expect(many.body).toContain('role="status"');
      expect(many.body).toContain("up 6m");
      expect(many.body).toContain(`data-registered-at="${now - 60_000}"`);
      expect(many.body).toContain("<script>");
    });

    describe("wildcard parent selection", () => {
      async function resolveWith(
        routes: RouteInfo[],
        host: string,
        requestPath = "/"
      ): Promise<string> {
        const server = trackServer(
          createProxyServer({
            getRoutes: () => routes,
            proxyPort: TEST_PROXY_PORT,
            strict: false,
          })
        );
        await listen(server);
        const res = await request(server, { host, path: requestPath });
        return res.status === 200 ? res.body : `status:${res.status}`;
      }

      async function backendFor(label: string): Promise<number> {
        const backend = trackServer(http.createServer((_req, res) => res.end(label)));
        await listen(backend);
        const addr = backend.address();
        if (!addr || typeof addr === "string") throw new Error("no addr");
        return addr.port;
      }

      it.each([
        ["shorter parent registered first", false],
        ["longer parent registered first", true],
      ])("picks the longest parent hostname when the %s", async (_name, longerFirst) => {
        const acme = { hostname: "acme.localhost", port: await backendFor("acme") };
        const api = { hostname: "api.acme.localhost", port: await backendFor("api") };
        const routes: RouteInfo[] = longerFirst ? [api, acme] : [acme, api];
        expect(await resolveWith(routes, "admin.api.acme.localhost")).toBe("api");
        expect(await resolveWith(routes, "tenant.acme.localhost")).toBe("acme");
      });

      it("prefers the longest parent, then the longest path prefix within it", async () => {
        const routes: RouteInfo[] = [
          { hostname: "acme.localhost", port: await backendFor("acme-root") },
          { hostname: "api.acme.localhost", port: await backendFor("api-root") },
          { hostname: "api.acme.localhost", port: await backendFor("api-v1"), pathPrefix: "/v1" },
        ];
        expect(await resolveWith(routes, "x.api.acme.localhost", "/v1/users")).toBe("api-v1");
        expect(await resolveWith(routes, "x.api.acme.localhost", "/other")).toBe("api-root");
      });

      it("falls back to a shorter parent when the longer parent has no matching path", async () => {
        const routes: RouteInfo[] = [
          { hostname: "acme.localhost", port: await backendFor("acme-root") },
          { hostname: "api.acme.localhost", port: await backendFor("api-v1"), pathPrefix: "/v1" },
        ];
        expect(await resolveWith(routes, "x.api.acme.localhost", "/other")).toBe("acme-root");
        expect(await resolveWith(routes, "x.api.acme.localhost", "/v1/a")).toBe("api-v1");
      });
    });
  });

  describe("custom TLD", () => {
    it("uses custom TLD in 404 page suggested command", async () => {
      const routes: RouteInfo[] = [];
      const server = trackServer(
        createProxyServer({ getRoutes: () => routes, proxyPort: TEST_PROXY_PORT, tld: "test" })
      );
      await listen(server);

      const res = await request(server, { host: "unknown.test" });
      expect(res.status).toBe(404);
      expect(res.body).toContain("unknown.test");
      expect(res.body).toContain("portless unknown your-command");
    });

    it("uses custom TLD in 508 loop detection page", async () => {
      const backend = trackServer(
        http.createServer((_req, res) => {
          res.writeHead(200);
          res.end("ok");
        })
      );
      await listen(backend);
      const backendAddr = backend.address();
      if (!backendAddr || typeof backendAddr === "string") throw new Error("no addr");

      const routes: RouteInfo[] = [{ hostname: "app.test", port: backendAddr.port }];
      const server = trackServer(
        createProxyServer({
          getRoutes: () => routes,
          proxyPort: TEST_PROXY_PORT,
          tld: "test",
          onError: () => {},
        })
      );
      await listen(server);

      const addr = server.address();
      if (!addr || typeof addr === "string") throw new Error("no addr");

      const res = await new Promise<{ status: number; body: string }>((resolve, reject) => {
        const req = http.request(
          {
            hostname: "127.0.0.1",
            port: addr.port,
            path: "/",
            method: "GET",
            headers: {
              host: "app.test",
              accept: "text/html",
              "x-portless-hops": "5",
            },
          },
          (res) => {
            let body = "";
            res.on("data", (chunk) => (body += chunk));
            res.on("end", () => resolve({ status: res.statusCode!, body }));
          }
        );
        req.on("error", reject);
        req.end();
      });

      expect(res.status).toBe(508);
      expect(res.body).toContain(".test");
    });

    it("routes requests with custom TLD hostnames", async () => {
      const backend = trackServer(
        http.createServer((_req, res) => {
          res.writeHead(200, { "Content-Type": "text/plain" });
          res.end("custom tld hit");
        })
      );
      await listen(backend);
      const backendAddr = backend.address();
      if (!backendAddr || typeof backendAddr === "string") throw new Error("no addr");

      const routes: RouteInfo[] = [{ hostname: "myapp.test", port: backendAddr.port }];
      const server = trackServer(
        createProxyServer({ getRoutes: () => routes, proxyPort: TEST_PROXY_PORT, tld: "test" })
      );
      await listen(server);

      const res = await request(server, { host: "myapp.test" });
      expect(res.status).toBe(200);
      expect(res.body).toBe("custom tld hit");
    });

    it("supports dotted suffixes", async () => {
      const backend = trackServer(
        http.createServer((_req, res) => {
          res.writeHead(200, { "Content-Type": "text/plain" });
          res.end("custom domain hit");
        })
      );
      await listen(backend);
      const backendAddr = backend.address();
      if (!backendAddr || typeof backendAddr === "string") throw new Error("no addr");

      const routes: RouteInfo[] = [{ hostname: "myapp.server01.acme.com", port: backendAddr.port }];
      const server = trackServer(
        createProxyServer({
          getRoutes: () => routes,
          proxyPort: TEST_PROXY_PORT,
          tld: "server01.acme.com",
        })
      );
      await listen(server);

      const res = await request(server, { host: "myapp.server01.acme.com" });
      expect(res.status).toBe(200);
      expect(res.body).toBe("custom domain hit");
    });

    it("uses the longest configured suffix in 404 command suggestions", async () => {
      const server = trackServer(
        createProxyServer({
          getRoutes: () => [],
          proxyPort: TEST_PROXY_PORT,
          tld: "example.com",
          tlds: ["example.com", "dev.example.com"],
        })
      );
      await listen(server);

      const res = await request(server, { host: "missing.dev.example.com" });
      expect(res.status).toBe(404);
      expect(res.body).toContain("portless missing your-command");
      expect(res.body).not.toContain("portless missing.dev your-command");
    });

    it("reserves internal pages on secondary configured suffixes", async () => {
      const server = trackServer(
        createProxyServer({
          getRoutes: () => [{ hostname: "portless.test", port: 65534 }],
          proxyPort: TEST_PROXY_PORT,
          tlds: ["localhost", "test"],
        })
      );
      await listen(server);

      const res = await request(server, { host: "portless.test" });
      expect(res.status).toBe(200);
      expect(res.body).toContain("portless");
    });
  });

  describe("XSS safety", () => {
    it("escapes hostname in 404 page", async () => {
      const routes: RouteInfo[] = [];
      const server = trackServer(
        createProxyServer({ getRoutes: () => routes, proxyPort: TEST_PROXY_PORT })
      );
      await listen(server);

      // The proxy extracts hostname from the Host header before the colon.
      // A name under a configured suffix reaches the 404 page; a foreign name
      // reaches the 421 page. Both must escape it.
      for (const [host, status] of [
        ["<script>alert(1)</script>.localhost", 404],
        ["<script>alert(1)</script>", 421],
      ] as const) {
        const res = await request(server, { host });
        expect(res.status).toBe(status);
        expect(res.body).not.toContain("<script>alert(1)</script>");
        expect(res.body).toContain("&lt;script&gt;");
      }
    });

    it("escapes route hostnames in active apps list", async () => {
      // Route hostnames come from the route store, but defense-in-depth matters
      const routes: RouteInfo[] = [{ hostname: '<img src=x onerror="alert(1)">', port: 4001 }];
      const server = trackServer(
        createProxyServer({ getRoutes: () => routes, proxyPort: TEST_PROXY_PORT })
      );
      await listen(server);

      const res = await request(server, { host: "other.localhost" });
      expect(res.status).toBe(404);
      expect(res.body).not.toContain("<img src=x");
      expect(res.body).toContain("&lt;img");
    });
  });

  describe("WebSocket upgrade", () => {
    it("ends the upstream socket when the client aborts before the handshake", async () => {
      let resolveUpstreamSocket!: (socket: Duplex) => void;
      const upstreamSocketPromise = new Promise<Duplex>((resolve) => {
        resolveUpstreamSocket = resolve;
      });
      const backend = trackServer(http.createServer());
      backend.on("upgrade", (_req, socket) => {
        socket.resume();
        resolveUpstreamSocket(socket);
      });
      await listen(backend);
      const backendAddr = backend.address();
      if (!backendAddr || typeof backendAddr === "string") throw new Error("no addr");

      const routes: RouteInfo[] = [{ hostname: "ws.localhost", port: backendAddr.port }];
      const server = trackServer(
        createProxyServer({
          getRoutes: () => routes,
          proxyPort: TEST_PROXY_PORT,
          onError: () => {},
        })
      );
      await listen(server);
      const addr = server.address();
      if (!addr || typeof addr === "string") throw new Error("no addr");

      const clientSocket = net.connect(addr.port, "127.0.0.1");
      await new Promise<void>((resolve, reject) => {
        clientSocket.once("connect", resolve);
        clientSocket.once("error", reject);
      });
      clientSocket.write(
        "GET / HTTP/1.1\r\n" +
          "Host: ws.localhost\r\n" +
          "Connection: Upgrade\r\n" +
          "Upgrade: websocket\r\n" +
          "\r\n"
      );

      const upstreamSocket = await upstreamSocketPromise;
      const upstreamEnded = new Promise<boolean>((resolve) => {
        upstreamSocket.once("end", () => resolve(true));
      });
      clientSocket.resetAndDestroy();

      const endedBeforeDeadline = await Promise.race([
        upstreamEnded,
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 1_000)),
      ]);
      upstreamSocket.destroy();

      expect(endedBeforeDeadline).toBe(true);
    });

    it("times out a stalled backend WebSocket handshake", async () => {
      let resolveUpstreamSocket!: (socket: Duplex) => void;
      const upstreamSocketPromise = new Promise<Duplex>((resolve) => {
        resolveUpstreamSocket = resolve;
      });
      const backend = trackServer(http.createServer());
      backend.on("upgrade", (_req, socket) => resolveUpstreamSocket(socket));
      await listen(backend);
      const backendAddr = backend.address();
      if (!backendAddr || typeof backendAddr === "string") throw new Error("no addr");

      const routes: RouteInfo[] = [{ hostname: "ws.localhost", port: backendAddr.port }];
      const errors: string[] = [];
      const server = trackServer(
        createProxyServer({
          getRoutes: () => routes,
          proxyPort: TEST_PROXY_PORT,
          onError: (message) => errors.push(message),
        })
      );
      await listen(server);
      const addr = server.address();
      if (!addr || typeof addr === "string") throw new Error("no addr");

      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      const clientSocket = net.connect(addr.port, "127.0.0.1");
      await new Promise<void>((resolve, reject) => {
        clientSocket.once("connect", resolve);
        clientSocket.once("error", reject);
      });
      clientSocket.write(
        "GET / HTTP/1.1\r\n" +
          "Host: ws.localhost\r\n" +
          "Connection: Upgrade\r\n" +
          "Upgrade: websocket\r\n" +
          "\r\n"
      );
      const upstreamSocket = await upstreamSocketPromise;
      const clientClosed = new Promise<void>((resolve) => clientSocket.once("close", resolve));

      await vi.advanceTimersByTimeAsync(30_000);
      await clientClosed;

      expect(clientSocket.destroyed).toBe(true);
      expect(errors.some((message) => message.includes("handshake timed out"))).toBe(true);
      upstreamSocket.destroy();
    });

    it("keeps a relayed WebSocket alive past the handshake timeout and forwards data", async () => {
      let backendSocket: Duplex | undefined;
      const backend = trackServer(http.createServer());
      backend.on("upgrade", (_req, socket) => {
        backendSocket = socket;
        socket.write(
          "HTTP/1.1 101 Switching Protocols\r\n" +
            "Upgrade: websocket\r\n" +
            "Connection: Upgrade\r\n" +
            "\r\n"
        );
        socket.on("data", (chunk) => socket.write(`backend:${chunk.toString("utf8")}`));
      });
      await listen(backend);
      const backendAddr = backend.address();
      if (!backendAddr || typeof backendAddr === "string") throw new Error("no addr");

      const routes: RouteInfo[] = [{ hostname: "ws.localhost", port: backendAddr.port }];
      const errors: string[] = [];
      const server = trackServer(
        createProxyServer({
          getRoutes: () => routes,
          proxyPort: TEST_PROXY_PORT,
          onError: (message) => errors.push(message),
        })
      );
      await listen(server);
      const addr = server.address();
      if (!addr || typeof addr === "string") throw new Error("no addr");

      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      const clientSocket = await new Promise<Duplex>((resolve, reject) => {
        const req = http.request({
          hostname: "127.0.0.1",
          port: addr.port,
          path: "/",
          headers: {
            host: "ws.localhost",
            connection: "Upgrade",
            upgrade: "websocket",
          },
        });
        req.once("error", reject);
        req.once("upgrade", (_res, socket) => resolve(socket));
        req.end();
      });
      const echoed = new Promise<string>((resolve) => {
        clientSocket.once("data", (chunk) => resolve(chunk.toString("utf8")));
      });
      clientSocket.write("client-frame");

      expect(await echoed).toBe("backend:client-frame");
      await vi.advanceTimersByTimeAsync(30_000);
      expect(clientSocket.destroyed).toBe(false);
      expect(errors.some((message) => message.includes("handshake timed out"))).toBe(false);

      clientSocket.destroy();
      backendSocket?.destroy();
    });

    it("proxies WebSocket upgrade to matching route", async () => {
      // Create a backend that accepts WebSocket upgrades
      const backend = trackServer(http.createServer());
      backend.on("upgrade", (req, socket) => {
        socket.write(
          "HTTP/1.1 101 Switching Protocols\r\n" +
            "Upgrade: websocket\r\n" +
            "Connection: Upgrade\r\n" +
            "\r\n"
        );
        socket.end();
      });
      await listen(backend);
      const backendAddr = backend.address();
      if (!backendAddr || typeof backendAddr === "string") throw new Error("no addr");

      const routes: RouteInfo[] = [{ hostname: "ws.localhost", port: backendAddr.port }];
      const server = trackServer(
        createProxyServer({ getRoutes: () => routes, proxyPort: TEST_PROXY_PORT })
      );
      await listen(server);

      const addr = server.address();
      if (!addr || typeof addr === "string") throw new Error("no addr");

      const upgraded = await new Promise<boolean>((resolve) => {
        const req = http.request({
          hostname: "127.0.0.1",
          port: addr.port,
          path: "/",
          headers: {
            host: "ws.localhost",
            connection: "Upgrade",
            upgrade: "websocket",
          },
        });
        req.on("error", () => resolve(false));
        req.on("upgrade", () => resolve(true));
        req.setTimeout(2000, () => {
          req.destroy();
          resolve(false);
        });
        req.end();
      });

      expect(upgraded).toBe(true);
    });

    it("forwards backend Sec-WebSocket-Accept and custom headers", async () => {
      const testAcceptValue = "dGhlIHNhbXBsZSBub25jZQ==";
      const testProtocol = "graphql-ws";

      const backend = trackServer(http.createServer());
      backend.on("upgrade", (_req, socket) => {
        socket.write(
          "HTTP/1.1 101 Switching Protocols\r\n" +
            "Upgrade: websocket\r\n" +
            "Connection: Upgrade\r\n" +
            `Sec-WebSocket-Accept: ${testAcceptValue}\r\n` +
            `Sec-WebSocket-Protocol: ${testProtocol}\r\n` +
            "\r\n"
        );
        socket.end();
      });
      await listen(backend);
      const backendAddr = backend.address();
      if (!backendAddr || typeof backendAddr === "string") throw new Error("no addr");

      const routes: RouteInfo[] = [{ hostname: "ws.localhost", port: backendAddr.port }];
      const server = trackServer(
        createProxyServer({ getRoutes: () => routes, proxyPort: TEST_PROXY_PORT })
      );
      await listen(server);

      const addr = server.address();
      if (!addr || typeof addr === "string") throw new Error("no addr");

      const result = await new Promise<{
        upgraded: boolean;
        accept?: string;
        protocol?: string;
      }>((resolve) => {
        const req = http.request({
          hostname: "127.0.0.1",
          port: addr.port,
          path: "/",
          headers: {
            host: "ws.localhost",
            connection: "Upgrade",
            upgrade: "websocket",
          },
        });
        req.on("error", () => resolve({ upgraded: false }));
        req.on("upgrade", (res) => {
          resolve({
            upgraded: true,
            accept: res.headers["sec-websocket-accept"],
            protocol: res.headers["sec-websocket-protocol"],
          });
        });
        req.setTimeout(2000, () => {
          req.destroy();
          resolve({ upgraded: false });
        });
        req.end();
      });

      expect(result.upgraded).toBe(true);
      expect(result.accept).toBe(testAcceptValue);
      expect(result.protocol).toBe(testProtocol);
    });

    it("returns 502 when the backend sends malformed handshake data", async () => {
      const backend = trackServer(
        net.createServer((socket) => {
          socket.once("data", () => socket.end("Unauthorized"));
        })
      );
      await listen(backend);
      const backendAddr = backend.address();
      if (!backendAddr || typeof backendAddr === "string") throw new Error("no addr");

      const routes: RouteInfo[] = [{ hostname: "ws.localhost", port: backendAddr.port }];
      const server = trackServer(
        createProxyServer({ getRoutes: () => routes, proxyPort: TEST_PROXY_PORT })
      );
      await listen(server);

      const addr = server.address();
      if (!addr || typeof addr === "string") throw new Error("no addr");

      const response = await new Promise<{ status: number; body: string }>((resolve, reject) => {
        const req = http.request(
          {
            hostname: "127.0.0.1",
            port: addr.port,
            path: "/",
            headers: {
              host: "ws.localhost",
              connection: "Upgrade",
              upgrade: "websocket",
            },
          },
          (res) => {
            let body = "";
            res.on("data", (chunk: Buffer) => (body += chunk.toString("utf8")));
            res.on("end", () => resolve({ status: res.statusCode!, body }));
          }
        );
        req.on("error", reject);
        req.setTimeout(2000, () => {
          req.destroy(new Error("timed out waiting for malformed handshake response"));
        });
        req.end();
      });

      expect(response.status).toBe(502);
      expect(response.body).toContain("Bad Gateway");
    });

    it("destroys socket for unknown host on upgrade", async () => {
      const routes: RouteInfo[] = [];
      const server = trackServer(
        createProxyServer({ getRoutes: () => routes, proxyPort: TEST_PROXY_PORT })
      );
      await listen(server);

      const addr = server.address();
      if (!addr || typeof addr === "string") throw new Error("no addr");

      // Attempt a WebSocket upgrade to an unknown host
      const destroyed = await new Promise<boolean>((resolve) => {
        const req = http.request({
          hostname: "127.0.0.1",
          port: addr.port,
          path: "/",
          headers: {
            host: "unknown.localhost",
            connection: "Upgrade",
            upgrade: "websocket",
          },
        });
        req.on("error", () => resolve(true));
        req.on("close", () => resolve(true));
        req.on("upgrade", () => resolve(false));
        req.end();
      });

      expect(destroyed).toBe(true);
    });

    it("proxies requests to an h2c upstream when the route opts in", async () => {
      const backend = trackServer(
        http2.createServer((req, res) => {
          res.stream.respond({
            ":status": 200,
            "content-type": "application/json",
            "x-backend-protocol": "h2c",
          });
          res.end(
            JSON.stringify({
              method: req.method,
              path: req.url,
              authority: req.headers[":authority"],
              host: req.headers.host,
              forwardedHost: req.headers["x-forwarded-host"],
              hops: req.headers["x-portless-hops"],
            })
          );
        })
      );
      await listen(backend);
      const backendAddr = backend.address();
      if (!backendAddr || typeof backendAddr === "string") throw new Error("no addr");

      const routes: RouteInfo[] = [
        { hostname: "grpc.localhost", port: backendAddr.port, protocol: "h2c" },
      ];
      const server = trackServer(
        createProxyServer({ getRoutes: () => routes, proxyPort: TEST_PROXY_PORT })
      );
      await listen(server);

      const res = await request(server, { host: "grpc.localhost", path: "/Greeter/SayHello" });
      const payload = JSON.parse(res.body) as Record<string, string>;

      expect(res.status).toBe(200);
      expect(res.headers["x-backend-protocol"]).toBe("h2c");
      expect(payload).toMatchObject({
        method: "GET",
        path: "/Greeter/SayHello",
        authority: "grpc.localhost",
        forwardedHost: "grpc.localhost",
        hops: "1",
      });
      expect(payload.host).toBeUndefined();
    });

    it("proxies request bodies and trailers for h2c upstreams", async () => {
      const backend = trackServer(http2.createServer());
      backend.on("stream", (stream: http2.ServerHttp2Stream) => {
        let body = "";
        stream.on("data", (chunk) => {
          body += chunk;
        });
        stream.on("end", () => {
          stream.respond(
            {
              ":status": 200,
              "content-type": "text/plain",
              trailer: "grpc-status",
            },
            { waitForTrailers: true }
          );
          stream.on("wantTrailers", () => {
            stream.sendTrailers({ "grpc-status": "0" });
          });
          stream.end(body);
        });
      });
      await listen(backend);
      const backendAddr = backend.address();
      if (!backendAddr || typeof backendAddr === "string") throw new Error("no addr");

      const routes: RouteInfo[] = [
        { hostname: "grpc.localhost", port: backendAddr.port, protocol: "h2c" },
      ];
      const server = trackServer(
        createProxyServer({ getRoutes: () => routes, proxyPort: TEST_PROXY_PORT })
      );
      await listen(server);

      const res = await request(server, {
        host: "grpc.localhost",
        path: "/grpc.Service/Call",
        method: "POST",
        headers: { "content-type": "application/grpc", te: "trailers" },
        body: "grpc-body",
      });

      expect(res.status).toBe(200);
      expect(res.body).toBe("grpc-body");
      expect(res.trailers["grpc-status"]).toBe("0");
    });
  });
});

describe("createProxyServer with TLS (HTTP/2)", () => {
  let tlsCert: Buffer;
  let tlsKey: Buffer;
  let certDir: string;
  const servers: AnyServer[] = [];

  function trackServer<T extends AnyServer>(server: T): T {
    servers.push(server);
    return server;
  }

  beforeAll(() => {
    certDir = fs.mkdtempSync(path.join(os.tmpdir(), "portless-proxy-test-"));
    const certs = ensureCerts(certDir);
    tlsCert = fs.readFileSync(certs.certPath);
    tlsKey = fs.readFileSync(certs.keyPath);
  }, 30_000);

  afterAll(() => {
    fs.rmSync(certDir, { recursive: true, force: true });
  });

  afterEach(async () => {
    // Force-close all servers with a timeout to avoid hanging on open HTTP/2 sessions
    await Promise.all(
      servers.map(
        (s) =>
          new Promise<void>((resolve) => {
            s.close(() => resolve());
            // Force resolve after 1s if connections don't drain
            setTimeout(resolve, 1000);
          })
      )
    );
    servers.length = 0;
  });

  function httpsRequest(
    server: AnyServer,
    options: { host?: string; path?: string; method?: string; accept?: string | null }
  ): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
    return new Promise((resolve, reject) => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        return reject(new Error("Server not listening"));
      }
      const headers: Record<string, string> = { host: options.host || "" };
      if (options.accept !== null) {
        headers.accept = options.accept ?? "text/html";
      }
      const req = https.request(
        {
          hostname: "127.0.0.1",
          port: addr.port,
          path: options.path || "/",
          method: options.method || "GET",
          headers,
          rejectUnauthorized: false,
        },
        (res) => {
          let body = "";
          res.on("data", (chunk: Buffer) => (body += chunk));
          res.on("end", () => resolve({ status: res.statusCode!, headers: res.headers, body }));
        }
      );
      req.on("error", reject);
      req.end();
    });
  }

  function openH2WebSocket(
    server: AnyServer,
    headers: http2.OutgoingHttpHeaders,
    onResponse?: (stream: http2.ClientHttp2Stream) => void
  ): Promise<{
    status: number;
    headers: http2.IncomingHttpHeaders;
    data: Buffer;
    closed: boolean;
  }> {
    return new Promise((resolve, reject) => {
      const addr = server.address();
      if (!addr || typeof addr === "string") return reject(new Error("no addr"));
      const client = http2.connect(`https://127.0.0.1:${addr.port}`, {
        rejectUnauthorized: false,
      });
      let settled = false;
      const finish = (result: {
        status: number;
        headers: http2.IncomingHttpHeaders;
        data: Buffer;
        closed: boolean;
      }) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        client.close();
        resolve(result);
      };
      const timeout = setTimeout(() => {
        finish({ status: 0, headers: {}, data: Buffer.alloc(0), closed: false });
      }, 3000);

      client.on("error", reject);
      client.on("remoteSettings", () => {
        let stream: http2.ClientHttp2Stream;
        try {
          stream = client.request(
            {
              ":method": "CONNECT",
              ":protocol": "websocket",
              ":scheme": "https",
              "sec-websocket-version": "13",
              "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
              ...headers,
            },
            { endStream: false }
          );
        } catch (err) {
          clearTimeout(timeout);
          client.close();
          reject(err);
          return;
        }
        let status = 0;
        let receivedHeaders: http2.IncomingHttpHeaders = {};
        const chunks: Buffer[] = [];
        stream.on("response", (headers) => {
          status = Number(headers[":status"]) || 0;
          receivedHeaders = headers;
          onResponse?.(stream);
        });
        stream.on("data", (chunk: Buffer) => chunks.push(chunk));
        stream.on("error", () => {});
        stream.on("close", () => {
          finish({ status, headers: receivedHeaders, data: Buffer.concat(chunks), closed: true });
        });
      });
    });
  }

  function websocketEchoBackend(onUpgrade?: (req: http.IncomingMessage) => void): http.Server {
    const backend = trackServer(http.createServer());
    backend.on("upgrade", (req, socket) => {
      onUpgrade?.(req);
      const key = req.headers["sec-websocket-key"] as string;
      socket.write(
        "HTTP/1.1 101 Switching Protocols\r\n" +
          "Upgrade: websocket\r\n" +
          "Connection: Upgrade\r\n" +
          `Sec-WebSocket-Accept: ${computeWebSocketAccept(key)}\r\n` +
          (req.headers["sec-websocket-protocol"]
            ? `Sec-WebSocket-Protocol: ${req.headers["sec-websocket-protocol"]}\r\n`
            : "") +
          "\r\n"
      );
      socket.on("data", (chunk: Buffer) => socket.write(chunk));
    });
    return backend;
  }

  it("creates an HTTPS server that responds to requests", async () => {
    const routes: RouteInfo[] = [];
    const server = trackServer(
      createProxyServer({
        getRoutes: () => routes,
        proxyPort: TEST_PROXY_PORT,
        tls: { cert: tlsCert, key: tlsKey },
      })
    );
    await listen(server);

    const res = await httpsRequest(server, { host: "unknown.localhost" });
    expect(res.status).toBe(404);
    expect(res.body).toContain("Not Found");
  });

  it("includes X-Portless header on TLS responses", async () => {
    const routes: RouteInfo[] = [];
    const server = trackServer(
      createProxyServer({
        getRoutes: () => routes,
        proxyPort: TEST_PROXY_PORT,
        tls: { cert: tlsCert, key: tlsKey },
      })
    );
    await listen(server);
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("no addr");

    const res = await httpsRequest(server, { host: "unknown.localhost" });
    expect(res.headers[PORTLESS_HEADER.toLowerCase()]).toBe("1");
    expect(res.headers[PORTLESS_LISTENER_PORT_HEADER.toLowerCase()]).toBe(String(addr.port));
  });

  it("proxies HTTPS request to matching route", async () => {
    const backend = trackServer(
      http.createServer((_req, res) => {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("hello from backend via h2");
      })
    );
    await listen(backend);
    const backendAddr = backend.address();
    if (!backendAddr || typeof backendAddr === "string") throw new Error("no addr");

    const routes: RouteInfo[] = [{ hostname: "myapp.localhost", port: backendAddr.port }];
    const server = trackServer(
      createProxyServer({
        getRoutes: () => routes,
        proxyPort: TEST_PROXY_PORT,
        tls: { cert: tlsCert, key: tlsKey },
      })
    );
    await listen(server);

    const res = await httpsRequest(server, { host: "myapp.localhost" });
    expect(res.status).toBe(200);
    expect(res.body).toBe("hello from backend via h2");
  });

  it("destroys pooled upstream sockets when the TLS wrapper closes", async () => {
    let upstreamSocket: net.Socket | undefined;
    let resolveClosed: (() => void) | undefined;
    const upstreamClosed = new Promise<void>((resolve) => {
      resolveClosed = resolve;
    });
    const backend = trackServer(http.createServer((_req, res) => res.end("ok")));
    backend.on("connection", (socket) => {
      upstreamSocket = socket;
      socket.once("close", () => resolveClosed?.());
    });
    await listen(backend);
    const backendAddr = backend.address();
    if (!backendAddr || typeof backendAddr === "string") throw new Error("no addr");

    const routes: RouteInfo[] = [{ hostname: "myapp.localhost", port: backendAddr.port }];
    const server = trackServer(
      createProxyServer({
        getRoutes: () => routes,
        proxyPort: TEST_PROXY_PORT,
        tls: { cert: tlsCert, key: tlsKey },
      })
    );
    await listen(server);
    await httpsRequest(server, { host: "myapp.localhost" });

    try {
      server.close();
      await Promise.race([
        upstreamClosed,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("TLS upstream socket stayed open")), 500)
        ),
      ]);
    } finally {
      upstreamSocket?.destroy();
    }
  });

  it("supports HTTP/2 connections", async () => {
    const routes: RouteInfo[] = [];
    const server = trackServer(
      createProxyServer({
        getRoutes: () => routes,
        proxyPort: TEST_PROXY_PORT,
        tls: { cert: tlsCert, key: tlsKey },
      })
    );
    await listen(server);

    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("no addr");

    const result = await new Promise<{ status: number; protocol: string }>((resolve, reject) => {
      const client = http2.connect(`https://127.0.0.1:${addr.port}`, {
        rejectUnauthorized: false,
      });
      client.on("error", reject);

      const req = client.request({
        ":method": "GET",
        ":path": "/",
        host: "test.localhost",
      });

      req.on("response", (headers) => {
        const status = headers[":status"] as number;
        req.close();
        client.close();
        resolve({ status, protocol: "h2" });
      });

      req.on("error", reject);
      req.end();
    });

    expect(result.status).toBe(404);
    expect(result.protocol).toBe("h2");
  });

  it("frames h2 request bodies sent without content-length", async () => {
    const received: { method?: string; te?: string; body: string }[] = [];
    const clientErrors: string[] = [];
    const backend = trackServer(
      http.createServer((req, res) => {
        let body = "";
        req.on("data", (chunk) => (body += chunk));
        req.on("end", () => {
          received.push({ method: req.method, te: req.headers["transfer-encoding"], body });
          res.end("ok");
        });
      })
    );
    backend.on("clientError", (err: NodeJS.ErrnoException, socket: net.Socket) => {
      clientErrors.push(err.code ?? err.message);
      socket.destroy();
    });
    await listen(backend);
    const backendAddr = backend.address();
    if (!backendAddr || typeof backendAddr === "string") throw new Error("no addr");

    const routes: RouteInfo[] = [{ hostname: "myapp.localhost", port: backendAddr.port }];
    const server = trackServer(
      createProxyServer({
        getRoutes: () => routes,
        proxyPort: TEST_PROXY_PORT,
        tls: { cert: tlsCert, key: tlsKey },
      })
    );
    await listen(server);
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("no addr");

    const client = http2.connect(`https://127.0.0.1:${addr.port}`, { rejectUnauthorized: false });
    const send = (method: string, body?: string, headers: http2.OutgoingHttpHeaders = {}) =>
      new Promise<number>((resolve, reject) => {
        const req = client.request(
          { ":method": method, ":path": "/", ":authority": "myapp.localhost", ...headers },
          { endStream: body === undefined }
        );
        req.on("response", (headers) => resolve(headers[":status"] as number));
        req.on("error", reject);
        req.resume();
        if (body !== undefined) req.end(body);
      });

    try {
      expect(await send("DELETE", '{"id":1}')).toBe(200);
      expect(await send("GET", "x")).toBe(200);
      expect(await send("GET")).toBe(200);
      expect(await send("DELETE", "{}", { "content-length": "2" })).toBe(200);
    } finally {
      client.close();
    }

    expect(clientErrors).toEqual([]);
    expect(received).toEqual([
      { method: "DELETE", te: "chunked", body: '{"id":1}' },
      { method: "GET", te: "chunked", body: "x" },
      { method: "GET", te: undefined, body: "" },
      { method: "DELETE", te: undefined, body: "{}" },
    ]);
  });

  it("drains an undelivered request body after a 502 over TLS HTTP/1.1", async () => {
    const port = await unusedPort();
    const routes: RouteInfo[] = [{ hostname: "dead.localhost", port }];
    const server = trackServer(
      createProxyServer({
        getRoutes: () => routes,
        proxyPort: TEST_PROXY_PORT,
        tls: { cert: tlsCert, key: tlsKey },
        onError: () => {},
      })
    );
    await listen(server);
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("no addr");

    const count = await pipelinedErrorResponses(
      () =>
        tls.connect({
          port: addr.port,
          host: "127.0.0.1",
          rejectUnauthorized: false,
          ALPNProtocols: ["http/1.1"],
        }),
      "dead.localhost",
      502
    );
    expect(count).toBe(2);
  });

  it("does not let an h2 GET body run as a second request on a pooled backend socket", async () => {
    const seen: { url?: string; forwardedFor?: string }[] = [];
    const backend = trackServer(
      http.createServer((req, res) => {
        seen.push({ url: req.url, forwardedFor: req.headers["x-forwarded-for"] as string });
        req.resume();
        req.on("end", () => res.end("ok"));
      })
    );
    await listen(backend);
    const backendAddr = backend.address();
    if (!backendAddr || typeof backendAddr === "string") throw new Error("no addr");

    const routes: RouteInfo[] = [{ hostname: "myapp.localhost", port: backendAddr.port }];
    const server = trackServer(
      createProxyServer({
        getRoutes: () => routes,
        proxyPort: TEST_PROXY_PORT,
        tls: { cert: tlsCert, key: tlsKey },
      })
    );
    await listen(server);
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("no addr");

    const client = http2.connect(`https://127.0.0.1:${addr.port}`, { rejectUnauthorized: false });
    const send = (path: string, body?: string) =>
      new Promise<number>((resolve, reject) => {
        const req = client.request(
          { ":method": "GET", ":path": path, ":authority": "myapp.localhost" },
          { endStream: body === undefined }
        );
        req.on("response", (headers) => resolve(headers[":status"] as number));
        req.on("error", reject);
        req.resume();
        if (body !== undefined) req.end(body);
      });

    try {
      // Warm the pool so the smuggling attempt rides a reused keep-alive socket.
      expect(await send("/warm")).toBe(200);
      expect(await send("/first", "GET /smuggled HTTP/1.1\r\nHost: myapp.localhost\r\n\r\n")).toBe(
        200
      );
      expect(await send("/second")).toBe(200);
    } finally {
      client.close();
    }

    expect(seen.map((entry) => entry.url)).toEqual(["/warm", "/first", "/second"]);
    for (const entry of seen) expect(entry.forwardedFor).toBeDefined();
  });

  it("replays a bodyless h2 GET but never an h2 GET that carried DATA", async () => {
    const handled = new WeakMap<net.Socket, number>();
    let requests = 0;
    let resets = 0;
    const backend = trackServer(
      http.createServer((req, res) => {
        requests++;
        const count = (handled.get(req.socket) ?? 0) + 1;
        handled.set(req.socket, count);
        if (count === 1) {
          req.resume();
          req.on("end", () => res.end("ok"));
          return;
        }
        resets++;
        req.socket.resetAndDestroy();
      })
    );
    await listen(backend);
    const backendAddr = backend.address();
    if (!backendAddr || typeof backendAddr === "string") throw new Error("no addr");

    const errors: string[] = [];
    const routes: RouteInfo[] = [{ hostname: "myapp.localhost", port: backendAddr.port }];
    const server = trackServer(
      createProxyServer({
        getRoutes: () => routes,
        proxyPort: TEST_PROXY_PORT,
        tls: { cert: tlsCert, key: tlsKey },
        onError: (message) => errors.push(message),
      })
    );
    await listen(server);
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("no addr");

    const client = http2.connect(`https://127.0.0.1:${addr.port}`, { rejectUnauthorized: false });
    const send = (body?: string) =>
      new Promise<number>((resolve, reject) => {
        const req = client.request(
          { ":method": "GET", ":path": "/", ":authority": "myapp.localhost" },
          { endStream: body === undefined }
        );
        req.on("response", (headers) => resolve(headers[":status"] as number));
        req.on("error", reject);
        req.resume();
        if (body !== undefined) req.end(body);
      });

    try {
      // 1: fresh socket, ok. 2: reused socket resets, headers-only GET is replayed.
      expect(await send()).toBe(200);
      expect(await send()).toBe(200);
      expect(requests).toBe(3);
      expect(resets).toBe(1);
      expect(errors).toEqual([]);

      // 3: reused socket resets and the body was already consumed, so no replay.
      expect(await send("payload")).toBe(502);
      expect(requests).toBe(4);
      expect(resets).toBe(2);
      expect(errors).toHaveLength(1);
    } finally {
      client.close();
    }
  });

  it("forwards the :authority hostname as Host to the backend (h2 -> HTTP/1.1)", async () => {
    let receivedHost = "";
    const backend = trackServer(
      http.createServer((req, res) => {
        receivedHost = req.headers.host || "";
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("ok");
      })
    );
    await listen(backend);
    const backendAddr = backend.address();
    if (!backendAddr || typeof backendAddr === "string") throw new Error("no addr");

    const routes: RouteInfo[] = [{ hostname: "myapp.localhost", port: backendAddr.port }];
    const server = trackServer(
      createProxyServer({
        getRoutes: () => routes,
        proxyPort: TEST_PROXY_PORT,
        tls: { cert: tlsCert, key: tlsKey },
      })
    );
    await listen(server);

    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("no addr");

    const status = await new Promise<number>((resolve, reject) => {
      const client = http2.connect(`https://127.0.0.1:${addr.port}`, {
        rejectUnauthorized: false,
      });
      client.on("error", reject);
      // Real h2 clients (browsers, curl) send only :authority — no Host header.
      const req = client.request({
        ":method": "GET",
        ":path": "/",
        ":authority": "myapp.localhost",
      });
      req.on("response", (headers) => {
        const s = headers[":status"] as number;
        req.resume();
        req.on("end", () => {
          client.close();
          resolve(s);
        });
      });
      req.on("error", reject);
      req.end();
    });

    expect(status).toBe(200);
    expect(receivedHost).toBe("myapp.localhost");
  });

  it("still accepts HTTP/1.1 connections over TLS (allowHTTP1)", async () => {
    const routes: RouteInfo[] = [];
    const server = trackServer(
      createProxyServer({
        getRoutes: () => routes,
        proxyPort: TEST_PROXY_PORT,
        tls: { cert: tlsCert, key: tlsKey },
      })
    );
    await listen(server);

    const res = await httpsRequest(server, { host: "fallback.localhost" });
    expect(res.status).toBe(404);
    expect(res.body).toContain("Not Found");
  });

  it("generates https:// URLs in 404 page", async () => {
    const routes: RouteInfo[] = [{ hostname: "myapp.localhost", port: 4001 }];
    const server = trackServer(
      createProxyServer({
        getRoutes: () => routes,
        proxyPort: TEST_PROXY_PORT,
        tls: { cert: tlsCert, key: tlsKey },
      })
    );
    await listen(server);

    const res = await httpsRequest(server, { host: "other.localhost" });
    expect(res.status).toBe(404);
    expect(res.body).toContain("https://myapp.localhost:1355");
  });

  it("sets x-forwarded-proto to http for plain HTTP requests on non-TLS proxy", async () => {
    let receivedProto = "";
    const backend = trackServer(
      http.createServer((req, res) => {
        receivedProto = req.headers["x-forwarded-proto"] as string;
        res.writeHead(200);
        res.end("ok");
      })
    );
    await listen(backend);
    const backendAddr = backend.address();
    if (!backendAddr || typeof backendAddr === "string") throw new Error("no addr");

    const routes: RouteInfo[] = [{ hostname: "myapp.localhost", port: backendAddr.port }];
    const server = trackServer(createProxyServer({ getRoutes: () => routes, proxyPort: 80 }));
    await listen(server);

    await request(server, { host: "myapp.localhost" });
    expect(receivedProto).toBe("http");
  });

  it("sets x-forwarded-proto to https when proxying", async () => {
    let receivedProto = "";
    const backend = trackServer(
      http.createServer((req, res) => {
        receivedProto = req.headers["x-forwarded-proto"] as string;
        res.writeHead(200);
        res.end("ok");
      })
    );
    await listen(backend);
    const backendAddr = backend.address();
    if (!backendAddr || typeof backendAddr === "string") throw new Error("no addr");

    const routes: RouteInfo[] = [{ hostname: "myapp.localhost", port: backendAddr.port }];
    const server = trackServer(
      createProxyServer({
        getRoutes: () => routes,
        proxyPort: TEST_PROXY_PORT,
        tls: { cert: tlsCert, key: tlsKey },
      })
    );
    await listen(server);

    await httpsRequest(server, { host: "myapp.localhost" });
    expect(receivedProto).toBe("https");
  });

  it("proxies WebSocket upgrade over TLS", async () => {
    const backend = trackServer(http.createServer());
    backend.on("upgrade", (_req, socket) => {
      socket.write(
        "HTTP/1.1 101 Switching Protocols\r\n" +
          "Upgrade: websocket\r\n" +
          "Connection: Upgrade\r\n" +
          "\r\n"
      );
      socket.end();
    });
    await listen(backend);
    const backendAddr = backend.address();
    if (!backendAddr || typeof backendAddr === "string") throw new Error("no addr");

    const routes: RouteInfo[] = [{ hostname: "ws.localhost", port: backendAddr.port }];
    const server = trackServer(
      createProxyServer({
        getRoutes: () => routes,
        proxyPort: TEST_PROXY_PORT,
        tls: { cert: tlsCert, key: tlsKey },
      })
    );
    await listen(server);

    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("no addr");

    const upgraded = await new Promise<boolean>((resolve) => {
      const req = https.request({
        hostname: "127.0.0.1",
        port: addr.port,
        path: "/",
        headers: {
          host: "ws.localhost",
          connection: "Upgrade",
          upgrade: "websocket",
        },
        rejectUnauthorized: false,
      });
      req.on("error", () => resolve(false));
      req.on("upgrade", () => resolve(true));
      req.setTimeout(2000, () => {
        req.destroy();
        resolve(false);
      });
      req.end();
    });

    expect(upgraded).toBe(true);
  });

  it("proxies plain HTTP WebSocket upgrades on the TLS port and keeps the warning", async () => {
    const backend = trackServer(http.createServer());
    backend.on("upgrade", (_req, socket) => {
      socket.write(
        "HTTP/1.1 101 Switching Protocols\r\n" +
          "Upgrade: websocket\r\n" +
          "Connection: Upgrade\r\n" +
          "\r\n"
      );
      socket.end();
    });
    await listen(backend);
    const backendAddr = backend.address();
    if (!backendAddr || typeof backendAddr === "string") throw new Error("no addr");

    const routes: RouteInfo[] = [{ hostname: "ws.localhost", port: backendAddr.port }];
    const server = trackServer(
      createProxyServer({
        getRoutes: () => routes,
        proxyPort: TEST_PROXY_PORT,
        tls: { cert: tlsCert, key: tlsKey },
      })
    );
    await listen(server);

    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("no addr");
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});

    try {
      const upgraded = await new Promise<boolean>((resolve) => {
        const req = http.request({
          hostname: "127.0.0.1",
          port: addr.port,
          path: "/socket",
          headers: {
            host: "ws.localhost",
            connection: "Upgrade",
            upgrade: "websocket",
          },
        });
        req.on("error", () => resolve(false));
        req.on("upgrade", () => resolve(true));
        req.setTimeout(2000, () => {
          req.destroy();
          resolve(false);
        });
        req.end();
      });

      expect(upgraded).toBe(true);
      expect(warning).toHaveBeenCalledWith(expect.stringContaining("use wss:// instead"));
    } finally {
      warning.mockRestore();
    }
  });

  describe("RFC 8441 Extended CONNECT WebSocket bridge", () => {
    it("advertises SETTINGS_ENABLE_CONNECT_PROTOCOL to HTTP/2 clients", async () => {
      const server = trackServer(
        createProxyServer({
          getRoutes: () => [],
          proxyPort: TEST_PROXY_PORT,
          tls: { cert: tlsCert, key: tlsKey },
        })
      );
      await listen(server);

      const addr = server.address();
      if (!addr || typeof addr === "string") throw new Error("no addr");

      const enabled = await new Promise<boolean>((resolve, reject) => {
        const client = http2.connect(`https://127.0.0.1:${addr.port}`, {
          rejectUnauthorized: false,
        });
        client.on("error", reject);
        client.on("remoteSettings", (settings) => {
          client.close();
          resolve((settings as { enableConnectProtocol?: boolean }).enableConnectProtocol === true);
        });
      });

      expect(enabled).toBe(true);
    });

    it("bridges Extended CONNECT frames to an HTTP/1.1 backend", async () => {
      const backend = websocketEchoBackend();
      await listen(backend);
      const backendAddr = backend.address();
      if (!backendAddr || typeof backendAddr === "string") throw new Error("no addr");

      const routes: RouteInfo[] = [{ hostname: "ws.localhost", port: backendAddr.port }];
      const server = trackServer(
        createProxyServer({
          getRoutes: () => routes,
          proxyPort: TEST_PROXY_PORT,
          tls: { cert: tlsCert, key: tlsKey },
        })
      );
      await listen(server);

      const result = await openH2WebSocket(
        server,
        { ":path": "/hmr", ":authority": "ws.localhost" },
        (stream) => {
          stream.write("ping");
          setTimeout(() => stream.close(), 25);
        }
      );

      expect(result.status).toBe(200);
      expect(result.data.toString("utf8")).toContain("ping");
    });

    it("forwards negotiated WebSocket subprotocol in Extended CONNECT response", async () => {
      const backend = websocketEchoBackend();
      await listen(backend);
      const backendAddr = backend.address();
      if (!backendAddr || typeof backendAddr === "string") throw new Error("no addr");

      const routes: RouteInfo[] = [{ hostname: "ws.localhost", port: backendAddr.port }];
      const server = trackServer(
        createProxyServer({
          getRoutes: () => routes,
          proxyPort: TEST_PROXY_PORT,
          tls: { cert: tlsCert, key: tlsKey },
        })
      );
      await listen(server);

      const result = await openH2WebSocket(
        server,
        {
          ":path": "/hmr",
          ":authority": "ws.localhost",
          "sec-websocket-protocol": "vite-hmr",
        },
        (stream) => setTimeout(() => stream.close(), 25)
      );

      expect(result.status).toBe(200);
      expect(result.headers["sec-websocket-protocol"]).toBe("vite-hmr");
    });

    it("forwards negotiated WebSocket extensions in Extended CONNECT response", async () => {
      // A backend that accepts permessage-deflate sets RSV1 on its frames. If the
      // negotiated extension never reaches the client, the client reads the first
      // compressed frame as a protocol error and drops the connection.
      const backend = trackServer(http.createServer());
      backend.on("upgrade", (req, socket) => {
        const key = req.headers["sec-websocket-key"] as string;
        socket.write(
          "HTTP/1.1 101 Switching Protocols\r\n" +
            "Upgrade: websocket\r\n" +
            "Connection: Upgrade\r\n" +
            `Sec-WebSocket-Accept: ${computeWebSocketAccept(key)}\r\n` +
            "Sec-WebSocket-Extensions: permessage-deflate\r\n" +
            "\r\n"
        );
      });
      await listen(backend);
      const backendAddr = backend.address();
      if (!backendAddr || typeof backendAddr === "string") throw new Error("no addr");

      const routes: RouteInfo[] = [{ hostname: "ws.localhost", port: backendAddr.port }];
      const server = trackServer(
        createProxyServer({
          getRoutes: () => routes,
          proxyPort: TEST_PROXY_PORT,
          tls: { cert: tlsCert, key: tlsKey },
        })
      );
      await listen(server);

      const result = await openH2WebSocket(
        server,
        {
          ":path": "/ws",
          ":authority": "ws.localhost",
          "sec-websocket-extensions": "permessage-deflate; client_max_window_bits",
        },
        (stream) => setTimeout(() => stream.close(), 25)
      );

      expect(result.status).toBe(200);
      expect(result.headers["sec-websocket-extensions"]).toBe("permessage-deflate");
    });

    it("omits WebSocket extensions when the backend declines them", async () => {
      const backend = websocketEchoBackend();
      await listen(backend);
      const backendAddr = backend.address();
      if (!backendAddr || typeof backendAddr === "string") throw new Error("no addr");

      const routes: RouteInfo[] = [{ hostname: "ws.localhost", port: backendAddr.port }];
      const server = trackServer(
        createProxyServer({
          getRoutes: () => routes,
          proxyPort: TEST_PROXY_PORT,
          tls: { cert: tlsCert, key: tlsKey },
        })
      );
      await listen(server);

      const result = await openH2WebSocket(
        server,
        {
          ":path": "/ws",
          ":authority": "ws.localhost",
          "sec-websocket-extensions": "permessage-deflate; client_max_window_bits",
        },
        (stream) => setTimeout(() => stream.close(), 25)
      );

      expect(result.status).toBe(200);
      expect(result.headers["sec-websocket-extensions"]).toBeUndefined();
    });

    it("selects path-scoped routes and forwards the full path unchanged", async () => {
      let receivedUrl = "";
      const backend = websocketEchoBackend((req) => {
        receivedUrl = req.url || "";
      });
      await listen(backend);
      const backendAddr = backend.address();
      if (!backendAddr || typeof backendAddr === "string") throw new Error("no addr");

      const routes: RouteInfo[] = [
        { hostname: "ws.localhost", port: 4999 },
        { hostname: "ws.localhost", port: backendAddr.port, pathPrefix: "/hmr" },
      ];
      const server = trackServer(
        createProxyServer({
          getRoutes: () => routes,
          proxyPort: TEST_PROXY_PORT,
          tls: { cert: tlsCert, key: tlsKey },
        })
      );
      await listen(server);

      await openH2WebSocket(
        server,
        {
          ":path": "/hmr/socket?token=1",
          ":authority": "ws.localhost",
        },
        (stream) => setTimeout(() => stream.close(), 25)
      );

      expect(receivedUrl).toBe("/hmr/socket?token=1");
    });

    it("routes exact public tunnel aliases without accepting wildcard public hosts", async () => {
      let upgrades = 0;
      const backend = websocketEchoBackend(() => {
        upgrades++;
      });
      await listen(backend);
      const backendAddr = backend.address();
      if (!backendAddr || typeof backendAddr === "string") throw new Error("no addr");

      const routes: RouteInfo[] = [
        { hostname: "app.localhost", port: backendAddr.port, pathPrefix: "/api" },
      ];
      const server = trackServer(
        createProxyServer({
          getRoutes: () => routes,
          getTunnelAliases: () => [
            {
              externalHostname: "public.example.com",
              targetHostname: "app.localhost",
              targetPathPrefix: "/api",
            },
          ],
          proxyPort: TEST_PROXY_PORT,
          tls: { cert: tlsCert, key: tlsKey },
        })
      );
      await listen(server);

      await openH2WebSocket(
        server,
        { ":path": "/api/socket", ":authority": "public.example.com" },
        (stream) => setTimeout(() => stream.close(), 25)
      );
      await openH2WebSocket(server, { ":path": "/api/socket", ":authority": "evil.example.com" });

      expect(upgrades).toBe(1);
    });

    it("honors multiplex selection cookies and otherwise uses the deterministic default", async () => {
      const labels: string[] = [];
      const alpha = websocketEchoBackend(() => labels.push("alpha"));
      const beta = websocketEchoBackend(() => labels.push("beta"));
      await listen(alpha);
      await listen(beta);
      const alphaAddr = alpha.address();
      const betaAddr = beta.address();
      if (!alphaAddr || typeof alphaAddr === "string") throw new Error("no alpha addr");
      if (!betaAddr || typeof betaAddr === "string") throw new Error("no beta addr");

      const routes: RouteInfo[] = [
        { hostname: "shared.localhost", port: betaAddr.port, label: "beta" },
        { hostname: "shared.localhost", port: alphaAddr.port, label: "alpha" },
      ];
      const server = trackServer(
        createProxyServer({
          getRoutes: () => routes,
          proxyPort: TEST_PROXY_PORT,
          tls: { cert: tlsCert, key: tlsKey },
        })
      );
      await listen(server);

      await openH2WebSocket(
        server,
        {
          ":path": "/",
          ":authority": "shared.localhost",
          cookie: "portless_app=beta",
        },
        (stream) => setTimeout(() => stream.close(), 25)
      );
      await openH2WebSocket(server, { ":path": "/", ":authority": "shared.localhost" }, (stream) =>
        setTimeout(() => stream.close(), 25)
      );

      expect(labels).toEqual(["beta", "alpha"]);
    });

    it("destroys streams for internal hosts, h2c routes, missing routes, and looped requests", async () => {
      const backend = websocketEchoBackend();
      await listen(backend);
      const backendAddr = backend.address();
      if (!backendAddr || typeof backendAddr === "string") throw new Error("no addr");
      const errors: string[] = [];

      const server = trackServer(
        createProxyServer({
          getRoutes: () => [
            { hostname: "grpc.localhost", port: backendAddr.port, protocol: "h2c" },
            { hostname: "ws.localhost", port: backendAddr.port },
          ],
          proxyPort: TEST_PROXY_PORT,
          onError: (message) => errors.push(message),
          tls: { cert: tlsCert, key: tlsKey },
        })
      );
      await listen(server);

      const internal = await openH2WebSocket(server, {
        ":path": "/",
        ":authority": "portless.localhost",
      });
      const h2c = await openH2WebSocket(server, { ":path": "/", ":authority": "grpc.localhost" });
      const missing = await openH2WebSocket(server, {
        ":path": "/",
        ":authority": "none.localhost",
      });
      const loop = await openH2WebSocket(server, {
        ":path": "/",
        ":authority": "ws.localhost",
        "x-portless-hops": "5",
      });

      expect(internal.closed).toBe(true);
      expect(h2c.closed).toBe(true);
      expect(missing.closed).toBe(true);
      expect(loop.closed).toBe(true);
      expect(errors.some((message) => message.includes("WebSocket loop detected"))).toBe(true);
      expect(errors.some((message) => message.includes("h2c"))).toBe(true);
    });

    it("does not forward payload when backend accept validation fails", async () => {
      const backend = trackServer(http.createServer());
      backend.on("upgrade", (_req, socket) => {
        socket.write(
          "HTTP/1.1 101 Switching Protocols\r\n" +
            "Upgrade: websocket\r\n" +
            "Connection: Upgrade\r\n" +
            "Sec-WebSocket-Accept: invalid\r\n" +
            "\r\n" +
            "leak"
        );
      });
      await listen(backend);
      const backendAddr = backend.address();
      if (!backendAddr || typeof backendAddr === "string") throw new Error("no addr");

      const routes: RouteInfo[] = [{ hostname: "bad.localhost", port: backendAddr.port }];
      const server = trackServer(
        createProxyServer({
          getRoutes: () => routes,
          proxyPort: TEST_PROXY_PORT,
          tls: { cert: tlsCert, key: tlsKey },
        })
      );
      await listen(server);

      const result = await openH2WebSocket(server, { ":path": "/", ":authority": "bad.localhost" });

      // The CONNECT is answered only once the backend's 101 validates, so a
      // bad handshake is reported as a reset stream rather than a WebSocket
      // that opens and then dies.
      expect(result.status).toBe(0);
      expect(result.closed).toBe(true);
      expect(result.data.toString("utf8")).toBe("");
    });

    it("keeps normal HTTP/2 requests working after a failed CONNECT stream", async () => {
      const backend = trackServer(
        http.createServer((_req, res) => {
          res.writeHead(200, { "Content-Type": "text/plain" });
          res.end("still works");
        })
      );
      await listen(backend);
      const backendAddr = backend.address();
      if (!backendAddr || typeof backendAddr === "string") throw new Error("no addr");

      const routes: RouteInfo[] = [{ hostname: "ok.localhost", port: backendAddr.port }];
      const server = trackServer(
        createProxyServer({
          getRoutes: () => routes,
          proxyPort: TEST_PROXY_PORT,
          tls: { cert: tlsCert, key: tlsKey },
        })
      );
      await listen(server);
      const addr = server.address();
      if (!addr || typeof addr === "string") throw new Error("no addr");

      const client = http2.connect(`https://127.0.0.1:${addr.port}`, {
        rejectUnauthorized: false,
      });
      try {
        await new Promise<void>((resolve, reject) => {
          client.on("error", reject);
          client.on("remoteSettings", () => {
            const connect = client.request(
              {
                ":method": "CONNECT",
                ":protocol": "websocket",
                ":scheme": "https",
                ":path": "/socket",
                ":authority": "missing.localhost",
                "sec-websocket-version": "13",
                "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
              },
              { endStream: false }
            );
            connect.on("close", resolve);
            connect.on("error", () => resolve());
          });
        });

        const response = await new Promise<{ status: number; body: string }>((resolve, reject) => {
          const req = client.request({
            ":method": "GET",
            ":path": "/",
            ":authority": "ok.localhost",
          });
          let body = "";
          let status = 0;
          req.on("response", (headers) => {
            status = Number(headers[":status"]) || 0;
          });
          req.on("data", (chunk: Buffer) => {
            body += chunk.toString("utf8");
          });
          req.on("end", () => resolve({ status, body }));
          req.on("error", reject);
          req.end();
        });

        expect(response).toEqual({ status: 200, body: "still works" });
      } finally {
        client.close();
      }
    });

    it("does not send WebSocket traffic to reserved dashboard or certificate hosts", async () => {
      let upgrades = 0;
      const backend = websocketEchoBackend(() => {
        upgrades++;
      });
      await listen(backend);
      const backendAddr = backend.address();
      if (!backendAddr || typeof backendAddr === "string") throw new Error("no addr");

      const routes: RouteInfo[] = [
        { hostname: "portless.localhost", port: backendAddr.port },
        { hostname: "cert.localhost", port: backendAddr.port },
      ];
      const server = trackServer(
        createProxyServer({
          getRoutes: () => routes,
          proxyPort: TEST_PROXY_PORT,
          tls: { cert: tlsCert, key: tlsKey },
        })
      );
      await listen(server);

      const dashboard = await openH2WebSocket(server, {
        ":path": "/",
        ":authority": "portless.localhost",
      });
      const cert = await openH2WebSocket(server, { ":path": "/", ":authority": "cert.localhost" });

      expect(dashboard.closed).toBe(true);
      expect(cert.closed).toBe(true);
      expect(upgrades).toBe(0);
    });
  });

  it("redirects plain HTTP to HTTPS on the TLS-enabled port", async () => {
    const routes: RouteInfo[] = [];
    const server = trackServer(
      createProxyServer({
        getRoutes: () => routes,
        proxyPort: 443,
        tls: { cert: tlsCert, key: tlsKey },
      })
    );
    await listen(server);

    const res = await request(server, { host: "myapp.localhost", path: "/dashboard" });
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("https://myapp.localhost/dashboard");
  });

  it("includes port in redirect Location when proxy is not on 443", async () => {
    const routes: RouteInfo[] = [];
    const server = trackServer(
      createProxyServer({
        getRoutes: () => routes,
        proxyPort: TEST_PROXY_PORT,
        tls: { cert: tlsCert, key: tlsKey },
      })
    );
    await listen(server);

    const res = await request(server, { host: "myapp.localhost" });
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`https://myapp.localhost:${TEST_PROXY_PORT}/`);
  });

  it("includes X-Portless header in HTTP-to-HTTPS redirect", async () => {
    const server = trackServer(
      createProxyServer({
        getRoutes: () => [],
        proxyPort: 443,
        tls: { cert: tlsCert, key: tlsKey },
      })
    );
    await listen(server);

    const res = await request(server, { host: "myapp.localhost" });
    expect(res.status).toBe(302);
    expect(res.headers["x-portless"]).toBe("1");
  });

  it("strips hop-by-hop headers from proxied TLS responses (HTTP/2 client)", async () => {
    const backend = trackServer(
      http.createServer((_req, res) => {
        // Backend sends hop-by-hop headers that are invalid in HTTP/2
        res.writeHead(200, {
          "Content-Type": "text/plain",
          Connection: "keep-alive",
          "Keep-Alive": "timeout=5",
          "X-Custom": "preserved",
        });
        res.end("ok");
      })
    );
    await listen(backend);
    const backendAddr = backend.address();
    if (!backendAddr || typeof backendAddr === "string") throw new Error("no addr");

    const routes: RouteInfo[] = [{ hostname: "hop.localhost", port: backendAddr.port }];
    const server = trackServer(
      createProxyServer({
        getRoutes: () => routes,
        proxyPort: TEST_PROXY_PORT,
        tls: { cert: tlsCert, key: tlsKey },
      })
    );
    await listen(server);

    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("no addr");

    // Use HTTP/2 client; hop-by-hop headers must be stripped for HTTP/2
    const result = await new Promise<{
      status: number;
      headers: Record<string, string>;
      body: string;
    }>((resolve, reject) => {
      const client = http2.connect(`https://127.0.0.1:${addr.port}`, {
        rejectUnauthorized: false,
      });
      client.on("error", reject);

      const req = client.request({
        ":method": "GET",
        ":path": "/",
        host: "hop.localhost",
      });

      let status = 0;
      const responseHeaders: Record<string, string> = {};
      req.on("response", (headers) => {
        status = headers[":status"] as number;
        for (const [key, value] of Object.entries(headers)) {
          if (key !== ":status" && typeof value === "string") {
            responseHeaders[key] = value;
          }
        }
      });

      let body = "";
      req.on("data", (chunk: Buffer) => (body += chunk));
      req.on("end", () => {
        client.close();
        resolve({ status, headers: responseHeaders, body });
      });
      req.on("error", reject);
      req.end();
    });

    expect(result.status).toBe(200);
    expect(result.headers["connection"]).toBeUndefined();
    expect(result.headers["keep-alive"]).toBeUndefined();
    expect(result.headers["x-custom"]).toBe("preserved");
    expect(result.body).toBe("ok");
  });

  // streamResetBurst/streamResetRate server options require Node 22.11+;
  // on older versions they are silently ignored and GOAWAY fires at ~1000 resets.
  // Also skipped on Windows where the rapid burst overwhelms the test backend.
  const [nodeMajor, nodeMinor] = process.versions.node.split(".").map(Number);
  it.skipIf(nodeMajor < 22 || (nodeMajor === 22 && nodeMinor < 11) || process.platform === "win32")(
    "session survives sustained stream cancellation (issues #217, #221)",
    async () => {
      const backend = trackServer(
        http.createServer((_req, res) => {
          res.writeHead(200, { "Content-Type": "text/plain" });
          res.end("ok");
        })
      );
      await listen(backend);
      const backendAddr = backend.address();
      if (!backendAddr || typeof backendAddr === "string") throw new Error("no addr");

      const routes: RouteInfo[] = [{ hostname: "h2burst.localhost", port: backendAddr.port }];
      const server = trackServer(
        createProxyServer({
          getRoutes: () => routes,
          proxyPort: TEST_PROXY_PORT,
          tls: { cert: tlsCert, key: tlsKey },
        })
      );
      await listen(server);

      const addr = server.address();
      if (!addr || typeof addr === "string") throw new Error("no addr");

      // Simulate Vite/Nuxt HMR: sustained bursts of stream cancellations.
      // Without streamResetBurst/streamResetRate tuning, Node sends GOAWAY
      // INTERNAL_ERROR (code 2) after ~1000 cumulative resets, killing the
      // HTTP/2 session and causing ERR_HTTP2_PROTOCOL_ERROR in Chrome.
      const client = http2.connect(`https://127.0.0.1:${addr.port}`, {
        rejectUnauthorized: false,
      });

      let gotGoaway = false;
      client.on("goaway", () => {
        gotGoaway = true;
      });
      client.on("error", () => {});

      // Send 1500 resets in rapid batches (exceeds the ~1000 threshold that
      // triggers GOAWAY on an untuned server).
      const TOTAL = 1500;
      const BATCH = 100;
      let sent = 0;
      await new Promise<void>((resolve) => {
        const timer = setInterval(() => {
          if (gotGoaway || sent >= TOTAL) {
            clearInterval(timer);
            resolve();
            return;
          }
          for (let i = 0; i < BATCH && sent < TOTAL; i++) {
            const req = client.request({
              ":method": "GET",
              ":path": `/${sent}`,
              host: "h2burst.localhost",
            });
            req.on("error", () => {});
            req.close(http2.constants.NGHTTP2_CANCEL);
            sent++;
          }
        }, 10);
      });

      // Verify the session is still alive with a real request
      let finalStatus = 0;
      if (!client.destroyed && !client.closed) {
        finalStatus = await new Promise<number>((resolve, reject) => {
          const req = client.request({
            ":method": "GET",
            ":path": "/final",
            host: "h2burst.localhost",
          });
          req.on("response", (headers) => {
            req.close();
            resolve(headers[":status"] as number);
          });
          req.on("error", reject);
          req.end();
        });
      }

      client.close();
      expect(gotGoaway).toBe(false);
      expect(finalStatus).toBe(200);
    },
    15_000
  );
});

describe("internal pages and multiplex routing", () => {
  const servers: AnyServer[] = [];
  const backends: http.Server[] = [];

  function track<T extends AnyServer>(server: T): T {
    servers.push(server);
    return server;
  }

  function startBackend(label: string): Promise<number> {
    return new Promise((resolve) => {
      const b = http.createServer((_req, res) => {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end(`backend:${label}`);
      });
      backends.push(b);
      b.listen(0, "127.0.0.1", () => resolve((b.address() as net.AddressInfo).port));
    });
  }

  afterEach(async () => {
    for (const s of servers) await new Promise<void>((r) => s.close(() => r()));
    for (const b of backends) await new Promise<void>((r) => b.close(() => r()));
    servers.length = 0;
    backends.length = 0;
  });

  it("serves the dashboard at portless.<suffix>", async () => {
    const routes: RouteInfo[] = [{ hostname: "web.localhost", port: 4001 }];
    const server = track(
      createProxyServer({ getRoutes: () => routes, proxyPort: TEST_PROXY_PORT })
    );
    await listen(server);
    const res = await request(server, { host: "portless.localhost" });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.body).toContain("Local dashboard");
    expect(res.body).toContain("web.localhost");
  });

  it("cannot be shadowed by a user route on the reserved hostname", async () => {
    const routes: RouteInfo[] = [{ hostname: "portless.localhost", port: 4001 }];
    const server = track(
      createProxyServer({ getRoutes: () => routes, proxyPort: TEST_PROXY_PORT })
    );
    await listen(server);
    const res = await request(server, { host: "portless.localhost" });
    expect(res.status).toBe(200);
    expect(res.body).toContain("Local dashboard");
  });

  it("serves the certificate page at cert.<suffix>", async () => {
    const server = track(createProxyServer({ getRoutes: () => [], proxyPort: TEST_PROXY_PORT }));
    await listen(server);
    const res = await request(server, { host: "cert.localhost" });
    expect(res.status).toBe(200);
    expect(res.body).toContain("Certificate authority");
  });

  it("returns 404 for CA download when the proxy has no CA (no TLS)", async () => {
    const server = track(createProxyServer({ getRoutes: () => [], proxyPort: TEST_PROXY_PORT }));
    await listen(server);
    const res = await request(server, { host: "cert.localhost", path: "/portless-ca.pem" });
    expect(res.status).toBe(404);
  });

  it("serves a read-only state.json on the dashboard host", async () => {
    const routes: RouteInfo[] = [{ hostname: "web.localhost", port: 4001 }];
    const server = track(
      createProxyServer({ getRoutes: () => routes, proxyPort: TEST_PROXY_PORT })
    );
    await listen(server);
    const res = await request(server, {
      host: "portless.localhost",
      path: "/__portless/state.json",
      accept: "application/json",
    });
    expect(res.status).toBe(200);
    const parsed = JSON.parse(res.body);
    expect(parsed.apps[0].name).toBe("web.localhost");
  });

  it("can disable internal pages with internalPages:false", async () => {
    const server = track(
      createProxyServer({ getRoutes: () => [], proxyPort: TEST_PROXY_PORT, internalPages: false })
    );
    await listen(server);
    const res = await request(server, { host: "portless.localhost" });
    expect(res.status).toBe(404);
    expect(res.body).not.toContain("Local dashboard");
  });

  it("shows the app picker for a multiplexed host with no selection", async () => {
    const routes: RouteInfo[] = [
      { hostname: "app.localhost", port: 4001, label: "main" },
      { hostname: "app.localhost", port: 4002, label: "hotfix" },
    ];
    const server = track(
      createProxyServer({ getRoutes: () => routes, proxyPort: TEST_PROXY_PORT })
    );
    await listen(server);
    const res = await request(server, { host: "app.localhost" });
    expect(res.status).toBe(200);
    expect(res.body).toContain("Choose an app");
    expect(res.body).toContain("main");
    expect(res.body).toContain("hotfix");
  });

  it("records a selection and redirects with a host-scoped cookie", async () => {
    const routes: RouteInfo[] = [
      { hostname: "app.localhost", port: 4001, label: "main" },
      { hostname: "app.localhost", port: 4002, label: "hotfix" },
    ];
    const server = track(
      createProxyServer({ getRoutes: () => routes, proxyPort: TEST_PROXY_PORT })
    );
    await listen(server);
    const res = await request(server, {
      host: "app.localhost",
      path: "/__portless/select?label=main",
    });
    expect(res.status).toBe(302);
    const setCookie = String(res.headers["set-cookie"]);
    expect(setCookie).toContain("portless_app=main");
    expect(setCookie).toContain("SameSite=Lax");
  });

  it("routes a multiplexed host to the cookie-selected member", async () => {
    const mainPort = await startBackend("main");
    const hotfixPort = await startBackend("hotfix");
    const routes: RouteInfo[] = [
      { hostname: "app.localhost", port: mainPort, label: "main" },
      { hostname: "app.localhost", port: hotfixPort, label: "hotfix" },
    ];
    const server = track(
      createProxyServer({ getRoutes: () => routes, proxyPort: TEST_PROXY_PORT })
    );
    await listen(server);

    const toMain = await request(server, {
      host: "app.localhost",
      headers: { cookie: "portless_app=main" },
    });
    expect(toMain.body).toBe("backend:main");

    const toHotfix = await request(server, {
      host: "app.localhost",
      headers: { cookie: "portless_app=hotfix" },
    });
    expect(toHotfix.body).toBe("backend:hotfix");
  });

  it("falls back to a default member for non-HTML requests without a selection", async () => {
    const mainPort = await startBackend("main");
    const hotfixPort = await startBackend("hotfix");
    const routes: RouteInfo[] = [
      { hostname: "app.localhost", port: mainPort, label: "main" },
      { hostname: "app.localhost", port: hotfixPort, label: "hotfix" },
    ];
    const server = track(
      createProxyServer({ getRoutes: () => routes, proxyPort: TEST_PROXY_PORT })
    );
    await listen(server);
    const res = await request(server, { host: "app.localhost", accept: "application/json" });
    // Lowest label wins deterministically ("hotfix" < "main").
    expect(res.body).toBe("backend:hotfix");
  });
});
