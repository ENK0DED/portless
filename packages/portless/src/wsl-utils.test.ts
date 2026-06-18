import { describe, expect, it, vi } from "vitest";
import { getPowerShellPath, isWSL, runPowerShellFromWSL, wslToWindowsPath } from "./wsl-utils.js";

describe("isWSL", () => {
  it("detects WSL from environment variables", () => {
    expect(
      isWSL({
        platform: "linux",
        env: { WSL_DISTRO_NAME: "Ubuntu" },
        readFileSync: vi.fn(),
        existsSync: vi.fn(),
        execFileSync: vi.fn(),
      })
    ).toBe(true);
  });

  it("detects WSL from the kernel release", () => {
    expect(
      isWSL({
        platform: "linux",
        env: {},
        readFileSync: vi.fn(() => "5.15.90.1-microsoft-standard-WSL2"),
        existsSync: vi.fn(),
        execFileSync: vi.fn(),
      })
    ).toBe(true);
  });

  it("returns false outside Linux", () => {
    expect(
      isWSL({
        platform: "darwin",
        env: { WSL_DISTRO_NAME: "Ubuntu" },
        readFileSync: vi.fn(),
        existsSync: vi.fn(),
        execFileSync: vi.fn(),
      })
    ).toBe(false);
  });
});

describe("wslToWindowsPath", () => {
  it("converts a WSL path through wslpath", () => {
    const execFileSync = vi.fn(() => "\\\\wsl.localhost\\Ubuntu\\home\\user\\.portless\\ca.pem\n");

    expect(wslToWindowsPath("/home/user/.portless/ca.pem", { execFileSync })).toBe(
      "\\\\wsl.localhost\\Ubuntu\\home\\user\\.portless\\ca.pem"
    );
    expect(execFileSync).toHaveBeenCalledWith("wslpath", ["-w", "/home/user/.portless/ca.pem"], {
      encoding: "utf-8",
      timeout: 5_000,
      stdio: ["pipe", "pipe", "pipe"],
    });
  });
});

describe("PowerShell interop", () => {
  it("returns the first existing PowerShell path", () => {
    expect(
      getPowerShellPath({
        existsSync: vi.fn((candidate) => String(candidate).includes("System32")),
        execFileSync: vi.fn(),
      })
    ).toBe("/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe");
  });

  it("throws when PowerShell is not reachable", () => {
    expect(() =>
      getPowerShellPath({
        existsSync: vi.fn(() => false),
        execFileSync: vi.fn(),
      })
    ).toThrow("PowerShell executable not found");
  });

  it("runs PowerShell through the resolved path", () => {
    const execFileSync = vi.fn(() => "hello\n");
    const result = runPowerShellFromWSL(["-NoProfile", "-Command", "Write-Output hello"], {
      runtime: {
        existsSync: vi.fn(() => true),
        execFileSync,
      },
    });

    expect(result.trim()).toBe("hello");
    expect(execFileSync).toHaveBeenCalledWith(
      "/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe",
      ["-NoProfile", "-Command", "Write-Output hello"],
      {
        encoding: "utf-8",
        timeout: 30_000,
        stdio: ["pipe", "pipe", "pipe"],
      }
    );
  });
});
