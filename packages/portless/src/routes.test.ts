import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { pathToFileURL } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import {
  FILE_MODE,
  RouteStore,
  RouteConflictError,
  hasDeadRouteOwner,
  isRetryableLockError,
  isRouteOwnerAlive,
} from "./routes.js";
import { getProcessStartTime } from "./process-group.js";

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, renameSync: vi.fn(actual.renameSync) };
});

describe("RouteStore", () => {
  let tmpDir: string;
  let store: RouteStore;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "portless-routes-test-"));
    store = new RouteStore(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("ensureDir", () => {
    it("creates directory if it does not exist", () => {
      const nested = path.join(tmpDir, "sub", "dir");
      const s = new RouteStore(nested);
      s.ensureDir();
      expect(fs.existsSync(nested)).toBe(true);
    });

    it("does not throw if directory already exists", () => {
      store.ensureDir();
      expect(() => store.ensureDir()).not.toThrow();
    });
  });

  describe("loadRoutes", () => {
    it("returns empty array when routes file does not exist", () => {
      expect(store.loadRoutes()).toEqual([]);
    });

    it("returns empty array for invalid JSON", () => {
      store.ensureDir();
      fs.writeFileSync(store.getRoutesPath(), "not json");
      expect(store.loadRoutes()).toEqual([]);
    });

    it("aborts a route mutation on corrupt JSON without changing the file", () => {
      store.ensureDir();
      const raw = "{ not json";
      fs.writeFileSync(store.getRoutesPath(), raw);

      expect(() => store.addRoute("new.localhost", 4001, process.pid)).toThrow(
        `Refusing to modify a corrupt routes file: ${store.getRoutesPath()}`
      );
      expect(fs.readFileSync(store.getRoutesPath(), "utf-8")).toBe(raw);
    });

    it("keeps routes owned by a process the caller cannot signal (EPERM)", () => {
      store.ensureDir();
      fs.writeFileSync(
        store.getRoutesPath(),
        JSON.stringify([{ hostname: "other-user.localhost", port: 4001, pid: 999999 }])
      );
      const realKill = process.kill.bind(process);
      const kill = vi.spyOn(process, "kill").mockImplementation((pid, signal) => {
        if (pid === 999999 && signal === 0) {
          throw Object.assign(new Error("EPERM"), { code: "EPERM" });
        }
        return realKill(pid, signal);
      });
      try {
        expect(store.loadRoutes().map((r) => r.hostname)).toEqual(["other-user.localhost"]);
        expect(store.pruneStaleRoutes()).toEqual([]);
        expect(store.loadRoutes()).toHaveLength(1);
      } finally {
        kill.mockRestore();
      }
    });

    it("does not persist migration changes during an unlocked read", () => {
      store.ensureDir();
      const raw = JSON.stringify([
        { hostname: "api.localhost", port: 4001, pid: process.pid, pathPrefix: "/api/" },
      ]);
      fs.writeFileSync(store.getRoutesPath(), raw);

      expect(store.loadRoutesRaw()).toEqual([
        { hostname: "api.localhost", port: 4001, pid: process.pid, pathPrefix: "/api" },
      ]);
      expect(fs.readFileSync(store.getRoutesPath(), "utf-8")).toBe(raw);
    });

    it("calls onWarning for invalid JSON", () => {
      const warnings: string[] = [];
      const warnStore = new RouteStore(tmpDir, {
        onWarning: (msg) => warnings.push(msg),
      });
      warnStore.ensureDir();
      fs.writeFileSync(warnStore.getRoutesPath(), "not json");
      warnStore.loadRoutes();
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain("invalid JSON");
    });

    it("calls onWarning when routes file is not an array", () => {
      const warnings: string[] = [];
      const warnStore = new RouteStore(tmpDir, {
        onWarning: (msg) => warnings.push(msg),
      });
      warnStore.ensureDir();
      fs.writeFileSync(warnStore.getRoutesPath(), JSON.stringify({ not: "array" }));
      warnStore.loadRoutes();
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain("expected array");
    });

    it("filters out entries with invalid schema", () => {
      store.ensureDir();
      const routes = [
        { hostname: "valid.localhost", port: 4001, pid: process.pid },
        { hostname: "missing-port.localhost", pid: process.pid },
        { hostname: 123, port: 4002, pid: process.pid },
        "not an object",
        null,
      ];
      fs.writeFileSync(store.getRoutesPath(), JSON.stringify(routes));
      const loaded = store.loadRoutes();
      expect(loaded).toHaveLength(1);
      expect(loaded[0].hostname).toBe("valid.localhost");
    });

    it("rewrites representational path-prefix differences in place", () => {
      store.ensureDir();
      fs.writeFileSync(
        store.getRoutesPath(),
        JSON.stringify([
          { hostname: "api.localhost", port: 4001, pid: process.pid, pathPrefix: "/api///" },
          { hostname: "web.localhost", port: 4002, pid: process.pid, pathPrefix: "/" },
        ])
      );

      store.updateRoute("missing.localhost", {});
      expect(store.loadRoutes()).toEqual([
        { hostname: "api.localhost", port: 4001, pid: process.pid, pathPrefix: "/api" },
        { hostname: "web.localhost", port: 4002, pid: process.pid },
      ]);
      expect(JSON.parse(fs.readFileSync(store.getRoutesPath(), "utf-8"))).toEqual([
        { hostname: "api.localhost", port: 4001, pid: process.pid, pathPrefix: "/api" },
        { hostname: "web.localhost", port: 4002, pid: process.pid },
      ]);
    });

    it("removes an invalid persisted prefix with one actionable warning", () => {
      const warnings: string[] = [];
      const warnStore = new RouteStore(tmpDir, {
        onWarning: (message) => warnings.push(message),
      });
      warnStore.ensureDir();
      fs.writeFileSync(
        warnStore.getRoutesPath(),
        JSON.stringify([
          {
            hostname: "invalid.localhost",
            port: 4001,
            pid: process.pid,
            pathPrefix: "/api/../admin",
          },
          { hostname: "valid.localhost", port: 4002, pid: process.pid, pathPrefix: "/api" },
        ])
      );

      warnStore.updateRoute("missing.localhost", {});
      expect(warnStore.loadRoutes()).toEqual([
        { hostname: "valid.localhost", port: 4002, pid: process.pid, pathPrefix: "/api" },
      ]);
      expect(JSON.parse(fs.readFileSync(warnStore.getRoutesPath(), "utf-8"))).toEqual([
        { hostname: "valid.localhost", port: 4002, pid: process.pid, pathPrefix: "/api" },
      ]);
      expect(warnings).toEqual([
        expect.stringMatching(
          /invalid\.localhost\/api\/\.\.\/admin.*PID \d+.*"\.\." path segment.*portless alias invalid\.localhost 4001 --path <valid-prefix>/
        ),
      ]);
    });

    it("loads routes from file", () => {
      const routes = [{ hostname: "app.localhost", port: 4001, pid: process.pid }];
      store.ensureDir();
      fs.writeFileSync(store.getRoutesPath(), JSON.stringify(routes));
      const loaded = store.loadRoutes();
      expect(loaded).toHaveLength(1);
      expect(loaded[0].hostname).toBe("app.localhost");
      expect(loaded[0].port).toBe(4001);
    });

    it("filters out routes with dead PIDs", () => {
      // Use a PID that is guaranteed not to exist
      const deadPid = 999999;
      const routes = [
        { hostname: "alive.localhost", port: 4001, pid: process.pid },
        { hostname: "dead.localhost", port: 4002, pid: deadPid },
      ];
      store.ensureDir();
      fs.writeFileSync(store.getRoutesPath(), JSON.stringify(routes));
      const loaded = store.loadRoutes();
      expect(loaded).toHaveLength(1);
      expect(loaded[0].hostname).toBe("alive.localhost");
    });

    it("does not persist cleanup when persistCleanup is false (default)", () => {
      const deadPid = 999999;
      const routes = [
        { hostname: "alive.localhost", port: 4001, pid: process.pid },
        { hostname: "dead.localhost", port: 4002, pid: deadPid },
      ];
      store.ensureDir();
      fs.writeFileSync(store.getRoutesPath(), JSON.stringify(routes));
      store.loadRoutes();

      // Re-read the file directly; stale entries should still be on disk
      const raw = JSON.parse(fs.readFileSync(store.getRoutesPath(), "utf-8"));
      expect(raw).toHaveLength(2);
    });

    it("persists cleaned-up routes through an atomic temp file", async () => {
      const deadPid = 999999;
      const routes = [
        { hostname: "alive.localhost", port: 4001, pid: process.pid },
        { hostname: "dead.localhost", port: 4002, pid: deadPid },
      ];
      store.ensureDir();
      fs.writeFileSync(store.getRoutesPath(), JSON.stringify(routes));
      const events: string[] = [];
      // Watch the canonical spelling: Windows 8.3 short temp paths make
      // libuv's fs-event assert and abort the vitest worker.
      const watcher = fs.watch(fs.realpathSync.native(tmpDir), (_eventType, filename) => {
        if (filename) events.push(filename.toString());
      });
      try {
        store.loadRoutes(true);
        for (let attempt = 0; attempt < 20; attempt++) {
          if (events.some((entry) => entry.startsWith("routes.json.tmp-"))) break;
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        expect(events.some((entry) => entry.startsWith("routes.json.tmp-"))).toBe(true);
      } finally {
        watcher.close();
      }

      // Re-read the file directly to verify it was cleaned up
      const raw = JSON.parse(fs.readFileSync(store.getRoutesPath(), "utf-8"));
      expect(raw).toHaveLength(1);
      expect(raw[0].hostname).toBe("alive.localhost");
    });
  });

  describe("saveRoutes (via addRoute)", () => {
    it("persists routes to file", () => {
      store.addRoute("test.localhost", 4123, process.pid);
      const raw = JSON.parse(fs.readFileSync(store.getRoutesPath(), "utf-8"));
      expect(raw).toHaveLength(1);
      expect(raw[0].hostname).toBe("test.localhost");
      expect(raw[0].port).toBe(4123);
      expect(raw[0].pid).toBe(process.pid);
    });

    it("creates directory if it does not exist", () => {
      const nested = path.join(tmpDir, "nested");
      const s = new RouteStore(nested);
      s.addRoute("test.localhost", 4001, process.pid);
      expect(fs.existsSync(s.getRoutesPath())).toBe(true);
    });

    it("cleans the temp file when the atomic rename fails", async () => {
      store.ensureDir();
      vi.mocked(fs.renameSync).mockImplementationOnce(() => {
        throw new Error("simulated rename failure");
      });
      const events: string[] = [];
      // Watch the canonical spelling: Windows 8.3 short temp paths make
      // libuv's fs-event assert and abort the vitest worker.
      const watcher = fs.watch(fs.realpathSync.native(tmpDir), (_eventType, filename) => {
        if (filename) events.push(filename.toString());
      });
      try {
        expect(() => store.addRoute("new.localhost", 4002, process.pid)).toThrow(
          "simulated rename failure"
        );
        for (let attempt = 0; attempt < 20; attempt++) {
          if (events.some((entry) => entry.startsWith("routes.json.tmp-"))) break;
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        expect(events.some((entry) => entry.startsWith("routes.json.tmp-"))).toBe(true);
        expect(fs.existsSync(store.getRoutesPath())).toBe(false);
        expect(
          fs.readdirSync(tmpDir).filter((entry) => entry.startsWith("routes.json.tmp-"))
        ).toEqual([]);
      } finally {
        watcher.close();
      }
    });

    // POSIX-only: Windows stat models just the write bit, so a 0o644
    // request reads back as 0o666 there.
    it.skipIf(process.platform === "win32")(
      "writes route files with the configured file mode",
      () => {
        store.addRoute("mode.localhost", 4003, process.pid);
        expect(fs.statSync(store.getRoutesPath()).mode & 0o777).toBe(FILE_MODE);
      }
    );
  });

  describe("addRoute", () => {
    it("adds a route to empty store", () => {
      store.addRoute("myapp.localhost", 4001, process.pid);
      const routes = store.loadRoutes();
      expect(routes).toHaveLength(1);
      expect(routes[0]).toEqual({
        hostname: "myapp.localhost",
        port: 4001,
        pid: process.pid,
        registeredAt: expect.any(Number),
      });
    });

    it("records when a route registered, for sole-owner and multiplex members", () => {
      const before = Date.now();
      store.addRoute("solo.localhost", 4001, process.pid);
      store.addRoute("multi.localhost", 4002, process.pid, false, { label: "a" });
      const after = Date.now();
      for (const route of store.loadRoutes()) {
        expect(route.registeredAt).toBeGreaterThanOrEqual(before);
        expect(route.registeredAt).toBeLessThanOrEqual(after);
      }
    });

    it("replaces existing route with same hostname", () => {
      store.addRoute("myapp.localhost", 4001, process.pid);
      store.addRoute("myapp.localhost", 4002, process.pid);
      const routes = store.loadRoutes();
      expect(routes).toHaveLength(1);
      expect(routes[0].port).toBe(4002);
    });

    it("preserves other routes when adding", () => {
      store.addRoute("app1.localhost", 4001, process.pid);
      store.addRoute("app2.localhost", 4002, process.pid);
      const routes = store.loadRoutes();
      expect(routes).toHaveLength(2);
      const hostnames = routes.map((r) => r.hostname).sort();
      expect(hostnames).toEqual(["app1.localhost", "app2.localhost"]);
    });

    it("allows the same hostname to use multiple path prefixes", () => {
      store.addRoute("myapp.localhost", 4001, process.pid, false, { pathPrefix: "/api" });
      store.addRoute("myapp.localhost", 4002, process.pid, false, { pathPrefix: "/docs" });

      const routes = store.loadRoutes();
      expect(routes).toHaveLength(2);
      expect(routes.map((route) => [route.pathPrefix, route.port]).sort()).toEqual([
        ["/api", 4001],
        ["/docs", 4002],
      ]);
    });

    it("keeps legacy root routes compatible without storing a path prefix", () => {
      store.addRoute("myapp.localhost", 4001, process.pid);

      const routes = store.loadRoutes();
      expect(routes).toHaveLength(1);
      expect(routes[0].pathPrefix).toBeUndefined();
    });
  });

  describe("addRoute with force", () => {
    function spawnSleeper(): number {
      const child = spawn("node", ["-e", "setTimeout(()=>{},60000)"], {
        detached: true,
        stdio: "ignore",
      });
      child.unref();
      return child.pid!;
    }

    function isAlive(pid: number): boolean {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    }

    it("refuses to replace a static alias without --force", () => {
      store.addRoute("db.localhost", 5432, 0);
      expect(() => store.addRoute("db.localhost", 4002, process.pid)).toThrow(
        '"db.localhost" is a static alias. Use --force to replace it; re-add the alias with "portless alias" afterwards.'
      );
    });

    it("names a static alias when a multiplex member would replace it", () => {
      store.addRoute("db.localhost", 5432, 0);
      expect(() =>
        store.addRoute("db.localhost", 4002, process.pid, false, { label: "web" })
      ).toThrow(/is a static alias/);
    });

    it("replaces a static alias with --force without sending any signal", () => {
      const realKill = process.kill.bind(process);
      const kill = vi
        .spyOn(process, "kill")
        .mockImplementation((pid, signal) => (signal ? true : realKill(pid, signal)));
      try {
        store.addRoute("db.localhost", 5432, 0);
        expect(store.addRoute("db.localhost", 4002, process.pid, true)).toBeUndefined();
        expect(kill.mock.calls.filter(([, signal]) => signal)).toEqual([]);
        const routes = store.loadRoutes();
        expect(routes).toHaveLength(1);
        expect(routes[0]).toMatchObject({ port: 4002, pid: process.pid });
      } finally {
        kill.mockRestore();
      }
    });

    it("throws RouteConflictError without --force when route is owned by another live process", () => {
      const otherPid = spawnSleeper();
      try {
        store.addRoute("app.localhost", 4001, otherPid);
        expect(() => store.addRoute("app.localhost", 4002, process.pid)).toThrow(
          RouteConflictError
        );
      } finally {
        try {
          process.kill(otherPid, "SIGTERM");
        } catch {
          // already dead
        }
      }
    });

    it("throws only for the same hostname and path prefix", () => {
      const otherPid = spawnSleeper();
      try {
        store.addRoute("app.localhost", 4001, otherPid, false, { pathPrefix: "/api" });
        expect(() =>
          store.addRoute("app.localhost", 4002, process.pid, false, { pathPrefix: "/api" })
        ).toThrow(RouteConflictError);
        expect(() =>
          store.addRoute("app.localhost", 4003, process.pid, false, { pathPrefix: "/docs" })
        ).not.toThrow();
      } finally {
        try {
          process.kill(otherPid, "SIGTERM");
        } catch {
          // already dead
        }
      }
    });

    it("kills the existing process and returns its PID when --force is used", async () => {
      const otherPid = spawnSleeper();
      try {
        store.addRoute("app.localhost", 4001, otherPid);
        const killedPid = store.addRoute("app.localhost", 4002, process.pid, true);
        expect(killedPid).toBe(otherPid);
        // Wait for signal delivery
        await new Promise((r) => setTimeout(r, 200));
        expect(isAlive(otherPid)).toBe(false);
      } finally {
        try {
          process.kill(otherPid, "SIGTERM");
        } catch {
          // already dead
        }
      }
    });

    it("replaces the route when --force kills the existing process", () => {
      const otherPid = spawnSleeper();
      try {
        store.addRoute("app.localhost", 4001, otherPid);
        store.addRoute("app.localhost", 4002, process.pid, true);
        const routes = store.loadRoutes();
        expect(routes).toHaveLength(1);
        expect(routes[0].port).toBe(4002);
        expect(routes[0].pid).toBe(process.pid);
      } finally {
        try {
          process.kill(otherPid, "SIGTERM");
        } catch {
          // already dead
        }
      }
    });

    it("force override only replaces the matching path prefix", () => {
      const otherPid = spawnSleeper();
      try {
        store.addRoute("app.localhost", 4001, otherPid, false, { pathPrefix: "/api" });
        store.addRoute("app.localhost", 4002, process.pid, false, { pathPrefix: "/docs" });
        store.addRoute("app.localhost", 4003, process.pid, true, { pathPrefix: "/api" });

        const routes = store
          .loadRoutes()
          .sort((a, b) => (a.pathPrefix ?? "/").localeCompare(b.pathPrefix ?? "/"));
        expect(routes).toHaveLength(2);
        expect(routes.map((route) => [route.pathPrefix, route.port])).toEqual([
          ["/api", 4003],
          ["/docs", 4002],
        ]);
      } finally {
        try {
          process.kill(otherPid, "SIGTERM");
        } catch {
          // already dead
        }
      }
    });

    it("returns undefined when no conflicting process exists", () => {
      const killedPid = store.addRoute("app.localhost", 4001, process.pid, true);
      expect(killedPid).toBeUndefined();
    });
  });

  describe("removeRoute", () => {
    it("removes an existing route", () => {
      store.addRoute("myapp.localhost", 4001, process.pid);
      store.removeRoute("myapp.localhost");
      const routes = store.loadRoutes();
      expect(routes).toHaveLength(0);
    });

    it("does not fail when removing non-existent route", () => {
      store.addRoute("myapp.localhost", 4001, process.pid);
      expect(() => store.removeRoute("other.localhost")).not.toThrow();
      const routes = store.loadRoutes();
      expect(routes).toHaveLength(1);
    });

    it("preserves other routes when removing", () => {
      store.addRoute("app1.localhost", 4001, process.pid);
      store.addRoute("app2.localhost", 4002, process.pid);
      store.removeRoute("app1.localhost");
      const routes = store.loadRoutes();
      expect(routes).toHaveLength(1);
      expect(routes[0].hostname).toBe("app2.localhost");
    });

    it("removes only the requested path prefix", () => {
      store.addRoute("myapp.localhost", 4001, process.pid, false, { pathPrefix: "/api" });
      store.addRoute("myapp.localhost", 4002, process.pid, false, { pathPrefix: "/docs" });

      store.removeRoute("myapp.localhost", undefined, { pathPrefix: "/api" });

      const routes = store.loadRoutes();
      expect(routes).toHaveLength(1);
      expect(routes[0].pathPrefix).toBe("/docs");
      expect(routes[0].port).toBe(4002);
    });

    it("removes the route when the caller still owns it", () => {
      store.addRoute("myapp.localhost", 4001, process.pid);
      store.removeRoute("myapp.localhost", process.pid);
      expect(store.loadRoutes()).toHaveLength(0);
    });

    it("does not remove a route the caller no longer owns (post --force takeover)", () => {
      // Simulate the state right after a --force takeover: the route is owned
      // by another live process. The killed process's exit cleanup (passing
      // its own pid) must not deregister the new owner's route.
      const newOwnerPid = process.ppid;
      store.addRoute("myapp.localhost", 4002, newOwnerPid);
      store.removeRoute("myapp.localhost", process.pid);
      const routes = store.loadRoutes();
      expect(routes).toHaveLength(1);
      expect(routes[0].pid).toBe(newOwnerPid);
    });
  });

  describe("transferRoute", () => {
    const DEAD_PID = 99_999_991;

    it("moves a route to another pid while the caller owns it", () => {
      store.addRoute("myapp.localhost", 4001, process.pid);
      expect(store.transferRoute("myapp.localhost", process.pid, process.ppid)).toEqual({
        hadSharing: false,
      });
      const routes = store.loadRoutes();
      expect(routes).toHaveLength(1);
      expect(routes[0].pid).toBe(process.ppid);
      expect(routes[0].port).toBe(4001);
    });

    it("does not move a route owned by another pid", () => {
      store.addRoute("myapp.localhost", 4001, process.ppid);
      expect(store.transferRoute("myapp.localhost", process.pid, 1)).toBeNull();
      expect(store.loadRoutes()[0].pid).toBe(process.ppid);
    });

    it("clears every sharing field, because those helpers stop with the command", () => {
      store.addRoute("myapp.localhost", 4001, process.pid);
      store.updateRoute("myapp.localhost", {
        ngrokUrl: "https://abc.ngrok.app",
        ngrokPid: 123,
        tailscaleUrl: "https://dev.tail1234.ts.net",
        tailscaleHttpsPort: 8443,
        tailscaleFunnel: true,
        tailscaleHttp: true,
        tailscaleServiceName: "svc",
        tailscaleServiceUrl: "https://svc.tail1234.ts.net",
        tailscaleServicePending: true,
        tunnelProvider: "cloudflare",
        tunnelUrl: "https://abc.trycloudflare.com",
        tunnelExternalHostname: "abc.trycloudflare.com",
        tunnelPid: 124,
        netbirdUrl: "https://abc.netbird.io",
        netbirdPid: 125,
        cloudflareUrl: "https://abc.trycloudflare.com",
        cloudflarePid: 126,
      });
      expect(store.transferRoute("myapp.localhost", process.pid, process.ppid)).toEqual({
        hadSharing: true,
      });
      const route = store.loadRoutes()[0];
      expect(Object.keys(route).sort()).toEqual(["hostname", "pid", "port", "registeredAt"].sort());
    });

    it("drops the process group record so the live daemon is never an orphan", () => {
      store.addRoute("myapp.localhost", 4001, process.pid);
      const startTime = getProcessStartTime(process.pid) ?? "recorded";
      store.updateRoute("myapp.localhost", { childPgid: process.pid, childStartTime: startTime });
      store.transferRoute("myapp.localhost", process.pid, process.ppid);
      const route = store.loadRoutes()[0];
      expect(route.childPgid).toBeUndefined();
      expect(route.childStartTime).toBeUndefined();
      expect(store.isOrphaned(route)).toBe(false);
      expect(store.loadOrphanedRoutes()).toEqual([]);
    });

    it("leaves no orphan record when the new owner later dies", () => {
      store.addRoute("myapp.localhost", 4001, process.pid);
      store.updateRoute("myapp.localhost", {
        childPgid: process.pid,
        childStartTime: getProcessStartTime(process.pid) ?? "recorded",
      });
      store.transferRoute("myapp.localhost", process.pid, DEAD_PID);
      const [route] = store.loadRoutesRaw();
      expect(route.pid).toBe(DEAD_PID);
      expect(store.isOrphaned(route)).toBe(false);
      expect(store.pruneStaleRoutes({ keepOrphaned: true }).map((r) => r.hostname)).toEqual([
        "myapp.localhost",
      ]);
      expect(store.loadRoutesRaw()).toEqual([]);
    });

    it("targets the route under its path prefix only", () => {
      store.addRoute("myapp.localhost", 4001, process.pid, false, { pathPrefix: "/api" });
      store.addRoute("myapp.localhost", 4002, process.pid, false, { pathPrefix: "/web" });
      expect(store.transferRoute("myapp.localhost", process.pid, process.ppid)).toBeNull();
      expect(
        store.transferRoute("myapp.localhost", process.pid, process.ppid, { pathPrefix: "/api" })
      ).toEqual({ hadSharing: false });
      const byPrefix = new Map(store.loadRoutes().map((r) => [r.pathPrefix, r]));
      expect(byPrefix.get("/api")?.pid).toBe(process.ppid);
      expect(byPrefix.get("/web")?.pid).toBe(process.pid);
    });

    it("moves only the labelled member of a multiplexed hostname", () => {
      // One pid can hold one member, so the sibling belongs to another live process.
      store.addRoute("myapp.localhost", 4001, process.ppid, false, { label: "web" });
      store.addRoute("myapp.localhost", 4002, process.pid, false, { label: "api" });
      expect(store.transferRoute("myapp.localhost", process.pid, 1, { label: "web" })).toBeNull();
      expect(store.transferRoute("myapp.localhost", process.pid, 1, { label: "api" })).toEqual({
        hadSharing: false,
      });
      // Read raw: pid 1 is a live init process on Unix but does not exist on
      // Windows, and this test checks the transfer, not owner liveness.
      const byLabel = new Map(store.loadRoutesRaw().map((r) => [r.label, r]));
      expect(byLabel.get("api")?.pid).toBe(1);
      expect(byLabel.get("api")?.port).toBe(4002);
      expect(byLabel.get("web")?.pid).toBe(process.ppid);
    });

    it("lets the exit cleanup leave a transferred route alone", () => {
      store.addRoute("myapp.localhost", 4001, process.pid);
      store.transferRoute("myapp.localhost", process.pid, process.ppid);
      store.removeRoute("myapp.localhost", process.pid);
      expect(store.loadRoutes().map((r) => r.pid)).toEqual([process.ppid]);
    });
  });

  describe("locking (via concurrent addRoute)", () => {
    it("treats common lock directory races as retryable", () => {
      for (const code of ["EEXIST", "EPERM", "EACCES"]) {
        const err = Object.assign(new Error(code), { code });
        expect(isRetryableLockError(err)).toBe(true);
      }

      const enoent = Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      expect(isRetryableLockError(enoent)).toBe(false);
      expect(isRetryableLockError(new Error("unknown"))).toBe(false);
    });

    it("handles stale lock by recovering and completing the operation", () => {
      store.ensureDir();
      const lockPath = path.join(tmpDir, "routes.lock");
      fs.mkdirSync(lockPath);
      const staleTime = new Date(Date.now() - 11_000);
      fs.utimesSync(lockPath, staleTime, staleTime);
      expect(() => store.addRoute("test.localhost", 4001, process.pid)).not.toThrow();
      const routes = store.loadRoutes();
      expect(routes).toHaveLength(1);
      expect(routes[0].hostname).toBe("test.localhost");
    });

    it("handles many parallel addRoute calls without lock errors", async () => {
      const count = 20;
      const scriptPath = path.join(tmpDir, "worker.mjs");
      const pkgDir = path.resolve(import.meta.dirname, "..");
      const importUrl = pathToFileURL(path.join(pkgDir, "dist", "index.js")).href;
      fs.writeFileSync(
        scriptPath,
        [
          `import { RouteStore } from ${JSON.stringify(importUrl)};`,
          `const [dir, hostname, port] = process.argv.slice(2);`,
          `const store = new RouteStore(dir);`,
          `try { store.addRoute(hostname, Number(port), process.pid); console.log("ok"); }`,
          `catch (e) { console.log("error:" + e.message); process.exit(1); }`,
          `process.stdin.resume();`,
        ].join("\n")
      );

      const children: ReturnType<typeof spawn>[] = [];
      const ready: Promise<{ code: number | null; stdout: string }>[] = [];
      for (let i = 0; i < count; i++) {
        const child = spawn(
          process.execPath,
          [scriptPath, tmpDir, `app${i}.localhost`, String(4000 + i)],
          { stdio: ["pipe", "pipe", "pipe"] }
        );
        children.push(child);
        ready.push(
          new Promise((resolve) => {
            let stdout = "";
            child.stdout!.on("data", (d: Buffer) => {
              stdout += d.toString();
              if (stdout.includes("ok") || stdout.includes("error:")) {
                resolve({ code: null, stdout: stdout.trim() });
              }
            });
            child.on("close", (code) => resolve({ code, stdout: stdout.trim() }));
          })
        );
      }

      const outcomes = await Promise.all(ready);
      const failures = outcomes.filter((o) => !o.stdout.startsWith("ok"));

      for (const child of children) {
        child.stdin!.end();
      }

      expect(failures).toHaveLength(0);

      const raw = JSON.parse(fs.readFileSync(store.getRoutesPath(), "utf-8"));
      expect(raw).toHaveLength(count);

      const hostnames = raw.map((r: { hostname: string }) => r.hostname).sort();
      const expected = Array.from({ length: count }, (_, i) => `app${i}.localhost`).sort();
      expect(hostnames).toEqual(expected);
    }, 30_000);

    it("survives sustained lock contention that defeats a naive retry strategy", async () => {
      store.ensureDir();
      const lockPath = path.join(tmpDir, "routes.lock");

      // A child process holds the lock for 1.5s, simulating a slow writer on
      // a loaded machine. The old strategy (20 retries * 50ms = 1s budget)
      // would time out; exponential backoff with a larger budget survives.
      const holdMs = 1500;
      const holder = spawn(
        process.execPath,
        [
          "-e",
          [
            `const fs = require("fs");`,
            `const lockPath = ${JSON.stringify(lockPath)};`,
            `fs.mkdirSync(lockPath, { recursive: true });`,
            `console.log("holding");`,
            `setTimeout(() => { try { fs.rmSync(lockPath, { recursive: true }); } catch {} console.log("released"); }, ${holdMs});`,
          ].join("\n"),
        ],
        { stdio: ["ignore", "pipe", "pipe"] }
      );

      // Wait for the holder to acquire the lock
      await new Promise<void>((resolve) => {
        holder.stdout!.on("data", (d: Buffer) => {
          if (d.toString().includes("holding")) resolve();
        });
      });

      // addRoute must wait for the lock to be released (>1.5s)
      expect(() => store.addRoute("contended.localhost", 5000, process.pid)).not.toThrow();

      holder.kill("SIGTERM");

      const routes = store.loadRoutes();
      expect(routes).toHaveLength(1);
      expect(routes[0].hostname).toBe("contended.localhost");
    }, 10_000);
  });

  describe("tailscale metadata", () => {
    it("persists and loads tailscale fields via updateRoute", () => {
      store.addRoute("myapp.localhost", 4123, process.pid);
      store.updateRoute("myapp.localhost", {
        tailscaleUrl: "https://devbox.example.ts.net",
        tailscaleHttpsPort: 443,
      });
      const routes = store.loadRoutes();
      expect(routes).toHaveLength(1);
      expect(routes[0].tailscaleUrl).toBe("https://devbox.example.ts.net");
      expect(routes[0].tailscaleHttpsPort).toBe(443);
      expect(routes[0].tailscaleFunnel).toBeUndefined();
    });

    it("persists funnel flag via updateRoute", () => {
      store.addRoute("api.localhost", 4456, process.pid);
      store.updateRoute("api.localhost", {
        tailscaleUrl: "https://devbox.example.ts.net:8443",
        tailscaleHttpsPort: 8443,
        tailscaleFunnel: true,
      });
      const routes = store.loadRoutes();
      expect(routes).toHaveLength(1);
      expect(routes[0].tailscaleFunnel).toBe(true);
    });

    it("persists and clears the plain-HTTP flag via updateRoute", () => {
      store.addRoute("api.localhost", 4456, process.pid);
      store.updateRoute("api.localhost", {
        tailscaleUrl: "http://100.101.102.103:8080",
        tailscaleHttpsPort: 8080,
        tailscaleHttp: true,
      });
      let routes = store.loadRoutes();
      expect(routes[0].tailscaleHttp).toBe(true);
      expect(routes[0].tailscaleFunnel).toBeUndefined();

      store.updateRoute("api.localhost", { tailscaleHttp: null });
      routes = store.loadRoutes();
      expect(routes[0].tailscaleHttp).toBeUndefined();
    });

    it("persists and clears Tailscale Service metadata via updateRoute", () => {
      store.addRoute("api.localhost", 4456, process.pid);
      store.updateRoute("api.localhost", {
        tailscaleServiceName: "api",
        tailscaleServiceUrl: "https://api.example.ts.net",
        tailscaleServicePending: true,
      });

      let routes = store.loadRoutes();
      expect(routes).toHaveLength(1);
      expect(routes[0].tailscaleServiceName).toBe("api");
      expect(routes[0].tailscaleServiceUrl).toBe("https://api.example.ts.net");
      expect(routes[0].tailscaleServicePending).toBe(true);

      store.updateRoute("api.localhost", {
        tailscaleServiceName: null,
        tailscaleServiceUrl: null,
        tailscaleServicePending: null,
      });

      routes = store.loadRoutes();
      expect(routes[0].tailscaleServiceName).toBeUndefined();
      expect(routes[0].tailscaleServiceUrl).toBeUndefined();
      expect(routes[0].tailscaleServicePending).toBeUndefined();
    });

    it("loads routes without tailscale fields (backward compat)", () => {
      store.addRoute("legacy.localhost", 4000, process.pid);
      const routes = store.loadRoutes();
      expect(routes).toHaveLength(1);
      expect(routes[0].tailscaleUrl).toBeUndefined();
      expect(routes[0].tailscaleHttpsPort).toBeUndefined();
      expect(routes[0].tailscaleServiceName).toBeUndefined();
    });

    it("updateRoute is a no-op for nonexistent hostname", () => {
      store.addRoute("myapp.localhost", 4123, process.pid);
      store.updateRoute("noexist.localhost", {
        tailscaleUrl: "https://devbox.example.ts.net",
      });
      const routes = store.loadRoutes();
      expect(routes).toHaveLength(1);
      expect(routes[0].tailscaleUrl).toBeUndefined();
    });
  });

  describe("route protocol metadata", () => {
    it("persists h2c protocol when a route is added", () => {
      store.addRoute("grpc.localhost", 50051, process.pid, false, { protocol: "h2c" });

      const routes = store.loadRoutes();
      expect(routes).toHaveLength(1);
      expect(routes[0].protocol).toBe("h2c");
    });

    it("loads legacy routes without protocol as HTTP/1.1 routes", () => {
      store.addRoute("web.localhost", 4123, process.pid);

      const routes = store.loadRoutes();
      expect(routes).toHaveLength(1);
      expect(routes[0].protocol).toBeUndefined();
    });
  });

  describe("ngrok metadata", () => {
    it("persists and loads ngrok fields via updateRoute", () => {
      store.addRoute("myapp.localhost", 4123, process.pid);
      store.updateRoute("myapp.localhost", {
        ngrokUrl: "https://abc123.ngrok.app",
        ngrokPid: 12345,
      });
      const routes = store.loadRoutes();
      expect(routes).toHaveLength(1);
      expect(routes[0].ngrokUrl).toBe("https://abc123.ngrok.app");
      expect(routes[0].ngrokPid).toBe(12345);
    });

    it("clears ngrok fields via updateRoute", () => {
      store.addRoute("myapp.localhost", 4123, process.pid);
      store.updateRoute("myapp.localhost", {
        ngrokUrl: "https://abc123.ngrok.app",
        ngrokPid: 12345,
      });
      store.updateRoute("myapp.localhost", {
        ngrokUrl: null,
        ngrokPid: null,
      });
      const routes = store.loadRoutes();
      expect(routes).toHaveLength(1);
      expect(routes[0].ngrokUrl).toBeUndefined();
      expect(routes[0].ngrokPid).toBeUndefined();
    });

    it("loads routes without ngrok fields", () => {
      store.addRoute("legacy.localhost", 4000, process.pid);
      const routes = store.loadRoutes();
      expect(routes).toHaveLength(1);
      expect(routes[0].ngrokUrl).toBeUndefined();
      expect(routes[0].ngrokPid).toBeUndefined();
    });
  });

  describe("netbird metadata", () => {
    it("persists and loads netbird fields via updateRoute", () => {
      store.addRoute("myapp.localhost", 4123, process.pid);
      store.updateRoute("myapp.localhost", {
        netbirdUrl: "https://myapp.proxy.example.com",
        netbirdPid: 12345,
      });

      const routes = store.loadRoutes();
      expect(routes).toHaveLength(1);
      expect(routes[0].netbirdUrl).toBe("https://myapp.proxy.example.com");
      expect(routes[0].netbirdPid).toBe(12345);
    });

    it("clears netbird fields via updateRoute", () => {
      store.addRoute("myapp.localhost", 4123, process.pid);
      store.updateRoute("myapp.localhost", {
        netbirdUrl: "https://myapp.proxy.example.com",
        netbirdPid: 12345,
      });
      store.updateRoute("myapp.localhost", {
        netbirdUrl: null,
        netbirdPid: null,
      });

      const routes = store.loadRoutes();
      expect(routes).toHaveLength(1);
      expect(routes[0].netbirdUrl).toBeUndefined();
      expect(routes[0].netbirdPid).toBeUndefined();
    });
  });
});

describe("RouteStore multiplex", { timeout: 15_000 }, () => {
  let tmpDir: string;
  let store: RouteStore;
  const sleepers: number[] = [];

  function spawnSleeper(): number {
    const child = spawn(process.execPath, ["-e", "setTimeout(()=>{},60000)"], {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
    sleepers.push(child.pid!);
    return child.pid!;
  }

  function isAlive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "portless-mux-test-"));
    store = new RouteStore(tmpDir);
  });

  afterEach(() => {
    for (const pid of sleepers) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // already dead
      }
    }
    sleepers.length = 0;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("lets several labeled members share one hostname", () => {
    store.addRoute("app.localhost", 4001, spawnSleeper(), false, { label: "main" });
    store.addRoute("app.localhost", 4002, spawnSleeper(), false, { label: "hotfix" });
    const routes = store.loadRoutes();
    expect(routes).toHaveLength(2);
    expect(routes.map((r) => r.label).sort()).toEqual(["hotfix", "main"]);
    expect(new Set(routes.map((r) => r.port))).toEqual(new Set([4001, 4002]));
  });

  it("rejects a sole-owner registration onto a multiplexed hostname", () => {
    store.addRoute("app.localhost", 4001, spawnSleeper(), false, { label: "main" });
    expect(() => store.addRoute("app.localhost", 4002, spawnSleeper())).toThrow(RouteConflictError);
  });

  it("rejects a multiplex registration onto a sole-owned hostname", () => {
    store.addRoute("app.localhost", 4001, spawnSleeper());
    expect(() =>
      store.addRoute("app.localhost", 4002, spawnSleeper(), false, { label: "main" })
    ).toThrow(RouteConflictError);
  });

  it("rejects a second member with the same label", () => {
    store.addRoute("app.localhost", 4001, spawnSleeper(), false, { label: "main" });
    expect(() =>
      store.addRoute("app.localhost", 4002, spawnSleeper(), false, { label: "main" })
    ).toThrow(RouteConflictError);
  });

  it("force replaces the same-label member and keeps other members", () => {
    const mainPid = spawnSleeper();
    store.addRoute("app.localhost", 4001, mainPid, false, { label: "main" });
    store.addRoute("app.localhost", 4002, spawnSleeper(), false, { label: "hotfix" });

    const killed = store.addRoute("app.localhost", 4003, spawnSleeper(), true, { label: "main" });
    expect(killed).toBe(mainPid);

    const routes = store.loadRoutes();
    expect(routes).toHaveLength(2);
    const main = routes.find((r) => r.label === "main");
    expect(main?.port).toBe(4003);
    expect(routes.find((r) => r.label === "hotfix")?.port).toBe(4002);
  });

  it("removeRoute by owner pid removes only that member", () => {
    const mainPid = spawnSleeper();
    store.addRoute("app.localhost", 4001, mainPid, false, { label: "main" });
    store.addRoute("app.localhost", 4002, spawnSleeper(), false, { label: "hotfix" });

    store.removeRoute("app.localhost", mainPid);
    const routes = store.loadRoutes();
    expect(routes).toHaveLength(1);
    expect(routes[0].label).toBe("hotfix");
  });

  it("removeRoute by label removes only the matching member", () => {
    store.addRoute("app.localhost", 4001, spawnSleeper(), false, { label: "main" });
    store.addRoute("app.localhost", 4002, spawnSleeper(), false, { label: "hotfix" });

    store.removeRoute("app.localhost", undefined, { label: "hotfix" });
    const routes = store.loadRoutes();
    expect(routes).toHaveLength(1);
    expect(routes[0].label).toBe("main");
  });

  it("persists the label across load", () => {
    store.addRoute("app.localhost", 4001, spawnSleeper(), false, { label: "main" });
    const reloaded = new RouteStore(tmpDir).loadRoutes();
    expect(reloaded[0].label).toBe("main");
  });

  it("treats an empty label as a sole-owner route", () => {
    store.addRoute("app.localhost", 4001, spawnSleeper(), false, { label: "   " });
    const routes = store.loadRoutes();
    expect(routes[0].label).toBeUndefined();
    expect(isAlive(sleepers[0])).toBe(true);
  });
});

describe.skipIf(process.platform === "win32")("orphaned routes", () => {
  let tmpDir: string;
  let store: RouteStore;
  let group: number | undefined;

  /** A detached process leading its own group, like a dev server portless spawned. */
  function startGroup(): number {
    const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
    group = child.pid!;
    return group;
  }

  /** A pid that is guaranteed dead, standing in for the exited portless owner. */
  function deadPid(): number {
    const result = spawnSync(
      process.execPath,
      ["-e", "process.stdout.write(String(process.pid))"],
      {
        encoding: "utf-8",
      }
    );
    return Number(result.stdout);
  }

  function writeOrphan(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    const pgid = startGroup();
    const route = {
      hostname: "orphan.localhost",
      port: 4555,
      pid: deadPid(),
      childPgid: pgid,
      childStartTime: getProcessStartTime(pgid),
      ...overrides,
    };
    store.ensureDir();
    fs.writeFileSync(store.getRoutesPath(), JSON.stringify([route]));
    return route;
  }

  const raw = (): Array<{ hostname: string; ngrokPid?: number }> =>
    JSON.parse(fs.readFileSync(store.getRoutesPath(), "utf-8"));

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "portless-orphans-test-"));
    store = new RouteStore(tmpDir);
  });

  afterEach(() => {
    if (group) {
      try {
        process.kill(-group, "SIGKILL");
      } catch {
        // already gone
      }
    }
    group = undefined;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("is not routable but is reported as orphaned", () => {
    writeOrphan();

    expect(store.loadRoutes()).toEqual([]);
    expect(store.loadOrphanedRoutes().map((r) => r.hostname)).toEqual(["orphan.localhost"]);
  });

  it("does not treat a route without a verified group as orphaned", () => {
    writeOrphan({ childStartTime: "Thu Jan  1 00:00:00 1970" });
    expect(store.loadOrphanedRoutes()).toEqual([]);

    writeOrphan({ childPgid: undefined, childStartTime: undefined });
    expect(store.loadOrphanedRoutes()).toEqual([]);
  });

  it("keeps the orphan on file when another route is registered or removed", () => {
    writeOrphan();

    store.addRoute("other.localhost", 4556, process.pid);
    expect(
      raw()
        .map((r) => r.hostname)
        .sort()
    ).toEqual(["orphan.localhost", "other.localhost"]);

    store.updateRoute("other.localhost", { childPgid: 1234 });
    store.removeRoute("other.localhost", process.pid);
    expect(raw().map((r) => r.hostname)).toEqual(["orphan.localhost"]);
  });

  it("drops the orphan when a new owner registers the same slot", () => {
    writeOrphan();

    store.addRoute("orphan.localhost", 4557, process.pid);

    expect(raw()).toHaveLength(1);
    expect(store.loadRoutes()[0]).toMatchObject({ hostname: "orphan.localhost", port: 4557 });
  });

  it("drops a dead-owner route once its group is gone", async () => {
    writeOrphan();
    process.kill(-group!, "SIGKILL");
    // The leader is a child of this process, so the event loop must run to reap it.
    for (let i = 0; i < 100 && store.loadOrphanedRoutes().length > 0; i++) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    store.addRoute("other.localhost", 4556, process.pid);

    expect(raw().map((r) => r.hostname)).toEqual(["other.localhost"]);
  });

  describe("pruneStaleRoutes", () => {
    it("removes orphaned routes by default", () => {
      writeOrphan();

      expect(store.pruneStaleRoutes().map((r) => r.hostname)).toEqual(["orphan.localhost"]);
      expect(raw()).toEqual([]);
    });

    it("keeps orphaned routes when asked, and strips their sharing once", () => {
      writeOrphan({ ngrokPid: 99_999_991, ngrokUrl: "https://x.ngrok.app" });

      const first = store.pruneStaleRoutes({ keepOrphaned: true });
      expect(first.map((r) => r.ngrokPid)).toEqual([99_999_991]);
      expect(raw()).toHaveLength(1);
      expect(raw()[0].ngrokPid).toBeUndefined();
      expect(store.loadOrphanedRoutes()).toHaveLength(1);

      expect(store.pruneStaleRoutes({ keepOrphaned: true })).toEqual([]);
      expect(raw()).toHaveLength(1);
    });

    it("still removes dead-owner routes without a live group when keeping orphans", () => {
      writeOrphan({ childStartTime: "Thu Jan  1 00:00:00 1970" });

      expect(store.pruneStaleRoutes({ keepOrphaned: true })).toHaveLength(1);
      expect(raw()).toEqual([]);
    });
  });
});

describe("isRouteOwnerAlive", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function mockKill(code: string | undefined) {
    return vi.spyOn(process, "kill").mockImplementation(() => {
      if (code === undefined) return true;
      throw Object.assign(new Error(code), { code });
    });
  }

  it("treats pid 0 as a live reserved route without signaling anything", () => {
    const kill = mockKill("ESRCH");
    expect(isRouteOwnerAlive({ pid: 0 })).toBe(true);
    expect(kill).not.toHaveBeenCalled();
  });

  it("is true for a live owner and false for a dead one", () => {
    mockKill(undefined);
    expect(isRouteOwnerAlive({ pid: 4242 })).toBe(true);
    vi.restoreAllMocks();
    mockKill("ESRCH");
    expect(isRouteOwnerAlive({ pid: 4242 })).toBe(false);
  });

  it("keeps a route owned by another user's process (EPERM) live", () => {
    mockKill("EPERM");
    expect(isRouteOwnerAlive({ pid: 4242 })).toBe(true);
    expect(hasDeadRouteOwner([{ pid: 4242 }, { pid: 0 }])).toBe(false);
  });

  it("only sends signal 0, so the check never kills", () => {
    const kill = mockKill(undefined);
    hasDeadRouteOwner([{ pid: 11 }, { pid: 12 }]);
    expect(kill.mock.calls.every((call) => call[1] === 0)).toBe(true);
  });

  it("reports a dead owner among live ones", () => {
    vi.spyOn(process, "kill").mockImplementation((pid) => {
      if (pid === 13) throw Object.assign(new Error("ESRCH"), { code: "ESRCH" });
      return true;
    });
    expect(hasDeadRouteOwner([{ pid: 11 }, { pid: 13 }])).toBe(true);
    expect(hasDeadRouteOwner([{ pid: 11 }, { pid: 12 }])).toBe(false);
    expect(hasDeadRouteOwner([])).toBe(false);
  });
});
