import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getProcessCommand } from "./cli-utils.js";
import { isWindowsTunnelShimCommandLine, stopTunnelPid } from "./tunnel-runner.js";

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

  describe("Windows cmd.exe shim wrapper", () => {
    const shimLine = (shim: string) =>
      `C:\\Windows\\system32\\cmd.exe /d /v:off /s /c ""${shim}" http 3000"`;

    function mockWindowsProcess(image: string, commandLine: string | null) {
      platform.windows = true;
      vi.mocked(spawnSync).mockReset();
      vi.mocked(spawnSync).mockImplementation(((command: string) => {
        if (command === "tasklist.exe") {
          return { status: 0, stdout: `"${image}","12345","Console","1","1,000 K"` };
        }
        if (command === "powershell.exe") {
          return commandLine === null
            ? { status: 1, stdout: "" }
            : { status: 0, stdout: `${commandLine}\r\n` };
        }
        return { status: 0, stdout: "" };
      }) as unknown as typeof spawnSync);
    }

    it.each([
      "C:\\Users\\me\\AppData\\Roaming\\npm\\ngrok.cmd",
      "C:\\Program Files\\cloudflared\\cloudflared.cmd",
      "C:\\tools\\ngrok.bat",
    ])("kills the tree of a cmd.exe running the shim %s", (shim) => {
      mockWindowsProcess("cmd.exe", shimLine(shim));
      const kill = vi.spyOn(process, "kill").mockReturnValue(true);
      stopTunnelPid(12345);
      expect(spawnSync).toHaveBeenCalledWith(
        "taskkill",
        ["/T", "/F", "/PID", "12345"],
        expect.objectContaining({ windowsHide: true })
      );
      // The tree kill replaces the single-process signal.
      expect(kill).not.toHaveBeenCalled();
    });

    it.each([
      ["an unrelated cmd.exe", "C:\\Windows\\system32\\cmd.exe /d /c dir"],
      [
        "a shim named like a tunnel but in another command",
        "cmd.exe /c node.exe C:\\x\\ngrok.cmd.js",
      ],
      ["a shim passed only as an argument", 'cmd.exe /c "C:\\tools\\run.cmd C:\\x\\ngrok.cmd"'],
      ["a different .cmd", shimLine("C:\\tools\\other.cmd")],
      ["an unreadable command line", null],
    ])("leaves %s alone", (_name, commandLine) => {
      mockWindowsProcess("cmd.exe", commandLine);
      const kill = vi.spyOn(process, "kill").mockReturnValue(true);
      stopTunnelPid(12345);
      expect(spawnSync).not.toHaveBeenCalledWith("taskkill", expect.anything(), expect.anything());
      expect(kill).not.toHaveBeenCalled();
    });

    it("recognises an unquoted shim path", () => {
      expect(
        isWindowsTunnelShimCommandLine('cmd.exe /d /v:off /s /c "C:\\n\\ngrok.cmd http 80"')
      ).toBe(true);
      expect(isWindowsTunnelShimCommandLine("cmd.exe /c ngrok.cmd http 80")).toBe(true);
      expect(isWindowsTunnelShimCommandLine("cmd.exe /c notngrok.cmd http 80")).toBe(false);
    });
  });
});
