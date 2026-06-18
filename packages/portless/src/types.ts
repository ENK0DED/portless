/** Route info used by the proxy server to map hostnames to ports. */
export type RouteProtocol = "http1" | "h2c";

export type TunnelProviderName = "ngrok" | "cloudflare";

export interface RouteInfo {
  hostname: string;
  port: number;
  /** Route path prefix. Missing means root ("/") for backward compatibility. */
  pathPrefix?: string;
  /** Upstream protocol. Missing means HTTP/1.1 for backward compatibility. */
  protocol?: RouteProtocol;
  /**
   * Distinguishing label for a multiplexed route. When several routes share a
   * hostname (e.g. multiple worktrees of one app), the label is how the proxy's
   * app picker and the selection cookie tell them apart. Missing means the route
   * is the sole owner of its hostname (the default, single-owner behavior).
   */
  label?: string;
  /**
   * Public-exposure URLs, surfaced for display only (the dashboard and the
   * `list` command). These are populated on the live route objects the proxy
   * reads; the proxy itself never routes by them.
   */
  tailscaleUrl?: string;
  tailscaleServiceUrl?: string;
  tailscaleFunnel?: boolean;
  ngrokUrl?: string;
  tunnelUrl?: string;
  tunnelProvider?: TunnelProviderName;
  netbirdUrl?: string;
}

export interface TunnelAlias {
  /** Exact public tunnel hostname accepted by the proxy. */
  externalHostname: string;
  /** Local portless route hostname that receives traffic for this alias. */
  targetHostname: string;
  /** Target route path prefix. Missing means root ("/") for backward compatibility. */
  targetPathPrefix?: string;
  /** True when portless started and owns the tunnel process. */
  managed?: boolean;
  /** Provider that created this managed tunnel. */
  provider?: TunnelProviderName;
  /** Full public URL returned by the tunnel provider. */
  url?: string;
  /** Tunnel process PID, when known. */
  tunnelPid?: number;
  /** Portless CLI process that owns this managed alias. */
  routeOwnerPid?: number;
}

export interface ProxyServerOptions {
  /** Called on each request to get the current route table. */
  getRoutes: () => RouteInfo[];
  /** Called on each request to get exact public tunnel aliases. */
  getTunnelAliases?: () => TunnelAlias[];
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
  /**
   * Serve portless's own pages at reserved hostnames — the dashboard at
   * `portless.<suffix>` and the certificate trust page at `cert.<suffix>`.
   * Defaults to true. These are intercepted before route dispatch, so a user
   * app can never be reached at those hostnames.
   */
  internalPages?: boolean;
  /**
   * Returns whether the local CA is installed in the OS trust store, surfaced
   * on the dashboard and certificate page. Should be cheap/memoized — it is
   * called per internal-page request. Return undefined when unknown.
   */
  getCaTrusted?: () => boolean | undefined;
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
