import { describe, it, expect, afterAll, afterEach, beforeAll } from "vitest";
import * as fs from "node:fs";
import * as http from "node:http";
import * as http2 from "node:http2";
import * as https from "node:https";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import { createProxyServer, PORTLESS_HEADER, PORTLESS_LISTENER_PORT_HEADER } from "./proxy.js";
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

describe("createProxyServer", () => {
  const servers: AnyServer[] = [];

  function trackServer<T extends AnyServer>(server: T): T {
    servers.push(server);
    return server;
  }

  afterEach(async () => {
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

    it("returns plain-text 404 for non-browser clients", async () => {
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
      expect(res.headers["content-type"]).toBe("text/plain");
      expect(res.body).toContain("No app registered for other.localhost");
      expect(res.body).toContain("Active apps:");
      expect(res.body).toContain("myapp.localhost");
      expect(res.body).toContain("api.localhost");
      expect(res.body).toContain("portless other your-command");
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
      expect(res.status).toBe(404);
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
      ).toBe(404);
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

    it("proxies to a backend listening on IPv6 loopback only", async () => {
      const backend = trackServer(
        http.createServer((_req, res) => {
          res.writeHead(200, { "Content-Type": "text/plain" });
          res.end("hello from ipv6 backend");
        })
      );
      await new Promise<void>((resolve) => backend.listen(0, "::1", () => resolve()));
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

    it("returns plain-text 502 with target port for non-browser clients", async () => {
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
      expect(res.headers["content-type"]).toBe("text/plain");
      expect(res.body).toContain(`127.0.0.1:${unusedPort}`);
      expect(res.body).toContain("portless list");
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
      expect(res.body).toContain("Loop Detected");
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
  });

  describe("XSS safety", () => {
    it("escapes hostname in 404 page", async () => {
      const routes: RouteInfo[] = [];
      const server = trackServer(
        createProxyServer({ getRoutes: () => routes, proxyPort: TEST_PROXY_PORT })
      );
      await listen(server);

      // The proxy extracts hostname from the Host header before the colon
      const res = await request(server, { host: "<script>alert(1)</script>" });
      expect(res.status).toBe(404);
      expect(res.body).not.toContain("<script>alert(1)</script>");
      expect(res.body).toContain("&lt;script&gt;");
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
      const finish = (result: { status: number; data: Buffer; closed: boolean }) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        client.close();
        resolve(result);
      };
      const timeout = setTimeout(() => {
        finish({ status: 0, data: Buffer.alloc(0), closed: false });
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
        const chunks: Buffer[] = [];
        stream.on("response", (responseHeaders) => {
          status = Number(responseHeaders[":status"]) || 0;
          onResponse?.(stream);
        });
        stream.on("data", (chunk: Buffer) => chunks.push(chunk));
        stream.on("error", () => {});
        stream.on("close", () => {
          finish({ status, data: Buffer.concat(chunks), closed: true });
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

      expect(result.status).toBe(200);
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
