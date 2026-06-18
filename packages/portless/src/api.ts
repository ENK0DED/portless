import { detectWorktreePrefix } from "./auto.js";
import { discoverState } from "./cli-utils.js";
import { formatUrl, normalizePathPrefix, parseHostname } from "./utils.js";

export interface ServiceUrl {
  /** The full URL, including protocol and any non-default proxy port. */
  url: string;
  /** The resolved hostname including suffix and any worktree prefix. */
  hostname: string;
  /** The proxy port used to build the URL. */
  port: number;
  /** Whether the proxy is serving HTTPS. */
  tls: boolean;
  /** The suffix configured on the proxy, e.g. localhost or test. */
  tld: string;
  /** Route path prefix. */
  pathPrefix: string;
  /** Coerce the object to its URL string. */
  toString(): string;
}

export interface GetUrlOptions {
  /**
   * Apply git worktree prefixes by default. Set to false for stable URLs
   * such as OAuth callbacks that must not vary by branch.
   */
  worktree?: boolean;
  /** Working directory used for git worktree detection. */
  cwd?: string;
  /** Optional route path prefix to append to the resolved URL. */
  pathPrefix?: string;
}

/**
 * Resolve the URL for a portless-managed service.
 *
 * This mirrors `portless get <name>`: it reads the active proxy's persisted
 * port, TLS mode, and suffix, applies the same hostname and worktree logic,
 * and returns both the URL string and its components.
 */
export async function getUrl(name: string, options: GetUrlOptions = {}): Promise<ServiceUrl> {
  const worktree = options.worktree === false ? null : detectWorktreePrefix(options.cwd);
  const effectiveName = worktree ? `${worktree.prefix}.${name}` : name;

  const { port, tls, tld } = await discoverState();
  const hostname = parseHostname(effectiveName, tld);
  const pathPrefix = normalizePathPrefix(options.pathPrefix);
  const url = formatUrl(hostname, port, tls, pathPrefix);

  const result = { url, hostname, port, tls, tld, pathPrefix } as ServiceUrl;
  Object.defineProperty(result, "toString", {
    value: () => url,
    enumerable: false,
    configurable: true,
    writable: true,
  });
  return result;
}
