import * as fs from "node:fs";
import * as path from "node:path";
import { BG_DIR_MODE, BG_FILE_MODE, isSafeBgId } from "./bg-store.js";
import { fixOwnership, normalizePathPrefix } from "./utils.js";

export const PORTLESS_BG_ID_ENV = "PORTLESS_BG_ID";
export const PORTLESS_BG_READY_PATH_ENV = "PORTLESS_BG_READY_PATH";

export interface BgReadyPayload {
  version: 1;
  bgId: string;
  pid: number;
  hostname: string;
  pathPrefix: string;
  url: string;
  stateDir: string;
  appPort: number;
  proxyPort: number;
  tls: boolean;
  sharing: {
    tailscaleUrl?: string;
    tailscaleServiceUrl?: string;
    ngrokUrl?: string;
    tunnelUrl?: string;
    netbirdUrl?: string;
  };
}

function ensurePrivateDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true, mode: BG_DIR_MODE });
  try {
    fs.chmodSync(dir, BG_DIR_MODE);
  } catch {
    // Permission repair is best effort.
  }
  fixOwnership(dir);
}

function isReadySharing(value: unknown): value is BgReadyPayload["sharing"] {
  if (typeof value !== "object" || value === null) return false;
  const sharing = value as BgReadyPayload["sharing"];
  return (
    (sharing.tailscaleUrl === undefined || typeof sharing.tailscaleUrl === "string") &&
    (sharing.tailscaleServiceUrl === undefined ||
      typeof sharing.tailscaleServiceUrl === "string") &&
    (sharing.ngrokUrl === undefined || typeof sharing.ngrokUrl === "string") &&
    (sharing.tunnelUrl === undefined || typeof sharing.tunnelUrl === "string") &&
    (sharing.netbirdUrl === undefined || typeof sharing.netbirdUrl === "string")
  );
}

function isReadyPayload(value: unknown): value is BgReadyPayload {
  if (typeof value !== "object" || value === null) return false;
  const payload = value as BgReadyPayload;
  if (payload.version !== 1) return false;
  if (typeof payload.bgId !== "string" || !isSafeBgId(payload.bgId)) return false;
  if (typeof payload.pid !== "number" || payload.pid <= 0) return false;
  if (typeof payload.hostname !== "string" || payload.hostname.trim() === "") return false;
  if (typeof payload.pathPrefix !== "string") return false;
  try {
    normalizePathPrefix(payload.pathPrefix);
  } catch {
    return false;
  }
  if (typeof payload.url !== "string" || payload.url.trim() === "") return false;
  if (typeof payload.stateDir !== "string" || payload.stateDir.trim() === "") return false;
  if (typeof payload.appPort !== "number" || payload.appPort <= 0) return false;
  if (typeof payload.proxyPort !== "number" || payload.proxyPort <= 0) return false;
  if (typeof payload.tls !== "boolean") return false;
  return isReadySharing(payload.sharing);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function getBgReadyPath(stateDir: string, entryId: string): string {
  if (!isSafeBgId(entryId)) {
    throw new Error(`Invalid background process id "${entryId}"`);
  }
  return path.join(stateDir, "bg", `${entryId}.ready.json`);
}

export function writeBgReadyFile(filePath: string, payload: BgReadyPayload): void {
  if (!isReadyPayload(payload)) {
    throw new Error("Invalid background ready payload");
  }
  const dir = path.dirname(filePath);
  ensurePrivateDir(dir);
  const tmpPath = path.join(
    dir,
    `${path.basename(filePath)}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`
  );
  fs.writeFileSync(tmpPath, JSON.stringify(payload, null, 2) + "\n", { mode: BG_FILE_MODE });
  try {
    fs.chmodSync(tmpPath, BG_FILE_MODE);
  } catch {
    // Permission repair is best effort.
  }
  fixOwnership(tmpPath);
  fs.renameSync(tmpPath, filePath);
  try {
    fs.chmodSync(filePath, BG_FILE_MODE);
  } catch {
    // Permission repair is best effort.
  }
  fixOwnership(filePath);
}

export function readBgReadyFile(filePath: string, expectedBgId: string): BgReadyPayload | null {
  if (!isSafeBgId(expectedBgId)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8")) as unknown;
    if (!isReadyPayload(parsed)) return null;
    if (parsed.bgId !== expectedBgId) return null;
    return {
      ...parsed,
      pathPrefix: normalizePathPrefix(parsed.pathPrefix),
    };
  } catch {
    return null;
  }
}

export async function waitForBgReadyFile(
  filePath: string,
  expectedBgId: string,
  timeoutMs: number,
  intervalMs = 100
): Promise<BgReadyPayload | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    const payload = readBgReadyFile(filePath, expectedBgId);
    if (payload) return payload;
    await sleep(intervalMs);
  }
  return null;
}
