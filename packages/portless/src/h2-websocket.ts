import * as crypto from "node:crypto";
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

const HEADER_NAME_RE = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

const CANONICAL_HEADER_NAMES: Record<string, string> = {
  cookie: "Cookie",
  host: "Host",
  origin: "Origin",
  "sec-websocket-extensions": "Sec-WebSocket-Extensions",
  "sec-websocket-key": "Sec-WebSocket-Key",
  "sec-websocket-protocol": "Sec-WebSocket-Protocol",
  "sec-websocket-version": "Sec-WebSocket-Version",
  "user-agent": "User-Agent",
  "x-forwarded-for": "X-Forwarded-For",
  "x-forwarded-host": "X-Forwarded-Host",
  "x-forwarded-port": "X-Forwarded-Port",
  "x-forwarded-proto": "X-Forwarded-Proto",
  "x-portless-hops": "X-Portless-Hops",
};

export function isH2WebSocketConnect(headers: http2.IncomingHttpHeaders): boolean {
  return headers[":method"] === "CONNECT" && headers[":protocol"] === "websocket";
}

export function createWebSocketKey(): string {
  return crypto.randomBytes(16).toString("base64");
}

export function computeWebSocketAccept(key: string): string {
  return crypto
    .createHash("sha1")
    .update(key + WS_GUID)
    .digest("base64");
}

function canonicalHeaderName(name: string): string {
  const lower = name.toLowerCase();
  return (
    CANONICAL_HEADER_NAMES[lower] ??
    lower.replace(/(^|-)([a-z])/g, (_match, prefix: string, letter: string) => {
      return `${prefix}${letter.toUpperCase()}`;
    })
  );
}

function assertSafeHeaderName(name: string): void {
  if (!HEADER_NAME_RE.test(name)) {
    throw new Error(`Unsafe WebSocket header name: ${name}`);
  }
}

function assertSafeHeaderValue(value: string): void {
  if (/[\r\n]/.test(value)) {
    throw new Error("Unsafe WebSocket header value");
  }
}

function headerValue(headers: http2.IncomingHttpHeaders, name: string): string | undefined {
  const value = headers[name.toLowerCase()];
  if (value === undefined) return undefined;
  if (Array.isArray(value)) return value.map(String).join(", ");
  return String(value);
}

function addHeaderLine(lines: string[], name: string, value: string | undefined): void {
  if (value === undefined || value === "") return;
  assertSafeHeaderName(name);
  assertSafeHeaderValue(value);
  lines.push(`${canonicalHeaderName(name)}: ${value}`);
}

export function serializeWebSocketUpgradeRequest(
  input: WebSocketUpgradeRequestInput
): SerializedWebSocketUpgradeRequest {
  assertSafeHeaderValue(input.authority);
  assertSafeHeaderValue(input.path);

  const websocketKey = input.websocketKey ?? createWebSocketKey();
  const requestPath = input.path || "/";
  const lines = [`GET ${requestPath} HTTP/1.1`];

  addHeaderLine(lines, "host", input.authority);
  addHeaderLine(lines, "connection", "Upgrade");
  addHeaderLine(lines, "upgrade", "websocket");
  addHeaderLine(
    lines,
    "sec-websocket-version",
    headerValue(input.headers, "sec-websocket-version") ?? "13"
  );
  addHeaderLine(lines, "sec-websocket-key", websocketKey);
  addHeaderLine(
    lines,
    "sec-websocket-protocol",
    headerValue(input.headers, "sec-websocket-protocol")
  );
  addHeaderLine(
    lines,
    "sec-websocket-extensions",
    headerValue(input.headers, "sec-websocket-extensions")
  );
  addHeaderLine(lines, "origin", headerValue(input.headers, "origin"));
  addHeaderLine(lines, "user-agent", headerValue(input.headers, "user-agent"));
  addHeaderLine(lines, "cookie", headerValue(input.headers, "cookie"));

  for (const [name, value] of Object.entries(input.forwardedHeaders)) {
    addHeaderLine(lines, name, value);
  }
  addHeaderLine(lines, "x-portless-hops", String(input.hops + 1));

  return {
    request: `${lines.join("\r\n")}\r\n\r\n`,
    websocketKey,
    expectedAccept: computeWebSocketAccept(websocketKey),
  };
}

export function parseWebSocketUpgradeResponse(
  buffer: Buffer,
  expectedAccept: string
): WebSocketUpgradeParseResult {
  const headerEnd = buffer.indexOf("\r\n\r\n");
  if (headerEnd === -1) {
    return { ok: false, reason: "incomplete" };
  }

  const headerBlock = buffer.subarray(0, headerEnd).toString("latin1");
  const remaining = buffer.subarray(headerEnd + 4);
  const lines = headerBlock.split("\r\n");
  const statusMatch = /^HTTP\/1\.[01]\s+(\d{3})(?:\s|$)/.exec(lines[0] || "");
  if (!statusMatch) {
    return { ok: false, reason: "malformed" };
  }

  const status = Number(statusMatch[1]);
  if (status !== 101) {
    return { ok: false, reason: "non-101", status };
  }

  const headers: Record<string, string> = {};
  for (const line of lines.slice(1)) {
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const name = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (!name) continue;
    headers[name] = value;
  }

  const accept = headers["sec-websocket-accept"];
  if (!accept) {
    return { ok: false, reason: "missing-accept", status };
  }
  if (accept !== expectedAccept) {
    return { ok: false, reason: "bad-accept", status };
  }

  return { ok: true, status: 101, remaining, headers };
}
