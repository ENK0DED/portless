# HTTP/2 WebSocket Extended CONNECT Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement upstream `vercel-labs/portless` PR #278 as a fork-specific RFC 8441 Extended CONNECT bridge so modern browser HMR WebSockets work over the existing HTTPS HTTP/2 session.

**Architecture:** Keep normal request routing in `proxy.ts`, but move WebSocket handshake parsing and HTTP/1.1 upgrade serialization into a focused helper module. The TLS proxy advertises RFC 8441 support, claims `CONNECT` streams before Node's HTTP/2 compatibility layer responds, selects routes through the current fork routing rules, validates the backend WebSocket handshake, and pipes raw frame bytes only after validation succeeds.

**Tech Stack:** TypeScript, Node `http2`, Node `net`, Node `crypto`, existing portless proxy tests, Vitest through Bun.

## Global Constraints

- Use `bun` for all package and verification commands.
- Do not add runtime dependencies.
- Do not weaken public-server defaults. This feature must not widen child app binds, infer public exposure, or accept arbitrary public hosts.
- Preserve existing strict route matching, exact tunnel aliases, path prefixes, multiplexed hostnames, internal reserved pages, h2c routes, and HTTP/1.1 WebSocket upgrades.
- Dial backend WebSocket targets only through `LOOPBACK_DIAL_OPTIONS` plus the selected route port.
- Validate `Sec-WebSocket-Accept` before forwarding any backend payload bytes to the HTTP/2 client.
- Serialize any manual HTTP/1.1 backend request with explicit header-name and header-value safety checks. Reject or skip CR, LF, and invalid header names.
- Do not implement WebSocket-over-HTTP/2 to h2c upstreams in this pass. A route marked `protocol: "h2c"` must not be accidentally contacted through an HTTP/1.1 upgrade bridge.
- Do not introduce new environment variables.
- If user-facing behavior is documented, update `README.md`, `skills/portless/SKILL.md`, and `packages/portless/src/cli.ts` help text.
- Every commit must be signed and include upstream PR data: `vercel-labs/portless#278`, title `Fix WebSocket-over-HTTP/2 (RFC 8441 Extended CONNECT) for Turbopack and Vite HMR`, and upstream commits `9b41ef966bc039a1d5de23340886e55886c0898c`, `f23b827458b5b8fae5d9865468ed7f6a53654802`, and `c80ff6771315c696fab7240de7d3f513b8f0f6f1`.

---

## Source Assessment

- Upstream PR: <https://github.com/vercel-labs/portless/pull/278>
- Upstream title: `Fix WebSocket-over-HTTP/2 (RFC 8441 Extended CONNECT) for Turbopack and Vite HMR`
- Upstream commits inspected:
  - `9b41ef966bc039a1d5de23340886e55886c0898c`
  - `f23b827458b5b8fae5d9865468ed7f6a53654802`
  - `c80ff6771315c696fab7240de7d3f513b8f0f6f1`
- Upstream implementation shape:
  - Set `settings.enableConnectProtocol: true` on the TLS HTTP/2 server.
  - Add a `prependListener("stream", ...)` handler for `:method = CONNECT` and `:protocol = websocket`.
  - Respond with `:status = 200` synchronously to claim the stream before Node's compatibility layer emits a `405`.
  - Replace `stream.end` for the CONNECT stream so the compatibility layer cannot close the tunnel.
  - Dial an HTTP/1.1 backend, send a manually framed WebSocket Upgrade request, validate `Sec-WebSocket-Accept`, and pipe raw bytes both ways.
- Fork-specific differences required:
  - Current `findRoute()` takes tunnel aliases, request paths, and strict mode. The bridge must use it.
  - Current routing has path prefixes. The bridge must select by the `:path` value and forward the full path unchanged.
  - Current routing has multiplexed hostnames. The bridge must honor the `portless_app` cookie and otherwise use the same deterministic default as HTTP/1.1 upgrades. It must never serve the HTML picker on a WebSocket stream.
  - Current proxy has reserved internal pages at `portless.<suffix>` and `cert.<suffix>`. The bridge must reject those hosts before route dispatch.
  - Current proxy has `protocol: "h2c"` routes for gRPC and HTTP/2 cleartext. This plan deliberately does not add HTTP/2 CONNECT bridging to h2c backends.
  - Current proxy uses family-aware loopback dialing through `LOOPBACK_DIAL_OPTIONS`. The bridge must use that instead of hard-coding `127.0.0.1`.
  - Current proxy supports exact public tunnel aliases. The bridge must accept only aliases returned by `getTunnelAliases()`, never wildcard public hosts.

## File Structure

- Create `packages/portless/src/h2-websocket.ts`.
  - Pure RFC 6455 and HTTP/1.1 upgrade helpers.
  - No route-store access and no proxy state access.
  - Exports are small enough to unit test without starting servers.
- Create `packages/portless/src/h2-websocket.test.ts`.
  - Unit tests for accept hashes, parsing, serialization, and header safety.
- Modify `packages/portless/src/proxy.ts`.
  - Add RFC 8441 server settings.
  - Add a stream listener and minimal local route selection glue.
  - Use the helper module to build the backend upgrade request and validate the backend response.
- Modify `packages/portless/src/proxy.test.ts`.
  - Add end to end tests inside `describe("createProxyServer with TLS (HTTP/2)")`.
- Modify `README.md`.
  - Add a short HTTP/2 + HTTPS note that modern browser HMR WebSockets over HTTP/2 are supported.
- Modify `skills/portless/SKILL.md`.
  - Teach agents not to work around HTTPS HMR failures by disabling TLS before checking portless version.
- Modify `packages/portless/src/cli.ts`.
  - Add one line to the HTTP/2 + HTTPS help section.
- Modify `FORK.md`.
  - Mark #278 as `implemented differently` after implementation lands.

## Interfaces

Add this helper interface in `packages/portless/src/h2-websocket.ts`:

```ts
import * as http from "node:http";
import * as http2 from "node:http2";

export const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

export interface WebSocketUpgradeRequestInput {
  authority: string;
  path: string;
  headers: http2.IncomingHttpHeaders;
  forwardedHeaders: Record<string, string>;
  hops: number;
  websocketKey?: string;
}

export interface SerializedWebSocketUpgradeRequest {
  request: string;
  websocketKey: string;
  expectedAccept: string;
}

export type WebSocketUpgradeParseResult =
  | {
      ok: true;
      status: 101;
      remaining: Buffer;
      headers: Record<string, string>;
    }
  | {
      ok: false;
      reason: "incomplete" | "malformed" | "non-101" | "missing-accept" | "bad-accept";
      status?: number;
    };

export function isH2WebSocketConnect(headers: http2.IncomingHttpHeaders): boolean;
export function createWebSocketKey(): string;
export function computeWebSocketAccept(key: string): string;
export function serializeWebSocketUpgradeRequest(
  input: WebSocketUpgradeRequestInput
): SerializedWebSocketUpgradeRequest;
export function parseWebSocketUpgradeResponse(
  buffer: Buffer,
  expectedAccept: string
): WebSocketUpgradeParseResult;
```

Add this local interface in `packages/portless/src/proxy.ts` near the bridge code:

```ts
interface H2WebSocketRouteSelection {
  host: string;
  authority: string;
  path: string;
  hops: number;
  route?: RouteInfo;
  rejectReason?: "missing-host" | "internal-host" | "loop" | "missing-route" | "h2c-route";
}
```

The proxy-local route selection function should be:

```ts
const selectH2WebSocketRoute = (headers: http2.IncomingHttpHeaders): H2WebSocketRouteSelection => {
  // Implement in Task 3 using the existing helpers already in proxy.ts.
};
```

## Task 1: Pure WebSocket Handshake Helpers

**Files:**

- Create: `packages/portless/src/h2-websocket.ts`
- Create: `packages/portless/src/h2-websocket.test.ts`

**Produces:**

- `isH2WebSocketConnect(headers)`
- `createWebSocketKey()`
- `computeWebSocketAccept(key)`
- `serializeWebSocketUpgradeRequest(input)`
- `parseWebSocketUpgradeResponse(buffer, expectedAccept)`

- [ ] **Step 1: Write failing helper tests**

Create `packages/portless/src/h2-websocket.test.ts` with these tests:

```ts
import { describe, expect, it } from "vitest";
import {
  computeWebSocketAccept,
  isH2WebSocketConnect,
  parseWebSocketUpgradeResponse,
  serializeWebSocketUpgradeRequest,
} from "./h2-websocket.js";

describe("h2 websocket helpers", () => {
  it("detects RFC 8441 WebSocket CONNECT streams", () => {
    expect(isH2WebSocketConnect({ ":method": "CONNECT", ":protocol": "websocket" })).toBe(true);
    expect(isH2WebSocketConnect({ ":method": "GET", ":protocol": "websocket" })).toBe(false);
    expect(isH2WebSocketConnect({ ":method": "CONNECT" })).toBe(false);
  });

  it("computes the RFC 6455 accept hash", () => {
    expect(computeWebSocketAccept("dGhlIHNhbXBsZSBub25jZQ==")).toBe("s3pPLMBiTxaQ9kYGzzhZRbK+xOo=");
  });

  it("serializes a safe HTTP/1.1 WebSocket upgrade request", () => {
    const serialized = serializeWebSocketUpgradeRequest({
      authority: "ws.localhost:1355",
      path: "/hmr?token=1",
      websocketKey: "dGhlIHNhbXBsZSBub25jZQ==",
      hops: 2,
      forwardedHeaders: {
        "x-forwarded-for": "127.0.0.1",
        "x-forwarded-proto": "https",
        "x-forwarded-host": "ws.localhost:1355",
        "x-forwarded-port": "1355",
      },
      headers: {
        "sec-websocket-version": "13",
        "sec-websocket-protocol": "vite-hmr",
        origin: "https://ws.localhost:1355",
        cookie: "portless_app=main",
        "user-agent": "test-agent",
      },
    });

    expect(serialized.expectedAccept).toBe("s3pPLMBiTxaQ9kYGzzhZRbK+xOo=");
    expect(serialized.request).toContain("GET /hmr?token=1 HTTP/1.1\r\n");
    expect(serialized.request).toContain("Host: ws.localhost:1355\r\n");
    expect(serialized.request).toContain("Connection: Upgrade\r\n");
    expect(serialized.request).toContain("Upgrade: websocket\r\n");
    expect(serialized.request).toContain("Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n");
    expect(serialized.request).toContain("Sec-WebSocket-Protocol: vite-hmr\r\n");
    expect(serialized.request).toContain("X-Portless-Hops: 3\r\n");
    expect(serialized.request.endsWith("\r\n\r\n")).toBe(true);
  });

  it("rejects unsafe manual HTTP/1.1 header material", () => {
    expect(() =>
      serializeWebSocketUpgradeRequest({
        authority: "ws.localhost\r\nX-Evil: 1",
        path: "/",
        websocketKey: "dGhlIHNhbXBsZSBub25jZQ==",
        hops: 0,
        forwardedHeaders: {},
        headers: {},
      })
    ).toThrow("Unsafe WebSocket header");

    expect(() =>
      serializeWebSocketUpgradeRequest({
        authority: "ws.localhost",
        path: "/",
        websocketKey: "dGhlIHNhbXBsZSBub25jZQ==",
        hops: 0,
        forwardedHeaders: { "bad\r\nname": "value" },
        headers: {},
      })
    ).toThrow("Unsafe WebSocket header");
  });

  it("parses a valid 101 response and preserves trailing frame bytes", () => {
    const result = parseWebSocketUpgradeResponse(
      Buffer.from(
        "HTTP/1.1 101 Switching Protocols\r\n" +
          "Upgrade: websocket\r\n" +
          "Connection: Upgrade\r\n" +
          "Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=\r\n" +
          "\r\n" +
          "ping"
      ),
      "s3pPLMBiTxaQ9kYGzzhZRbK+xOo="
    );

    expect(result).toMatchObject({ ok: true, status: 101 });
    if (result.ok) expect(result.remaining.toString("utf8")).toBe("ping");
  });

  it("rejects non-101, missing accept, and mismatched accept responses", () => {
    expect(
      parseWebSocketUpgradeResponse(Buffer.from("HTTP/1.1 404 Not Found\r\n\r\n"), "expected")
    ).toMatchObject({ ok: false, reason: "non-101", status: 404 });

    expect(
      parseWebSocketUpgradeResponse(
        Buffer.from("HTTP/1.1 101 Switching Protocols\r\n\r\n"),
        "expected"
      )
    ).toMatchObject({ ok: false, reason: "missing-accept" });

    expect(
      parseWebSocketUpgradeResponse(
        Buffer.from(
          "HTTP/1.1 101 Switching Protocols\r\n" + "Sec-WebSocket-Accept: wrong\r\n" + "\r\n"
        ),
        "expected"
      )
    ).toMatchObject({ ok: false, reason: "bad-accept" });
  });
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
cd packages/portless && bun run test src/h2-websocket.test.ts
```

Expected: fail because `src/h2-websocket.ts` does not exist.

- [ ] **Step 3: Implement helpers**

Create `packages/portless/src/h2-websocket.ts` with the interfaces from this plan and these implementation rules:

- `isH2WebSocketConnect` returns true only when `headers[":method"] === "CONNECT"` and `headers[":protocol"] === "websocket"`.
- `createWebSocketKey` returns `crypto.randomBytes(16).toString("base64")`.
- `computeWebSocketAccept` uses SHA-1 of `key + WS_GUID`, base64 encoded.
- `serializeWebSocketUpgradeRequest`:
  - Uses the provided `websocketKey` or generates one.
  - Writes `GET ${path || "/"} HTTP/1.1`.
  - Writes `Host`, `Connection: Upgrade`, `Upgrade: websocket`, `Sec-WebSocket-Version`, `Sec-WebSocket-Key`, optional `Sec-WebSocket-Protocol`, optional `Sec-WebSocket-Extensions`, optional `Origin`, optional `User-Agent`, optional `Cookie`, forwarded headers, and `X-Portless-Hops`.
  - Rejects header names that do not match `^[!#$%&'*+.^_`|~0-9A-Za-z-]+$`.
  - Rejects any header value containing `\r` or `\n`.
  - Converts casing to conventional HTTP/1.1 names for generated headers. Existing forwarded header names may be canonicalized with a small helper.
- `parseWebSocketUpgradeResponse`:
  - Returns `{ ok: false, reason: "incomplete" }` until `\r\n\r\n` exists.
  - Parses the HTTP status from the first line.
  - Rejects non-101 statuses.
  - Locates `Sec-WebSocket-Accept` case-insensitively.
  - Compares the accept value exactly with `expectedAccept`.
  - Returns trailing bytes after the header block in `remaining` on success.

- [ ] **Step 4: Verify and commit**

Run:

```bash
cd packages/portless && bun run test src/h2-websocket.test.ts
bun run lint
git diff --check
```

Commit:

```bash
git add packages/portless/src/h2-websocket.ts packages/portless/src/h2-websocket.test.ts
git commit -S -m "feat(proxy): add h2 websocket handshake helpers"
```

Commit body must include upstream PR #278 data and the manual HTTP/1.1 header safety decision.

## Task 2: Failing Proxy Integration Coverage

**Files:**

- Modify: `packages/portless/src/proxy.test.ts`

**Consumes:**

- `computeWebSocketAccept` from `h2-websocket.ts`.

- [ ] **Step 1: Add test helpers**

Inside `packages/portless/src/proxy.test.ts`, import:

```ts
import { computeWebSocketAccept } from "./h2-websocket.js";
```

Add these local helpers inside `describe("createProxyServer with TLS (HTTP/2)")`:

```ts
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
    client.on("error", reject);
    client.on("remoteSettings", () => {
      const stream = client.request(
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
      let status = 0;
      const chunks: Buffer[] = [];
      stream.on("response", (responseHeaders) => {
        status = Number(responseHeaders[":status"]) || 0;
        onResponse?.(stream);
      });
      stream.on("data", (chunk: Buffer) => chunks.push(chunk));
      stream.on("error", () => {});
      stream.on("close", () => {
        client.close();
        resolve({ status, data: Buffer.concat(chunks), closed: true });
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
```

- [ ] **Step 2: Add failing integration tests**

Add this `describe` block inside the TLS HTTP/2 describe block:

```ts
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

    await openH2WebSocket(server, { ":path": "/hmr/socket?token=1", ":authority": "ws.localhost" });

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

    await openH2WebSocket(server, { ":path": "/api/socket", ":authority": "public.example.com" });
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

    await openH2WebSocket(server, {
      ":path": "/",
      ":authority": "shared.localhost",
      cookie: "portless_app=beta",
    });
    await openH2WebSocket(server, { ":path": "/", ":authority": "shared.localhost" });

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
    const missing = await openH2WebSocket(server, { ":path": "/", ":authority": "none.localhost" });
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
});
```

- [ ] **Step 3: Run tests and verify failure**

Run:

```bash
cd packages/portless && bun run test src/proxy.test.ts
```

Expected: failures for missing `enableConnectProtocol` and the missing stream bridge.

- [ ] **Step 4: Commit failing tests only if team policy allows**

Do not commit failing tests to the branch unless explicitly asked. Keep them unstaged for Task 3 if using the normal red-green loop.

## Task 3: Implement The Extended CONNECT Bridge

**Files:**

- Modify: `packages/portless/src/proxy.ts`
- Modify: `packages/portless/src/proxy.test.ts`

**Consumes:**

- Helper functions from `h2-websocket.ts`.
- Existing `findRoute`, `multiplexMembersFor`, `defaultMember`, `readSelectionCookie`, `buildForwardedHeaders`, `LOOPBACK_DIAL_OPTIONS`, `MAX_PROXY_HOPS`, and `PORTLESS_HOPS_HEADER` logic in `proxy.ts`.

- [ ] **Step 1: Import helper functions**

In `packages/portless/src/proxy.ts`, import:

```ts
import {
  isH2WebSocketConnect,
  parseWebSocketUpgradeResponse,
  serializeWebSocketUpgradeRequest,
} from "./h2-websocket.js";
```

- [ ] **Step 2: Add route selection for H2 WebSockets**

Inside `createProxyServer`, add `selectH2WebSocketRoute(headers)` with these exact behaviors:

- Read `authority = String(headers[":authority"] || "")`.
- Read `host = authority.split(":")[0]`.
- Read `path = String(headers[":path"] || "/")`.
- Read `hops = parseInt(headers[PORTLESS_HOPS_HEADER] as string, 10) || 0`.
- Reject missing `host`.
- Reject `dashboardHost` and `certHost` when `internalPages` is enabled.
- If `hops >= MAX_PROXY_HOPS`, call `onError("WebSocket loop detected ...")` and reject.
- Get `routes = getRoutes()` and `tunnelAliases = getTunnelAliases()`.
- For multiplexed hostnames, use `multiplexMembersFor(routes, host, path)`. If there are members, read `headers.cookie`, parse it with `parseCookieHeader`, pick the matching label if present, otherwise use `defaultMember(members)`.
- Otherwise use `findRoute(routes, tunnelAliases, host, path, strict)`.
- Reject missing route.
- Reject `route.protocol === "h2c"` and call `onError("WebSocket-over-HTTP/2 to h2c upstream is not supported for ...")`.
- Return route and parsed values.

- [ ] **Step 3: Add the bridge**

Inside `createProxyServer`, add `handleH2WebSocket(stream, headers)` with these exact behaviors:

- Add `stream.on("error", () => stream.destroy())`.
- Immediately call `stream.respond({ ":status": 200 })` inside a try/catch. If it throws, destroy and return.
- Call `selectH2WebSocketRoute(headers)`. If it rejects, destroy and return.
- Build forwarded headers using a small request-like object:

```ts
const fakeReq = {
  socket: stream.session?.socket,
  headers: { ...headers, host: selection.authority },
} as unknown as http.IncomingMessage;
const forwardedHeaders = buildForwardedHeaders(fakeReq, true);
```

- Serialize the backend upgrade with `serializeWebSocketUpgradeRequest`.
- Dial the selected route with:

```ts
const backendSocket = net.connect({
  ...LOOPBACK_DIAL_OPTIONS,
  port: selection.route.port,
});
```

- On backend connect, write the serialized request.
- Buffer backend data until `parseWebSocketUpgradeResponse` returns success or a terminal failure.
- If the parse result is `incomplete`, keep buffering.
- If the parse result is any failure except `incomplete`, destroy backend socket and stream. Do not write buffered payload bytes to the stream.
- If success, write any `remaining` bytes to `stream`, then pipe `backendSocket` to `stream` and `stream` to `backendSocket`.
- Use an idempotent cleanup function that destroys the backend socket and closes or destroys the stream.
- Handle backend `error`, `close`, and `end`, plus stream `close` and `aborted`.

- [ ] **Step 4: Wire HTTP/2 server settings and stream listener**

In `http2.createSecureServer`, add:

```ts
settings: { enableConnectProtocol: true },
```

Preserve the existing `streamResetBurst`, `streamResetRate`, `allowHTTP1`, certificate chain, and `SNICallback` behavior.

After creating `h2Server`, before the existing `"request"` listener is registered or at least using `prependListener`, add:

```ts
h2Server.prependListener(
  "stream",
  (stream: http2.ServerHttp2Stream, headers: http2.IncomingHttpHeaders) => {
    if (!isH2WebSocketConnect(headers)) return;
    const streamWithNoEnd = stream as unknown as {
      end: (...args: unknown[]) => http2.ServerHttp2Stream;
    };
    streamWithNoEnd.end = function () {
      return stream;
    };
    handleH2WebSocket(stream, headers);
  }
);
```

Keep the existing HTTP/1.1 `"upgrade"` listener unchanged.

- [ ] **Step 5: Neutralize the compatibility request path for CONNECT**

At the top of the existing `"request"` listener, after `req.stream?.on("error", () => {})`, add:

```ts
if (req.method === "CONNECT") {
  const response = res as unknown as {
    end: (...args: unknown[]) => http2.Http2ServerResponse;
    writeHead: (...args: unknown[]) => http2.Http2ServerResponse;
    write: (...args: unknown[]) => boolean;
  };
  response.end = () => res;
  response.writeHead = () => res;
  response.write = () => false;
  return;
}
```

This is required because Node's compatibility layer fires a `"request"` event for CONNECT streams even though the stream listener owns the tunnel.

- [ ] **Step 6: Verify and commit**

Run:

```bash
cd packages/portless && bun run test src/h2-websocket.test.ts src/proxy.test.ts
bun run lint
git diff --check
```

Commit:

```bash
git add packages/portless/src/proxy.ts packages/portless/src/proxy.test.ts
git commit -S -m "feat(proxy): support h2 websocket connect"
```

Commit body must include upstream PR #278 data and these fork-specific differences: loopback family-aware dialing, exact route and tunnel alias selection, multiplex cookie selection, internal host rejection, h2c route rejection, and accept validation before payload forwarding.

## Task 4: Regression And Compatibility Sweep

**Files:**

- Modify: `packages/portless/src/proxy.test.ts`

- [ ] **Step 1: Add regression tests for untouched paths**

If Task 3 did not already add equivalent coverage, add these focused tests inside
`describe("RFC 8441 Extended CONNECT WebSocket bridge", ...)`:

```ts
it("keeps classic HTTP/1.1 WebSocket upgrade behavior over TLS", async () => {
  let upgrades = 0;
  const backend = trackServer(http.createServer());
  backend.on("upgrade", (_req, socket) => {
    upgrades++;
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

  const upgraded = await new Promise<boolean>((resolve) => {
    const addr = server.address();
    if (!addr || typeof addr === "string") return resolve(false);
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
  expect(upgrades).toBe(1);
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
        setTimeout(() => resolve(), 500);
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
```

- [ ] **Step 2: Verify broader proxy-related suites**

Run:

```bash
cd packages/portless && bun run test src/proxy.test.ts src/routes.test.ts src/tunnel-aliases.test.ts src/tunnel.test.ts src/bg.test.ts src/cli.test.ts
bun run lint
git diff --check
```

- [ ] **Step 3: Commit test refinements**

Commit only if Task 4 added tests not already committed in Task 3:

```bash
git add packages/portless/src/proxy.test.ts
git commit -S -m "test(proxy): cover h2 websocket compatibility paths"
```

Commit body must include upstream PR #278 data and identify the compatibility paths covered.

## Task 5: Documentation And Fork Tracking

**Files:**

- Modify: `README.md`
- Modify: `skills/portless/SKILL.md`
- Modify: `packages/portless/src/cli.ts`
- Modify: `FORK.md`

- [ ] **Step 1: Update README**

In the HTTP/2 + HTTPS section, add:

```md
Portless also supports modern browser HMR WebSockets over HTTP/2 using RFC 8441 Extended CONNECT, so Next.js Turbopack, Vite, and similar dev servers can keep hot reloading while HTTPS/HTTP/2 is enabled.
```

- [ ] **Step 2: Update agent skill**

In `skills/portless/SKILL.md`, in the HTTP/2 + HTTPS section, add:

```md
Modern browser HMR WebSockets over HTTPS use HTTP/2 Extended CONNECT. Current portless supports that path. Do not work around HMR failures by disabling TLS first; check route state, proxy logs, and whether the app is actually running before changing TLS settings.
```

- [ ] **Step 3: Update CLI help**

In `packages/portless/src/cli.ts`, in the `HTTP/2 + HTTPS (default):` help block, add one concise line:

```ts
  Modern HMR WebSockets over HTTP/2 are supported via Extended CONNECT.
```

- [ ] **Step 4: Update FORK.md**

Change #278 state in both the detailed comparison table and full open PR state table from `deferred` to `implemented differently`.

Use this detailed note:

```md
Implemented differently. The fork supports RFC 8441 Extended CONNECT for browser HMR WebSockets while preserving strict route selection, exact tunnel aliases, path prefixes, multiplex selection cookies, internal reserved hosts, and loopback-only backend dialing. Unlike upstream, the fork keeps h2c upstream CONNECT out of scope for this pass and validates serialized HTTP/1.1 upgrade headers before writing a manual backend request.
```

Update the full-state summary so it no longer says the WebSocket-over-HTTP/2 PR is deferred.

- [ ] **Step 5: Verify and commit**

Run:

```bash
bun run lint
bun run build
bun run test
git diff --check
```

Commit:

```bash
git add README.md skills/portless/SKILL.md packages/portless/src/cli.ts FORK.md
git commit -S -m "docs(proxy): document h2 websocket support"
```

Commit body must include upstream PR #278 data and state that this closes the final deferred upstream PR in the fork ledger.

## Additional Tests Required Before Merge

- `h2-websocket.test.ts`: RFC accept hash, request serialization, CRLF rejection, response parsing, non-101 rejection, missing accept rejection, mismatched accept rejection, partial header buffering.
- `proxy.test.ts`: `SETTINGS_ENABLE_CONNECT_PROTOCOL`, exact-route bridge, path-prefix route selection, tunnel alias selection, multiplex cookie selection, multiplex default selection, internal host rejection, missing route rejection, h2c route rejection, loop detection, backend non-101 rejection, backend mismatched accept rejection, trailing bytes after 101, HTTP/1.1 upgrade regression, normal HTTP/2 request regression after failed CONNECT.
- Existing suites that should remain stable: `routes.test.ts`, `tunnel-aliases.test.ts`, `tunnel.test.ts`, `proxy.test.ts`, `cli.test.ts`, and `bg.test.ts`.
- Optional manual smoke: run a Next.js 16 Turbopack app and a Vite app through HTTPS portless, open browser devtools, verify HMR connects without periodic full-page reloads, edit a component, and confirm hot reload occurs.

## Verification Gate

Before considering #278 implemented in this fork, run:

```bash
cd packages/portless && bun run test src/h2-websocket.test.ts src/proxy.test.ts src/routes.test.ts src/tunnel-aliases.test.ts src/tunnel.test.ts src/bg.test.ts src/cli.test.ts
bun run lint
bun run build
bun run test
git diff --check
for commit in $(git rev-list --max-count=5 HEAD); do git verify-commit "$commit"; done
```

The final worktree must be clean, and `FORK.md` must show zero deferred open upstream PRs.
