import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import * as http from "node:http";
import * as http2 from "node:http2";
import * as net from "node:net";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createProxyServer } from "./proxy.js";
import { ensureCerts } from "./certs.js";

const dials = vi.hoisted(() => ({
  port: 0,
  pending: 0,
  max: 0,
  starts: 0,
  hold: false,
  sockets: [] as import("node:net").Socket[],
  release: [] as (() => void)[],
}));
vi.mock("node:net", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:net")>();
  return {
    ...actual,
    connect: (options: net.NetConnectOpts) => {
      if (!("port" in options) || Number(options.port) !== dials.port)
        return actual.connect(options);
      dials.starts++;
      dials.pending++;
      dials.max = Math.max(dials.max, dials.pending);
      const socket = actual.connect({
        ...options,
        host: "localhost",
        autoSelectFamily: true,
        lookup: ((_host, _opts, callback) => {
          const release = () => callback(null, [{ address: "127.0.0.1", family: 4 }]);
          if (dials.hold) dials.release.push(release);
          else setTimeout(release, 20);
        }) as net.LookupFunction,
      });
      dials.sockets.push(socket);
      let settled = false;
      const settle = () => {
        if (!settled) {
          settled = true;
          dials.pending--;
        }
      };
      socket.once("connect", settle);
      socket.once("close", settle);
      return socket;
    },
  };
});
const servers: net.Server[] = [];
const clients: (() => void)[] = [];
let certDir: string;
let tls: { cert: Buffer; key: Buffer };
beforeAll(() => {
  certDir = fs.mkdtempSync(path.join(os.tmpdir(), "pooling-test-"));
  const certs = ensureCerts(certDir);
  tls = { cert: fs.readFileSync(certs.certPath), key: fs.readFileSync(certs.keyPath) };
});
afterAll(() => fs.rmSync(certDir, { recursive: true, force: true }));
afterEach(async () => {
  clients.splice(0).forEach((close) => close());
  servers
    .slice()
    .reverse()
    .forEach((server) => server.close());
  dials.sockets.forEach((socket) => socket.destroy());
  dials.release.splice(0).forEach((release) => release());
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
          (server as http.Server).closeAllConnections?.();
        })
    )
  );
  Object.assign(dials, { port: 0, pending: 0, max: 0, starts: 0, hold: false, sockets: [] });
});
async function listen<T extends net.Server>(server: T) {
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return (server.address() as net.AddressInfo).port;
}
async function setup(handler: http.RequestListener, h2 = false) {
  const port = await listen(http.createServer(handler));
  dials.port = port;
  const server = createProxyServer({
    getRoutes: () => [{ hostname: "app.localhost", port }],
    proxyPort: 1355,
    ...(h2 ? { tls } : {}),
  });
  const proxyPort = await listen(server);
  return { server, proxyPort };
}
function send(port: number, url = "/") {
  return new Promise<number>((resolve) => {
    const req = http.get(
      { host: "127.0.0.1", port, path: url, headers: { host: "app.localhost" }, agent: false },
      (res) => {
        res.resume();
        res.on("end", () => resolve(res.statusCode!));
        res.on("error", () => resolve(0));
      }
    );
    req.on("error", () => resolve(0));
    clients.push(() => req.destroy());
  });
}
async function heldBurst(port: number) {
  dials.hold = true;
  const requests = Array.from({ length: 40 }, () => send(port));
  await vi.waitFor(() => expect(dials.pending).toBe(16));
  return { requests };
}
describe("upstream dial scheduling", () => {
  it("limits a burst to 16 concurrent dials and reuses idle sockets", async () => {
    const { proxyPort } = await setup((_req, res) => res.end("ok"));
    const statuses = await Promise.all(Array.from({ length: 100 }, () => send(proxyPort)));
    expect(statuses.every((status) => status === 200)).toBe(true);
    // How many dials overlap depends on how fast the burst arrives, so a loaded
    // runner can stay under the cap. The held-burst tests pin the exact cap.
    expect(dials.max).toBeGreaterThan(0);
    expect(dials.max).toBeLessThanOrEqual(16);
    expect(dials.starts).toBeLessThan(100);
  });
  it("wakes queued work when an established socket becomes free", async () => {
    let release!: () => void;
    const { proxyPort } = await setup((req, res) => {
      if (req.url === "/held") release = () => res.end("ok");
      else res.end("ok");
    });
    const first = send(proxyPort, "/held");
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    const { requests } = await heldBurst(proxyPort);
    const quick = send(proxyPort);
    release();
    expect(await first).toBe(200);
    expect(await quick).toBe(200);
    expect(dials.pending).toBe(16);
    expect(dials.starts).toBe(17);
    dials.release.splice(0).forEach((release) => release());
    expect((await Promise.all(requests)).every((status) => status === 200)).toBe(true);
  });
  it.each([false, true])(
    "fails queued requests at shutdown without new dials (TLS %s)",
    async (h2) => {
      const { server, proxyPort } = await setup((_req, res) => res.end("ok"), h2);
      let requests: Promise<number>[];
      let session: http2.ClientHttp2Session | undefined;
      dials.hold = true;
      if (h2) {
        session = http2.connect(`https://127.0.0.1:${proxyPort}`, { rejectUnauthorized: false });
        clients.push(() => session!.destroy());
        requests = Array.from(
          { length: 40 },
          () =>
            new Promise<number>((resolve) => {
              const req = session!.request({ ":authority": "app.localhost" });
              req.on("response", (headers) => resolve(Number(headers[":status"])));
              req.on("error", () => resolve(0));
              req.resume();
              req.end();
            })
        );
      } else requests = Array.from({ length: 40 }, () => send(proxyPort));
      await vi.waitFor(() => expect(dials.pending).toBe(16));
      server.close();
      const statuses = await Promise.all(requests);
      expect(statuses.filter((status) => status === 503)).toHaveLength(24);
      expect(dials.starts).toBe(16);
      dials.release.splice(0).forEach((release) => release());
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(dials.starts).toBe(16);
    }
  );
  it("releases a stalled dial on the connect deadline and clears it after connect", async () => {
    const { proxyPort } = await setup((_req, res) => res.end("ok"));
    dials.hold = true;
    const first = send(proxyPort);
    await vi.waitFor(() => expect(dials.sockets).toHaveLength(1));
    const socket = dials.sockets[0];
    expect(socket.timeout).toBe(10_000);
    expect(await first).toBe(502);
    dials.hold = false;
    expect(await send(proxyPort)).toBe(200);
    expect(dials.sockets[1].timeout).toBe(0);
  }, 15_000);
  it.each([false, true])("skips a client aborted while queued (HTTP/2 %s)", async (h2) => {
    const seen: string[] = [];
    const { proxyPort } = await setup((req, res) => {
      seen.push(req.url!);
      res.end("ok");
    }, h2);
    dials.hold = true;
    const session = h2
      ? http2.connect(`https://127.0.0.1:${proxyPort}`, { rejectUnauthorized: false })
      : undefined;
    if (session) clients.push(() => session.destroy());
    const start = (url: string) => {
      const req = session
        ? session.request({ ":authority": "app.localhost", ":path": url })
        : http.get({
            host: "127.0.0.1",
            port: proxyPort,
            path: url,
            headers: { host: "app.localhost" },
            agent: false,
          });
      req.on("error", () => {});
      if (session) {
        (req as http2.ClientHttp2Stream).resume();
        req.end();
      } else req.on("response", (res) => res.resume());
      clients.push(() => req.destroy());
      return req;
    };
    Array.from({ length: 16 }, () => start("/held"));
    await vi.waitFor(() => expect(dials.pending).toBe(16));
    const aborted = start("/aborted");
    // A later request proves the cancelled entry was passed in queue order.
    start("/after");
    await new Promise((resolve) => setTimeout(resolve, 30));
    aborted.destroy();
    await new Promise((resolve) => setTimeout(resolve, 30));
    dials.hold = false;
    dials.release.splice(0).forEach((release) => release());
    await vi.waitFor(() => expect(seen).toContain("/after"));
    expect(seen).not.toContain("/aborted");
  });
  it("serves a quick HTTP/2 request with 80 established streams", async () => {
    const { proxyPort } = await setup((req, res) => {
      if (req.url === "/stream") {
        res.writeHead(200);
        res.write("stream");
      } else res.end("ok");
    }, true);
    const session = http2.connect(`https://127.0.0.1:${proxyPort}`, { rejectUnauthorized: false });
    clients.push(() => session.destroy());
    await Promise.all(
      Array.from(
        { length: 80 },
        () =>
          new Promise<void>((resolve) => {
            const req = session.request({ ":authority": "app.localhost", ":path": "/stream" });
            req.once("data", () => resolve());
            req.on("error", () => {});
            req.end();
          })
      )
    );
    expect(dials.starts).toBe(80);
    const status = await new Promise<number>((resolve) => {
      const req = session.request({ ":authority": "app.localhost" });
      req.on("response", (headers) => resolve(Number(headers[":status"])));
      req.resume();
      req.end();
    });
    expect(status).toBe(200);
  });
});
