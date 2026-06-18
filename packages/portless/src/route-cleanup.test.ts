import { describe, expect, it, vi } from "vitest";
import { cleanupRouteSharing } from "./route-cleanup.js";
import type { RouteMapping } from "./routes.js";

function route(overrides: Partial<RouteMapping> = {}): RouteMapping {
  return {
    hostname: "web.localhost",
    port: 4100,
    pid: 12345,
    ...overrides,
  };
}

describe("cleanupRouteSharing", () => {
  it("cleans sharing metadata for one exact route", () => {
    const actions = {
      unregisterTailscale: vi.fn(),
      stopNgrok: vi.fn(),
      stopTunnelPid: vi.fn(),
      stopNetbird: vi.fn(),
      removeManagedAlias: vi.fn(),
    };
    const target = route({
      tailscaleHttpsPort: 8443,
      ngrokPid: 23456,
      tunnelPid: 34567,
      tunnelExternalHostname: "public.example.com",
      netbirdPid: 45678,
    });

    cleanupRouteSharing(target, { actions });

    expect(actions.unregisterTailscale).toHaveBeenCalledWith(target);
    expect(actions.stopNgrok).toHaveBeenCalledWith(target);
    expect(actions.stopTunnelPid).toHaveBeenCalledWith(34567);
    expect(actions.stopNetbird).toHaveBeenCalledWith(target);
    expect(actions.removeManagedAlias).toHaveBeenCalledWith("public.example.com", 12345);
  });

  it("does not stop managed tunnel processes when stopTunnels is false", () => {
    const actions = {
      unregisterTailscale: vi.fn(),
      stopNgrok: vi.fn(),
      stopTunnelPid: vi.fn(),
      stopNetbird: vi.fn(),
      removeManagedAlias: vi.fn(),
    };

    cleanupRouteSharing(route({ tunnelPid: 34567 }), { actions, stopTunnels: false });

    expect(actions.stopTunnelPid).not.toHaveBeenCalled();
  });

  it("does nothing for routes without sharing metadata", () => {
    const actions = {
      unregisterTailscale: vi.fn(),
      stopNgrok: vi.fn(),
      stopTunnelPid: vi.fn(),
      stopNetbird: vi.fn(),
      removeManagedAlias: vi.fn(),
    };

    cleanupRouteSharing(route(), { actions });

    expect(actions.unregisterTailscale).not.toHaveBeenCalled();
    expect(actions.stopNgrok).not.toHaveBeenCalled();
    expect(actions.stopTunnelPid).not.toHaveBeenCalled();
    expect(actions.stopNetbird).not.toHaveBeenCalled();
    expect(actions.removeManagedAlias).not.toHaveBeenCalled();
  });
});
