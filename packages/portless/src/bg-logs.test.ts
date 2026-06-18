import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  appendBgLifecycleLog,
  getBgLogPaths,
  readLastBgLogLines,
  readWholeBgLog,
  truncateBgLogFile,
} from "./bg-logs.js";

describe("bg logs", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "portless-bg-logs-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates logs below a safe bg log directory", () => {
    const logs = getBgLogPaths(tmpDir, "bg_01");
    appendBgLifecycleLog(logs, "started");

    expect(logs.stdout).toBe(path.join(tmpDir, "bg", "logs", "bg_01.stdout.log"));
    expect(fs.statSync(path.dirname(logs.bg)).mode & 0o777).toBe(0o700);
    expect(fs.statSync(logs.bg).mode & 0o777).toBe(0o600);
  });

  it("uses filenames derived from a safe generated id", () => {
    expect(() => getBgLogPaths(tmpDir, "../bad")).toThrow("Invalid background process id");
    expect(() => getBgLogPaths(tmpDir, "bad/name")).toThrow("Invalid background process id");
  });

  it("caps large log files without breaking UTF-8 line boundaries", () => {
    const logs = getBgLogPaths(tmpDir, "bg_01");
    fs.mkdirSync(path.dirname(logs.stdout), { recursive: true });
    fs.writeFileSync(logs.stdout, `${"a".repeat(700_000)}\nsecond\nthird\n`);

    truncateBgLogFile(logs.stdout, { maxBytes: 1024, keepBytes: 64 });

    const content = fs.readFileSync(logs.stdout, "utf-8");
    expect(content).toBe("second\nthird\n");
  });

  it("returns the last N lines", () => {
    const logs = getBgLogPaths(tmpDir, "bg_01");
    fs.mkdirSync(path.dirname(logs.stdout), { recursive: true });
    fs.writeFileSync(logs.stdout, "one\ntwo\nthree\n");

    expect(readLastBgLogLines(logs.stdout, 2)).toEqual(["two", "three"]);
  });

  it("returns no lines for tail 0", () => {
    const logs = getBgLogPaths(tmpDir, "bg_01");
    fs.mkdirSync(path.dirname(logs.stdout), { recursive: true });
    fs.writeFileSync(logs.stdout, "one\ntwo\nthree\n");

    expect(readLastBgLogLines(logs.stdout, 0)).toEqual([]);
  });

  it("does not throw when a log file is missing", () => {
    const logs = getBgLogPaths(tmpDir, "bg_01");

    expect(readWholeBgLog(logs.stdout)).toBe("");
    expect(readLastBgLogLines(logs.stdout, 10)).toEqual([]);
  });
});
