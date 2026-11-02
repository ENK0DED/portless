import { applyWorktreePrefix, detectWorktreePrefix, resolveWorktreeFlat } from "./auto.js";
import { discoverState } from "./cli-utils.js";
import { loadConfig, resolveAppConfig, type WorktreeBranchMode } from "./config.js";
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
  /**
   * Use this label as the worktree prefix. It applies in a linked worktree,
   * the main checkout, and outside git. Cannot be combined with
   * `worktree: false`, and an empty string throws (use `worktree: false`).
   * Takes precedence over `PORTLESS_WORKTREE_PREFIX`.
   */
  worktreePrefix?: string;
  /** Override the project worktreeFlat setting for this lookup. */
  worktreeFlat?: boolean;
  /** Override the project worktreeBranch setting for this lookup. */
  worktreeBranch?: WorktreeBranchMode;
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
  const cwd = options.cwd ?? process.cwd();
  if (options.worktree === false && options.worktreePrefix !== undefined) {
    throw new Error("getUrl: worktree: false cannot be combined with worktreePrefix.");
  }
  if (options.worktreePrefix !== undefined && !options.worktreePrefix.trim()) {
    throw new Error("getUrl: worktreePrefix must not be empty. Use worktree: false to skip it.");
  }

  // Config is read even when no worktree is detected: an explicit prefix
  // applies outside linked worktrees and still needs the flat setting.
  let configuredFlat: boolean | undefined;
  let configuredBranch: WorktreeBranchMode | undefined;
  if (
    options.worktree !== false &&
    (options.worktreeFlat === undefined || options.worktreeBranch === undefined)
  ) {
    const loaded = loadConfig(cwd);
    if (loaded) {
      const app = resolveAppConfig(loaded.config, loaded.configDir, cwd);
      configuredFlat = app.worktreeFlat ?? loaded.config.worktreeFlat;
      configuredBranch = app.worktreeBranch ?? loaded.config.worktreeBranch;
    }
  }

  const worktree = detectWorktreePrefix(cwd, {
    disabled: options.worktree === false,
    prefix: options.worktreePrefix,
    branch: options.worktreeBranch ?? configuredBranch,
  });
  const effectiveName = applyWorktreePrefix(
    name,
    worktree,
    options.worktreeFlat ?? resolveWorktreeFlat(configuredFlat)
  );

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
