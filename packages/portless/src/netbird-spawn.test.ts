import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { guardWindowsOrphans } from "./cli-utils.js";
import { startNetbirdExpose } from "./netbird.js";

vi.mock("node:child_process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:child_process")>()),
  spawn: vi.fn(),
}));
vi.mock("./cli-utils.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./cli-utils.js")>()),
  guardWindowsOrphans: vi.fn(),
}));

describe("netbird expose spawn", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("guards the public expose child against orphaning on Windows", async () => {
    const child = Object.assign(new EventEmitter(), {
      pid: 4321,
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
      kill: vi.fn(() => true),
    });
    vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>);

    // No spawner is passed, so the default one runs (against the mocked spawn).
    await expect(startNetbirdExpose(4567, { timeoutMs: 10 })).rejects.toThrow();

    expect(spawn).toHaveBeenCalledWith(
      "netbird",
      expect.arrayContaining(["expose"]),
      expect.anything()
    );
    expect(guardWindowsOrphans).toHaveBeenCalledTimes(1);
    expect(guardWindowsOrphans).toHaveBeenCalledWith(child, expect.any(Number));
  });
});
