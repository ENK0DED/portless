import * as fs from "node:fs";
import * as path from "node:path";
import { BG_DIR_MODE, BG_FILE_MODE, isSafeBgId } from "./bg-store.js";
import { fixOwnership } from "./utils.js";

const DEFAULT_MAX_LOG_SIZE = 1 * 1024 * 1024;
const DEFAULT_KEEP_LOG_SIZE = 512 * 1024;

export interface BgLogPaths {
  stdout: string;
  stderr: string;
  bg: string;
}

export interface TruncateBgLogOptions {
  maxBytes?: number;
  keepBytes?: number;
}

function ensureLogDir(logPath: string): void {
  const dir = path.dirname(logPath);
  fs.mkdirSync(dir, { recursive: true, mode: BG_DIR_MODE });
  try {
    fs.chmodSync(path.dirname(dir), BG_DIR_MODE);
    fs.chmodSync(dir, BG_DIR_MODE);
  } catch {
    // Permission repair is best effort.
  }
  fixOwnership(dir);
}

function writePrivateFile(filePath: string, content: Buffer | string): void {
  ensureLogDir(filePath);
  fs.writeFileSync(filePath, content, { mode: BG_FILE_MODE });
  try {
    fs.chmodSync(filePath, BG_FILE_MODE);
  } catch {
    // Permission repair is best effort.
  }
  fixOwnership(filePath);
}

export function getBgLogPaths(stateDir: string, entryId: string): BgLogPaths {
  if (!isSafeBgId(entryId)) {
    throw new Error(`Invalid background process id "${entryId}"`);
  }
  const logsDir = path.join(stateDir, "bg", "logs");
  return {
    stdout: path.join(logsDir, `${entryId}.stdout.log`),
    stderr: path.join(logsDir, `${entryId}.stderr.log`),
    bg: path.join(logsDir, `${entryId}.bg.log`),
  };
}

export function truncateBgLogFile(filePath: string, options: TruncateBgLogOptions = {}): void {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_LOG_SIZE;
  const keepBytes = options.keepBytes ?? DEFAULT_KEEP_LOG_SIZE;
  try {
    if (!fs.existsSync(filePath)) return;
    const stat = fs.statSync(filePath);
    if (stat.size <= maxBytes) return;
    const content = fs.readFileSync(filePath);
    const kept = content.slice(-keepBytes);
    const newlineIndex = kept.indexOf(10);
    const trimmed = newlineIndex >= 0 ? kept.slice(newlineIndex + 1) : kept;
    writePrivateFile(filePath, trimmed);
  } catch {
    // Log truncation must not make lifecycle commands fail.
  }
}

export function appendBgLifecycleLog(paths: BgLogPaths, message: string): void {
  ensureLogDir(paths.bg);
  truncateBgLogFile(paths.bg);
  const line = `[${new Date().toISOString()}] ${message}\n`;
  fs.appendFileSync(paths.bg, line, { mode: BG_FILE_MODE });
  try {
    fs.chmodSync(paths.bg, BG_FILE_MODE);
  } catch {
    // Permission repair is best effort.
  }
  fixOwnership(paths.bg);
  truncateBgLogFile(paths.bg);
}

export function readWholeBgLog(filePath: string): string {
  try {
    truncateBgLogFile(filePath);
    return fs.readFileSync(filePath, "utf-8");
  } catch {
    return "";
  }
}

export function readLastBgLogLines(filePath: string, count: number): string[] {
  if (count <= 0) return [];
  const content = readWholeBgLog(filePath);
  if (!content) return [];
  const lines = content.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines.slice(-count);
}
