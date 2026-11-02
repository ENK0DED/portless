import { stopNgrok } from "./ngrok.js";
import { stopNetbird } from "./netbird.js";
import { unregisterTailscale } from "./tailscale.js";
import { stopTunnelPid } from "./tunnel.js";
import { isRouteOwnerAlive, type RouteMapping } from "./routes.js";
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

function routeDeathKey(route: RouteMapping): string {
  return `${route.hostname}\0${route.pathPrefix ?? ""}\0${route.label ?? ""}\0${route.pid}`;
}

/**
 * Stops a route's sharing once when its owner dies without cleaning up (a
 * SIGKILL): the tunnel, Tailscale serve and NetBird helpers it started would
 * otherwise keep the route public until the next sweep. It only signals
 * sharing helpers, never the dev server, and each death is handled once, so a
 * helper pid that the OS has since reused is not signaled again.
 */
export class DeadOwnerSharingStopper {
  private readonly handled = new Set<string>();

  constructor(
    private readonly cleanup: (route: RouteMapping) => void,
    private readonly isOwnerAlive: (route: Pick<RouteMapping, "pid">) => boolean = isRouteOwnerAlive
  ) {}

  /** Stop sharing for every route whose owner is dead and not handled yet. */
  stopForDeadOwners(routes: readonly RouteMapping[]): RouteMapping[] {
    const stopped: RouteMapping[] = [];
    for (const route of routes) {
      if (this.isOwnerAlive(route)) continue;
      const key = routeDeathKey(route);
      if (this.handled.has(key)) continue;
      this.handled.add(key);
      try {
        this.cleanup(route);
      } catch {
        // Sharing cleanup is best effort; the sweep still reaps the route.
      }
      stopped.push(route);
    }
    return stopped;
  }

  /**
   * True when this death was already handled, forgetting it. The sweep calls
   * this to skip a second cleanup for the same route.
   */
  consume(route: RouteMapping): boolean {
    return this.handled.delete(routeDeathKey(route));
  }
}
