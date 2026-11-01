import { afterEach, describe, expect, it } from "vitest";
import { execSync, spawn, spawnSync, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as http from "node:http";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI_PATH = path.resolve(__dirname, "../../../packages/portless/dist/cli.js");
const LAUNCHER_PATH = path.resolve(__dirname, "../fixtures/self-daemon/launcher.sh");
const DETACHED_LAUNCHER_PATH = path.resolve(
  __dirname,
  "../fixtures/self-daemon/detached-launcher.mjs"
);
// Port allocation: 19121 (see harness.ts for the others).
const PROXY_PORT = 19121;

type StoredRoute = {
  hostname: string;
  port: number;
  pid: number;
  pathPrefix?: string;
  childPgid?: number;
  childStartTime?: string;
  ngrokUrl?: string;
  tailscaleUrl?: string;
};

let stateDir: string | undefined;
let cliChild: ChildProcess | undefined;
const appPorts: number[] = [];

function findPidsOnPort(port: number): number[] {
  try {
    const output = execSync(`lsof -ti tcp:${port} -sTCP:LISTEN`, {
      encoding: "utf8",
      timeout: 5000,
    }).trim();
    return output
      ? output
          .split("\n")
          .map((value) => Number(value))
          .filter((pid) => Number.isInteger(pid) && pid > 0)
      : [];
  } catch {
    return [];
  }
}

function killPort(port: number): void {
  for (const pid of findPidsOnPort(port)) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // The process may have exited between lookup and cleanup.
    }
  }
}

async function waitFor<T>(check: () => T | Promise<T>, timeoutMs = 15_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await check();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Timed out waiting for condition");
}

async function requestThroughProxy(hostname: string, requestPath = "/"): Promise<number> {
  return new Promise((resolve, reject) => {
    const request = http.request(
      `http://127.0.0.1:${PROXY_PORT}${requestPath}`,
      { headers: { Host: hostname }, timeout: 1000 },
      (response) => {
        response.resume();
        resolve(response.statusCode ?? 0);
      }
    );
    request.once("error", reject);
    request.once("timeout", () => request.destroy(new Error("request timeout")));
    request.end();
  });
}

/** The proxy reloads routes.json on a debounce, so poll until it serves the route. */
async function waitForRoute(hostname: string, requestPath = "/"): Promise<number> {
  return waitFor(async () => {
    const status = await requestThroughProxy(hostname, requestPath).catch(() => 0);
    return status === 200 ? status : 0;
  });
}

function readRoutes(): StoredRoute[] {
  return JSON.parse(fs.readFileSync(path.join(stateDir!, "routes.json"), "utf8"));
}

async function waitForExit(child: ChildProcess): Promise<number | null> {
  if (child.exitCode !== null) return child.exitCode;
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve(code));
  });
}

afterEach(async () => {
  if (cliChild && cliChild.exitCode === null && cliChild.signalCode === null) {
    cliChild.kill("SIGTERM");
    await waitForExit(cliChild).catch(() => undefined);
  }
  for (const port of appPorts) {
    killPort(port);
    await waitFor(() => findPidsOnPort(port).length === 0, 5000).catch(() => undefined);
  }
  if (stateDir) {
    // Isolated state directory and an explicit non-default port: this can only
    // reach the proxy this test started.
    spawnSync(process.execPath, [CLI_PATH, "proxy", "stop", "--port", String(PROXY_PORT)], {
      env: {
        ...process.env,
        PORTLESS_PORT: String(PROXY_PORT),
        PORTLESS_STATE_DIR: stateDir,
        NO_COLOR: "1",
      },
      timeout: 10_000,
    });
    killPort(PROXY_PORT);
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
  stateDir = undefined;
  cliChild = undefined;
  appPorts.length = 0;
});

function startProxy(): NodeJS.ProcessEnv {
  stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "portless-self-daemon-"));
  const env = {
    ...process.env,
    PORTLESS_PORT: String(PROXY_PORT),
    PORTLESS_HTTPS: "0",
    PORTLESS_STATE_DIR: stateDir,
    PORTLESS_SYNC_HOSTS: "0",
    NO_COLOR: "1",
  };
  const proxy = spawnSync(
    process.execPath,
    [CLI_PATH, "proxy", "start", "--no-tls", "-p", String(PROXY_PORT)],
    { env, encoding: "utf8", timeout: 15_000 }
  );
  expect(proxy.status, proxy.stderr + proxy.stdout).toBe(0);
  return env;
}

function runCli(env: NodeJS.ProcessEnv, args: string[]): ChildProcess {
  cliChild = spawn(process.execPath, [CLI_PATH, ...args], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return cliChild;
}

describe.skipIf(process.platform === "win32")("self-daemonizing command lifecycle", () => {
  it("keeps serving the route after the launcher exits, until the server stops", async () => {
    const env = startProxy();

    const child = runCli(env, ["self-daemon", LAUNCHER_PATH]);
    expect(await waitForExit(child)).toBe(0);

    const route = readRoutes().find((entry) => entry.hostname === "self-daemon.localhost");
    expect(route).toBeDefined();
    appPorts.push(route!.port);
    expect(findPidsOnPort(route!.port)).toEqual([route!.pid]);
    expect(await waitForRoute(route!.hostname)).toBe(200);

    // The launcher's process group record cannot be verified any more, so the
    // transferred route carries none and is never taken for an orphan.
    expect(route!.childPgid).toBeUndefined();
    expect(route!.childStartTime).toBeUndefined();
    const list = spawnSync(process.execPath, [CLI_PATH, "list", "--json"], {
      env,
      encoding: "utf8",
    });
    const listed = (JSON.parse(list.stdout) as Array<{ hostname: string; kind?: string }>).find(
      (entry) => entry.hostname === "self-daemon.localhost"
    );
    expect(listed).toBeDefined();
    expect(listed!.kind).not.toBe("orphan");

    // Let the proxy settle on the transferred route, as it would for a daemon
    // that runs for a while.
    await new Promise((resolve) => setTimeout(resolve, 1000));
    process.kill(route!.pid, "SIGTERM");
    await waitFor(() => findPidsOnPort(route!.port).length === 0);
    // An unrelated server on the same port must not answer for the old hostname.
    const unrelated = http.createServer((_, response) => response.end("unrelated"));
    await new Promise<void>((resolve) => unrelated.listen(route!.port, "127.0.0.1", resolve));
    try {
      await waitFor(
        async () => (await requestThroughProxy(route!.hostname).catch(() => 0)) !== 200
      );
    } finally {
      await new Promise((resolve) => unrelated.close(resolve));
    }
    const after = spawnSync(process.execPath, [CLI_PATH, "list"], { env, encoding: "utf8" });
    expect(after.stdout).not.toContain("self-daemon.localhost");
  });

  it("keeps the route for a detached daemon that binds after the launcher exits", async () => {
    const env = startProxy();

    const child = runCli(env, ["detached", process.execPath, DETACHED_LAUNCHER_PATH]);
    expect(await waitForExit(child)).toBe(0);

    const route = readRoutes().find((entry) => entry.hostname === "detached.localhost");
    expect(route).toBeDefined();
    appPorts.push(route!.port);
    expect(await waitForRoute(route!.hostname)).toBe(200);
  });

  it("keeps the transferred route under its path prefix", async () => {
    const env = startProxy();

    const child = runCli(env, ["prefixed", "--path", "/api", "sh", LAUNCHER_PATH]);
    expect(await waitForExit(child)).toBe(0);

    const route = readRoutes().find((entry) => entry.hostname === "prefixed.localhost");
    expect(route).toBeDefined();
    expect(route!.pathPrefix).toBe("/api");
    appPorts.push(route!.port);
    expect(await waitForRoute(route!.hostname, "/api/")).toBe(200);
  });

  it("removes the route when a foreground command exits", async () => {
    const env = startProxy();

    const child = runCli(env, ["foreground", "true"]);
    expect(await waitForExit(child)).toBe(0);
    expect(readRoutes()).toHaveLength(0);
  });

  it("leaves routes of background-managed runs to the bg supervisor", async () => {
    const env = startProxy();
    const readyPath = path.join(stateDir!, "bg-ready.json");

    const child = runCli({ ...env, PORTLESS_BG_ID: "e2e-bg", PORTLESS_BG_READY_PATH: readyPath }, [
      "bgmanaged",
      process.execPath,
      DETACHED_LAUNCHER_PATH,
    ]);
    expect(await waitForExit(child)).toBe(0);
    expect(fs.existsSync(readyPath)).toBe(true);
    // The daemon the launcher left behind is not routed: `portless bg` owns the
    // entry and cleans up the exact route its run registered.
    expect(readRoutes()).toHaveLength(0);
    // The detached daemon binds late; find and reap it by its assigned port.
    const ready = JSON.parse(fs.readFileSync(readyPath, "utf8")) as { appPort: number };
    appPorts.push(ready.appPort);
    // Wait for it to bind, so the cleanup can reap it by port.
    await waitFor(() => findPidsOnPort(ready.appPort).length > 0);
  });

  it("does not hand the route to a server that held the port before the command ran", async () => {
    const env = startProxy();
    const foreign = http.createServer((_, response) => response.end("foreign"));
    await new Promise<void>((resolve) => foreign.listen(0, "127.0.0.1", resolve));
    const foreignPort = (foreign.address() as { port: number }).port;
    try {
      const child = runCli(env, [
        "occupied",
        "--app-port",
        String(foreignPort),
        "sh",
        "-c",
        "exit 1",
      ]);
      expect(await waitForExit(child)).toBe(1);
      expect(readRoutes()).toHaveLength(0);
    } finally {
      await new Promise((resolve) => foreign.close(resolve));
    }
  });
});
