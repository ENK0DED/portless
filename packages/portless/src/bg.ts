import colors from "./colors.js";
import { isWindows } from "./cli-utils.js";

export const DEFAULT_BG_WAIT_SECONDS = 30;

export interface ParsedBgStartArgs {
  runArgs: string[];
  waitSeconds: number | undefined;
  keep: boolean;
  json: boolean;
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
  void options;
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
    try {
      parseBgStartArgs(args.slice(2));
    } catch (err) {
      console.error(colors.red(`Error: ${(err as Error).message}`));
      console.error(colors.cyan("  portless bg start --help"));
      process.exit(1);
    }
    console.error(colors.red("Error: portless bg start is not implemented in this commit."));
    process.exit(1);
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
