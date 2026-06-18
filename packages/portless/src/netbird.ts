import { spawn, spawnSync } from "node:child_process";

const NETBIRD_BINARY = "netbird";
const NETBIRD_START_TIMEOUT_MS = 30_000;
const NETBIRD_COMMAND_TIMEOUT_MS = 10_000;
const OUTPUT_BUFFER_LIMIT = 16_384;

interface NetbirdReadableStream {
  on(event: "data", listener: (chunk: Buffer | string) => void): unknown;
}

export interface NetbirdExposeProcess {
  pid?: number;
  stdout: NetbirdReadableStream | null;
  stderr: NetbirdReadableStream | null;
  kill(signal?: NodeJS.Signals): boolean;
  on(event: "error", listener: (err: Error) => void): this;
  on(event: "exit", listener: (code: number | null, signal: NodeJS.Signals | null) => void): this;
}

export type NetbirdExposeSpawner = (args: string[]) => NetbirdExposeProcess;

export interface NetbirdCommandResult {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: Error;
}

export type NetbirdCommandRunner = (args: string[]) => NetbirdCommandResult;

export interface NetbirdReadyResult {
  daemonStatus: string;
  fqdn?: string;
}

export interface NetbirdExposeOptions {
  password?: string;
  pin?: string;
  groups?: string[];
  namePrefix?: string;
  spawner?: NetbirdExposeSpawner;
  timeoutMs?: number;
  onExit?: (code: number | null, signal: NodeJS.Signals | null) => void;
}

export interface NetbirdExposeInfo {
  name: string;
  url: string;
  domain: string;
  protocol: string;
}

export interface StartedNetbirdExpose {
  info: NetbirdExposeInfo;
  pid?: number;
  child: NetbirdExposeProcess;
}

function defaultSpawner(args: string[]): NetbirdExposeProcess {
  return spawn(NETBIRD_BINARY, args, {
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  }) as NetbirdExposeProcess;
}

function defaultRunner(args: string[]): NetbirdCommandResult {
  const result = spawnSync(NETBIRD_BINARY, args, {
    encoding: "utf-8",
    killSignal: "SIGKILL",
    timeout: NETBIRD_COMMAND_TIMEOUT_MS,
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    ...(result.error ? { error: result.error } : {}),
  };
}

function normalizeSpace(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function formatSpawnError(error: Error): Error {
  const errno = error as NodeJS.ErrnoException;
  if (errno.code === "ENOENT") {
    return new Error(
      "NetBird CLI not found. Install NetBird (https://netbird.io/download) and ensure `netbird` is on PATH."
    );
  }
  return new Error(`Failed to start NetBird: ${error.message}`);
}

function parseStatusOutput(output: string): NetbirdReadyResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch {
    throw new Error("Failed to parse NetBird status output.");
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("NetBird status output did not contain an object.");
  }
  const record = parsed as Record<string, unknown>;
  const daemonStatus = typeof record.daemonStatus === "string" ? record.daemonStatus : undefined;
  if (!daemonStatus) {
    throw new Error("NetBird status output did not include daemonStatus.");
  }
  const fqdn = typeof record.fqdn === "string" ? record.fqdn : undefined;
  return { daemonStatus, ...(fqdn ? { fqdn } : {}) };
}

export function ensureNetbirdReady(
  runner: NetbirdCommandRunner = defaultRunner
): NetbirdReadyResult {
  const result = runner(["status", "--json"]);
  if (result.error) {
    throw formatSpawnError(result.error);
  }
  if (result.status !== 0) {
    const details = normalizeSpace(result.stderr || result.stdout);
    throw new Error(`Failed to check NetBird status: ${details || "unknown NetBird error"}`);
  }

  const status = parseStatusOutput(result.stdout || result.stderr);
  if (status.daemonStatus !== "Connected") {
    throw new Error(
      `NetBird is not connected (daemonStatus: ${status.daemonStatus}). Connect NetBird before using --netbird.`
    );
  }
  return status;
}

export function buildNetbirdExposeArgs(
  localPort: number,
  options: NetbirdExposeOptions = {}
): string[] {
  const args = ["expose"];
  if (options.password) {
    args.push("--with-password", options.password);
  }
  if (options.pin) {
    args.push("--with-pin", options.pin);
  }
  if (options.groups && options.groups.length > 0) {
    args.push("--with-user-groups", options.groups.join(","));
  }
  if (options.namePrefix) {
    args.push("--with-name-prefix", options.namePrefix);
  }
  args.push(String(localPort));
  return args;
}

function cleanFieldValue(value: string): string {
  return value
    .trim()
    .replace(/^[`"']|[`"']$/g, "")
    .replace(/[),.]+$/g, "");
}

export function parseNetbirdExposeInfo(output: string): NetbirdExposeInfo | null {
  const fields = new Map<string, string>();
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z][A-Za-z ]+):\s*(.+?)\s*$/);
    if (!match) continue;
    fields.set(match[1].toLowerCase(), cleanFieldValue(match[2]));
  }

  const name = fields.get("name");
  const url = fields.get("url");
  const domain = fields.get("domain");
  const protocol = fields.get("protocol");
  if (!name || !url || !domain || !protocol) return null;

  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) return null;
  } catch {
    return null;
  }

  return { name, url, domain, protocol };
}

function formatExposeOutputError(output: string): Error {
  const details = normalizeSpace(output);
  return new Error(
    `Failed to start NetBird expose: ${details || "netbird exited before printing a public URL"}`
  );
}

export function startNetbirdExpose(
  localPort: number,
  options: NetbirdExposeOptions = {}
): Promise<StartedNetbirdExpose> {
  const spawner = options.spawner ?? defaultSpawner;
  const timeoutMs = options.timeoutMs ?? NETBIRD_START_TIMEOUT_MS;
  const args = buildNetbirdExposeArgs(localPort, options);

  let child: NetbirdExposeProcess;
  try {
    child = spawner(args);
  } catch (err: unknown) {
    return Promise.reject(formatSpawnError(err instanceof Error ? err : new Error(String(err))));
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    let started = false;
    let output = "";

    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };

    const appendOutput = (chunk: Buffer | string) => {
      if (settled) return;
      output += chunk.toString();
      if (output.length > OUTPUT_BUFFER_LIMIT) {
        output = output.slice(-OUTPUT_BUFFER_LIMIT);
      }
      const info = parseNetbirdExposeInfo(output);
      if (info) {
        settle(() => {
          started = true;
          resolve({ info, pid: child.pid, child });
        });
      }
    };

    const timer = setTimeout(() => {
      try {
        child.kill("SIGTERM");
      } catch {
        // Best-effort cleanup.
      }
      settle(() =>
        reject(
          new Error(
            "Timed out waiting for netbird expose to publish a public URL. Check that NetBird Peer Expose is enabled and this peer is allowed to expose services."
          )
        )
      );
    }, timeoutMs);

    child.stdout?.on("data", appendOutput);
    child.stderr?.on("data", appendOutput);
    child.on("error", (err) => {
      settle(() => reject(formatSpawnError(err)));
    });
    child.on("exit", (code, signal) => {
      if (settled) {
        if (started) options.onExit?.(code, signal);
        return;
      }
      settle(() => {
        const suffix = signal ? ` (signal ${signal})` : code !== null ? ` (exit ${code})` : "";
        const error = formatExposeOutputError(output);
        reject(new Error(`${error.message}${suffix}`));
      });
    });
  });
}

export function stopNetbirdExpose(
  expose: StartedNetbirdExpose | NetbirdExposeProcess | undefined
): void {
  if (!expose) return;
  const child = "child" in expose ? expose.child : expose;
  try {
    child.kill("SIGTERM");
  } catch {
    // Best-effort cleanup.
  }
}

export function stopNetbird(route: { netbirdPid?: number }): void {
  if (!route.netbirdPid) return;
  try {
    process.kill(route.netbirdPid, "SIGTERM");
  } catch {
    // Process may already be gone, or may belong to another user.
  }
}
