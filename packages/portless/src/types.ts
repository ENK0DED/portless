/** Route info used by the proxy server to map hostnames to ports. */
export type RouteProtocol = "http1" | "h2c";

export interface RouteInfo {
  hostname: string;
  port: number;
  /** Upstream protocol. Missing means HTTP/1.1 for backward compatibility. */
  protocol?: RouteProtocol;
}

export interface ProxyServerOptions {
  /** Called on each request to get the current route table. */
  getRoutes: () => RouteInfo[];
  /** The port the proxy is listening on (used to build correct URLs). */
  proxyPort: number;
  /** Suffix used for hostnames (default: "localhost"). */
  tld?: string;
  /**
   * When true, only exact hostname matches are used. Unregistered subdomain
   * prefixes return 404 instead of falling back to the base service.
   * Defaults to true.
   */
  strict?: boolean;
  /** Optional error logger; defaults to console.error. */
  onError?: (message: string) => void;
  /** When provided, enables HTTP/2 over TLS (HTTPS). */
  tls?: {
    cert: Buffer;
    key: Buffer;
    /** CA certificate to include in the chain so clients can verify the leaf. */
    ca?: Buffer;
    /** SNI callback for per-hostname certificate selection. */
    SNICallback?: (
      servername: string,
      cb: (err: Error | null, ctx?: import("node:tls").SecureContext) => void
    ) => void;
  };
}
