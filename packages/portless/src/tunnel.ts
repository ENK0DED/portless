import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import type { TunnelProviderName } from "./types.js";
import { isWindows, quoteWindowsCmdArg, resolveWindowsExecutable } from "./cli-utils.js";
import { ensureNgrokAvailable, startNgrok, type NgrokChildProcess } from "./ngrok.js";

const CLOUDFLARED_BINARY = "cloudflared";
const TUNNEL_START_TIMEOUT_MS = 30_000;
const TUNNEL_COMMAND_TIMEOUT_MS = 10_000;
const OUTPUT_BUFFER_LIMIT = 16_384;

export interface TunnelChildProcess {
  pid?: number;
  stdout: NodeJS.ReadableStream | null;
  stderr: NodeJS.ReadableStream | null;
  kill(signal?: NodeJS.Signals): boolean;
  on(event: "error", listener: (err: Error) => void): this;
  on(event: "exit", listener: (code: number | null, signal: NodeJS.Signals | null) => void): this;
}

export type TunnelSpawner = (command: string, args: string[]) => TunnelChildProcess;

export interface TunnelInstance {
  provider: TunnelProviderName;
  url: string;
  hostname: string;
  pid?: number;
  child: TunnelChildProcess;
}

export interface StartTunnelOptions {
  hostname?: string;
  onExit?: (code: number | null, signal: NodeJS.Signals | null) => void;
  spawner?: TunnelSpawner;
  timeoutMs?: number;
}

export interface TunnelProvider {
  name: TunnelProviderName;
  start(localPort: number, options?: StartTunnelOptions): Promise<TunnelInstance>;
}

function defaultSpawner(command: string, args: string[]): TunnelChildProcess {
  if (isWindows) {
    const resolved = resolveWindowsExecutable(command, process.env.PATH ?? process.env.Path ?? "");
    if (resolved) {
      const ext = path.extname(resolved).toLowerCase();
      if (ext === ".cmd" || ext === ".bat") {
        const cmdline = [resolved, ...args].map(quoteWindowsCmdArg).join(" ");
        return spawn("cmd.exe", ["/d", "/s", "/c", cmdline], {
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true,
          windowsVerbatimArguments: true,
        }) as TunnelChildProcess;
      }

      return spawn(resolved, args, {
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      }) as TunnelChildProcess;
    }
  }

  return spawn(command, args, {
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  }) as TunnelChildProcess;
}

function normalizeSpace(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function formatSpawnError(binary: string, label: string, error: Error): Error {
  const errno = error as NodeJS.ErrnoException;
  if (errno.code === "ENOENT") {
    return new Error(
      `${label} CLI not found. Install ${binary} and ensure \`${binary}\` is on PATH.`
    );
  }
  return new Error(`Failed to start ${label}: ${error.message}`);
}

function cleanUrl(value: string): string {
  return value.replace(/[),.]+$/g, "");
}

function tunnelHostnameFromUrl(url: string): string {
  return new URL(url).hostname.toLowerCase();
}

export function buildCloudflareTunnelArgs(localPort: number): string[] {
  return ["tunnel", "--url", `http://127.0.0.1:${localPort}`];
}

export function extractCloudflareTunnelUrl(output: string): string | null {
  const urlMatches = output.matchAll(/https:\/\/[^\s"'<>]+/g);
  for (const match of urlMatches) {
    const candidate = cleanUrl(match[0]);
    try {
      const parsed = new URL(candidate);
      if (!parsed.hostname.endsWith(".trycloudflare.com")) continue;
      return parsed.toString().replace(/\/$/, "");
    } catch {
      continue;
    }
  }
  return null;
}

function formatCloudflareOutputError(output: string): Error {
  const details = normalizeSpace(output);
  return new Error(
    `Failed to start Cloudflare Tunnel: ${details || "cloudflared exited before printing a public URL"}`
  );
}

export function startCloudflareTunnel(
  localPort: number,
  options: StartTunnelOptions = {}
): Promise<TunnelInstance> {
  if (options.hostname) {
    return Promise.reject(
      new Error("--tunnel-hostname is not supported for Cloudflare quick tunnels")
    );
  }

  const spawner = options.spawner ?? defaultSpawner;
  const timeoutMs = options.timeoutMs ?? TUNNEL_START_TIMEOUT_MS;
  const args = buildCloudflareTunnelArgs(localPort);

  let child: TunnelChildProcess;
  try {
    child = spawner(CLOUDFLARED_BINARY, args);
  } catch (err: unknown) {
    return Promise.reject(
      formatSpawnError(
        "cloudflared",
        "cloudflared",
        err instanceof Error ? err : new Error(String(err))
      )
    );
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
      const url = extractCloudflareTunnelUrl(output);
      if (url) {
        settle(() => {
          started = true;
          resolve({
            provider: "cloudflare",
            url,
            hostname: tunnelHostnameFromUrl(url),
            pid: child.pid,
            child,
          });
        });
      }
    };

    const timer = setTimeout(() => {
      try {
        child.kill("SIGTERM");
      } catch {
        // non-fatal
      }
      settle(() =>
        reject(
          new Error(
            "Timed out waiting for cloudflared to print a public URL. Check that cloudflared can connect."
          )
        )
      );
    }, timeoutMs);

    child.stdout?.on("data", appendOutput);
    child.stderr?.on("data", appendOutput);
    child.on("error", (err) => {
      settle(() => reject(formatSpawnError("cloudflared", "cloudflared", err)));
    });
    child.on("exit", (code, signal) => {
      if (settled) {
        if (started) options.onExit?.(code, signal);
        return;
      }
      settle(() => {
        const suffix = signal ? ` (signal ${signal})` : code !== null ? ` (exit ${code})` : "";
        const error = formatCloudflareOutputError(output);
        reject(new Error(`${error.message}${suffix}`));
      });
    });
  });
}

const cloudflareProvider: TunnelProvider = {
  name: "cloudflare",
  start: startCloudflareTunnel,
};

const ngrokProvider: TunnelProvider = {
  name: "ngrok",
  async start(localPort: number, options: StartTunnelOptions = {}): Promise<TunnelInstance> {
    const started = await startNgrok(localPort, {
      hostHeader: false,
      domain: options.hostname,
      onExit: options.onExit,
      timeoutMs: options.timeoutMs,
    });
    return {
      provider: "ngrok",
      url: started.url,
      hostname: tunnelHostnameFromUrl(started.url),
      pid: started.pid,
      child: started.child as NgrokChildProcess as TunnelChildProcess,
    };
  },
};

export function getTunnelProvider(provider: string): TunnelProvider {
  if (provider === "ngrok") return ngrokProvider;
  if (provider === "cloudflare") return cloudflareProvider;
  throw new Error(`Unknown tunnel provider "${provider}". Use ngrok or cloudflare.`);
}

export function ensureTunnelProviderAvailable(provider: TunnelProviderName): void {
  if (provider === "ngrok") {
    ensureNgrokAvailable();
    return;
  }

  const result = spawnSync(CLOUDFLARED_BINARY, ["version"], {
    encoding: "utf-8",
    killSignal: "SIGKILL",
    timeout: TUNNEL_COMMAND_TIMEOUT_MS,
  });
  if (result.error) {
    throw formatSpawnError(
      "cloudflared",
      "cloudflared",
      result.error instanceof Error ? result.error : new Error(String(result.error))
    );
  }
  if (result.status !== 0) {
    const details = normalizeSpace((result.stderr ?? "") || (result.stdout ?? ""));
    throw new Error(
      `Failed to check cloudflared version: ${details || "unknown cloudflared error"}`
    );
  }
}

export function stopTunnelProcess(child: TunnelChildProcess | undefined): void {
  if (!child) return;
  try {
    child.kill("SIGTERM");
  } catch {
    // non-fatal
  }
}

export function stopTunnelPid(pid: number | undefined): void {
  if (!pid) return;
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    // Already exited or not owned by this user; non-fatal.
  }
}
