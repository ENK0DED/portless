import { writeFileSync } from "node:fs";
import type { TunnelProviderName } from "./types.js";
import {
  ngrok,
  ensureTunnelAvailable,
  startTunnel,
  type TunnelProvider as RunnerProvider,
  type TunnelChildProcess,
} from "./tunnel-runner.js";
export {
  stopNgrokProcess as stopTunnelProcess,
  stopTunnelPid,
  type TunnelChildProcess,
} from "./tunnel-runner.js";

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
  hostHeader?: string;
  configPath?: string;
  onExit?: (code: number | null, signal: NodeJS.Signals | null) => void;
  spawner?: TunnelSpawner;
  timeoutMs?: number;
}
export interface TunnelProvider {
  name: TunnelProviderName;
  start(localPort: number, options?: StartTunnelOptions): Promise<TunnelInstance>;
}
export {
  buildCloudflareArgs as buildCloudflareTunnelArgs,
  extractCloudflareUrl as extractCloudflareTunnelUrl,
} from "./cloudflare.js";
import { cloudflare, buildCloudflareArgs } from "./cloudflare.js";
const providers: Record<TunnelProviderName, RunnerProvider> = {
  cloudflare: cloudflare(),
  ngrok,
};
async function startManagedTunnel(
  name: TunnelProviderName,
  port: number,
  options: StartTunnelOptions = {}
): Promise<TunnelInstance> {
  if (name === "cloudflare" && options.hostname)
    throw new Error("--tunnel-hostname is not supported for Cloudflare quick tunnels");
  if (name === "cloudflare") {
    if (!options.configPath) throw new Error("Cloudflare tunnels require a state configPath");
    writeFileSync(options.configPath, "{}", { mode: 0o600 });
  }
  const provider = providers[name];
  const started = await startTunnel(
    {
      ...provider,
      ...(name === "cloudflare"
        ? {
            buildArgs: (localPort: number) =>
              buildCloudflareArgs(localPort, options.hostHeader ?? "", options.configPath ?? ""),
          }
        : {}),
    },
    port,
    {
      ...options,
      domain: options.hostname,
      spawner: options.spawner ? (args) => options.spawner!(provider.binary, args) : undefined,
    }
  );
  return { ...started, provider: name, hostname: new URL(started.url).hostname.toLowerCase() };
}
export function startCloudflareTunnel(
  port: number,
  options: StartTunnelOptions = {}
): Promise<TunnelInstance> {
  return startManagedTunnel("cloudflare", port, options);
}
export function getTunnelProvider(provider: string): TunnelProvider {
  if (provider !== "ngrok" && provider !== "cloudflare")
    throw new Error(`Unknown tunnel provider "${provider}". Use ngrok or cloudflare.`);
  return { name: provider, start: (port, options) => startManagedTunnel(provider, port, options) };
}
export function ensureTunnelProviderAvailable(provider: TunnelProviderName): void {
  ensureTunnelAvailable(providers[provider]);
}
