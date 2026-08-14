import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { cleanupAll, getPublished, mdnsFqdn, publish, startLanIpMonitor } from "./mdns.js";

const spawnMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:child_process")>();
  return {
    ...original,
    spawn: spawnMock,
  };
});

describe("startLanIpMonitor", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("reports LAN IP changes, loss, and recovery", async () => {
    vi.useFakeTimers();

    let currentIp: string | null = "192.168.1.42";
    const changes: Array<[string | null, string | null]> = [];
    const monitor = startLanIpMonitor({
      initialIp: currentIp,
      intervalMs: 1000,
      resolveIp: async () => currentIp,
      onChange: (nextIp, previousIp) => {
        changes.push([nextIp, previousIp]);
      },
    });

    currentIp = "192.168.1.77";
    await vi.advanceTimersByTimeAsync(1000);
    currentIp = null;
    await vi.advanceTimersByTimeAsync(1000);
    currentIp = "192.168.1.99";
    await vi.advanceTimersByTimeAsync(1000);

    monitor.stop();

    expect(changes).toEqual([
      ["192.168.1.77", "192.168.1.42"],
      [null, "192.168.1.77"],
      ["192.168.1.99", null],
    ]);
  });

  it("does not notify when the LAN IP is unchanged", async () => {
    vi.useFakeTimers();

    const onChange = vi.fn();
    const monitor = startLanIpMonitor({
      initialIp: "192.168.1.42",
      intervalMs: 1000,
      resolveIp: async () => "192.168.1.42",
      onChange,
    });

    await vi.advanceTimersByTimeAsync(3000);
    monitor.stop();

    expect(onChange).not.toHaveBeenCalled();
  });

  it("invokes onError when resolveIp throws", async () => {
    vi.useFakeTimers();

    const errors: unknown[] = [];
    const monitor = startLanIpMonitor({
      initialIp: "192.168.1.42",
      intervalMs: 1000,
      resolveIp: async () => {
        throw new Error("network gone");
      },
      onChange: () => {},
      onError: (err) => {
        errors.push(err);
      },
    });

    await vi.advanceTimersByTimeAsync(1000);
    monitor.stop();

    expect(errors).toHaveLength(1);
    expect((errors[0] as Error).message).toBe("network gone");
  });

  it("stops polling after stop is called", async () => {
    vi.useFakeTimers();

    let currentIp = "192.168.1.42";
    const onChange = vi.fn();
    const monitor = startLanIpMonitor({
      initialIp: currentIp,
      intervalMs: 1000,
      resolveIp: async () => currentIp,
      onChange,
    });

    monitor.stop();
    currentIp = "192.168.1.77";
    await vi.advanceTimersByTimeAsync(1000);

    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("mdnsFqdn", () => {
  it("keeps exact local hostnames", () => {
    expect(mdnsFqdn("myapp.local")).toBe("myapp.local");
    expect(mdnsFqdn("api.myapp.local")).toBe("api.myapp.local");
  });

  it("rejects non-local suffixes instead of appending local", () => {
    expect(mdnsFqdn("myapp.test")).toBeNull();
    expect(mdnsFqdn("myapp.localhost")).toBeNull();
    expect(mdnsFqdn("myapp.example.localhost")).toBeNull();
  });
});

describe("publish", () => {
  beforeEach(() => {
    spawnMock.mockImplementation(() => {
      const child = new EventEmitter() as EventEmitter & { kill: ReturnType<typeof vi.fn> };
      child.kill = vi.fn();
      return child;
    });
  });

  afterEach(() => {
    cleanupAll();
    spawnMock.mockReset();
  });

  it("does not track or publish custom-suffix routes from a LAN suffix list", () => {
    publish("myapp.test", 3000, "192.168.1.10");
    publish("myapp.local", 3000, "192.168.1.10");
    publish("myapp.test", 3001, "192.168.1.10");

    expect(getPublished()).not.toContain("myapp.test");
    expect(getPublished()).not.toContain("myapp.test.local");
  });

  it("publishes one local record for same-hostname path routes", () => {
    publish("myapp.local", 3000, "192.168.1.10");
    publish("myapp.local", 3000, "192.168.1.10");

    expect(getPublished()).toEqual(["myapp.local"]);
    expect(spawnMock).toHaveBeenCalledTimes(1);
  });
});
