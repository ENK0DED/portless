import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import colors from "./colors.js";
import { discoverState, isWindows, killTree } from "./cli-utils.js";
import { appendBgLifecycleLog, getBgLogPaths, type BgLogPaths } from "./bg-logs.js";
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

function printSubcommandStubHelp(subcommand: string): void {
  console.log(`
${colors.bold(`portless bg ${subcommand}`)} - Background app management command.

This command is part of the background app management surface. Its runtime
behavior is implemented by the follow-up lifecycle commits in this branch.
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

async function handleBgStart(startArgs: string[], options: { entryScript: string }): Promise<void> {
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
  const cwd = process.cwd();
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

  if (
    subcommand === "stop" ||
    subcommand === "restart" ||
    subcommand === "status" ||
    subcommand === "list" ||
    subcommand === "logs" ||
    subcommand === "clean"
  ) {
    if (args[2] === "--help" || args[2] === "-h") {
      printSubcommandStubHelp(subcommand);
      return;
    }
    if (isWindows) {
      console.error(colors.red("Error: portless bg currently supports macOS and Linux."));
      process.exit(1);
    }
    console.error(
      colors.red(`Error: portless bg ${subcommand} is not implemented in this commit.`)
    );
    process.exit(1);
  }

  console.error(colors.red(`Error: Unknown bg subcommand "${subcommand}".`));
  console.error(colors.cyan("  portless bg --help"));
  process.exit(1);
}
