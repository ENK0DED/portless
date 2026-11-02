import { execFileSync } from "node:child_process";
import * as fs from "node:fs";

const isWindows = process.platform === "win32";

/** Timeout (ms) for process lookups through `ps`. */
const LOOKUP_TIMEOUT_MS = 5000;

/**
 * Read a process's start time. Paired with the PID it identifies one process
 * instance, so a recycled PID does not match. Linux reads the boot-relative
 * tick count from /proc, which wall-clock adjustments cannot shift; other
 * platforms use `ps` in a fixed locale and time zone. Returns null on Windows
 * or when the process does not exist.
 */
export function getProcessStartTime(pid: number): string | null {
  if (isWindows || !Number.isInteger(pid) || pid <= 0) return null;
  try {
    if (process.platform === "linux") {
      const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf-8");
      // Fields after the parenthesized command name; starttime is field 22.
      const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
      return fields[19] || null;
    }
    const output = execFileSync("ps", ["-o", "lstart=", "-p", String(pid)], {
      encoding: "utf-8",
      env: { ...process.env, LC_ALL: "C", TZ: "UTC" },
      timeout: LOOKUP_TIMEOUT_MS,
    });
    return output.trim().replace(/\s+/g, " ") || null;
  } catch {
    return null;
  }
}

/**
 * True while the process group recorded at spawn still exists: its leader is
 * alive, still leads the group, and has the recorded start time. A recycled
 * PID fails the start time check, so it never counts as the original group.
 */
export function isRecordedProcessGroupAlive(
  pgid: number | undefined,
  startTime: string | undefined
): boolean {
  if (isWindows || !pgid || !Number.isInteger(pgid) || pgid <= 1 || !startTime) return false;
  try {
    const output = execFileSync("ps", ["-o", "pgid=", "-p", String(pgid)], {
      encoding: "utf-8",
      timeout: LOOKUP_TIMEOUT_MS,
    });
    if (Number(output.trim()) !== pgid) return false;
    return getProcessStartTime(pgid) === startTime;
  } catch {
    return false;
  }
}

/**
 * Kill a process group left behind by a portless session that died without
 * cleaning up. The group is only signaled while its leader is alive, still
 * leads the group, and has the start time recorded at spawn, so a recycled PID
 * is not targeted. Returns true when the signal was sent.
 */
export function killOrphanedProcessGroup(
  pgid: number,
  startTime: string | undefined,
  signal: NodeJS.Signals = "SIGTERM"
): boolean {
  if (!isRecordedProcessGroupAlive(pgid, startTime)) return false;
  try {
    process.kill(-pgid, signal);
    return true;
  } catch {
    return false;
  }
}
