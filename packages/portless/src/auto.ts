import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import type { WorktreeBranchMode } from "./config.js";

// ---------------------------------------------------------------------------
// Hostname sanitization
// ---------------------------------------------------------------------------

/** Maximum length of a single DNS label per RFC 1035. */
const MAX_DNS_LABEL_LENGTH = 63;

/**
 * Truncate a DNS label to fit within the 63-character limit (RFC 1035).
 * When truncation is needed, a short hash suffix is appended to preserve
 * uniqueness (e.g. "very-long-name" → "very-long-na-a1b2c3").
 * The hash is derived from the full (pre-truncated) label.
 */
export function truncateLabel(label: string): string {
  if (label.length <= MAX_DNS_LABEL_LENGTH) return label;

  // 6-char hex hash from the full label for uniqueness after truncation
  const hash = createHash("sha256").update(label).digest("hex").slice(0, 6);
  // Reserve space for "-" separator + 6-char hash = 7 chars
  const maxPrefixLength = MAX_DNS_LABEL_LENGTH - 7;
  const prefix = label.slice(0, maxPrefixLength).replace(/-+$/, "");
  return `${prefix}-${hash}`;
}

/**
 * Sanitize a string for use as a .localhost hostname label.
 * Lowercases, replaces invalid characters with hyphens, collapses consecutive
 * hyphens, trims leading/trailing hyphens, and enforces the 63-character DNS
 * label limit (RFC 1035).
 */
export function sanitizeForHostname(name: string): string {
  const sanitized = name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
  return truncateLabel(sanitized);
}

// ---------------------------------------------------------------------------
// Project name inference
// ---------------------------------------------------------------------------

export interface InferredName {
  name: string;
  source: string;
}

/**
 * Infer the project name by walking up from `cwd`:
 *   1. package.json `name` field (strips `@scope/` prefix)
 *   2. Git repo root directory name
 *   3. Current directory basename
 *
 * First match that yields a non-empty sanitized name wins.
 */
export function inferProjectName(cwd: string = process.cwd()): InferredName {
  // 1. Walk up looking for package.json
  const pkgResult = findPackageJsonName(cwd);
  if (pkgResult) {
    const sanitized = sanitizeForHostname(pkgResult);
    if (sanitized) {
      return { name: sanitized, source: "package.json" };
    }
  }

  // 2. Git repo root directory name
  const gitRoot = findGitRoot(cwd);
  if (gitRoot) {
    const sanitized = sanitizeForHostname(path.basename(gitRoot));
    if (sanitized) {
      return { name: sanitized, source: "git root" };
    }
  }

  // 3. Current directory basename
  const sanitized = sanitizeForHostname(path.basename(cwd));
  if (sanitized) {
    return { name: sanitized, source: "directory name" };
  }

  throw new Error("Could not infer a project name from package.json, git root, or directory name");
}

/**
 * Walk up from `startDir` looking for a package.json with a `name` field.
 * Returns the name (with `@scope/` prefix stripped) or null.
 */
function findPackageJsonName(startDir: string): string | null {
  let dir = startDir;
  for (;;) {
    const pkgPath = path.join(dir, "package.json");
    try {
      const raw = fs.readFileSync(pkgPath, "utf-8");
      const pkg = JSON.parse(raw);
      if (typeof pkg.name === "string" && pkg.name) {
        // Strip scoped prefix: @org/myapp → myapp
        return pkg.name.replace(/^@[^/]+\//, "");
      }
    } catch {
      // No package.json here or invalid JSON; keep walking
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * Find the git repo root by trying `git rev-parse --show-toplevel` first,
 * then falling back to walking up and looking for a `.git` directory.
 */
function findGitRoot(startDir: string): string | null {
  // Try git CLI
  try {
    const toplevel = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd: startDir,
      encoding: "utf-8",
      timeout: 5000,
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    }).trim();
    if (toplevel) return toplevel;
  } catch {
    // git binary unavailable or not a git repo
  }

  // Fallback: walk up looking for .git directory
  let dir = startDir;
  for (;;) {
    const gitPath = path.join(dir, ".git");
    try {
      const stat = fs.statSync(gitPath);
      if (stat.isDirectory()) return dir;
      // .git file (worktree or submodule) — the actual repo root is elsewhere,
      // but this directory is inside a git repo so it's a reasonable fallback
      if (stat.isFile()) return dir;
    } catch {
      // No .git here; keep walking
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Worktree detection
// ---------------------------------------------------------------------------

export interface WorktreePrefix {
  prefix: string;
  source: string;
}

const WORKTREE_FLAT_ENV = "PORTLESS_WORKTREE_FLAT";
const WORKTREE_PREFIX_ENV = "PORTLESS_WORKTREE_PREFIX";

/** Raised for an unusable or contradictory worktree prefix setting. */
export class WorktreePrefixError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorktreePrefixError";
  }
}

export interface WorktreePrefixOptions {
  /**
   * Explicit prefix (`--worktree-prefix`, `getUrl({ worktreePrefix })`). It
   * applies in a linked worktree, the main checkout, on a default branch, and
   * outside git. An empty string is rejected; use `disabled` to turn the
   * prefix off.
   */
  prefix?: string;
  /** Turn the worktree prefix off (`--no-worktree`, `getUrl({ worktree: false })`). */
  disabled?: boolean;
  /** How a detected branch becomes a prefix. Defaults to "last-segment". */
  branch?: WorktreeBranchMode;
  /** Environment used for `PORTLESS_WORKTREE_PREFIX`. Defaults to `process.env`. */
  env?: NodeJS.ProcessEnv;
}
const FLAT_WORKTREE_HASH_LENGTH = 6;

/**
 * Resolve the flat hostname setting from project configuration and the
 * environment. The environment takes precedence when it contains a boolean
 * value, including an explicit `0` to turn off a project setting.
 */
export function resolveWorktreeFlat(
  configured: boolean | undefined,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  const value = env[WORKTREE_FLAT_ENV];
  if (value === "1" || value === "true") return true;
  if (value === "0" || value === "false") return false;
  return configured === true;
}

/**
 * Apply a worktree prefix to a base hostname, or return the base name
 * unchanged when not in a worktree. Flat names use a tuple hash whenever
 * replacing structured labels with hyphens could make two names identical.
 */
export function applyWorktreePrefix(
  baseName: string,
  worktree: WorktreePrefix | null,
  flat: boolean = resolveWorktreeFlat(undefined)
): string {
  if (!worktree) return baseName;
  if (!flat) return `${worktree.prefix}.${baseName}`;

  const flattened = `${worktree.prefix}-${baseName.replace(/\./g, "-")}`;
  const isAmbiguous =
    worktree.prefix.includes("-") || baseName.includes("-") || baseName.includes(".");
  if (!isAmbiguous) return truncateLabel(flattened);

  const tupleHash = createHash("sha256")
    .update(JSON.stringify([worktree.prefix, baseName]))
    .digest("hex")
    .slice(0, FLAT_WORKTREE_HASH_LENGTH);
  return truncateLabel(`${flattened}-${tupleHash}`);
}

/** Prefix of the generated peer URL environment variables. */
export const PEER_URL_ENV_PREFIX = "PORTLESS_URL_";

/** Uppercase a name and turn every non-alphanumeric run character into `_`. */
function envNameSegment(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "_");
}

/**
 * Environment variable name carrying one app's URL in a multi-app run. Derived
 * from the app's base name, before any worktree prefix, so the variable name
 * stays the same in every worktree while its value follows the prefix. That is
 * what lets a service reference a peer from committed config: the value moves,
 * the name does not.
 *
 * When several apps share one hostname at different path prefixes, the base
 * name alone cannot tell them apart, so the route's path is appended. The
 * app at the root path keeps the plain name:
 * `PORTLESS_URL_APP` and `PORTLESS_URL_APP_API` for `/api`.
 */
export function peerUrlEnvName(baseName: string, sharedHostPathPrefix?: string): string {
  const base = PEER_URL_ENV_PREFIX + envNameSegment(baseName);
  const pathPart = sharedHostPathPrefix ? envNameSegment(sharedHostPathPrefix.slice(1)) : "";
  return pathPart ? `${base}_${pathPart}` : base;
}

export interface PeerApp {
  /** Name before any worktree prefix; names the variable. */
  baseName: string;
  /** Final hostname label (worktree prefix included); decides who shares a host. */
  hostname: string;
  /** Normalized route path prefix, `/` for none. */
  pathPrefix: string;
  /** Full URL of the app's primary route, path prefix included. */
  url: string;
}

/**
 * A name made only of punctuation would yield a variable of bare underscores,
 * which tells a reader nothing and cannot be guessed from the app name.
 */
function hasUsableEnvName(baseName: string): boolean {
  return /[a-z0-9]/i.test(baseName);
}

/**
 * Build the peer URL environment every proxied app in a multi-app run
 * receives, so one service can reach another without a hardcoded hostname that
 * a worktree prefix would invalidate. Each app appears once, the reader's own
 * entry included, so the map does not vary by reader.
 *
 * Variables are unique per app. Apps that share a hostname at different path
 * prefixes get the path appended (see peerUrlEnvName). Two apps that still
 * collapse to one variable name (`web.api` and `web-api`) keep the first and
 * report the second, rather than silently overwriting a peer URL with the
 * wrong host.
 */
export function buildPeerUrlEnv(
  peers: PeerApp[],
  onWarning?: (message: string) => void
): Record<string, string> {
  const env: Record<string, string> = {};
  const claimedBy = new Map<string, string>();

  const perHostname = new Map<string, number>();
  for (const peer of peers) {
    perHostname.set(peer.hostname, (perHostname.get(peer.hostname) ?? 0) + 1);
  }

  for (const peer of peers) {
    if (!hasUsableEnvName(peer.baseName)) continue;
    const shared = (perHostname.get(peer.hostname) ?? 0) > 1;
    const varName = peerUrlEnvName(
      peer.baseName,
      shared && peer.pathPrefix !== "/" ? peer.pathPrefix : undefined
    );
    const id = peer.pathPrefix === "/" ? peer.baseName : `${peer.baseName}${peer.pathPrefix}`;

    const owner = claimedBy.get(varName);
    if (owner !== undefined) {
      if (owner !== id) {
        onWarning?.(
          `Peer URL variable ${varName} is already taken by "${owner}", so "${id}" gets none. Rename one of them to give both a peer URL.`
        );
      }
      continue;
    }

    claimedBy.set(varName, id);
    env[varName] = peer.url;
  }

  return env;
}

/** Branch names that represent the default/primary checkout — no prefix needed. */
const DEFAULT_BRANCHES = new Set(["main", "master"]);

/**
 * Convert a branch name to a worktree prefix. The default "last-segment"
 * mode uses only the part after the final `/` (e.g. `feature/auth` becomes
 * `auth`); "full" sanitizes the whole name (`team-a/login` becomes
 * `team-a-login`). Returns null for default branches (compared on the whole
 * name, so `feature/main` is not one), detached HEAD, or names that
 * sanitize to empty.
 */
function branchToPrefix(branch: string, mode: WorktreeBranchMode): WorktreePrefix | null {
  if (!branch || branch === "HEAD" || DEFAULT_BRANCHES.has(branch)) return null;
  const label = mode === "full" ? branch : branch.split("/").pop()!;
  const prefix = sanitizeForHostname(label);
  if (!prefix) return null;
  return { prefix, source: mode === "full" ? "git branch (full name)" : "git branch" };
}

function explicitWorktreePrefix(value: string, source: string): WorktreePrefix {
  const prefix = sanitizeForHostname(value);
  if (!prefix) {
    throw new WorktreePrefixError(
      `${source} value "${value}" has no usable hostname characters. Use letters, digits, or hyphens.`
    );
  }
  return { prefix, source };
}

/**
 * Resolve the worktree prefix for hostname composition. Precedence: the
 * `disabled` / `prefix` options (flags), then `PORTLESS_WORKTREE_PREFIX`
 * (empty turns the prefix off), then git detection. An explicit prefix skips
 * detection entirely and applies outside linked worktrees too. Throws
 * `WorktreePrefixError` for an empty or unusable explicit value and for
 * `disabled` combined with `prefix`.
 *
 * Detection heuristic:
 *   1. `git worktree list` — if there are multiple worktrees, this repo
 *      uses worktrees and checkouts need distinguishing.
 *   2. `git rev-parse --abbrev-ref HEAD` — get the current branch name.
 *   3. If the branch is `main` or `master`, no prefix (primary checkout).
 *   4. Otherwise, the sanitized branch name is the prefix.
 *
 * Falls back to parsing `.git` file + HEAD when git CLI is unavailable.
 */
export function detectWorktreePrefix(
  cwd: string = process.cwd(),
  options: WorktreePrefixOptions = {}
): WorktreePrefix | null {
  if (options.disabled && options.prefix !== undefined) {
    throw new WorktreePrefixError("--no-worktree cannot be combined with --worktree-prefix.");
  }
  if (options.disabled) return null;

  if (options.prefix !== undefined) {
    if (!options.prefix.trim()) {
      throw new WorktreePrefixError(
        "--worktree-prefix requires a non-empty value. Use --no-worktree to turn the prefix off."
      );
    }
    return explicitWorktreePrefix(options.prefix, "--worktree-prefix");
  }

  const envValue = (options.env ?? process.env)[WORKTREE_PREFIX_ENV];
  if (envValue !== undefined) {
    if (!envValue.trim()) return null;
    return explicitWorktreePrefix(envValue, WORKTREE_PREFIX_ENV);
  }

  const mode = options.branch ?? "last-segment";

  // Primary: git CLI
  const cliResult = detectWorktreeViaCli(cwd, mode);
  if (cliResult !== undefined) return cliResult;

  // Fallback: parse .git file and HEAD when git binary is unavailable
  return detectWorktreeViaFilesystem(cwd, mode);
}

/**
 * Use git CLI to detect worktree prefix. Returns:
 *   - `{ prefix, source }` if in a linked worktree on a non-default branch
 *   - `null` if not in a linked worktree, or on main/master
 *   - `undefined` if git CLI is unavailable (caller should try fallback)
 */
function detectWorktreeViaCli(
  cwd: string,
  mode: WorktreeBranchMode
): WorktreePrefix | null | undefined {
  try {
    const listOutput = execFileSync("git", ["worktree", "list", "--porcelain"], {
      cwd,
      encoding: "utf-8",
      timeout: 5000,
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    });

    // Count worktrees — each block starts with "worktree "
    const worktreeCount = listOutput.split("\n").filter((l) => l.startsWith("worktree ")).length;
    if (worktreeCount <= 1) return null;

    // Multiple worktrees exist, but only add a prefix if the current
    // directory is a *linked* worktree (created via `git worktree add`),
    // not the root/main worktree. Developers frequently work on feature
    // branches in their main clone and don't want branch prefixes there.
    //
    // In a linked worktree, --git-dir points to .git/worktrees/<name>
    // while --git-common-dir points to the shared .git directory. In the
    // root worktree they resolve to the same path.
    const gitDir = path.resolve(
      cwd,
      execFileSync("git", ["rev-parse", "--git-dir"], {
        cwd,
        encoding: "utf-8",
        timeout: 5000,
        stdio: ["ignore", "pipe", "ignore"],
        windowsHide: true,
      }).trim()
    );

    const gitCommonDir = path.resolve(
      cwd,
      execFileSync("git", ["rev-parse", "--git-common-dir"], {
        cwd,
        encoding: "utf-8",
        timeout: 5000,
        stdio: ["ignore", "pipe", "ignore"],
        windowsHide: true,
      }).trim()
    );

    if (gitDir === gitCommonDir) return null;

    const branch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd,
      encoding: "utf-8",
      timeout: 5000,
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    }).trim();

    return branchToPrefix(branch, mode);
  } catch {
    return undefined;
  }
}

/**
 * Fallback worktree detection when git CLI is unavailable. Walks up from
 * `startDir` looking for a `.git` file (worktrees have a file, not a
 * directory) and reads the branch name from the gitdir's HEAD file.
 */
function detectWorktreeViaFilesystem(
  startDir: string,
  mode: WorktreeBranchMode
): WorktreePrefix | null {
  let dir = startDir;
  for (;;) {
    const gitPath = path.join(dir, ".git");
    try {
      const stat = fs.statSync(gitPath);
      if (stat.isDirectory()) {
        // Regular .git directory — not a worktree
        return null;
      }
      if (stat.isFile()) {
        const content = fs.readFileSync(gitPath, "utf-8").trim();
        const match = content.match(/^gitdir:\s*(.+)$/);
        if (!match) return null;

        const gitdir = match[1];
        // Only treat as a worktree if gitdir points into a /worktrees/ path.
        // Submodules point to /modules/ instead.
        if (!gitdir.match(/[/\\]worktrees[/\\][^/\\]+$/)) return null;

        // Read the branch name from the worktree's HEAD file
        const branch = readBranchFromHead(path.resolve(dir, gitdir));
        return branchToPrefix(branch ?? "", mode);
      }
    } catch {
      // No .git here; keep walking
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * Read the current branch name from a gitdir's HEAD file.
 * Returns null for detached HEAD or unreadable files.
 */
function readBranchFromHead(gitdir: string): string | null {
  try {
    const head = fs.readFileSync(path.join(gitdir, "HEAD"), "utf-8").trim();
    const refMatch = head.match(/^ref: refs\/heads\/(.+)$/);
    return refMatch ? refMatch[1] : null;
  } catch {
    return null;
  }
}
