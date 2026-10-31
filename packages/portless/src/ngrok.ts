// Compatibility surface for the legacy --ngrok flag, backed by the shared runner.
export {
  buildNgrokArgs,
  ensureNgrokAvailable,
  extractNgrokUrl,
  startNgrok,
  stopNgrokProcess,
  type TunnelChildProcess as NgrokChildProcess,
  type TunnelSpawner as NgrokSpawner,
  type TunnelCommandRunner as NgrokCommandRunner,
  type StartNgrokOptions,
  type StartedNgrok,
} from "./tunnel-runner.js";
import { stopTunnelPid } from "./tunnel-runner.js";
export function stopNgrok(route: { ngrokPid?: number }): void {
  stopTunnelPid(route.ngrokPid);
}
