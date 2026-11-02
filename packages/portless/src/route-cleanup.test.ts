import { describe, expect, it, vi } from "vitest";
import { DeadOwnerSharingStopper, cleanupRouteSharing } from "./route-cleanup.js";
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

  it("passes the plain-HTTP flag through to Tailscale cleanup", () => {
    const actions = {
      unregisterTailscale: vi.fn(),
      stopNgrok: vi.fn(),
      stopTunnelPid: vi.fn(),
      stopNetbird: vi.fn(),
      removeManagedAlias: vi.fn(),
    };
    const target = route({ tailscaleHttpsPort: 80, tailscaleHttp: true });

    cleanupRouteSharing(target, { actions });

    expect(actions.unregisterTailscale).toHaveBeenCalledWith(
      expect.objectContaining({ tailscaleHttpsPort: 80, tailscaleHttp: true })
    );
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

describe("DeadOwnerSharingStopper", () => {
  const alive = new Set<number>();
  const isOwnerAlive = (r: { pid: number }) => r.pid === 0 || alive.has(r.pid);

  it("stops sharing once for a route whose owner died, and not for live owners", () => {
    alive.clear();
    alive.add(2);
    const cleanup = vi.fn();
    const stopper = new DeadOwnerSharingStopper(cleanup, isOwnerAlive);
    const dead = route({ hostname: "dead.localhost", pid: 1, tunnelPid: 99 });
    const live = route({ hostname: "live.localhost", pid: 2, tunnelPid: 98 });
    const unowned = route({ hostname: "static.localhost", pid: 0 });

    expect(stopper.stopForDeadOwners([dead, live, unowned])).toEqual([dead]);
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(cleanup).toHaveBeenCalledWith(dead);

    // The same death is not handled again on later checks.
    expect(stopper.stopForDeadOwners([dead, live, unowned])).toEqual([]);
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("lets the sweep skip a death it already handled, once", () => {
    alive.clear();
    const cleanup = vi.fn();
    const stopper = new DeadOwnerSharingStopper(cleanup, isOwnerAlive);
    const dead = route({ pid: 1, tunnelPid: 99 });
    stopper.stopForDeadOwners([dead]);
    expect(stopper.consume(dead)).toBe(true);
    expect(stopper.consume(dead)).toBe(false);
    expect(stopper.consume(route({ hostname: "other.localhost", pid: 1 }))).toBe(false);
  });

  it("keeps going when one cleanup throws", () => {
    alive.clear();
    const cleanup = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error("boom");
      })
      .mockImplementation(() => undefined);
    const stopper = new DeadOwnerSharingStopper(cleanup, isOwnerAlive);
    const a = route({ hostname: "a.localhost", pid: 1 });
    const b = route({ hostname: "b.localhost", pid: 3 });
    expect(stopper.stopForDeadOwners([a, b])).toEqual([a, b]);
    expect(cleanup).toHaveBeenCalledTimes(2);
  });

  it("treats a live process owned by another user (EPERM) as alive by default", () => {
    const kill = vi.spyOn(process, "kill").mockImplementation(() => {
      throw Object.assign(new Error("EPERM"), { code: "EPERM" });
    });
    try {
      const cleanup = vi.fn();
      const stopper = new DeadOwnerSharingStopper(cleanup);
      expect(stopper.stopForDeadOwners([route({ pid: 4242 })])).toEqual([]);
      expect(cleanup).not.toHaveBeenCalled();
      kill.mockImplementation(() => {
        throw Object.assign(new Error("ESRCH"), { code: "ESRCH" });
      });
      expect(stopper.stopForDeadOwners([route({ pid: 4242 })])).toHaveLength(1);
      expect(cleanup).toHaveBeenCalledTimes(1);
    } finally {
      kill.mockRestore();
    }
  });
});
