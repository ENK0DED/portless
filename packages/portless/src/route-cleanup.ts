import { stopNgrok } from "./ngrok.js";
import { stopNetbird } from "./netbird.js";
import { unregisterTailscale } from "./tailscale.js";
import { stopTunnelPid } from "./tunnel.js";
import type { RouteMapping } from "./routes.js";
import type { TunnelAliasStore } from "./tunnel-aliases.js";

export interface CleanupRouteSharingActions {
  unregisterTailscale(route: RouteMapping): void;
  stopNgrok(route: RouteMapping): void;
  stopTunnelPid(pid: number | undefined): void;
  stopNetbird(route: RouteMapping): void;
  removeManagedAlias(externalHostname: string, routeOwnerPid?: number): void;
}

export interface CleanupRouteSharingOptions {
  stopTunnels?: boolean;
  tunnelAliasStore?: TunnelAliasStore;
  actions?: CleanupRouteSharingActions;
}

function defaultActions(tunnelAliasStore?: TunnelAliasStore): CleanupRouteSharingActions {
  return {
    unregisterTailscale,
    stopNgrok,
    stopTunnelPid,
    stopNetbird,
    removeManagedAlias(externalHostname, routeOwnerPid) {
      tunnelAliasStore?.removeManagedAlias(externalHostname, routeOwnerPid);
    },
  };
}

export function cleanupRouteSharing(
  route: RouteMapping,
  options: CleanupRouteSharingOptions = {}
): void {
  const actions = options.actions ?? defaultActions(options.tunnelAliasStore);
  if (route.tailscaleHttpsPort || route.tailscaleServiceName) {
    actions.unregisterTailscale(route);
  }
  if (route.ngrokPid) {
    actions.stopNgrok(route);
  }
  if (options.stopTunnels !== false && route.tunnelPid) {
    actions.stopTunnelPid(route.tunnelPid);
  }
  if (route.tunnelExternalHostname) {
    actions.removeManagedAlias(route.tunnelExternalHostname, route.pid);
  }
  if (route.netbirdPid) {
    actions.stopNetbird(route);
  }
}
