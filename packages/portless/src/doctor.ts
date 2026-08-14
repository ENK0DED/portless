import * as fs from "node:fs";
import * as http from "node:http";
import * as https from "node:https";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { BgStore, type BgProcessEntry } from "./bg-store.js";
import {
  discoverState,
  findPidOnPort,
  getDefaultPort,
  getProxyBindTargets,
  isHttpsEnvDisabled,
  isPortListening,
  isProxyRunning,
  LEGACY_SYSTEM_STATE_DIR,
  readCustomCertMarker,
  readInternalPagesDisabledMarker,
  resolveStateDir,
  resolveWindowsCommandInvocation,
  validateTld,
} from "./cli-utils.js";
import { isCATrusted } from "./certs.js";
import { checkHostResolution, getManagedHostnames } from "./hosts.js";
import { isMdnsSupported } from "./mdns.js";
import { ensureNetbirdReady } from "./netbird.js";
import { RouteStore, type RouteMapping } from "./routes.js";
import { ensureTailscaleReady } from "./tailscale.js";
import type { TunnelProviderName } from "./types.js";
import { resolveUserHome } from "./utils.js";

export type DoctorStatus = "ok" | "warn" | "fail" | "info";

export interface DoctorFinding {
  status: DoctorStatus;
  message: string;
  hint?: string;
}

export interface DoctorToolStatus {
  status: "ready" | "available" | "unavailable" | "error";
  detail?: string;
}

export interface DoctorRouteSnapshot {
  hostname: string;
  port: number;
  pid: number;
  pidAlive: boolean;
  portListening: boolean;
  resolves: boolean;
  managedHost: boolean;
  tunnelProvider?: TunnelProviderName;
  tailscale?: boolean;
  netbird?: boolean;
}

export interface DoctorBackgroundSnapshot {
  label: string;
  pid: number;
  pidAlive: boolean;
  state: "starting" | "ready" | "stopped" | "unknown";
  routePresent: boolean;
  sharing: Array<"cloudflare" | "ngrok" | "tailscale" | "netbird">;
}

export interface DoctorSnapshot {
  version: string;
  nodeVersion: string;
  platform: NodeJS.Platform;
  arch: string;
  state: {
    path: string;
    source: "default" | "environment" | "sudo-user" | "sudo-environment" | "legacy";
    status: "writable" | "missing-writable-parent" | "unwritable" | "not-directory" | "unreadable";
    sudoUser?: string;
    expectedPath?: string;
    handoffValid?: boolean;
  };
  proxy: {
    port: number;
    tls: boolean;
    running: boolean;
    portListening: boolean;
    pid?: number;
    pidAlive?: boolean;
    portPid?: number | null;
    lanMode: boolean;
    lanIp: string | null;
    configuredBindTargets: string[];
  };
  suffixes: {
    configured: string[];
    invalidPersisted: string[];
    persistedError?: string;
  };
  certificates: {
    custom: boolean;
    internalPages: boolean;
    ca: boolean;
    caKey: boolean;
    serverCert: boolean;
    serverKey: boolean;
    trusted: boolean | null;
    certPages: Record<string, boolean>;
  };
  routes: DoctorRouteSnapshot[];
  background: DoctorBackgroundSnapshot[];
  mdns: {
    available: boolean;
    reason?: string;
  };
  tools: {
    openssl: DoctorToolStatus;
    cloudflared: DoctorToolStatus;
    ngrok: DoctorToolStatus;
    tailscale: DoctorToolStatus;
    netbird: DoctorToolStatus;
  };
  warnings: string[];
}

export interface DoctorReport {
  snapshot: DoctorSnapshot;
  findings: DoctorFinding[];
  exitCode: 0 | 1;
}

type DiscoveredState = Awaited<ReturnType<typeof discoverState>>;
type DoctorToolName = "openssl" | "cloudflared" | "ngrok" | "tailscale" | "netbird";

export interface DoctorCommandResult {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: Error;
}

export type DoctorCommandRunner = (command: DoctorToolName, args: string[]) => DoctorCommandResult;

export interface DoctorToolProbeOptions {
  runner?: DoctorCommandRunner;
  platform?: NodeJS.Platform;
  pathValue?: string;
}

export interface DoctorDependencies {
  discoverState: () => Promise<DiscoveredState>;
  isProxyRunning: (port: number, tls?: boolean) => Promise<boolean>;
  isPortListening: (port: number) => Promise<boolean>;
  findPidOnPort: (port: number) => number | null;
  isProcessAlive: (pid: number) => boolean;
  managedHostnames: () => string[];
  resolvesHostname: (hostname: string) => Promise<boolean>;
  isCATrusted: (stateDir: string) => boolean;
  certPageResponds: (port: number, tls: boolean, suffix: string) => Promise<boolean>;
  mdnsSupport: () => { supported: boolean; reason?: string };
  probeTool: (name: DoctorToolName, required: boolean) => DoctorToolStatus;
}

export interface CollectDoctorOptions {
  version: string;
  state?: DiscoveredState;
  dependencies?: Partial<DoctorDependencies>;
}

function processIsAlive(pid: number): boolean {
  if (pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

export function resolveDoctorCommandInvocation(
  command: DoctorToolName,
  args: string[],
  platform: NodeJS.Platform = process.platform,
  pathValue = process.env.PATH ?? process.env.Path ?? ""
) {
  if (platform === "win32") {
    const invocation = resolveWindowsCommandInvocation(command, args, pathValue);
    if (invocation) return invocation;
  }
  return { command, args };
}

function defaultDoctorCommandRunner(
  command: DoctorToolName,
  args: string[],
  options: DoctorToolProbeOptions = {}
): DoctorCommandResult {
  const invocation = resolveDoctorCommandInvocation(
    command,
    args,
    options.platform,
    options.pathValue
  );
  const result = spawnSync(invocation.command, invocation.args, {
    encoding: "utf-8",
    killSignal: "SIGKILL",
    timeout: 10_000,
    windowsHide: true,
    ...(invocation.windowsVerbatimArguments
      ? { windowsVerbatimArguments: invocation.windowsVerbatimArguments }
      : {}),
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    ...(result.error ? { error: result.error } : {}),
  };
}

function toolProbeError(name: DoctorToolName, error: unknown): DoctorToolStatus {
  const detail = error instanceof Error ? error.message : String(error);
  const errno = error as NodeJS.ErrnoException;
  if (errno.code === "ENOENT" || /(?:not found|could not be found)/i.test(detail)) {
    return { status: "unavailable", detail };
  }
  return { status: "error", detail: detail || `Failed to inspect ${name}.` };
}

export function probeDoctorTool(
  name: DoctorToolName,
  required: boolean,
  options: DoctorToolProbeOptions = {}
): DoctorToolStatus {
  const runner =
    options.runner ??
    ((command: DoctorToolName, args: string[]) =>
      defaultDoctorCommandRunner(command, args, options));
  try {
    if (required && name === "tailscale") {
      ensureTailscaleReady({ runner: (args) => runner(name, args) });
      return { status: "ready" };
    }
    if (required && name === "netbird") {
      ensureNetbirdReady((args) => runner(name, args));
      return { status: "ready" };
    }
  } catch (error) {
    return toolProbeError(name, error);
  }

  const result = runner(name, ["version"]);
  if (result.error) return toolProbeError(name, result.error);
  if (result.status === 0) return { status: "available" };
  const detail = (result.stderr || result.stdout || "").trim().replace(/\s+/g, " ");
  return { status: "error", ...(detail ? { detail } : {}) };
}

export function requestCertPage(port: number, tls: boolean, suffix: string): Promise<boolean> {
  return new Promise((resolve) => {
    const transport = tls ? https : http;
    const request = transport.request(
      {
        host: "127.0.0.1",
        port,
        path: "/",
        method: "GET",
        headers: { host: `cert.${suffix}` },
        timeout: 1000,
        ...(tls ? { rejectUnauthorized: false, servername: "" } : {}),
      },
      (response) => {
        response.resume();
        resolve(response.statusCode === 200);
      }
    );
    request.on("error", () => resolve(false));
    request.on("timeout", () => {
      request.destroy();
      resolve(false);
    });
    request.end();
  });
}

const DEFAULT_DEPENDENCIES: DoctorDependencies = {
  discoverState,
  isProxyRunning,
  isPortListening,
  findPidOnPort,
  isProcessAlive: processIsAlive,
  managedHostnames: getManagedHostnames,
  resolvesHostname: checkHostResolution,
  isCATrusted,
  certPageResponds: requestCertPage,
  mdnsSupport: isMdnsSupported,
  probeTool: probeDoctorTool,
};

export function modeAllowsIdentityAccess(
  stat: Pick<fs.Stats, "uid" | "gid" | "mode">,
  uid: number,
  gid: number,
  required: number
): boolean {
  const shift = stat.uid === uid ? 6 : stat.gid === gid ? 3 : 0;
  const permissions = (stat.mode >> shift) & 0b111;
  return (permissions & required) === required;
}

function invokingUserCanAccess(stat: fs.Stats, access: "state" | "parent"): boolean | null {
  if (process.platform === "win32" || process.getuid?.() !== 0 || !process.env.SUDO_UID) {
    return null;
  }
  const uid = Number.parseInt(process.env.SUDO_UID, 10);
  const gid = Number.parseInt(process.env.SUDO_GID ?? process.env.SUDO_UID, 10);
  if (!Number.isInteger(uid) || !Number.isInteger(gid)) return null;
  const required = access === "state" ? 0b111 : 0b011;
  return modeAllowsIdentityAccess(stat, uid, gid, required);
}

function inspectStatePath(statePath: string): DoctorSnapshot["state"]["status"] {
  try {
    if (fs.existsSync(statePath)) {
      const stat = fs.statSync(statePath);
      if (!stat.isDirectory()) return "not-directory";
      if (invokingUserCanAccess(stat, "state") === false) return "unwritable";
      try {
        fs.accessSync(statePath, fs.constants.R_OK | fs.constants.W_OK | fs.constants.X_OK);
        return "writable";
      } catch {
        return "unwritable";
      }
    }

    let ancestor = path.dirname(statePath);
    while (!fs.existsSync(ancestor)) {
      const parent = path.dirname(ancestor);
      if (parent === ancestor) return "unreadable";
      ancestor = parent;
    }
    const ancestorStat = fs.statSync(ancestor);
    if (!ancestorStat.isDirectory()) return "unreadable";
    if (invokingUserCanAccess(ancestorStat, "parent") === false) return "unwritable";
    fs.accessSync(ancestor, fs.constants.W_OK);
    return "missing-writable-parent";
  } catch {
    return "unreadable";
  }
}

function stateSource(
  stateDir: string
): Pick<DoctorSnapshot["state"], "source" | "sudoUser" | "expectedPath" | "handoffValid"> {
  const sudoUser = process.env.SUDO_USER;
  if (sudoUser && sudoUser !== "root" && process.env.PORTLESS_STATE_DIR) {
    const expectedPath = process.env.PORTLESS_STATE_DIR;
    return {
      source: "sudo-environment",
      sudoUser,
      expectedPath,
      handoffValid: path.resolve(stateDir) === path.resolve(expectedPath),
    };
  }
  if (process.env.PORTLESS_STATE_DIR) return { source: "environment" };
  if (stateDir === LEGACY_SYSTEM_STATE_DIR) return { source: "legacy" };
  if (sudoUser && sudoUser !== "root") {
    const expectedPath = path.join(resolveUserHome(), ".portless");
    return {
      source: "sudo-user",
      sudoUser,
      expectedPath,
      handoffValid: path.resolve(stateDir) === path.resolve(expectedPath),
    };
  }
  return { source: "default" };
}

function readPidFile(stateDir: string, warnings: string[]): number | undefined {
  const pidPath = path.join(stateDir, "proxy.pid");
  try {
    const pid = Number.parseInt(fs.readFileSync(pidPath, "utf-8").trim(), 10);
    if (Number.isInteger(pid) && pid > 0) return pid;
    warnings.push(`Proxy PID file is invalid: ${pidPath}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      warnings.push(`Could not read proxy PID file: ${(error as Error).message}`);
    }
  }
  return undefined;
}

function persistedSuffixDiagnostics(
  stateDir: string,
  effectiveSuffixes: readonly string[]
): DoctorSnapshot["suffixes"] {
  const invalidPersisted: string[] = [];
  let persistedError: string | undefined;
  try {
    const raw = fs.readFileSync(path.join(stateDir, "proxy.tlds"), "utf-8").trim();
    const parsed: unknown = raw.startsWith("[")
      ? JSON.parse(raw)
      : raw.split(/[,\r\n]/).map((value) => value.trim());
    if (Array.isArray(parsed)) {
      for (const value of parsed) {
        if (typeof value !== "string") {
          persistedError = "proxy.tlds contains a non-string suffix entry.";
          continue;
        }
        const suffix = value.trim().toLowerCase();
        if (validateTld(suffix)) invalidPersisted.push(value);
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      persistedError =
        error instanceof SyntaxError
          ? "proxy.tlds contains malformed JSON."
          : `Could not read proxy.tlds: ${(error as Error).message}`;
    }
  }
  return {
    configured: [...effectiveSuffixes],
    invalidPersisted,
    ...(persistedError ? { persistedError } : {}),
  };
}

function routeHasTailscale(route: RouteMapping): boolean {
  return !!(
    route.tailscaleUrl ||
    route.tailscaleHttpsPort ||
    route.tailscaleFunnel ||
    route.tailscaleServiceName ||
    route.tailscaleServiceUrl
  );
}

function routeHasNetbird(route: RouteMapping): boolean {
  return !!(route.netbirdUrl || route.netbirdPid);
}

function isExactLocalHostname(hostname: string): boolean {
  return hostname === "local" || hostname.endsWith(".local");
}

function backgroundSharing(entry: BgProcessEntry): DoctorBackgroundSnapshot["sharing"] {
  const sharing: DoctorBackgroundSnapshot["sharing"] = [];
  if (entry.intent.tunnel?.provider === "cloudflare") sharing.push("cloudflare");
  if (entry.intent.tunnel?.provider === "ngrok" || entry.intent.sharing.ngrok) {
    sharing.push("ngrok");
  }
  if (
    entry.intent.sharing.tailscale ||
    entry.intent.sharing.tailscaleService ||
    entry.intent.sharing.funnel
  ) {
    sharing.push("tailscale");
  }
  if (entry.intent.sharing.netbird) sharing.push("netbird");
  return sharing;
}

function requiredSharingTools(
  routes: readonly DoctorRouteSnapshot[],
  background: readonly DoctorBackgroundSnapshot[]
) {
  const sharing = new Set(background.flatMap((entry) => entry.sharing));
  return {
    cloudflared:
      sharing.has("cloudflare") || routes.some((route) => route.tunnelProvider === "cloudflare"),
    ngrok: sharing.has("ngrok") || routes.some((route) => route.tunnelProvider === "ngrok"),
    tailscale: sharing.has("tailscale") || routes.some((route) => route.tailscale),
    netbird: sharing.has("netbird") || routes.some((route) => route.netbird),
  };
}

export async function collectDoctorSnapshot(
  options: CollectDoctorOptions
): Promise<DoctorSnapshot> {
  const dependencies = { ...DEFAULT_DEPENDENCIES, ...options.dependencies };
  const warnings: string[] = [];
  let state: DiscoveredState;
  try {
    state = options.state ?? (await dependencies.discoverState());
  } catch (error) {
    warnings.push(`Could not discover portless state: ${(error as Error).message}`);
    const dir = resolveStateDir();
    state = {
      dir,
      port: 443,
      tls: false,
      tld: "localhost",
      tlds: ["localhost"],
      lanMode: false,
      lanIp: null,
    };
  }

  const hasPortFile = fs.existsSync(path.join(state.dir, "proxy.port"));
  const stateProxyRunning = await dependencies.isProxyRunning(state.port, state.tls);
  const proxyTls = stateProxyRunning || hasPortFile ? state.tls : !isHttpsEnvDisabled();
  const proxyPort = stateProxyRunning || hasPortFile ? state.port : getDefaultPort(proxyTls);

  const routeStore = new RouteStore(state.dir, { onWarning: (warning) => warnings.push(warning) });
  const bgStore = new BgStore(state.dir, { onWarning: (warning) => warnings.push(warning) });
  const rawRoutes = routeStore.loadRoutesRaw();
  const bgEntries = bgStore.loadEntries();
  const proxyRunning =
    stateProxyRunning && proxyPort === state.port
      ? true
      : await dependencies.isProxyRunning(proxyPort, proxyTls);
  const portListening = proxyRunning || (await dependencies.isPortListening(proxyPort));
  const pid = readPidFile(state.dir, warnings);
  const managedHostnames = new Set(dependencies.managedHostnames());

  const routes = await Promise.all(
    rawRoutes.map(
      async (route): Promise<DoctorRouteSnapshot> => ({
        hostname: route.hostname,
        port: route.port,
        pid: route.pid,
        pidAlive: route.pid === 0 || dependencies.isProcessAlive(route.pid),
        portListening:
          Number.isInteger(route.port) && route.port > 0 && route.port <= 65535
            ? await dependencies.isPortListening(route.port)
            : false,
        resolves:
          state.lanMode && isExactLocalHostname(route.hostname)
            ? true
            : await dependencies.resolvesHostname(route.hostname),
        managedHost: managedHostnames.has(route.hostname),
        ...(route.tunnelProvider
          ? { tunnelProvider: route.tunnelProvider }
          : route.ngrokUrl || route.ngrokPid
            ? { tunnelProvider: "ngrok" as const }
            : {}),
        ...(routeHasTailscale(route) ? { tailscale: true } : {}),
        ...(routeHasNetbird(route) ? { netbird: true } : {}),
      })
    )
  );

  const background = bgEntries.map((entry): DoctorBackgroundSnapshot => {
    const routePresent =
      !!entry.route &&
      rawRoutes.some(
        (route) =>
          route.hostname === entry.route?.hostname &&
          (route.pathPrefix ?? "/") === entry.route.pathPrefix &&
          route.pid === entry.pid
      );
    return {
      label: entry.label,
      pid: entry.pid,
      pidAlive: dependencies.isProcessAlive(entry.pid),
      state: entry.state,
      routePresent,
      sharing: backgroundSharing(entry),
    };
  });

  const customCert = readCustomCertMarker(state.dir);
  const internalPages = !readInternalPagesDisabledMarker(state.dir);
  const ca = fs.existsSync(path.join(state.dir, "ca.pem"));
  const certPages: Record<string, boolean> = {};
  for (const suffix of state.tlds) {
    certPages[suffix] =
      proxyRunning && proxyTls && internalPages
        ? await dependencies.certPageResponds(proxyPort, proxyTls, suffix)
        : false;
  }

  const requiredTools = requiredSharingTools(routes, background);

  const mdns = dependencies.mdnsSupport();
  return {
    version: options.version,
    nodeVersion: process.versions.node,
    platform: process.platform,
    arch: process.arch,
    state: {
      path: state.dir,
      ...stateSource(state.dir),
      status: inspectStatePath(state.dir),
    },
    proxy: {
      port: proxyPort,
      tls: proxyTls,
      running: proxyRunning,
      portListening,
      ...(pid !== undefined ? { pid, pidAlive: dependencies.isProcessAlive(pid) } : {}),
      portPid: portListening ? dependencies.findPidOnPort(proxyPort) : null,
      lanMode: state.lanMode,
      lanIp: state.lanIp,
      configuredBindTargets: getProxyBindTargets(state.lanMode).map((target) => target.host),
    },
    suffixes: persistedSuffixDiagnostics(state.dir, state.tlds),
    certificates: {
      custom: customCert,
      internalPages,
      ca,
      caKey: fs.existsSync(path.join(state.dir, "ca-key.pem")),
      serverCert: fs.existsSync(path.join(state.dir, "server.pem")),
      serverKey: fs.existsSync(path.join(state.dir, "server-key.pem")),
      trusted: ca ? dependencies.isCATrusted(state.dir) : null,
      certPages,
    },
    routes,
    background,
    mdns: { available: mdns.supported, ...(mdns.reason ? { reason: mdns.reason } : {}) },
    tools: {
      openssl: dependencies.probeTool("openssl", proxyTls && !customCert),
      cloudflared: dependencies.probeTool("cloudflared", requiredTools.cloudflared),
      ngrok: dependencies.probeTool("ngrok", requiredTools.ngrok),
      tailscale: dependencies.probeTool("tailscale", requiredTools.tailscale),
      netbird: dependencies.probeTool("netbird", requiredTools.netbird),
    },
    warnings,
  };
}

function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function formatSuffixes(suffixes: readonly string[]): string {
  return suffixes.map((suffix) => `.${suffix}`).join(", ");
}

function matchesConfiguredSuffix(hostname: string, suffixes: readonly string[]): boolean {
  return suffixes.some((suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`));
}

function hasExactBindTargets(actual: readonly string[], expected: readonly string[]): boolean {
  return actual.length === expected.length && expected.every((target) => actual.includes(target));
}

function addToolFinding(
  findings: DoctorFinding[],
  label: string,
  tool: DoctorToolStatus,
  required: boolean
): void {
  if (!required) {
    if (tool.status === "ready" || tool.status === "available") {
      findings.push({ status: "info", message: `${label} is available.` });
    } else if (tool.status === "unavailable") {
      findings.push({
        status: "info",
        message: `${label} is not installed; no persisted feature requires it.`,
      });
    } else {
      findings.push({
        status: "info",
        message: `${label} could not be checked; no persisted feature requires it.`,
        ...(tool.detail ? { hint: tool.detail } : {}),
      });
    }
    return;
  }

  if (tool.status === "ready") {
    findings.push({ status: "ok", message: `${label} is available and ready.` });
  } else if (tool.status === "available") {
    findings.push({ status: "ok", message: `${label} is available.` });
  } else {
    findings.push({
      status: "warn",
      message: `${label} is not available.`,
      ...(tool.detail ? { hint: tool.detail } : {}),
    });
  }
}

export function evaluateDoctor(snapshot: DoctorSnapshot): DoctorReport {
  const findings: DoctorFinding[] = [];
  const add = (status: DoctorStatus, message: string, hint?: string) => {
    findings.push({ status, message, ...(hint ? { hint } : {}) });
  };

  const nodeMajor = Number.parseInt(snapshot.nodeVersion.split(".")[0] ?? "", 10);
  if (Number.isInteger(nodeMajor) && nodeMajor >= 24) {
    add("ok", `Node.js ${snapshot.nodeVersion} satisfies portless requirements.`);
  } else {
    add("fail", `Node.js ${snapshot.nodeVersion} is unsupported.`, "Install Node.js 24 or newer.");
  }

  if (snapshot.state.source === "environment") {
    add("info", `State directory comes from PORTLESS_STATE_DIR: ${snapshot.state.path}.`);
  } else if (snapshot.state.source === "sudo-user") {
    if (snapshot.state.handoffValid) {
      add(
        "ok",
        `Sudo state handoff resolves ${snapshot.state.sudoUser ?? "the invoking user"} to ${snapshot.state.path}.`
      );
    } else {
      add(
        "fail",
        `Sudo state handoff resolved to ${snapshot.state.path} instead of ${snapshot.state.expectedPath ?? "the invoking user's state directory"}.`
      );
    }
  } else if (snapshot.state.source === "sudo-environment") {
    if (snapshot.state.handoffValid) {
      add("ok", `Sudo preserved PORTLESS_STATE_DIR for outbound handoff: ${snapshot.state.path}.`);
    } else {
      add(
        "fail",
        `Sudo PORTLESS_STATE_DIR handoff resolved to ${snapshot.state.path} instead of ${snapshot.state.expectedPath ?? "the requested state directory"}.`
      );
    }
  } else if (snapshot.state.source === "legacy") {
    add("warn", `Using legacy proxy state: ${snapshot.state.path}.`);
  } else {
    add("info", `State directory uses the invoking user's default: ${snapshot.state.path}.`);
  }

  if (snapshot.state.status === "writable") {
    add("ok", `State directory is writable: ${snapshot.state.path}.`);
  } else if (snapshot.state.status === "missing-writable-parent") {
    add("info", `State directory has not been created yet: ${snapshot.state.path}.`);
  } else if (snapshot.state.status === "not-directory") {
    add("fail", `State path exists but is not a directory: ${snapshot.state.path}.`);
  } else if (snapshot.state.status === "unwritable") {
    add("fail", `State directory is not writable: ${snapshot.state.path}.`);
  } else {
    add("fail", `State directory could not be inspected: ${snapshot.state.path}.`);
  }

  if (snapshot.suffixes.configured.length === 0) {
    add("fail", "No valid suffixes are configured.");
  } else {
    add("ok", `Configured suffixes: ${formatSuffixes(snapshot.suffixes.configured)}.`);
  }
  for (const suffix of snapshot.suffixes.invalidPersisted) {
    add("warn", `Ignored invalid persisted suffix "${suffix}".`);
  }
  if (snapshot.suffixes.persistedError) add("warn", snapshot.suffixes.persistedError);

  if (snapshot.proxy.lanMode) {
    if (hasExactBindTargets(snapshot.proxy.configuredBindTargets, ["0.0.0.0", "::"])) {
      add("ok", "Configured LAN mode widens the proxy bind to 0.0.0.0 and ::.");
    } else {
      add(
        "fail",
        `LAN mode has unexpected configured bind targets: ${snapshot.proxy.configuredBindTargets.join(", ") || "none"}.`
      );
    }
    if (!snapshot.suffixes.configured.includes("local")) {
      add("warn", "LAN mode is active, but the persisted suffix list does not include .local.");
    }
    if (snapshot.proxy.lanIp) {
      add("ok", `LAN IP is recorded: ${snapshot.proxy.lanIp}.`);
    } else {
      add("warn", "LAN mode is active, but no LAN IP is recorded.");
    }
    if (snapshot.mdns.available) {
      add("ok", "mDNS tooling is available for exact .local publication.");
    } else {
      add(
        "fail",
        `mDNS tooling is unavailable${snapshot.mdns.reason ? `: ${snapshot.mdns.reason}` : "."}`
      );
    }
  } else if (hasExactBindTargets(snapshot.proxy.configuredBindTargets, ["127.0.0.1", "::1"])) {
    add("ok", "Configured local mode binds only to 127.0.0.1 and ::1.");
  } else {
    add(
      "fail",
      `Local mode has unexpected configured bind targets: ${snapshot.proxy.configuredBindTargets.join(", ") || "none"}.`
    );
  }

  if (snapshot.proxy.running) {
    add("ok", `Proxy is responding on port ${snapshot.proxy.port}.`);
  } else if (snapshot.proxy.portListening) {
    add(
      "fail",
      `Port ${snapshot.proxy.port} is in use, but it is not a portless proxy.`,
      snapshot.proxy.portPid ? `Process on port: PID ${snapshot.proxy.portPid}` : undefined
    );
  } else {
    add(
      "warn",
      `Proxy is not running on port ${snapshot.proxy.port}.`,
      "Run: portless proxy start"
    );
  }

  if (snapshot.proxy.pid !== undefined) {
    if (!snapshot.proxy.pidAlive) {
      add("warn", `Proxy PID file is stale: ${snapshot.proxy.pid}.`, "Run: portless proxy stop");
    } else if (snapshot.proxy.running && snapshot.proxy.portPid === snapshot.proxy.pid) {
      add("ok", `Proxy PID ${snapshot.proxy.pid} owns port ${snapshot.proxy.port}.`);
    } else if (snapshot.proxy.running && snapshot.proxy.portPid) {
      add(
        "warn",
        `Proxy PID file names ${snapshot.proxy.pid}, but port ${snapshot.proxy.port} is owned by ${snapshot.proxy.portPid}.`
      );
    }
  } else if (snapshot.proxy.running) {
    add("warn", "Proxy is running, but its PID file is missing.");
  }

  if (snapshot.proxy.tls && !snapshot.certificates.custom) {
    if (
      snapshot.tools.openssl.status === "ready" ||
      snapshot.tools.openssl.status === "available"
    ) {
      add("ok", "OpenSSL is available for generated certificates.");
    } else {
      add("fail", "OpenSSL is not available for generated certificates.");
    }
    if (snapshot.certificates.ca && snapshot.certificates.caKey) {
      add("ok", "Generated CA certificate and private key are present.");
    } else if (snapshot.certificates.ca) {
      add("warn", "Generated CA certificate exists without its private key.");
    } else if (snapshot.proxy.running) {
      add("fail", "HTTPS proxy is running without a generated CA certificate.");
    } else {
      add("info", "Generated CA has not been created yet.");
    }
    if (snapshot.certificates.serverCert !== snapshot.certificates.serverKey) {
      add("warn", "Generated server certificate and private key are incomplete.");
    } else if (snapshot.certificates.serverCert) {
      add("ok", "Generated server certificate and private key are present.");
    }
    if (snapshot.certificates.ca) {
      if (snapshot.certificates.trusted) {
        add("ok", "Generated CA is trusted by the OS trust store.");
      } else {
        add("warn", "Generated CA is not trusted by the OS trust store.", "Run: portless trust");
      }
    }
  } else if (snapshot.proxy.tls) {
    add("ok", "Proxy uses a custom TLS certificate.");
  } else {
    add("info", "HTTPS is disabled, so generated certificates are not required.");
  }

  if (snapshot.proxy.running && snapshot.proxy.tls && !snapshot.certificates.internalPages) {
    add("info", "Internal dashboard and certificate pages are intentionally disabled.");
  } else if (snapshot.proxy.running && snapshot.proxy.tls) {
    const availablePages: string[] = [];
    for (const suffix of snapshot.suffixes.configured) {
      const hostname = `cert.${suffix}`;
      if (snapshot.certificates.certPages[suffix]) {
        availablePages.push(hostname);
      } else {
        add("warn", `Certificate page is not responding: ${hostname}.`);
      }
    }
    if (availablePages.length > 0) {
      add(
        "ok",
        `Certificate pages are available at ${availablePages.join(
          availablePages.length === 2 ? " and " : ", "
        )}.`
      );
    }
  }

  const staleRoutes = snapshot.routes.filter((route) => route.pid !== 0 && !route.pidAlive);
  const liveRoutes = snapshot.routes.filter((route) => route.pid === 0 || route.pidAlive);
  if (snapshot.routes.length === 0) {
    add("info", "No routes are registered.");
  } else if (staleRoutes.length === 0) {
    add("ok", `Routes: ${pluralize(liveRoutes.length, "active route")}.`);
  } else {
    add(
      "warn",
      `Routes: ${pluralize(liveRoutes.length, "active route")}, ${pluralize(staleRoutes.length, "stale route")}.`,
      "Run: portless prune"
    );
  }

  for (const route of snapshot.routes) {
    if (!matchesConfiguredSuffix(route.hostname, snapshot.suffixes.configured)) {
      add("warn", `Route ${route.hostname} does not match any configured suffix.`);
    }
    if ((route.pid === 0 || route.pidAlive) && !route.portListening) {
      add(
        "warn",
        `Route ${route.hostname} points to port ${route.port}, but nothing is listening.`
      );
    }
    const needsHostsResolution = !snapshot.proxy.lanMode || !isExactLocalHostname(route.hostname);
    if (needsHostsResolution && !route.resolves) {
      add(
        "warn",
        `${route.hostname} does not resolve and is ${
          route.managedHost ? "present in" : "missing from"
        } the managed hosts block.`,
        "Run: portless hosts sync"
      );
    }
  }

  const hostsRoutes = snapshot.routes.filter(
    (route) => !snapshot.proxy.lanMode || !isExactLocalHostname(route.hostname)
  );
  if (hostsRoutes.length > 0) {
    const covered = hostsRoutes.filter((route) => route.managedHost).length;
    if (covered === hostsRoutes.length) {
      add("ok", `Hosts sync covers ${pluralize(covered, "registered hostname")}.`);
    } else {
      add(
        "warn",
        `Hosts sync covers ${covered} of ${hostsRoutes.length} registered hostnames.`,
        "Run: portless hosts sync"
      );
    }
  }

  const healthyBackground = snapshot.background.filter(
    (entry) => entry.pidAlive && entry.routePresent && entry.state === "ready"
  );
  if (snapshot.background.length === 0) {
    add("info", "No background apps are registered.");
  } else if (healthyBackground.length === snapshot.background.length) {
    add(
      "ok",
      `Background apps: ${pluralize(healthyBackground.length, "healthy entry", "healthy entries")}.`
    );
  } else {
    add(
      "warn",
      `Background apps: ${healthyBackground.length} of ${snapshot.background.length} entries are healthy.`,
      "Run: portless bg clean"
    );
  }
  for (const entry of snapshot.background) {
    if (!entry.pidAlive) {
      add(
        "warn",
        `Background app ${entry.label} records PID ${entry.pid}, but that process is not running.`
      );
    } else if (!entry.routePresent) {
      add("warn", `Background app ${entry.label} is running without its registered route.`);
    } else if (entry.state !== "ready") {
      add("warn", `Background app ${entry.label} reports state ${entry.state}.`);
    }
  }

  const requiredTools = requiredSharingTools(snapshot.routes, snapshot.background);
  addToolFinding(findings, "cloudflared", snapshot.tools.cloudflared, requiredTools.cloudflared);
  addToolFinding(findings, "ngrok", snapshot.tools.ngrok, requiredTools.ngrok);
  addToolFinding(findings, "Tailscale", snapshot.tools.tailscale, requiredTools.tailscale);
  addToolFinding(findings, "NetBird", snapshot.tools.netbird, requiredTools.netbird);

  for (const warning of snapshot.warnings) add("warn", warning);

  return {
    snapshot,
    findings,
    exitCode: findings.some((finding) => finding.status === "fail") ? 1 : 0,
  };
}
