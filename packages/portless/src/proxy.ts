import * as http from "node:http";
import * as http2 from "node:http2";
import * as net from "node:net";
import * as crypto from "node:crypto";
import type { ProxyServerOptions, RouteInfo, TunnelAlias } from "./types.js";
import { escapeHtml, formatUrl, matchesPathPrefix, normalizePathPrefix } from "./utils.js";
import { APP_SCRIPT, appList, renderPage } from "./pages.js";
import {
  dashboardStateJson,
  renderAppPicker,
  renderCertPage,
  renderDashboard,
  renderRouteRow,
} from "./internal-pages.js";
import {
  isH2WebSocketConnect,
  parseWebSocketUpgradeResponse,
  serializeWebSocketUpgradeRequest,
} from "./h2-websocket.js";

/** Cookie that remembers which app a multiplexed hostname should route to. */
const SELECTION_COOKIE = "portless_app";

/** Reserved request paths used by the multiplexed-host app picker. */
const MULTIPLEX_SELECT_PATH = "/__portless/select";
const MULTIPLEX_SWITCH_PATH = "/__portless/switch";

/** Parse a Cookie header into a name->value map (values URL-decoded). */
function parseCookieHeader(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    if (!name) continue;
    try {
      out[name] = decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      out[name] = part.slice(eq + 1).trim();
    }
  }
  return out;
}

/** Read the multiplex selection label from the request's cookies. */
function readSelectionCookie(req: http.IncomingMessage): string | undefined {
  return parseCookieHeader(req.headers.cookie)[SELECTION_COOKIE] || undefined;
}

/** Format a CA SHA-256 fingerprint as colon-separated uppercase byte pairs. */
function formatFingerprint(ca: Buffer): string {
  return crypto
    .createHash("sha256")
    .update(ca)
    .digest("hex")
    .toUpperCase()
    .replace(/(.{2})(?=.)/g, "$1:");
}

/** Stable signature of the route table, used for the dashboard's live refresh. */
function routeSignature(routes: RouteInfo[]): string {
  return routes
    .map(
      (r) =>
        `${r.hostname}|${normalizePathPrefix(r.pathPrefix)}|${r.port}|${r.label ?? ""}|${r.protocol ?? ""}|${[
          r.tailscaleUrl,
          r.tailscaleServiceUrl,
          r.tailscaleFunnel ? "f" : "",
          r.ngrokUrl,
          r.tunnelUrl,
          r.netbirdUrl,
        ]
          .filter(Boolean)
          .join(",")}`
    )
    .sort()
    .join("\n");
}

/**
 * Members sharing one hostname (multiplex). Returns the set only when more than
 * one live route occupies the same hostname + winning (longest) path prefix;
 * otherwise an empty array, so single-owner routing is completely unaffected.
 */
function multiplexMembersFor(routes: RouteInfo[], host: string, requestPath: string): RouteInfo[] {
  const candidates = routes.filter(
    (r) => r.hostname === host && matchesPathPrefix(requestPath, normalizePathPrefix(r.pathPrefix))
  );
  if (candidates.length < 2) return [];
  let longest = -1;
  for (const c of candidates) {
    const len = normalizePathPrefix(c.pathPrefix).length;
    if (len > longest) longest = len;
  }
  const members = candidates.filter((c) => normalizePathPrefix(c.pathPrefix).length === longest);
  return members.length > 1 ? members : [];
}

/** Pick a deterministic default member (lowest label) for non-interactive requests. */
function defaultMember(members: RouteInfo[]): RouteInfo {
  return members.slice().sort((a, b) => (a.label ?? "").localeCompare(b.label ?? ""))[0];
}

/** Response header used to identify a portless proxy (for health checks). */
export const PORTLESS_HEADER = "X-Portless";

/**
 * Response header reporting the actual local TCP port that accepted the
 * request. This prevents health-check false positives when pf/NAT redirects
 * another local port to the proxy.
 */
export const PORTLESS_LISTENER_PORT_HEADER = "X-Portless-Listener-Port";

/**
 * Upstream app connections stay on loopback, but support both IPv4 and IPv6.
 * Some dev servers bind localhost as ::1 only, while older portless builds
 * dialed only 127.0.0.1.
 */
export const LOOPBACK_DIAL_OPTIONS = {
  hostname: "localhost",
  host: "localhost",
  autoSelectFamily: true,
  lookup: ((_hostname, _options, callback) => {
    callback(null, [
      { address: "127.0.0.1", family: 4 },
      { address: "::1", family: 6 },
    ]);
  }) as net.LookupFunction,
} as const;

function dialErrorMessage(err: NodeJS.ErrnoException): string {
  return err.message || err.code || "connection failed";
}

function wantsHtml(req: http.IncomingMessage): boolean {
  const accept = req.headers.accept;
  const value = Array.isArray(accept) ? accept.join(",") : accept;
  if (!value) return false;
  return value.split(",").some((entry) => entry.trim().toLowerCase().split(";")[0] === "text/html");
}

function textSafe(value: string): string {
  return value.replace(/[\r\n]/g, " ");
}

function activeAppLinkSuffix(url: string): string {
  if (!url || url === "/" || !url.startsWith("/")) return "";
  return url;
}

/**
 * HTTP/1.1 hop-by-hop headers that are forbidden in HTTP/2 responses.
 * These must be stripped when proxying an HTTP/1.1 backend response
 * back to an HTTP/2 client.
 */
const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "http2-settings",
  "keep-alive",
  "proxy-connection",
  "transfer-encoding",
  "upgrade",
]);

/** Cap ordinary upstream connections so multiplexed clients cannot overload a backend. */
const MAX_UPSTREAM_SOCKETS = 64;
const REPLAYABLE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Remove Connection and every header named by its comma-separated token list. */
function stripConnectionHeaders(headers: http.OutgoingHttpHeaders): void {
  const connectionTokens = new Set<string>();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== "connection") continue;
    const values = Array.isArray(value) ? value : [value];
    for (const item of values) {
      if (typeof item !== "string") continue;
      for (const token of item.split(",")) {
        const normalized = token.trim().toLowerCase();
        if (normalized) connectionTokens.add(normalized);
      }
    }
  }

  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === "connection" || connectionTokens.has(key.toLowerCase())) {
      delete headers[key];
    }
  }
}

/** A request can be replayed only when its headers prove it has no body. */
function isBodylessRequest(req: http.IncomingMessage): boolean {
  if (req.headers["transfer-encoding"] !== undefined) return false;
  const contentLength = req.headers["content-length"];
  if (contentLength === undefined) return true;
  const values = Array.isArray(contentLength) ? contentLength : [contentLength];
  return values.every((value) => value.trim() === "0");
}

/**
 * Get the effective host value from a request.
 * HTTP/2 uses the :authority pseudo-header; HTTP/1.1 uses Host.
 */
function getRequestHost(req: http.IncomingMessage): string {
  // HTTP/2 :authority pseudo-header (available via compatibility API)
  const authority = req.headers[":authority"];
  if (typeof authority === "string" && authority) return authority;
  return req.headers.host || "";
}

interface ClassifiedRequestTarget {
  /** Raw origin-form spelling used for route selection. */
  matchPath: string;
  /** Target sent to the backend. Absolute-form is rewritten to origin-form. */
  forwardTarget: string;
}

/**
 * Classify a request target without decoding or canonicalizing its path.
 * Absolute-form is accepted only when its canonical origin agrees with the
 * connection authority, then its raw path and query are forwarded as
 * origin-form. Other non-origin forms are unroutable.
 */
function classifyRequestTarget(
  rawTarget: string,
  method: string | undefined,
  authority: string,
  tls: boolean
): ClassifiedRequestTarget | undefined {
  if (rawTarget === "*") {
    return method === "OPTIONS" ? { matchPath: "/", forwardTarget: "*" } : undefined;
  }
  if (rawTarget.startsWith("/")) {
    return { matchPath: rawTarget, forwardTarget: rawTarget };
  }

  const absolute = /^([A-Za-z][A-Za-z0-9+.-]*):\/\/([^/?#]*)(.*)$/.exec(rawTarget);
  if (!absolute || !authority || absolute[3].includes("#")) return undefined;

  const scheme = absolute[1].toLowerCase();
  const connectionScheme = tls ? "https" : "http";
  if (scheme !== connectionScheme) return undefined;

  try {
    const targetUrl = new URL(rawTarget);
    const connectionUrl = new URL(`${connectionScheme}://${authority}`);
    if (
      targetUrl.username ||
      targetUrl.password ||
      connectionUrl.username ||
      connectionUrl.password ||
      targetUrl.origin !== connectionUrl.origin
    ) {
      return undefined;
    }
  } catch {
    return undefined;
  }

  const remainder = absolute[3];
  const originForm =
    remainder === "" ? "/" : remainder.startsWith("?") ? `/${remainder}` : remainder;
  return { matchPath: originForm, forwardTarget: originForm };
}

function writeBadRequest(res: http.ServerResponse): void {
  res.writeHead(400, { "Content-Type": "text/plain" });
  res.end("Bad Request: unsupported or mismatched request target\n");
}

/** Return the local TCP port that accepted this request. */
function getListenerPort(req: http.IncomingMessage, fallbackPort: number): string {
  const port = req.socket.localPort;
  return typeof port === "number" && port > 0 ? String(port) : String(fallbackPort);
}

/**
 * Detect whether a request arrived over an encrypted (TLS) connection.
 * Works for both native TLS sockets and HTTP/2 streams.
 */
function isEncrypted(req: http.IncomingMessage): boolean {
  return !!(req.socket as net.Socket & { encrypted?: boolean }).encrypted;
}

/**
 * Build X-Forwarded-* headers for a proxied request.
 */
function buildForwardedHeaders(req: http.IncomingMessage, tls: boolean): Record<string, string> {
  const headers: Record<string, string> = {};
  const remoteAddress = req.socket.remoteAddress || "127.0.0.1";
  const proto = tls ? "https" : "http";
  const defaultPort = tls ? "443" : "80";
  const hostHeader = getRequestHost(req);

  headers["x-forwarded-for"] = req.headers["x-forwarded-for"]
    ? `${req.headers["x-forwarded-for"]}, ${remoteAddress}`
    : remoteAddress;
  headers["x-forwarded-proto"] = (req.headers["x-forwarded-proto"] as string) || proto;
  headers["x-forwarded-host"] = (req.headers["x-forwarded-host"] as string) || hostHeader;
  headers["x-forwarded-port"] =
    (req.headers["x-forwarded-port"] as string) || hostHeader.split(":")[1] || defaultPort;

  return headers;
}

type H2cSessionCache = Map<number, http2.ClientHttp2Session>;

function closeH2cSessions(sessions: H2cSessionCache): void {
  for (const session of sessions.values()) {
    session.close();
  }
  sessions.clear();
}

function getH2cSession(port: number, sessions: H2cSessionCache): http2.ClientHttp2Session {
  const existing = sessions.get(port);
  if (existing && !existing.closed && !existing.destroyed) {
    return existing;
  }

  const session = http2.connect(`http://localhost:${port}`, {
    createConnection: () =>
      net.connect({
        ...LOOPBACK_DIAL_OPTIONS,
        port,
      }),
  });
  const remove = () => {
    if (sessions.get(port) === session) {
      sessions.delete(port);
    }
  };
  session.on("close", remove);
  session.on("goaway", remove);
  session.on("error", remove);
  sessions.set(port, session);
  return session;
}

function h2cResponseHeaders(headers: http2.IncomingHttpHeaders): {
  status: number;
  headers: http.OutgoingHttpHeaders;
} {
  const status = Number(headers[":status"]) || 502;
  const responseHeaders: http.OutgoingHttpHeaders = {};
  for (const [key, value] of Object.entries(headers)) {
    if (key.startsWith(":") || HOP_BY_HOP_HEADERS.has(key.toLowerCase())) continue;
    responseHeaders[key] = value as string | string[];
  }
  return { status, headers: responseHeaders };
}

function h2cRequestHeaders(
  req: http.IncomingMessage,
  reqTls: boolean,
  hops: number,
  forwardTarget: string
): http2.OutgoingHttpHeaders {
  const forwardedHeaders = buildForwardedHeaders(req, reqTls);
  const headers: http2.OutgoingHttpHeaders = {
    ":method": req.method || "GET",
    ":path": forwardTarget,
    ":scheme": "http",
    ":authority": getRequestHost(req),
  };

  for (const [key, value] of Object.entries(req.headers)) {
    const lower = key.toLowerCase();
    if (lower.startsWith(":") || lower === "host" || HOP_BY_HOP_HEADERS.has(lower)) continue;
    if (lower === "te" && value !== "trailers") continue;
    headers[lower] = value as string | string[];
  }
  for (const [key, value] of Object.entries(forwardedHeaders)) {
    headers[key] = value;
  }
  headers[PORTLESS_HOPS_HEADER] = String(hops + 1);

  return headers;
}

function writePlainBadGateway(
  res: http.ServerResponse,
  route: { port: number },
  detail = "The target app may not be running."
): void {
  res.writeHead(502, { "Content-Type": "text/plain" });
  res.end(
    [
      `Bad Gateway: ${detail}`,
      `Target: 127.0.0.1:${route.port}`,
      "Check active routes with: portless list",
    ].join("\n") + "\n"
  );
}

function proxyH2c(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  route: { hostname: string; port: number },
  reqTls: boolean,
  hops: number,
  sessions: H2cSessionCache,
  onError: (message: string) => void,
  forwardTarget: string
): void {
  const session = getH2cSession(route.port, sessions);
  const proxyReq = session.request(h2cRequestHeaders(req, reqTls, hops, forwardTarget));

  proxyReq.on("response", (headers) => {
    const response = h2cResponseHeaders(headers);
    res.writeHead(response.status, response.headers);
  });

  proxyReq.on("trailers", (headers) => {
    const trailers: Record<string, string | string[]> = {};
    for (const [key, value] of Object.entries(headers)) {
      if (key.startsWith(":") || value === undefined) continue;
      trailers[key] = value as string | string[];
    }
    if (Object.keys(trailers).length > 0) {
      res.addTrailers(trailers);
    }
  });

  proxyReq.on("error", (err) => {
    onError(`h2c proxy error for ${getRequestHost(req)}: ${dialErrorMessage(err)}`);
    if (!res.headersSent) {
      writePlainBadGateway(res, route);
    } else {
      res.destroy();
    }
  });

  proxyReq.on("end", () => {
    if (!res.destroyed) res.end();
  });

  res.on("close", () => {
    proxyReq.close(http2.constants.NGHTTP2_CANCEL);
  });
  req.on("error", () => {
    proxyReq.close(http2.constants.NGHTTP2_CANCEL);
  });

  proxyReq.pipe(res, { end: false });
  req.pipe(proxyReq);
}

/**
 * Request header tracking how many times a request has passed through a
 * portless proxy. Used to detect forwarding loops (e.g. a frontend dev
 * server proxying back through portless without rewriting the Host header).
 */
const PORTLESS_HOPS_HEADER = "x-portless-hops";

/**
 * Maximum number of times a request may pass through the portless proxy
 * before it is rejected as a loop. Two hops is normal when a frontend
 * proxies API calls to a separate portless-managed backend; five gives
 * comfortable headroom for multi-tier setups while catching loops quickly.
 */
const MAX_PROXY_HOPS = 5;

/** Normalize an authority for case-insensitive matching and default HTTPS port handling. */
function normalizeAuthority(authority: string): string {
  const lower = authority.toLowerCase();
  return lower.endsWith(":443") ? lower.slice(0, -4) : lower;
}

/** Extract the hostname portion from a normalized request authority. */
function authorityHostname(authority: string): string {
  if (authority.startsWith("[")) {
    const closingBracket = authority.indexOf("]");
    return closingBracket === -1 ? authority : authority.slice(0, closingBracket + 1);
  }

  const lastColon = authority.lastIndexOf(":");
  const port = authority.slice(lastColon + 1);
  return lastColon > -1 && /^\d+$/.test(port) ? authority.slice(0, lastColon) : authority;
}

/** Return the normalized authority stored in a Tailscale URL, or undefined if invalid. */
function tailscaleAuthority(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return normalizeAuthority(new URL(url).host);
  } catch {
    return undefined;
  }
}

function routeTailscaleAuthorities(route: RouteInfo): string[] {
  return [route.tailscaleUrl, route.tailscaleServiceUrl]
    .map(tailscaleAuthority)
    .filter((authority): authority is string => authority !== undefined);
}

/** Pick the route with the longest matching path prefix. */
function pickLongestPathRoute(routes: RouteInfo[], requestPath: string): RouteInfo | undefined {
  let best: RouteInfo | undefined;
  let bestLength = -1;
  for (const route of routes) {
    const pathPrefix = normalizePathPrefix(route.pathPrefix);
    if (!matchesPathPrefix(requestPath, pathPrefix)) continue;
    if (pathPrefix.length > bestLength) {
      best = route;
      bestLength = pathPrefix.length;
    }
  }
  return best;
}

/**
 * Find the route matching a request authority. Exact local routes win first,
 * followed by exact tunnel aliases, exact Tailscale authorities, and then
 * Tailscale hostnames when the request port differs. The final non-strict
 * fallback is the existing local subdomain match.
 */
function findRoute(
  routes: RouteInfo[],
  tunnelAliases: TunnelAlias[],
  host: string,
  requestPath: string,
  strict?: boolean
): RouteInfo | undefined {
  const authority = normalizeAuthority(host);
  const hostname = authorityHostname(authority);
  const exact = pickLongestPathRoute(
    routes.filter((r) => r.hostname === hostname),
    requestPath
  );
  if (exact) return exact;

  const alias = tunnelAliases.find((entry) => entry.externalHostname === hostname);
  if (alias) {
    const targetPathPrefix = normalizePathPrefix(alias.targetPathPrefix);
    if (matchesPathPrefix(requestPath, targetPathPrefix)) {
      return routes.find(
        (route) =>
          route.hostname === alias.targetHostname &&
          normalizePathPrefix(route.pathPrefix) === targetPathPrefix
      );
    }
  }

  const tailscaleAuthorityRoute = pickLongestPathRoute(
    routes.filter((route) => routeTailscaleAuthorities(route).includes(authority)),
    requestPath
  );
  if (tailscaleAuthorityRoute) return tailscaleAuthorityRoute;

  const tailscaleHostnameRoute = pickLongestPathRoute(
    routes.filter((route) =>
      routeTailscaleAuthorities(route).some(
        (routeAuthority) => authorityHostname(routeAuthority) === hostname
      )
    ),
    requestPath
  );
  if (tailscaleHostnameRoute) return tailscaleHostnameRoute;

  if (strict) return undefined;
  return pickLongestPathRoute(
    routes.filter((r) => hostname.endsWith("." + r.hostname)),
    requestPath
  );
}

interface H2WebSocketRouteSelection {
  host: string;
  authority: string;
  path: string;
  matchPath: string;
  hops: number;
  route?: RouteInfo;
  rejectReason?:
    | "missing-host"
    | "internal-host"
    | "loop"
    | "bad-target"
    | "missing-route"
    | "h2c-route";
}

function singleHeaderValue(value: string | string[] | number | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (Array.isArray(value)) return value.map(String).join(", ");
  return String(value);
}

function h2WebSocketResponseHeaders(headers: http2.IncomingHttpHeaders): http2.OutgoingHttpHeaders {
  const responseHeaders: http2.OutgoingHttpHeaders = { ":status": 200 };
  const protocol = singleHeaderValue(headers["sec-websocket-protocol"]);
  if (protocol && !protocol.includes(",")) {
    responseHeaders["sec-websocket-protocol"] = protocol;
  }
  return responseHeaders;
}

/** Server type returned by createProxyServer (plain HTTP/1.1 or net.Server TLS wrapper). */
export type ProxyServer = http.Server | net.Server;

/**
 * Create an HTTP proxy server that routes requests based on the Host header.
 *
 * Uses Node's built-in http module for proxying (no external dependencies).
 * The `getRoutes` callback is invoked on every request so callers can provide
 * either a static list or a live-updating one.
 *
 * When `tls` is provided, creates an HTTP/2 secure server with HTTP/1.1
 * fallback (`allowHTTP1: true`). This enables HTTP/2 multiplexing for
 * browsers while keeping WebSocket upgrades working over HTTP/1.1.
 */
export function createProxyServer(options: ProxyServerOptions): ProxyServer {
  const {
    getRoutes,
    getTunnelAliases = () => [],
    proxyPort,
    tld = "localhost",
    tlds = [tld],
    strict = true,
    onError = (msg: string) => console.error(msg),
    tls,
    internalPages = true,
    getCaTrusted,
  } = options;
  const configuredTlds = [...new Set(tlds.length > 0 ? tlds : [tld])];
  const primaryTld = configuredTlds[0] ?? "localhost";
  const tldSuffix = `.${primaryTld}`;
  const tldSuffixes = configuredTlds
    .map((configuredTld) => `.${configuredTld}`)
    .sort((a, b) => b.length - a.length);
  const h2cSessions: H2cSessionCache = new Map();

  // Reserved internal hostnames. Intercepted before route dispatch so a user
  // app can never shadow them, and derived from the live suffix so they follow
  // a custom PORTLESS_SUFFIX (e.g. portless.test / cert.test).
  const dashboardHosts = new Set(configuredTlds.map((suffix) => `portless.${suffix}`));
  const certHosts = new Set(configuredTlds.map((suffix) => `cert.${suffix}`));
  const isInternalHost = (host: string): boolean => dashboardHosts.has(host) || certHosts.has(host);
  const suffixForHost = (host: string): string => {
    const matched = tldSuffixes.find((suffix) => host.endsWith(suffix));
    return matched?.slice(1) ?? primaryTld;
  };
  const caFingerprint = tls?.ca ? formatFingerprint(tls.ca) : undefined;
  const upstreamAgent = new http.Agent({
    keepAlive: true,
    maxSockets: MAX_UPSTREAM_SOCKETS,
  });
  upstreamAgent.createConnection = (options) =>
    net.connect({
      ...LOOPBACK_DIAL_OPTIONS,
      port: options.port as number,
    });

  const hostPort = (reqTls: boolean): string =>
    proxyPort === (reqTls ? 443 : 80) ? "" : `:${proxyPort}`;

  /**
   * Serve portless's own pages (dashboard, certificate trust + CA download) at
   * the reserved hostnames. Returns true when the request was handled.
   */
  const serveInternalPage = (
    req: http.IncomingMessage,
    res: http.ServerResponse,
    host: string,
    reqTls: boolean,
    requestTarget: string
  ): boolean => {
    if (!internalPages) return false;
    if (!isInternalHost(host)) return false;
    const pageSuffix = suffixForHost(host);
    const dashboardHost = `portless.${pageSuffix}`;
    const certHost = `cert.${pageSuffix}`;

    const method = req.method || "GET";
    if (method !== "GET" && method !== "HEAD") {
      res.writeHead(405, { "Content-Type": "text/plain", Allow: "GET, HEAD" });
      res.end("Method Not Allowed\n");
      return true;
    }
    const isHead = method === "HEAD";
    const pathname = requestTarget.split(/[?#]/, 1)[0] || "/";

    if (host === certHost) {
      if (pathname === "/portless-ca.pem" || pathname === "/ca.pem") {
        if (!tls?.ca) {
          res.writeHead(404, { "Content-Type": "text/plain" });
          res.end("No CA certificate available (the proxy is running without HTTPS).\n");
          return true;
        }
        res.writeHead(200, {
          "Content-Type": "application/x-x509-ca-cert",
          "Content-Disposition": 'attachment; filename="portless-ca.pem"',
          "Cache-Control": "no-store",
        });
        res.end(isHead ? undefined : tls.ca);
        return true;
      }
      const body = renderCertPage({
        suffix: pageSuffix,
        downloadPath: "/portless-ca.pem",
        fingerprint: caFingerprint,
        trustedHere: getCaTrusted?.(),
        dashboardUrl: `${reqTls ? "https" : "http"}://${dashboardHost}${hostPort(reqTls)}/`,
      });
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      });
      res.end(isHead ? undefined : body);
      return true;
    }

    // Dashboard host
    const routes = getRoutes();
    const signature = routeSignature(routes);
    if (pathname === "/__portless/state.json") {
      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      res.end(isHead ? undefined : dashboardStateJson({ routes, signature }));
      return true;
    }
    const body = renderDashboard({
      routes,
      proxyPort,
      tls: reqTls,
      suffix: pageSuffix,
      caTrusted: getCaTrusted?.(),
      certHost,
      signature,
    });
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    res.end(isHead ? undefined : body);
    return true;
  };

  /**
   * Resolve a multiplexed hostname to a single member route. Returns the chosen
   * route, or undefined when this call already served a picker page / redirect
   * (the caller must then stop). portless never mutates app responses — the
   * selection lives entirely in our own interstitial responses.
   */
  const resolveMultiplex = (
    req: http.IncomingMessage,
    res: http.ServerResponse,
    members: RouteInfo[],
    host: string,
    requestPath: string,
    reqTls: boolean
  ): RouteInfo | undefined => {
    const pathname = requestPath.split(/[?#]/, 1)[0] || "/";
    const pageSuffix = suffixForHost(host);
    const certHost = `cert.${pageSuffix}`;
    const base = `${reqTls ? "https" : "http"}://${host}${hostPort(reqTls)}`;
    const liveLabels = new Set(members.map((m) => m.label).filter(Boolean) as string[]);
    const selected = readSelectionCookie(req);

    const servePicker = (): void => {
      const body = renderAppPicker({
        host,
        members: members.map((m) => ({
          label: m.label || `:${m.port}`,
          port: m.port,
          protocol: m.protocol,
        })),
        selectPath: MULTIPLEX_SELECT_PATH,
        current: selected && liveLabels.has(selected) ? selected : undefined,
        suffix: pageSuffix,
        proxyPort,
        tls: reqTls,
        caTrusted: getCaTrusted?.(),
        certHost,
      });
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      });
      res.end(body);
    };

    if (pathname === MULTIPLEX_SELECT_PATH) {
      const qIndex = requestPath.indexOf("?");
      const params = new URLSearchParams(qIndex === -1 ? "" : requestPath.slice(qIndex + 1));
      const label = params.get("label") || "";
      if (label && liveLabels.has(label)) {
        res.writeHead(302, {
          Location: `${base}/`,
          "Set-Cookie": `${SELECTION_COOKIE}=${encodeURIComponent(label)}; Path=/; Max-Age=31536000; SameSite=Lax${reqTls ? "; Secure" : ""}`,
          "Cache-Control": "no-store",
        });
        res.end();
        return undefined;
      }
      servePicker();
      return undefined;
    }

    if (pathname === MULTIPLEX_SWITCH_PATH) {
      servePicker();
      return undefined;
    }

    if (selected && liveLabels.has(selected)) {
      return members.find((m) => m.label === selected);
    }

    // No valid selection yet. Show the picker for page navigations; for
    // sub-resources (assets, XHR) fall back to a deterministic member so the
    // page the user eventually picks still resolves its requests.
    if (wantsHtml(req)) {
      servePicker();
      return undefined;
    }
    return defaultMember(members);
  };

  const cookieHeaderValue = (value: http2.IncomingHttpHeaders["cookie"]): string | undefined => {
    if (Array.isArray(value)) return value.join("; ");
    return value;
  };

  const selectH2WebSocketRoute = (
    headers: http2.IncomingHttpHeaders
  ): H2WebSocketRouteSelection => {
    const authority = String(headers[":authority"] || "");
    const host = authority.split(":")[0];
    const rawPath = String(headers[":path"] || "/");
    const target = classifyRequestTarget(rawPath, "CONNECT", authority, true);
    const path = target?.forwardTarget ?? rawPath;
    const matchPath = target?.matchPath ?? rawPath;
    const hops = parseInt(headers[PORTLESS_HOPS_HEADER] as string, 10) || 0;
    const base = { host, authority, path, matchPath, hops };

    if (!host) return { ...base, rejectReason: "missing-host" };
    if (!target) return { ...base, rejectReason: "bad-target" };
    if (internalPages && isInternalHost(host)) {
      return { ...base, rejectReason: "internal-host" };
    }
    if (hops >= MAX_PROXY_HOPS) {
      onError(
        `WebSocket loop detected for ${host}: request has passed through portless ${hops} times. ` +
          `Set changeOrigin: true in your proxy config.`
      );
      return { ...base, rejectReason: "loop" };
    }

    const routes = getRoutes();
    const tunnelAliases = getTunnelAliases();
    const members = multiplexMembersFor(routes, host, matchPath);
    let route: RouteInfo | undefined;
    if (members.length > 0) {
      const selected = parseCookieHeader(cookieHeaderValue(headers.cookie))[SELECTION_COOKIE];
      route =
        (selected ? members.find((member) => member.label === selected) : undefined) ??
        defaultMember(members);
    } else {
      route = findRoute(routes, tunnelAliases, authority, matchPath, strict);
    }

    if (!route) return { ...base, rejectReason: "missing-route" };
    if (route.protocol === "h2c") {
      onError(
        `WebSocket-over-HTTP/2 to h2c upstream is not supported for ${host}${path}. ` +
          `Use HTTP/2 request routing for h2c routes instead.`
      );
      return { ...base, route, rejectReason: "h2c-route" };
    }

    return { ...base, route };
  };

  const handleH2WebSocket = (
    stream: http2.ServerHttp2Stream,
    headers: http2.IncomingHttpHeaders
  ): void => {
    stream.on("error", () => stream.destroy());
    const responseHeaders = h2WebSocketResponseHeaders(headers);
    const responseProtocol = singleHeaderValue(responseHeaders["sec-websocket-protocol"]);
    try {
      stream.respond(responseHeaders, { endStream: false });
    } catch {
      stream.destroy();
      return;
    }

    const selection = selectH2WebSocketRoute(headers);
    if (!selection.route || selection.rejectReason) {
      stream.close(http2.constants.NGHTTP2_CANCEL);
      return;
    }

    const sessionSocket = stream.session?.socket;
    if (!sessionSocket) {
      stream.close(http2.constants.NGHTTP2_CANCEL);
      return;
    }

    const fakeReq = {
      socket: sessionSocket,
      headers: { ...headers, host: selection.authority },
    } as unknown as http.IncomingMessage;
    let serialized: ReturnType<typeof serializeWebSocketUpgradeRequest>;
    try {
      serialized = serializeWebSocketUpgradeRequest({
        authority: selection.authority,
        path: selection.path,
        headers,
        forwardedHeaders: buildForwardedHeaders(fakeReq, true),
        hops: selection.hops,
      });
    } catch (err) {
      onError(
        `WebSocket-over-HTTP/2 request rejected for ${selection.host}: ${
          err instanceof Error ? err.message : "unsafe request"
        }`
      );
      stream.close(http2.constants.NGHTTP2_CANCEL);
      return;
    }

    const backendSocket = net.connect({
      ...LOOPBACK_DIAL_OPTIONS,
      port: selection.route.port,
    });
    let cleaned = false;
    let bridged = false;
    let handshakeBuffer = Buffer.alloc(0);

    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      backendSocket.destroy();
      if (!stream.destroyed) {
        try {
          stream.close(http2.constants.NGHTTP2_CANCEL);
        } catch {
          stream.destroy();
        }
      }
    };

    const onBackendData = (chunk: Buffer) => {
      if (bridged) return;
      handshakeBuffer = Buffer.concat([handshakeBuffer, chunk]);
      const parsed = parseWebSocketUpgradeResponse(handshakeBuffer, serialized.expectedAccept);
      if (!parsed.ok && parsed.reason === "incomplete") return;
      if (!parsed.ok) {
        cleanup();
        return;
      }
      if (responseProtocol && parsed.headers["sec-websocket-protocol"] !== responseProtocol) {
        cleanup();
        return;
      }

      bridged = true;
      backendSocket.off("data", onBackendData);
      if (parsed.remaining.length > 0) {
        stream.write(parsed.remaining);
      }
      backendSocket.pipe(stream);
      stream.pipe(backendSocket);
    };

    backendSocket.on("connect", () => {
      backendSocket.write(serialized.request);
    });
    backendSocket.on("data", onBackendData);
    backendSocket.on("error", (err) => {
      onError(
        `WebSocket-over-HTTP/2 backend error for ${selection.host}: ${dialErrorMessage(err)}`
      );
      cleanup();
    });
    backendSocket.on("close", cleanup);
    backendSocket.on("end", cleanup);
    stream.on("close", cleanup);
    stream.on("aborted", cleanup);
  };

  const handleRequest = (req: http.IncomingMessage, res: http.ServerResponse, isReplay = false) => {
    const reqTls = isEncrypted(req);
    res.setHeader(PORTLESS_HEADER, "1");
    res.setHeader(PORTLESS_LISTENER_PORT_HEADER, getListenerPort(req, proxyPort));

    const routes = getRoutes();
    const tunnelAliases = getTunnelAliases();
    const rawHost = getRequestHost(req);
    const host = rawHost.split(":")[0];

    if (!host) {
      res.writeHead(400, { "Content-Type": "text/plain" });
      res.end("Missing Host header");
      return;
    }

    const target = classifyRequestTarget(req.url || "/", req.method, rawHost, reqTls);
    if (!target) {
      writeBadRequest(res);
      return;
    }

    // Reserved portless pages (dashboard, certificate trust) win before any
    // route lookup or loop detection, so a user app can never shadow them.
    if (serveInternalPage(req, res, host, reqTls, target.forwardTarget)) return;

    const hops = parseInt(req.headers[PORTLESS_HOPS_HEADER] as string, 10) || 0;
    if (hops >= MAX_PROXY_HOPS) {
      onError(
        `Loop detected for ${host}: request has passed through portless ${hops} times. ` +
          `This usually means a backend is proxying back through portless without rewriting ` +
          `the Host header. If you use Vite/webpack proxy, set changeOrigin: true.`
      );
      if (!wantsHtml(req)) {
        res.writeHead(508, { "Content-Type": "text/plain" });
        res.end(
          [
            `Loop Detected: request for ${textSafe(host)} has passed through portless ${hops} times.`,
            "This usually means a dev server proxy is forwarding back through portless without rewriting the Host header.",
            "Set changeOrigin: true in your dev server proxy config.",
            `Example target: ${reqTls ? "https" : "http"}://<backend>${tldSuffix}${reqTls ? "" : ":<port>"}`,
          ].join("\n") + "\n"
        );
        return;
      }
      res.writeHead(508, { "Content-Type": "text/html" });
      res.end(
        renderPage(
          508,
          "Loop Detected",
          `<div class="content"><p class="desc">This request has passed through portless ${hops} times. This usually means a dev server (Vite, webpack, etc.) is proxying requests back through portless without rewriting the Host header.</p><div class="section"><p class="label">Fix: add changeOrigin to your proxy config</p><pre class="terminal">proxy: {
  "/api": {
    target: "${reqTls ? "https" : "http"}://&lt;backend&gt;${escapeHtml(tldSuffix)}${reqTls ? "" : ":&lt;port&gt;"}",
    changeOrigin: true,
  },
}</pre></div></div>`
        )
      );
      return;
    }

    const requestPath = target.matchPath;
    const members = multiplexMembersFor(routes, host, requestPath);
    let route: RouteInfo | undefined;
    if (members.length > 0) {
      route = resolveMultiplex(req, res, members, host, requestPath, reqTls);
      if (!route) return; // a picker page or selection redirect was served
    } else {
      route = findRoute(routes, tunnelAliases, rawHost, requestPath, strict);
    }

    if (!route) {
      const safeHost = escapeHtml(host);
      const matchedSuffix = tldSuffixes.find((suffix) => host.endsWith(suffix));
      const strippedHost =
        matchedSuffix && matchedSuffix.length < host.length
          ? host.slice(0, -matchedSuffix.length)
          : host;
      const safeSuggestion = escapeHtml(strippedHost);
      if (!wantsHtml(req)) {
        const lines = [`No app registered for ${textSafe(host)}.`];
        if (routes.length > 0) {
          lines.push("Active apps:");
          for (const route of routes) {
            const pathPrefix = normalizePathPrefix(route.pathPrefix);
            const label = pathPrefix === "/" ? route.hostname : `${route.hostname}${pathPrefix}`;
            lines.push(`- ${textSafe(label)} -> 127.0.0.1:${route.port}`);
          }
        } else {
          lines.push("No apps running.");
        }
        lines.push(`Register it with: portless ${textSafe(strippedHost)} your-command`);
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end(lines.join("\n") + "\n");
        return;
      }
      const linkSuffix = activeAppLinkSuffix(target.forwardTarget);
      const routesList =
        routes.length > 0
          ? `<div class="section"><p class="label">Apps <span class="count">${routes.length}</span></p>${appList(
              routes.map((r) => {
                const pathPrefix = normalizePathPrefix(r.pathPrefix);
                const hrefSuffix = pathPrefix === "/" ? linkSuffix : "";
                const url = `${formatUrl(r.hostname, proxyPort, reqTls, pathPrefix)}${hrefSuffix}`;
                return renderRouteRow(r, { url, copyUrl: url, status: "active", newTab: true });
              })
            )}</div>`
          : '<p class="empty">No apps running.</p>';
      res.writeHead(404, { "Content-Type": "text/html" });
      res.end(
        renderPage(
          404,
          "Not Found",
          `<div class="content"><p class="desc">No app registered for <strong>${safeHost}</strong></p>${routesList}<div class="section"><div class="terminal"><span class="prompt">$ </span>portless ${safeSuggestion} your-command</div></div></div>`,
          APP_SCRIPT
        )
      );
      return;
    }

    if (route.protocol === "h2c") {
      proxyH2c(req, res, route, reqTls, hops, h2cSessions, onError, target.forwardTarget);
      return;
    }

    const forwardedHeaders = buildForwardedHeaders(req, reqTls);
    const proxyReqHeaders: http.OutgoingHttpHeaders = { ...req.headers };
    for (const [key, value] of Object.entries(forwardedHeaders)) {
      proxyReqHeaders[key] = value;
    }
    proxyReqHeaders[PORTLESS_HOPS_HEADER] = String(hops + 1);
    stripConnectionHeaders(proxyReqHeaders);
    // Remove HTTP/2 pseudo-headers before forwarding to HTTP/1.1 backend
    for (const key of Object.keys(proxyReqHeaders)) {
      if (key.startsWith(":")) {
        delete proxyReqHeaders[key];
      }
    }
    // HTTP/2 carries the hostname only in :authority (stripped above); restore
    // it as Host so Host-dependent backends (multi-tenant vhosts, framework
    // host allow-lists) see the original hostname instead of 127.0.0.1.
    if (!proxyReqHeaders.host) {
      proxyReqHeaders.host = getRequestHost(req);
    }

    const proxyReq = http.request(
      {
        agent: upstreamAgent,
        port: route.port,
        path: target.forwardTarget,
        method: req.method,
        headers: proxyReqHeaders,
      },
      (proxyRes) => {
        const responseHeaders: http.OutgoingHttpHeaders = { ...proxyRes.headers };
        if (reqTls) {
          for (const h of HOP_BY_HOP_HEADERS) {
            delete responseHeaders[h];
          }
        }
        res.writeHead(proxyRes.statusCode || 502, responseHeaders);
        proxyRes.on("error", () => {
          if (!res.headersSent) {
            res.writeHead(502, { "Content-Type": "text/plain" });
            res.end();
          } else {
            // Headers already sent (mid-stream): destroy instead of end to
            // send RST_STREAM. Calling res.end() here can cause a
            // content-length mismatch that Chrome treats as a session error.
            res.destroy();
          }
        });
        proxyRes.pipe(res);
      }
    );

    proxyReq.on("error", (err) => {
      const errWithCode = err as NodeJS.ErrnoException;
      if (
        !isReplay &&
        proxyReq.reusedSocket &&
        errWithCode.code === "ECONNRESET" &&
        !res.headersSent &&
        REPLAYABLE_METHODS.has(req.method || "") &&
        isBodylessRequest(req)
      ) {
        req.unpipe(proxyReq);
        handleRequest(req, res, true);
        return;
      }
      onError(`Proxy error for ${getRequestHost(req)}: ${dialErrorMessage(err)}`);
      if (!res.headersSent) {
        const detail =
          errWithCode.code === "ECONNREFUSED"
            ? "The target app is not responding. It may have crashed."
            : "The target app may not be running.";
        if (!wantsHtml(req)) {
          res.writeHead(502, { "Content-Type": "text/plain" });
          res.end(
            [
              `Bad Gateway: ${detail}`,
              `Target: 127.0.0.1:${route.port}`,
              "Check active routes with: portless list",
            ].join("\n") + "\n"
          );
          return;
        }
        res.writeHead(502, { "Content-Type": "text/html" });
        res.end(
          renderPage(
            502,
            "Bad Gateway",
            `<div class="content"><p class="desc">${escapeHtml(detail)}</p></div>`
          )
        );
      }
    });

    // Abort the outgoing request if the client disconnects
    res.on("close", () => {
      if (!proxyReq.destroyed) {
        proxyReq.destroy();
      }
    });

    req.on("error", () => {
      if (!proxyReq.destroyed) {
        proxyReq.destroy();
      }
    });

    if (isReplay) {
      proxyReq.end();
    } else {
      req.pipe(proxyReq);
    }
  };

  const handleUpgrade = (req: http.IncomingMessage, socket: net.Socket, head: Buffer) => {
    socket.on("error", () => socket.destroy());

    const hops = parseInt(req.headers[PORTLESS_HOPS_HEADER] as string, 10) || 0;
    if (hops >= MAX_PROXY_HOPS) {
      const host = getRequestHost(req).split(":")[0];
      onError(
        `WebSocket loop detected for ${host}: request has passed through portless ${hops} times. ` +
          `Set changeOrigin: true in your proxy config.`
      );
      socket.end(
        "HTTP/1.1 508 Loop Detected\r\n" +
          "Content-Type: text/plain\r\n" +
          "\r\n" +
          "Loop Detected: request has passed through portless too many times.\n" +
          "Add changeOrigin: true to your dev server proxy config.\n"
      );
      return;
    }

    const routes = getRoutes();
    const tunnelAliases = getTunnelAliases();
    const rawHost = getRequestHost(req);
    const host = rawHost.split(":")[0];

    // Reserved internal hosts have no WebSocket surface.
    if (internalPages && isInternalHost(host)) {
      socket.destroy();
      return;
    }

    const target = classifyRequestTarget(req.url || "/", req.method, rawHost, isEncrypted(req));
    if (!target) {
      socket.end(
        "HTTP/1.1 400 Bad Request\r\n" +
          "Content-Type: text/plain\r\n" +
          "Connection: close\r\n" +
          "\r\n" +
          "Bad Request: unsupported or mismatched request target\n"
      );
      return;
    }

    const requestPath = target.matchPath;
    const members = multiplexMembersFor(routes, host, requestPath);
    let route: RouteInfo | undefined;
    if (members.length > 0) {
      // No picker over WebSockets: honor the selection cookie, else default.
      const selected = readSelectionCookie(req);
      route =
        (selected ? members.find((m) => m.label === selected) : undefined) ??
        defaultMember(members);
    } else {
      route = findRoute(routes, tunnelAliases, rawHost, requestPath, strict);
    }

    if (!route) {
      socket.destroy();
      return;
    }

    const forwardedHeaders = buildForwardedHeaders(req, isEncrypted(req));
    const proxyReqHeaders: http.OutgoingHttpHeaders = { ...req.headers };
    for (const [key, value] of Object.entries(forwardedHeaders)) {
      proxyReqHeaders[key] = value;
    }
    proxyReqHeaders[PORTLESS_HOPS_HEADER] = String(hops + 1);
    // Remove HTTP/2 pseudo-headers before forwarding to HTTP/1.1 backend
    for (const key of Object.keys(proxyReqHeaders)) {
      if (key.startsWith(":")) {
        delete proxyReqHeaders[key];
      }
    }
    // HTTP/2 carries the hostname only in :authority (stripped above); restore
    // it as Host so Host-dependent backends (multi-tenant vhosts, framework
    // host allow-lists) see the original hostname instead of 127.0.0.1.
    if (!proxyReqHeaders.host) {
      proxyReqHeaders.host = getRequestHost(req);
    }

    const proxyReq = http.request({
      agent: false,
      ...LOOPBACK_DIAL_OPTIONS,
      port: route.port,
      path: target.forwardTarget,
      method: req.method,
      headers: proxyReqHeaders,
    });

    // Once a handshake answer has reached the client, the connection may be
    // carrying WebSocket frames. Before that point, a proxy error can still
    // be reported as an HTTP response.
    let handshakeRelayed = false;

    proxyReq.on("upgrade", (proxyRes, proxySocket, proxyHead) => {
      handshakeRelayed = true;
      // Forward the backend's actual 101 response including Sec-WebSocket-Accept,
      // subprotocol negotiation, and extension headers.
      let response = `HTTP/1.1 101 Switching Protocols\r\n`;
      for (let i = 0; i < proxyRes.rawHeaders.length; i += 2) {
        response += `${proxyRes.rawHeaders[i]}: ${proxyRes.rawHeaders[i + 1]}\r\n`;
      }
      response += "\r\n";
      socket.write(response);

      if (proxyHead.length > 0) {
        socket.write(proxyHead);
      }
      proxySocket.pipe(socket);
      socket.pipe(proxySocket);

      // Tear down both sockets when either side disconnects. destroy() is
      // idempotent, so duplicate calls from multiple events are harmless.
      const cleanup = () => {
        proxySocket.destroy();
        socket.destroy();
      };
      proxySocket.on("error", cleanup);
      socket.on("error", cleanup);
      proxySocket.on("close", cleanup);
      socket.on("close", cleanup);
      proxySocket.on("end", cleanup);
      socket.on("end", cleanup);
    });

    proxyReq.on("error", (err) => {
      onError(`WebSocket proxy error for ${getRequestHost(req)}: ${dialErrorMessage(err)}`);
      if (!handshakeRelayed && socket.writable) {
        socket.end(
          "HTTP/1.1 502 Bad Gateway\r\n" +
            "Content-Type: text/plain\r\n" +
            "Connection: close\r\n" +
            "\r\n" +
            "Bad Gateway: the target app is not responding or sent an invalid response to the WebSocket handshake.\n"
        );
      } else {
        socket.destroy();
      }
    });

    proxyReq.on("response", (res) => {
      handshakeRelayed = true;
      // The backend responded with a normal HTTP response instead of upgrading.
      // Forward the rejection to the client.
      if (!socket.destroyed) {
        let response = `HTTP/1.1 ${res.statusCode} ${res.statusMessage}\r\n`;
        for (let i = 0; i < res.rawHeaders.length; i += 2) {
          response += `${res.rawHeaders[i]}: ${res.rawHeaders[i + 1]}\r\n`;
        }
        response += "\r\n";
        socket.write(response);
        res.on("error", () => socket.destroy());
        res.pipe(socket);
      }
    });

    if (head.length > 0) {
      proxyReq.write(head);
    }
    proxyReq.end();
  };

  if (tls) {
    const h2Server = http2.createSecureServer({
      cert: tls.ca ? Buffer.concat([tls.cert, tls.ca]) : tls.cert,
      key: tls.key,
      allowHTTP1: true,
      settings: { enableConnectProtocol: true },
      // Tolerate high rates of RST_STREAM from browsers during HMR and
      // page navigations. Without this, Node sends GOAWAY INTERNAL_ERROR
      // after ~1000 cumulative stream resets and kills the session,
      // surfacing as ERR_HTTP2_PROTOCOL_ERROR in Chrome. Available in
      // Node 22.11+; silently ignored on older versions.
      ...({ streamResetBurst: 10000, streamResetRate: 100 } as Record<string, unknown>),
      ...(tls.SNICallback ? { SNICallback: tls.SNICallback } : {}),
    });

    // Absorb session-level errors (connection resets, protocol errors from
    // abrupt client disconnects) so they don't crash the proxy.
    h2Server.on("sessionError", () => {});

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

    // With allowHTTP1, the 'request' event receives objects compatible with
    // http.IncomingMessage / http.ServerResponse. Cast explicitly to satisfy TypeScript.
    h2Server.on("request", (req: http2.Http2ServerRequest, res: http2.Http2ServerResponse) => {
      // Absorb RST_STREAM errors from cancelled requests (browser navigation,
      // HMR) so they don't propagate to the HTTP/2 session.
      req.stream?.on("error", () => {});
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
      handleRequest(req as unknown as http.IncomingMessage, res as unknown as http.ServerResponse);
    });
    // WebSocket upgrades arrive over HTTP/1.1 connections (allowHTTP1)
    h2Server.on("upgrade", (req: http.IncomingMessage, socket: net.Socket, head: Buffer) => {
      handleUpgrade(req, socket, head);
    });

    // Plain HTTP on a TLS-enabled port -> 302 redirect to HTTPS.
    // The redirect targets the same port because the wrapper net.Server
    // demuxes TLS and plain HTTP on a single listener (peek at first byte).
    const plainServer = http.createServer((req, res) => {
      const authority = getRequestHost(req);
      const host = authority.split(":")[0] || "localhost";
      const target = classifyRequestTarget(req.url || "/", req.method, authority, false);
      if (!target) {
        writeBadRequest(res);
        return;
      }
      const location = `https://${host}${proxyPort === 443 ? "" : `:${proxyPort}`}${target.forwardTarget}`;
      res.writeHead(302, { Location: location, [PORTLESS_HEADER]: "1" });
      res.end();
    });
    plainServer.on("upgrade", (req: http.IncomingMessage, socket: net.Socket, head: Buffer) => {
      const host = getRequestHost(req);
      console.warn(
        `[portless] Plain HTTP WebSocket upgrade received for ${host}; use wss:// instead`
      );
      handleUpgrade(req, socket, head);
    });

    // Wrap both in a net.Server that peeks at the first byte to decide
    // whether the connection is TLS (0x16 = ClientHello) or plain HTTP.
    const wrapper = net.createServer((socket) => {
      // Absorb connection errors (ECONNRESET, EPIPE, etc.) from abrupt
      // client disconnects (tab close, page reload, HMR) so they don't
      // bubble up as uncaught exceptions and crash the proxy (#111).
      socket.on("error", () => {
        socket.destroy();
      });
      socket.once("readable", () => {
        const buf: Buffer | null = socket.read(1);
        if (!buf) {
          socket.destroy();
          return;
        }
        socket.unshift(buf);
        if (buf[0] === 0x16) {
          // TLS handshake -> HTTP/2 secure server
          h2Server.emit("connection", socket);
        } else {
          // Plain HTTP -> redirect to HTTPS
          plainServer.emit("connection", socket);
        }
      });
    });

    // Proxy close() through to inner servers so tests and cleanup work.
    const origClose = wrapper.close.bind(wrapper);
    wrapper.close = function (cb?: (err?: Error) => void) {
      closeH2cSessions(h2cSessions);
      upstreamAgent.destroy();
      h2Server.close();
      plainServer.close();
      return origClose(cb);
    } as typeof wrapper.close;

    return wrapper;
  }

  const httpServer = http.createServer(handleRequest);
  httpServer.on("upgrade", handleUpgrade);
  httpServer.on("close", () => {
    closeH2cSessions(h2cSessions);
    upstreamAgent.destroy();
  });

  return httpServer;
}

/**
 * Create a minimal HTTP server that 302-redirects every request to HTTPS.
 * Meant to run on port 80 alongside an HTTPS proxy on port 443.
 */
export function createHttpRedirectServer(httpsPort: number): http.Server {
  return http.createServer((req, res) => {
    const authority = req.headers.host || "localhost";
    const host = authority.split(":")[0];
    const target = classifyRequestTarget(req.url || "/", req.method, authority, false);
    if (!target) {
      writeBadRequest(res);
      return;
    }
    const portSuffix = httpsPort === 443 ? "" : `:${httpsPort}`;
    const location = `https://${host}${portSuffix}${target.forwardTarget}`;
    res.writeHead(302, { Location: location, [PORTLESS_HEADER]: "1" });
    res.end();
  });
}
