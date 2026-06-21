import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  getBgReadyPath,
  readBgReadyFile,
  waitForBgReadyFile,
  writeBgReadyFile,
  type BgReadyPayload,
} from "./bg-ready.js";

function tempStateDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "portless-bg-ready-"));
}

function payload(overrides: Partial<BgReadyPayload> = {}): BgReadyPayload {
  return {
    version: 1,
    bgId: "bg-test",
    pid: process.pid,
    hostname: "web.localhost",
    pathPrefix: "/",
    url: "https://web.localhost",
    stateDir: tempStateDir(),
    appPort: 4100,
    proxyPort: 443,
    tls: true,
    sharing: {},
    ...overrides,
  };
}

describe("bg ready file", () => {
  it("writes ready data atomically with private file permissions", () => {
    const stateDir = tempStateDir();
    try {
      const readyPath = getBgReadyPath(stateDir, "bg-test");
      writeBgReadyFile(readyPath, payload({ stateDir }));

      const parsed = JSON.parse(fs.readFileSync(readyPath, "utf-8")) as BgReadyPayload;
      const mode = fs.statSync(readyPath).mode & 0o777;

      expect(parsed.bgId).toBe("bg-test");
      if (process.platform !== "win32") {
        expect(mode).toBe(0o600);
      }
      expect(
        fs.readdirSync(path.dirname(readyPath)).filter((name) => name.endsWith(".tmp"))
      ).toEqual([]);
    } finally {
      fs.rmSync(stateDir, { recursive: true, force: true });
    }
  });

  it("reads ready data for the expected bg id", () => {
    const stateDir = tempStateDir();
    try {
      const readyPath = getBgReadyPath(stateDir, "bg-test");
      const expected = payload({ stateDir, pathPrefix: "/api" });
      writeBgReadyFile(readyPath, expected);

      expect(readBgReadyFile(readyPath, "bg-test")).toEqual(expected);
    } finally {
      fs.rmSync(stateDir, { recursive: true, force: true });
    }
  });

  it("rejects ready data with a mismatched bg id", () => {
    const stateDir = tempStateDir();
    try {
      const readyPath = getBgReadyPath(stateDir, "bg-test");
      writeBgReadyFile(readyPath, payload({ stateDir }));

      expect(readBgReadyFile(readyPath, "other-bg")).toBeNull();
    } finally {
      fs.rmSync(stateDir, { recursive: true, force: true });
    }
  });

  it("times out without returning partial data", async () => {
    const stateDir = tempStateDir();
    try {
      const readyPath = getBgReadyPath(stateDir, "bg-test");
      fs.mkdirSync(path.dirname(readyPath), { recursive: true });
      fs.writeFileSync(readyPath, '{"version":1,');

      await expect(waitForBgReadyFile(readyPath, "bg-test", 25, 5)).resolves.toBeNull();
    } finally {
      fs.rmSync(stateDir, { recursive: true, force: true });
    }
  });
});
