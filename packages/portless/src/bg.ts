import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import colors from "./colors.js";
import { discoverState, isWindows, killTree } from "./cli-utils.js";
import {
  appendBgLifecycleLog,
  getBgLogPaths,
  readLastBgLogLines,
  readWholeBgLog,
  type BgLogPaths,
} from "./bg-logs.js";
import {
  BG_DIR_MODE,
  BG_FILE_MODE,
  BgStore,
  type BgManagedTunnelOptions,
  type BgProcessEntry,
  type BgStartIntent,
} from "./bg-store.js";
import {
  getBgReadyPath,
  PORTLESS_BG_ID_ENV,
  PORTLESS_BG_READY_PATH_ENV,
  waitForBgReadyFile,
} from "./bg-ready.js";
import { cleanupRouteSharing } from "./route-cleanup.js";
import { RouteStore, type RouteMapping } from "./routes.js";
import { TunnelAliasStore } from "./tunnel-aliases.js";
import type { RouteProtocol, TunnelProviderName } from "./types.js";
import { fixOwnership, normalizePathPrefix } from "./utils.js";

export const DEFAULT_BG_WAIT_SECONDS = 30;

export interface ParsedBgStartArgs {
  runArgs: string[];
  waitSeconds: number | undefined;
  keep: boolean;
  json: boolean;
}

interface ParsedRunIntent {
  intent: BgStartIntent;
  label: string;
}

interface BgCommandContext {
  stateDir: string;
  store: BgStore;
  routeStore: RouteStore;
  tunnelAliasStore: TunnelAliasStore;
}

interface EntryView extends BgProcessEntry {
  logs: BgLogPaths;
}

const RUN_VALUE_FLAGS = new Set([
  "--name",
  "--app-port",
  "--path",
  "--tunnel",
  "--tunnel-hostname",
  "--tailscale-service-name",
  "--netbird-password",
  "--netbird-pin",
  "--netbird-groups",
]);

const RUN_BOOLEAN_FLAGS = new Set([
  "--force",
  "--h2c",
  "--tailscale",
  "--tailscale-service",
  "--funnel",
  "--ngrok",
  "--netbird",
]);

function printBgHelp(): void {
  console.log(`
${colors.bold("portless bg")} - Manage portless apps running in the background.

${colors.bold("Usage:")}
  ${colors.cyan("portless bg start [options] [command...]")}  Start an app in the background
  ${colors.cyan("portless bg stop [name]")}                   Stop a background app
  ${colors.cyan("portless bg restart [name]")}                Restart a background app
  ${colors.cyan("portless bg status [name]")}                 Show one background app
  ${colors.cyan("portless bg list")}                          List background apps
  ${colors.cyan("portless bg logs [name]")}                   Print background app logs
  ${colors.cyan("portless bg clean [name]")}                  Remove dead background entries

${colors.bold("Examples:")}
  portless bg start
  portless bg start --name web bun run dev
  portless bg start --path /api --wait 60 bun run api
  portless bg logs web --tail 100
  portless bg stop web
`);
}

function printBgStartHelp(): void {
  console.log(`
${colors.bold("portless bg start")} - Start a portless app in the background.

${colors.bold("Usage:")}
  ${colors.cyan("portless bg start [options] [command...]")}

${colors.bold("Run options forwarded to portless run:")}
  --name <name>                 Use an explicit app name
  --force                       Take over an existing route owned by portless
  --app-port <number>           Use a fixed app port
  --h2c                         Forward to an HTTP/2 cleartext upstream
  --path <prefix>               Scope route to a path prefix
  --tunnel <provider>           Share publicly via a managed tunnel
  --tunnel-hostname <hostname>  Request a stable tunnel hostname
  --tailscale                   Share on Tailscale
  --tailscale-service           Share as a Tailscale Service
  --tailscale-service-name <n>  Use an explicit Tailscale Service name
  --funnel                      Share publicly via Tailscale Funnel
  --ngrok                       Share publicly via ngrok
  --netbird                     Share publicly via NetBird Peer Expose
  --netbird-password <string>   Require a password for the NetBird public URL
  --netbird-pin <code>          Require a PIN for the NetBird public URL
  --netbird-groups <csv>        Restrict the NetBird URL to user groups

${colors.bold("Background options:")}
  --wait [seconds]              Wait for readiness before returning (default: 30)
  --no-wait                     Return after spawning without waiting for readiness
  --keep                        Keep a timed-out child running
  --json                        Print machine-readable output
  --help, -h                    Show this help
`);
}

function printBgStopHelp(): void {
  console.log(`
${colors.bold("portless bg stop")} - Stop a background app.

${colors.bold("Usage:")}
  ${colors.cyan("portless bg stop [name] [--path <prefix>] [--force] [--json]")}

${colors.bold("Options:")}
  --path <prefix>               Resolve a path-scoped background route
  --force                       Send SIGKILL after graceful stop and clean exact owned route state
  --json                        Print machine-readable output
  --help, -h                    Show this help
`);
}

function printBgRestartHelp(): void {
  console.log(`
${colors.bold("portless bg restart")} - Restart a background app.

${colors.bold("Usage:")}
  ${colors.cyan("portless bg restart [name] [--path <prefix>] [--force] [--wait [seconds]]")}
  ${colors.cyan("portless bg restart [name] --no-wait")}

${colors.bold("Options:")}
  --path <prefix>               Resolve a path-scoped background route
  --force                       Take over an existing portless-owned route
  --wait [seconds]              Wait for readiness before returning (default: 30)
  --no-wait                     Return after spawning without waiting for readiness
  --keep                        Keep a timed-out child running
  --json                        Print machine-readable output
  --help, -h                    Show this help
`);
}

function printBgCleanHelp(): void {
  console.log(`
${colors.bold("portless bg clean")} - Remove dead background entries.

${colors.bold("Usage:")}
  ${colors.cyan("portless bg clean [name] [--path <prefix>] [--json]")}
  ${colors.cyan("portless bg clean --all [--json]")}

${colors.bold("Options:")}
  --path <prefix>               Resolve a path-scoped background route
  --all                         Remove all dead background entries and their private logs
  --json                        Print machine-readable output
  --help, -h                    Show this help
`);
}

function printBgStatusHelp(): void {
  console.log(`
${colors.bold("portless bg status")} - Show background app status.

${colors.bold("Usage:")}
  ${colors.cyan("portless bg status [name] [--path <prefix>] [--json]")}

${colors.bold("Options:")}
  --path <prefix>               Resolve a path-scoped background route
  --json                        Print machine-readable output
  --help, -h                    Show this help
`);
}

function printBgListHelp(): void {
  console.log(`
${colors.bold("portless bg list")} - List background apps.

${colors.bold("Usage:")}
  ${colors.cyan("portless bg list [--json]")}

${colors.bold("Options:")}
  --json                        Print machine-readable output
  --help, -h                    Show this help
`);
}

function printBgLogsHelp(): void {
  console.log(`
${colors.bold("portless bg logs")} - Print background app logs.

${colors.bold("Usage:")}
  ${colors.cyan("portless bg logs [name] [--path <prefix>] [--tail <lines>]")}
  ${colors.cyan("portless bg logs [name] --all")}
  ${colors.cyan("portless bg logs [name] --errors")}
  ${colors.cyan("portless bg logs [name] --bg")}

${colors.bold("Options:")}
  --path <prefix>               Resolve a path-scoped background route
  --tail <lines>                Print the last N lines (default: 100)
  --all                         Print the whole selected log
  --follow                      Continue printing new log data
  --errors                      Print stderr logs
  --bg                          Print lifecycle logs
  --help, -h                    Show this help
`);
}

function readPositiveSeconds(value: string): number {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new Error("--wait must be a positive number of seconds");
  }
  return seconds;
}

function canBeWaitValue(value: string | undefined): value is string {
  if (value === undefined) return false;
  if (/^-?\d/.test(value)) return true;
  return !value.startsWith("-");
}

function requireForwardedValue(tokens: string[], index: number): string {
  const flag = tokens[index];
  const value = tokens[index + 1];
  if (!value || value.startsWith("-")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseTunnelProviderForIntent(value: string): TunnelProviderName {
  if (value === "cloudflare" || value === "ngrok") return value;
  throw new Error(`Unsupported tunnel provider "${value}"`);
}

function parseRunIntent(runArgs: string[], cwd: string): ParsedRunIntent {
  let name: string | undefined;
  let force = false;
  let appPort: number | undefined;
  let protocol: RouteProtocol | undefined;
  let pathPrefix = "/";
  let tunnel: BgManagedTunnelOptions | undefined;
  const sharing: BgStartIntent["sharing"] = {
    tailscale: false,
    tailscaleService: false,
    funnel: false,
    ngrok: false,
    netbird: false,
  };
  let commandArgs: string[] = [];
  let explicitCommand = false;

  for (let i = 0; i < runArgs.length; i++) {
    const token = runArgs[i];
    if (token === "--") {
      explicitCommand = runArgs.length > i + 1;
      commandArgs = runArgs.slice(i + 1);
      break;
    }
    if (!token.startsWith("-")) {
      explicitCommand = true;
      commandArgs = runArgs.slice(i);
      break;
    }
    if (token === "--name") {
      name = runArgs[++i];
    } else if (token === "--force") {
      force = true;
    } else if (token === "--app-port") {
      const value = Number(runArgs[++i]);
      if (!Number.isInteger(value) || value < 1 || value > 65535) {
        throw new Error("--app-port requires a valid port number");
      }
      appPort = value;
    } else if (token === "--h2c") {
      protocol = "h2c";
    } else if (token === "--path") {
      pathPrefix = normalizePathPrefix(runArgs[++i]);
    } else if (token === "--tunnel") {
      tunnel = { ...(tunnel ?? {}), provider: parseTunnelProviderForIntent(runArgs[++i]) };
    } else if (token === "--tunnel-hostname") {
      if (!tunnel?.provider) throw new Error("--tunnel-hostname requires --tunnel");
      tunnel = { ...tunnel, hostname: runArgs[++i] };
    } else if (token === "--tailscale") {
      sharing.tailscale = true;
    } else if (token === "--tailscale-service") {
      sharing.tailscaleService = true;
    } else if (token === "--tailscale-service-name") {
      sharing.tailscaleService = true;
      sharing.tailscaleServiceName = runArgs[++i];
    } else if (token === "--funnel") {
      sharing.tailscale = true;
      sharing.funnel = true;
    } else if (token === "--ngrok") {
      sharing.ngrok = true;
    } else if (token === "--netbird") {
      sharing.netbird = true;
    } else if (token === "--netbird-password") {
      sharing.netbird = true;
      sharing.netbirdPassword = runArgs[++i];
    } else if (token === "--netbird-pin") {
      sharing.netbird = true;
      sharing.netbirdPin = runArgs[++i];
    } else if (token === "--netbird-groups") {
      sharing.netbird = true;
      sharing.netbirdGroups = runArgs[++i];
    }
  }

  const fallbackLabel = path.basename(cwd) || "app";
  const label = name ?? fallbackLabel;
  return {
    label,
    intent: {
      name,
      cwd,
      commandArgs,
      explicitCommand,
      force,
      appPort,
      protocol,
      pathPrefix,
      tunnel,
      sharing,
    },
  };
}

function openPrivateAppendFile(filePath: string): number {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: BG_DIR_MODE });
  try {
    fs.chmodSync(path.dirname(path.dirname(filePath)), BG_DIR_MODE);
    fs.chmodSync(path.dirname(filePath), BG_DIR_MODE);
  } catch {
    // Permission repair is best effort.
  }
  const fd = fs.openSync(filePath, "a", BG_FILE_MODE);
  try {
    fs.chmodSync(filePath, BG_FILE_MODE);
  } catch {
    // Permission repair is best effort.
  }
  fixOwnership(filePath);
  return fd;
}

function closeLogFd(fd: number): void {
  try {
    fs.closeSync(fd);
  } catch {
    // File descriptor may already be closed.
  }
}

function printStartResult(
  entry: BgProcessEntry,
  logs: BgLogPaths,
  json: boolean,
  ready: boolean
): void {
  if (json) {
    process.stdout.write(
      JSON.stringify(
        {
          id: entry.id,
          label: entry.label,
          pid: entry.pid,
          state: entry.state,
          url: entry.url,
          route: entry.route,
          logs,
        },
        null,
        2
      ) + "\n"
    );
    return;
  }
  if (ready && entry.url) {
    console.log(colors.green(`Started background app "${entry.label}" (PID ${entry.pid}).`));
    console.log(colors.cyan(`  ${entry.url}`));
  } else {
    console.log(colors.green(`Started background app "${entry.label}" (PID ${entry.pid}).`));
    console.log(colors.yellow("Readiness was not requested; state remains starting."));
  }
  console.log(colors.gray(`Logs: ${logs.stdout}`));
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function terminateChild(child: ChildProcess): Promise<void> {
  killTree(child, "SIGTERM");
  await sleep(500);
  if (child.pid && isProcessAlive(child.pid)) {
    killTree(child, "SIGKILL");
  }
}

async function createBgContext(): Promise<BgCommandContext> {
  const state = await discoverState();
  return {
    stateDir: state.dir,
    store: new BgStore(state.dir, {
      onWarning: (msg) => console.warn(colors.yellow(msg)),
    }),
    routeStore: new RouteStore(state.dir, {
      onWarning: (msg) => console.warn(colors.yellow(msg)),
    }),
    tunnelAliasStore: new TunnelAliasStore(state.dir, {
      onWarning: (msg) => console.warn(colors.yellow(msg)),
    }),
  };
}

function routeMatchesEntry(route: RouteMapping, entry: BgProcessEntry): boolean {
  if (!entry.route) return false;
  return (
    route.hostname === entry.route.hostname &&
    normalizePathPrefix(route.pathPrefix) === entry.route.pathPrefix
  );
}

function refreshEntryState(entry: BgProcessEntry, routes: RouteMapping[]): BgProcessEntry {
  if (!isProcessAlive(entry.pid)) {
    return entry.state === "stopped" ? entry : { ...entry, state: "stopped" };
  }
  if (!entry.route) return entry;
  const route = routes.find((candidate) => routeMatchesEntry(candidate, entry));
  if (!route) {
    return entry.state === "starting" ? entry : { ...entry, state: "unknown" };
  }
  if (route.pid !== entry.pid) return { ...entry, state: "unknown" };
  return entry.readyAt ? { ...entry, state: "ready" } : entry;
}

function refreshEntries(context: BgCommandContext): BgProcessEntry[] {
  const routes = context.routeStore.loadRoutesRaw();
  return context.store.loadEntries().map((entry) => {
    const refreshed = refreshEntryState(entry, routes);
    if (refreshed.state !== entry.state) {
      context.store.updateEntry(entry.id, { state: refreshed.state });
    }
    return refreshed;
  });
}

function signalProcessGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
    return;
  } catch {
    // The process may not be a group leader, or may already be gone.
  }
  try {
    process.kill(pid, signal);
  } catch {
    // The process may already be gone.
  }
}

async function waitForProcessExit(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    if (!isProcessAlive(pid)) return true;
    await sleep(50);
  }
  return !isProcessAlive(pid);
}

function findExactRoute(
  context: BgCommandContext,
  entry: BgProcessEntry
): RouteMapping | undefined {
  return context.routeStore.loadRoutesRaw().find((route) => routeMatchesEntry(route, entry));
}

function cleanupExactRoute(context: BgCommandContext, entry: BgProcessEntry): void {
  if (!entry.route) return;
  const route = findExactRoute(context, entry);
  if (!route || route.pid !== entry.pid) return;
  cleanupRouteSharing(route, { tunnelAliasStore: context.tunnelAliasStore });
  context.routeStore.removeRoute(entry.route.hostname, entry.pid, {
    pathPrefix: entry.route.pathPrefix,
  });
}

function removeEntryLogs(stateDir: string, entryId: string): void {
  const logs = getBgLogPaths(stateDir, entryId);
  for (const filePath of [logs.stdout, logs.stderr, logs.bg]) {
    try {
      fs.rmSync(filePath, { force: true });
    } catch {
      // Log cleanup is best effort.
    }
  }
}

async function stopEntry(
  context: BgCommandContext,
  entry: BgProcessEntry,
  options: { force?: boolean; removeLogs?: boolean } = {}
): Promise<{ stopped: boolean; alreadyStopped: boolean }> {
  const alive = isProcessAlive(entry.pid);
  if (alive) {
    signalProcessGroup(entry.pid, options.force ? "SIGKILL" : "SIGTERM");
    const exited = await waitForProcessExit(entry.pid, options.force ? 1000 : 5000);
    if (!exited && !options.force) {
      context.store.updateEntry(entry.id, { state: "unknown" });
      return { stopped: false, alreadyStopped: false };
    }
    if (!exited && options.force) {
      signalProcessGroup(entry.pid, "SIGKILL");
      await waitForProcessExit(entry.pid, 1000);
    }
  }

  cleanupExactRoute(context, entry);
  context.store.removeEntry(entry.id);
  if (options.removeLogs) removeEntryLogs(context.stateDir, entry.id);
  return { stopped: true, alreadyStopped: !alive };
}

function runArgsFromIntent(intent: BgStartIntent, force: boolean): string[] {
  const args: string[] = [];
  if (intent.name) args.push("--name", intent.name);
  if (force || intent.force) args.push("--force");
  if (intent.appPort) args.push("--app-port", String(intent.appPort));
  if (intent.protocol === "h2c") args.push("--h2c");
  if (intent.pathPrefix && intent.pathPrefix !== "/") args.push("--path", intent.pathPrefix);
  if (intent.tunnel) {
    args.push("--tunnel", intent.tunnel.provider);
    if (intent.tunnel.hostname) args.push("--tunnel-hostname", intent.tunnel.hostname);
  }
  if (intent.sharing.tailscale && !intent.sharing.funnel) args.push("--tailscale");
  if (intent.sharing.tailscaleService) args.push("--tailscale-service");
  if (intent.sharing.tailscaleServiceName) {
    args.push("--tailscale-service-name", intent.sharing.tailscaleServiceName);
  }
  if (intent.sharing.funnel) args.push("--funnel");
  if (intent.sharing.ngrok) args.push("--ngrok");
  if (intent.sharing.netbird) args.push("--netbird");
  if (intent.sharing.netbirdPassword)
    args.push("--netbird-password", intent.sharing.netbirdPassword);
  if (intent.sharing.netbirdPin) args.push("--netbird-pin", intent.sharing.netbirdPin);
  if (intent.sharing.netbirdGroups) args.push("--netbird-groups", intent.sharing.netbirdGroups);
  if (intent.explicitCommand) args.push("--", ...intent.commandArgs);
  return args;
}

function withLogs(stateDir: string, entry: BgProcessEntry): EntryView {
  return {
    ...entry,
    logs: getBgLogPaths(stateDir, entry.id),
  };
}

function serializeEntry(stateDir: string, entry: BgProcessEntry): EntryView {
  return withLogs(stateDir, entry);
}

function matchesEntrySelector(
  entry: BgProcessEntry,
  name: string | undefined,
  pathPrefix: string | undefined
): boolean {
  if (name && entry.label !== name && entry.route?.hostname.split(".")[0] !== name) return false;
  if (pathPrefix && entry.route?.pathPrefix !== normalizePathPrefix(pathPrefix)) return false;
  return true;
}

function selectEntry(
  entries: BgProcessEntry[],
  name: string | undefined,
  pathPrefix: string | undefined
): BgProcessEntry {
  const matches = entries.filter((entry) => matchesEntrySelector(entry, name, pathPrefix));
  if (matches.length === 1) return matches[0];
  if (matches.length === 0) {
    const label = name ?? "current directory";
    throw new Error(`No background app found for "${label}"`);
  }
  throw new Error("Multiple background apps match. Use --path to disambiguate.");
}

function printStatus(entry: EntryView): void {
  console.log(`${entry.label}  ${entry.state}`);
  if (entry.url) console.log(entry.url);
  if (entry.route) {
    const routeLabel =
      entry.route.pathPrefix === "/"
        ? entry.route.hostname
        : `${entry.route.hostname}${entry.route.pathPrefix}`;
    console.log(`Route: ${routeLabel}`);
  }
  console.log(`PID: ${entry.pid}`);
  console.log(`Logs: ${entry.logs.stdout}`);
}

function parseNamePathJsonArgs(
  args: string[],
  offset: number
): {
  name?: string;
  pathPrefix?: string;
  json: boolean;
} {
  let name: string | undefined;
  let pathPrefix: string | undefined;
  let json = false;
  for (let i = offset; i < args.length; i++) {
    const token = args[i];
    if (token === "--json") {
      json = true;
    } else if (token === "--path") {
      const value = args[++i];
      if (!value) throw new Error("--path requires a path prefix");
      pathPrefix = normalizePathPrefix(value);
    } else if (token.startsWith("-")) {
      throw new Error(`Unknown flag "${token}"`);
    } else if (!name) {
      name = token;
    } else {
      throw new Error(`Unknown argument "${token}"`);
    }
  }
  return { name, pathPrefix, json };
}

async function handleBgStatus(args: string[]): Promise<void> {
  if (args[2] === "--help" || args[2] === "-h") {
    printBgStatusHelp();
    return;
  }
  let parsed: ReturnType<typeof parseNamePathJsonArgs>;
  try {
    parsed = parseNamePathJsonArgs(args, 2);
  } catch (err) {
    console.error(colors.red(`Error: ${(err as Error).message}`));
    console.error(colors.cyan("  portless bg status --help"));
    process.exit(1);
  }
  const context = await createBgContext();
  try {
    const entry = selectEntry(refreshEntries(context), parsed.name, parsed.pathPrefix);
    const view = serializeEntry(context.stateDir, entry);
    if (parsed.json) {
      process.stdout.write(JSON.stringify(view, null, 2) + "\n");
    } else {
      printStatus(view);
    }
  } catch (err) {
    console.error(colors.red(`Error: ${(err as Error).message}`));
    process.exit(1);
  }
}

async function handleBgList(args: string[]): Promise<void> {
  if (args[2] === "--help" || args[2] === "-h") {
    printBgListHelp();
    return;
  }
  let json = false;
  for (let i = 2; i < args.length; i++) {
    if (args[i] === "--json") {
      json = true;
    } else {
      console.error(colors.red(`Error: Unknown flag "${args[i]}".`));
      console.error(colors.cyan("  portless bg list --help"));
      process.exit(1);
    }
  }
  const context = await createBgContext();
  const entries = refreshEntries(context)
    .map((entry) => serializeEntry(context.stateDir, entry))
    .sort((a, b) => a.label.localeCompare(b.label));
  if (json) {
    process.stdout.write(JSON.stringify(entries, null, 2) + "\n");
    return;
  }
  if (entries.length === 0) {
    console.log("No background apps found.");
    return;
  }
  for (const entry of entries) {
    console.log(`${entry.label}  ${entry.state}${entry.url ? `  ${entry.url}` : ""}`);
  }
}

function parseLogsArgs(args: string[]): {
  name?: string;
  pathPrefix?: string;
  tail: number;
  all: boolean;
  follow: boolean;
  source: "stdout" | "stderr" | "bg";
} {
  let name: string | undefined;
  let pathPrefix: string | undefined;
  let tail = 100;
  let all = false;
  let follow = false;
  let source: "stdout" | "stderr" | "bg" = "stdout";

  for (let i = 2; i < args.length; i++) {
    const token = args[i];
    if (token === "--path") {
      const value = args[++i];
      if (!value) throw new Error("--path requires a path prefix");
      pathPrefix = normalizePathPrefix(value);
    } else if (token === "--tail") {
      const value = args[++i];
      if (!value) throw new Error("--tail requires a line count");
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed < 0) {
        throw new Error("--tail must be a non-negative integer");
      }
      tail = parsed;
    } else if (token === "--all") {
      all = true;
    } else if (token === "--follow") {
      follow = true;
    } else if (token === "--errors") {
      if (source === "bg") throw new Error("--errors cannot be combined with --bg");
      source = "stderr";
    } else if (token === "--bg") {
      if (source === "stderr") throw new Error("--bg cannot be combined with --errors");
      source = "bg";
    } else if (token.startsWith("-")) {
      throw new Error(`Unknown flag "${token}"`);
    } else if (!name) {
      name = token;
    } else {
      throw new Error(`Unknown argument "${token}"`);
    }
  }
  return { name, pathPrefix, tail, all, follow, source };
}

function printLogSnapshot(filePath: string, all: boolean, tail: number): number {
  const content = all ? readWholeBgLog(filePath) : readLastBgLogLines(filePath, tail).join("\n");
  if (!content) return 0;
  process.stdout.write(content.endsWith("\n") ? content : `${content}\n`);
  return Buffer.byteLength(content);
}

function currentFileSize(filePath: string): number {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return 0;
  }
}

async function followLogFile(filePath: string, offset: number): Promise<never> {
  let cursor = offset;
  setInterval(() => {
    try {
      const stat = fs.statSync(filePath);
      if (stat.size < cursor) cursor = 0;
      if (stat.size === cursor) return;
      const fd = fs.openSync(filePath, "r");
      try {
        const buffer = Buffer.alloc(stat.size - cursor);
        fs.readSync(fd, buffer, 0, buffer.length, cursor);
        cursor = stat.size;
        process.stdout.write(buffer);
      } finally {
        fs.closeSync(fd);
      }
    } catch {
      // The log file may not exist yet.
    }
  }, 250);
  return new Promise(() => undefined);
}

async function handleBgLogs(args: string[]): Promise<void> {
  if (args[2] === "--help" || args[2] === "-h") {
    printBgLogsHelp();
    return;
  }
  let parsed: ReturnType<typeof parseLogsArgs>;
  try {
    parsed = parseLogsArgs(args);
  } catch (err) {
    console.error(colors.red(`Error: ${(err as Error).message}`));
    console.error(colors.cyan("  portless bg logs --help"));
    process.exit(1);
  }
  const context = await createBgContext();
  try {
    const entry = selectEntry(refreshEntries(context), parsed.name, parsed.pathPrefix);
    const logs = getBgLogPaths(context.stateDir, entry.id);
    const filePath = logs[parsed.source];
    printLogSnapshot(filePath, parsed.all, parsed.tail);
    if (parsed.follow) {
      await followLogFile(filePath, currentFileSize(filePath));
    }
  } catch (err) {
    console.error(colors.red(`Error: ${(err as Error).message}`));
    process.exit(1);
  }
}

function parseStopArgs(args: string[]): {
  name?: string;
  pathPrefix?: string;
  force: boolean;
  json: boolean;
} {
  const parsed = parseNamePathJsonArgs(
    args.filter((token) => token !== "--force"),
    2
  );
  return {
    ...parsed,
    force: args.includes("--force"),
  };
}

async function handleBgStop(args: string[]): Promise<void> {
  if (args[2] === "--help" || args[2] === "-h") {
    printBgStopHelp();
    return;
  }
  let parsed: ReturnType<typeof parseStopArgs>;
  try {
    parsed = parseStopArgs(args);
  } catch (err) {
    console.error(colors.red(`Error: ${(err as Error).message}`));
    console.error(colors.cyan("  portless bg stop --help"));
    process.exit(1);
  }
  const context = await createBgContext();
  try {
    const entry = selectEntry(refreshEntries(context), parsed.name, parsed.pathPrefix);
    const result = await stopEntry(context, entry, { force: parsed.force });
    if (!result.stopped) {
      console.error(colors.red(`Error: ${entry.label} did not exit after SIGTERM.`));
      process.exit(1);
    }
    if (parsed.json) {
      process.stdout.write(
        JSON.stringify({ id: entry.id, label: entry.label, stopped: true }, null, 2) + "\n"
      );
    } else {
      console.log(`Stopped ${entry.label}`);
    }
  } catch (err) {
    console.error(colors.red(`Error: ${(err as Error).message}`));
    process.exit(1);
  }
}

function parseRestartArgs(args: string[]): {
  name?: string;
  pathPrefix?: string;
  force: boolean;
  waitSeconds: number | undefined;
  keep: boolean;
  json: boolean;
} {
  const passthrough: string[] = [];
  let name: string | undefined;
  let pathPrefix: string | undefined;
  let force = false;
  for (let i = 2; i < args.length; i++) {
    const token = args[i];
    if (token === "--force") {
      force = true;
    } else if (token === "--path") {
      const value = args[++i];
      if (!value) throw new Error("--path requires a path prefix");
      pathPrefix = normalizePathPrefix(value);
    } else if (
      token === "--wait" ||
      token === "--no-wait" ||
      token === "--keep" ||
      token === "--json"
    ) {
      passthrough.push(token);
      if (token === "--wait" && canBeWaitValue(args[i + 1])) {
        passthrough.push(args[++i]);
      }
    } else if (token.startsWith("-")) {
      throw new Error(`Unknown flag "${token}"`);
    } else if (!name) {
      name = token;
    } else {
      throw new Error(`Unknown argument "${token}"`);
    }
  }
  const parsedStart = parseBgStartArgs(passthrough);
  return { name, pathPrefix, force, ...parsedStart };
}

async function handleBgRestart(args: string[], options: { entryScript: string }): Promise<void> {
  if (args[2] === "--help" || args[2] === "-h") {
    printBgRestartHelp();
    return;
  }
  let parsed: ReturnType<typeof parseRestartArgs>;
  try {
    parsed = parseRestartArgs(args);
  } catch (err) {
    console.error(colors.red(`Error: ${(err as Error).message}`));
    console.error(colors.cyan("  portless bg restart --help"));
    process.exit(1);
  }
  const context = await createBgContext();
  try {
    const entry = selectEntry(refreshEntries(context), parsed.name, parsed.pathPrefix);
    const stopped = await stopEntry(context, entry, { force: parsed.force });
    if (!stopped.stopped) {
      console.error(colors.red(`Error: ${entry.label} did not exit after SIGTERM.`));
      process.exit(1);
    }
    const runArgs = runArgsFromIntent(entry.intent, parsed.force);
    const startArgs = [
      ...runArgs,
      ...(parsed.waitSeconds === undefined
        ? ["--no-wait"]
        : parsed.waitSeconds !== DEFAULT_BG_WAIT_SECONDS
          ? ["--wait", String(parsed.waitSeconds)]
          : []),
      ...(parsed.keep ? ["--keep"] : []),
      ...(parsed.json ? ["--json"] : []),
    ];
    await handleBgStart(startArgs, options, { cwd: entry.cwd });
  } catch (err) {
    console.error(colors.red(`Error: ${(err as Error).message}`));
    process.exit(1);
  }
}

function parseCleanArgs(args: string[]): {
  name?: string;
  pathPrefix?: string;
  all: boolean;
  json: boolean;
} {
  let name: string | undefined;
  let pathPrefix: string | undefined;
  let all = false;
  let json = false;
  for (let i = 2; i < args.length; i++) {
    const token = args[i];
    if (token === "--all") {
      all = true;
    } else if (token === "--json") {
      json = true;
    } else if (token === "--path") {
      const value = args[++i];
      if (!value) throw new Error("--path requires a path prefix");
      pathPrefix = normalizePathPrefix(value);
    } else if (token.startsWith("-")) {
      throw new Error(`Unknown flag "${token}"`);
    } else if (!name) {
      name = token;
    } else {
      throw new Error(`Unknown argument "${token}"`);
    }
  }
  return { name, pathPrefix, all, json };
}

async function handleBgClean(args: string[]): Promise<void> {
  if (args[2] === "--help" || args[2] === "-h") {
    printBgCleanHelp();
    return;
  }
  let parsed: ReturnType<typeof parseCleanArgs>;
  try {
    parsed = parseCleanArgs(args);
  } catch (err) {
    console.error(colors.red(`Error: ${(err as Error).message}`));
    console.error(colors.cyan("  portless bg clean --help"));
    process.exit(1);
  }
  const context = await createBgContext();
  const entries = refreshEntries(context);
  const candidates = parsed.all ? entries : [selectEntry(entries, parsed.name, parsed.pathPrefix)];
  let removed = 0;
  for (const entry of candidates) {
    if (isProcessAlive(entry.pid)) continue;
    cleanupExactRoute(context, entry);
    context.store.removeEntry(entry.id);
    removeEntryLogs(context.stateDir, entry.id);
    removed++;
  }
  if (parsed.json) {
    process.stdout.write(JSON.stringify({ removed }, null, 2) + "\n");
  } else {
    console.log(`Removed ${removed} dead background ${removed === 1 ? "entry" : "entries"}.`);
  }
}

export async function stopBgEntriesForState(
  stateDir: string
): Promise<{ stopped: number; failed: number }> {
  const context: BgCommandContext = {
    stateDir,
    store: new BgStore(stateDir),
    routeStore: new RouteStore(stateDir),
    tunnelAliasStore: new TunnelAliasStore(stateDir),
  };
  let stopped = 0;
  let failed = 0;
  for (const entry of refreshEntries(context)) {
    const result = await stopEntry(context, entry);
    if (result.stopped) stopped++;
    else failed++;
  }
  return { stopped, failed };
}

export async function pruneBgEntriesForState(stateDir: string): Promise<{ removed: number }> {
  const context: BgCommandContext = {
    stateDir,
    store: new BgStore(stateDir),
    routeStore: new RouteStore(stateDir),
    tunnelAliasStore: new TunnelAliasStore(stateDir),
  };
  let removed = 0;
  for (const entry of refreshEntries(context)) {
    if (isProcessAlive(entry.pid)) continue;
    cleanupExactRoute(context, entry);
    context.store.removeEntry(entry.id);
    removeEntryLogs(context.stateDir, entry.id);
    removed++;
  }
  return { removed };
}

async function handleBgStart(
  startArgs: string[],
  options: { entryScript: string },
  startOptions: { cwd?: string } = {}
): Promise<void> {
  let parsed: ParsedBgStartArgs;
  try {
    parsed = parseBgStartArgs(startArgs);
  } catch (err) {
    console.error(colors.red(`Error: ${(err as Error).message}`));
    console.error(colors.cyan("  portless bg start --help"));
    process.exit(1);
  }

  const state = await discoverState();
  const store = new BgStore(state.dir, {
    onWarning: (msg) => console.warn(colors.yellow(msg)),
  });
  const id = `bg-${randomUUID()}`;
  const readyPath = getBgReadyPath(state.dir, id);
  const logs = getBgLogPaths(state.dir, id);
  const cwd = startOptions.cwd ?? process.cwd();
  const { intent, label } = parseRunIntent(parsed.runArgs, cwd);
  const startedAt = new Date().toISOString();
  let entry: BgProcessEntry = {
    version: 1,
    id,
    label,
    pid: 0,
    cwd,
    startedAt,
    state: "starting",
    intent,
  };

  const stdoutFd = openPrivateAppendFile(logs.stdout);
  const stderrFd = openPrivateAppendFile(logs.stderr);
  appendBgLifecycleLog(logs, `starting ${label}`);

  let child: ChildProcess;
  try {
    const childEnv: NodeJS.ProcessEnv = {
      ...process.env,
      [PORTLESS_BG_ID_ENV]: id,
      [PORTLESS_BG_READY_PATH_ENV]: readyPath,
    };
    delete childEnv.PORTLESS;
    child = spawn(process.execPath, [options.entryScript, "run", ...parsed.runArgs], {
      cwd,
      detached: true,
      env: childEnv,
      stdio: ["ignore", stdoutFd, stderrFd],
      windowsHide: true,
    });
  } catch (err) {
    closeLogFd(stdoutFd);
    closeLogFd(stderrFd);
    appendBgLifecycleLog(logs, `spawn failed: ${(err as Error).message}`);
    throw err;
  }

  closeLogFd(stdoutFd);
  closeLogFd(stderrFd);

  if (!child.pid) {
    appendBgLifecycleLog(logs, "spawn failed without a child pid");
    console.error(colors.red("Error: Failed to start background process."));
    process.exit(1);
  }

  child.unref();
  entry = { ...entry, pid: child.pid };
  store.upsertEntry(entry);
  appendBgLifecycleLog(logs, `spawned portless run pid ${child.pid}`);

  if (parsed.waitSeconds === undefined) {
    printStartResult(entry, logs, parsed.json, false);
    return;
  }

  const ready = await waitForBgReadyFile(readyPath, id, parsed.waitSeconds * 1000);
  if (ready) {
    entry = {
      ...entry,
      state: "ready",
      readyAt: new Date().toISOString(),
      route: {
        hostname: ready.hostname,
        pathPrefix: ready.pathPrefix,
      },
      url: ready.url,
    };
    store.updateEntry(id, entry);
    appendBgLifecycleLog(logs, `ready ${ready.url}`);
    printStartResult(entry, logs, parsed.json, true);
    return;
  }

  appendBgLifecycleLog(logs, `timed out waiting for readiness after ${parsed.waitSeconds}s`);
  if (parsed.keep) {
    entry = { ...entry, state: "unknown" };
    store.updateEntry(id, entry);
    console.error(colors.red("Error: timed out waiting for readiness; process kept running."));
    process.exit(1);
  }

  await terminateChild(child);
  store.removeEntry(id);
  appendBgLifecycleLog(logs, "removed timed-out background entry");
  console.error(colors.red("Error: timed out waiting for readiness."));
  process.exit(1);
}

export function parseBgStartArgs(tokens: string[]): ParsedBgStartArgs {
  const runArgs: string[] = [];
  let waitSeconds: number | undefined = DEFAULT_BG_WAIT_SECONDS;
  let keep = false;
  let json = false;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];

    if (token === "--") {
      runArgs.push(...tokens.slice(i));
      break;
    }

    if (!token.startsWith("-")) {
      runArgs.push(...tokens.slice(i));
      break;
    }

    if (RUN_BOOLEAN_FLAGS.has(token)) {
      runArgs.push(token);
      continue;
    }

    if (RUN_VALUE_FLAGS.has(token)) {
      runArgs.push(token, requireForwardedValue(tokens, i));
      i++;
      continue;
    }

    if (token === "--wait") {
      if (canBeWaitValue(tokens[i + 1])) {
        waitSeconds = readPositiveSeconds(tokens[i + 1]);
        i++;
      } else {
        waitSeconds = DEFAULT_BG_WAIT_SECONDS;
      }
      continue;
    }

    if (token === "--no-wait") {
      waitSeconds = undefined;
      continue;
    }

    if (token === "--keep") {
      keep = true;
      continue;
    }

    if (token === "--json") {
      json = true;
      continue;
    }

    if (token === "--help" || token === "-h") {
      continue;
    }

    throw new Error(`Unknown bg start flag "${token}"`);
  }

  if (keep && waitSeconds === undefined) {
    throw new Error("--keep requires readiness waiting");
  }

  return { runArgs, waitSeconds, keep, json };
}

export async function handleBg(args: string[], options: { entryScript: string }): Promise<void> {
  const subcommand = args[1];

  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    printBgHelp();
    return;
  }

  if (subcommand === "start") {
    if (args[2] === "--help" || args[2] === "-h") {
      printBgStartHelp();
      return;
    }
    if (isWindows) {
      console.error(colors.red("Error: portless bg currently supports macOS and Linux."));
      process.exit(1);
    }
    await handleBgStart(args.slice(2), options);
    return;
  }

  if (subcommand === "status") {
    if (isWindows) {
      console.error(colors.red("Error: portless bg currently supports macOS and Linux."));
      process.exit(1);
    }
    await handleBgStatus(args);
    return;
  }

  if (subcommand === "list") {
    if (isWindows) {
      console.error(colors.red("Error: portless bg currently supports macOS and Linux."));
      process.exit(1);
    }
    await handleBgList(args);
    return;
  }

  if (subcommand === "logs") {
    if (isWindows) {
      console.error(colors.red("Error: portless bg currently supports macOS and Linux."));
      process.exit(1);
    }
    await handleBgLogs(args);
    return;
  }

  if (subcommand === "stop") {
    if (isWindows) {
      console.error(colors.red("Error: portless bg currently supports macOS and Linux."));
      process.exit(1);
    }
    await handleBgStop(args);
    return;
  }

  if (subcommand === "restart") {
    if (isWindows) {
      console.error(colors.red("Error: portless bg currently supports macOS and Linux."));
      process.exit(1);
    }
    await handleBgRestart(args, options);
    return;
  }

  if (subcommand === "clean") {
    if (isWindows) {
      console.error(colors.red("Error: portless bg currently supports macOS and Linux."));
      process.exit(1);
    }
    await handleBgClean(args);
    return;
  }

  console.error(colors.red(`Error: Unknown bg subcommand "${subcommand}".`));
  console.error(colors.cyan("  portless bg --help"));
  process.exit(1);
}
