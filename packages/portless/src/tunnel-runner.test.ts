import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getProcessCommand } from "./cli-utils.js";
import { stopTunnelPid } from "./tunnel-runner.js";

const platform = vi.hoisted(() => ({ windows: false }));
vi.mock("node:child_process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:child_process")>()),
  spawnSync: vi.fn(),
}));
vi.mock("./cli-utils.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./cli-utils.js")>()),
  getProcessCommand: vi.fn(),
  get isWindows() {
    return platform.windows;
  },
}));

describe("persisted tunnel PID cleanup", () => {
  afterEach(() => {
    platform.windows = false;
    vi.restoreAllMocks();
  });
  it.each(["ngrok", "cloudflared"])("signals a verified %s process", (binary) => {
    vi.mocked(getProcessCommand).mockReturnValue(binary);
    const kill = vi.spyOn(process, "kill").mockReturnValue(true);
    stopTunnelPid(12345);
    expect(kill).toHaveBeenCalledWith(12345, "SIGTERM");
  });
  it.each(["node", "cloudflared-helper", null])(
    "leaves an unrelated or unreadable executable alone: %s",
    (binary) => {
      vi.mocked(getProcessCommand).mockReturnValue(binary);
      const kill = vi.spyOn(process, "kill").mockReturnValue(true);
      stopTunnelPid(12345);
      expect(kill).not.toHaveBeenCalled();
    }
  );
  it("rejects invalid and special PIDs without looking them up", () => {
    const lookup = vi.mocked(getProcessCommand).mockClear();
    for (const pid of [undefined, 0, 1, -1, 1.5, NaN]) stopTunnelPid(pid);
    expect(lookup).not.toHaveBeenCalled();
  });
  it.each(["ngrok.exe", "cloudflared.exe", "node.exe"])(
    "checks the Windows image name before signaling %s",
    (image) => {
      platform.windows = true;
      vi.mocked(spawnSync).mockReturnValue({
        status: 0,
        stdout: `\r\n"${image}","12345","Console","1","1,000 K"`,
      } as ReturnType<typeof spawnSync>);
      const kill = vi.spyOn(process, "kill").mockReturnValue(true);
      stopTunnelPid(12345);
      expect(spawnSync).toHaveBeenCalledWith(
        "tasklist.exe",
        ["/FI", "PID eq 12345", "/FO", "CSV", "/NH"],
        expect.objectContaining({ windowsHide: true })
      );
      expect(kill).toHaveBeenCalledTimes(image === "node.exe" ? 0 : 1);
    }
  );
});
