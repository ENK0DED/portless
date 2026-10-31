import { afterAll, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as http2 from "node:http2";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import { canBindProxyPort, canBindWithoutRoot, getProxyBindTargets } from "./cli-utils.js";
import { ensureCerts } from "./certs.js";
import { createHttpRedirectServer, createProxyServer } from "./proxy.js";

const certDir = fs.mkdtempSync(path.join(os.tmpdir(), "portless-binding-"));
afterAll(() => fs.rmSync(certDir, { recursive: true, force: true }));

function listen(server: net.Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "0.0.0.0", () => resolve((server.address() as net.AddressInfo).port));
  });
}
function status(port: number, host = "127.0.0.1", localAddress?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    const socket = net.connect({ port, host, localAddress });
    socket.setTimeout(3000, () => {
      socket.destroy();
      reject(new Error("socket timed out"));
    });
    socket.on("connect", () =>
      socket.write("GET / HTTP/1.1\r\nHost: app.localhost\r\nConnection: close\r\n\r\n")
    );
    socket.on("data", (chunk) => {
      data += chunk;
    });
    socket.on("error", () => {});
    socket.on("close", () => resolve(data.split("\r\n")[0] || "closed"));
  });
}

describe("privilege and binding", () => {
  it("probes free and occupied ports without treating occupancy as a permission error", async () => {
    const holder = net.createServer();
    const port = await listen(holder);
    try {
      expect(await canBindProxyPort(port, getProxyBindTargets(false))).toBe(true);
    } finally {
      await new Promise<void>((resolve) => holder.close(() => resolve()));
    }
    expect(await canBindProxyPort(port, getProxyBindTargets(false))).toBe(true);
  });

  it("checks Linux's low-port boundary without changing it", () => {
    expect(canBindWithoutRoot(80, "linux", () => "0")).toEqual({ ok: true });
    expect(canBindWithoutRoot(80, "linux", () => "1024").ok).toBe(false);
    expect(
      canBindWithoutRoot(80, "linux", () => {
        throw new Error("unreadable");
      }).ok
    ).toBe(false);
    expect(canBindWithoutRoot(80, "darwin").ok).toBe(true);
    expect(canBindWithoutRoot(80, "win32").ok).toBe(true);
    expect(getProxyBindTargets(false, true)).toEqual(getProxyBindTargets(true));
  });

  it.each(["http", "tls", "redirect", "lan"] as const)(
    "guards %s listeners at the socket boundary",
    async (mode) => {
      const certs = ensureCerts(certDir);
      const server =
        mode === "redirect"
          ? createHttpRedirectServer(443, true)
          : createProxyServer({
              getRoutes: () => [],
              proxyPort: 443,
              loopbackOnly: mode !== "lan",
              ...(mode === "tls"
                ? {
                    tls: {
                      cert: fs.readFileSync(certs.certPath),
                      key: fs.readFileSync(certs.keyPath),
                    },
                  }
                : {}),
            });
      const port = await listen(server);
      try {
        // WSL localhost forwarding and local sharing agents terminate as local peers.
        expect(await status(port)).toMatch(/^HTTP\/1\.1 (302|404)/);
        const external = Object.values(os.networkInterfaces())
          .flat()
          .find((entry) => entry?.family === "IPv4" && !entry.internal)?.address;
        expect(external, "socket boundary test requires a network interface").toBeTruthy();
        const remote = await status(port, external!);
        expect(remote).toBe(mode === "lan" ? "HTTP/1.1 404 Not Found" : "closed");
        if (mode === "tls") {
          const session = http2.connect(`https://127.0.0.1:${port}`, { rejectUnauthorized: false });
          try {
            const code = await new Promise<number>((resolve, reject) => {
              session.on("error", reject);
              const req = session.request({ ":path": "/", ":authority": "app.localhost" });
              req.on("error", reject);
              req.on("response", (headers) => resolve(Number(headers[":status"])));
              req.resume();
              req.end();
            });
            expect(code).toBe(404);
          } finally {
            session.destroy();
          }
        }
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    }
  );
});
