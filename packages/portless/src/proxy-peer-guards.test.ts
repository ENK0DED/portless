import { afterEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import * as http2 from "node:http2";
import * as net from "node:net";
import { createProxyServer } from "./proxy.js";
import { canBindProxyPort, getProxyBindTargets } from "./cli-utils.js";

const captured = vi.hoisted(() => ({ server: null as http2.Http2SecureServer | null }));
vi.mock("node:http2", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:http2")>();
  return {
    ...actual,
    createSecureServer: (...args: Parameters<typeof actual.createSecureServer>) => {
      // Capture the transport to exercise its stream handler independently of accept.
      captured.server = new EventEmitter() as http2.Http2SecureServer;
      void args;
      return captured.server;
    },
  };
});
vi.mock("node:net", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:net")>();
  return { ...actual, createServer: vi.fn(actual.createServer) };
});
afterEach(() => vi.restoreAllMocks());

describe("proxy peer defense in depth", () => {
  it.each(["192.0.2.1", "::ffff:192.0.2.1", undefined])(
    "refuses Extended CONNECT from %s before route lookup",
    (remoteAddress) => {
      const getRoutes = vi.fn(() => []);
      createProxyServer({
        getRoutes,
        proxyPort: 443,
        loopbackOnly: true,
        tls: { cert: Buffer.alloc(0), key: Buffer.alloc(0) },
      });
      const stream = Object.assign(new EventEmitter(), {
        session: { socket: { remoteAddress } },
        respond: vi.fn(),
        end: vi.fn(),
      });
      captured.server!.listeners("stream")[0](
        stream as unknown as http2.ServerHttp2Stream,
        {
          ":method": "CONNECT",
          ":protocol": "websocket",
          ":authority": "app.localhost",
          ":path": "/",
        },
        0,
        []
      );
      expect(stream.respond).toHaveBeenCalledWith({ ":status": 403 });
      expect(stream.end).toHaveBeenCalled();
      expect(getRoutes).not.toHaveBeenCalled();
    }
  );

  it.each(["127.0.0.1", "127.0.0.2", "::1", "::ffff:127.0.0.1"])(
    "allows forwarding and sharing loopback peer %s to reach routing",
    (remoteAddress) => {
      const getRoutes = vi.fn(() => []);
      createProxyServer({
        getRoutes,
        proxyPort: 443,
        loopbackOnly: true,
        tls: { cert: Buffer.alloc(0), key: Buffer.alloc(0) },
      });
      const stream = Object.assign(new EventEmitter(), {
        session: { socket: { remoteAddress } },
        respond: vi.fn(),
        end: vi.fn(),
        close: vi.fn(),
      });
      captured.server!.listeners("stream")[0](
        stream as unknown as http2.ServerHttp2Stream,
        {
          ":method": "CONNECT",
          ":protocol": "websocket",
          ":authority": "app.localhost",
          ":path": "/",
        },
        0,
        []
      );
      expect(stream.respond).not.toHaveBeenCalled();
      expect(getRoutes).toHaveBeenCalled();
    }
  );

  it.each(["EACCES", "EPERM", "EADDRINUSE", "EAFNOSUPPORT"])(
    "only permission errors require elevation: %s",
    async (code) => {
      const probe = Object.assign(new EventEmitter(), { listen: vi.fn() });
      probe.listen.mockImplementation(() => {
        queueMicrotask(() => probe.emit("error", Object.assign(new Error(code), { code })));
        return probe;
      });
      vi.mocked(net.createServer).mockReturnValue(probe as unknown as net.Server);
      expect(await canBindProxyPort(80, getProxyBindTargets(false))).toBe(
        !["EACCES", "EPERM"].includes(code)
      );
    }
  );
});
