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
