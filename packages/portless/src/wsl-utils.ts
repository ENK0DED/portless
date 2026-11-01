import * as fs from "node:fs";
import { execFileSync, type ExecFileSyncOptions } from "node:child_process";

type RuntimeExecFileSync = (
  file: string,
  args?: readonly string[],
  options?: ExecFileSyncOptions
) => string | Buffer;

interface WslRuntime {
  existsSync?: typeof fs.existsSync;
  execFileSync?: RuntimeExecFileSync;
}

function runtimeOrDefault(runtime: WslRuntime = {}): Required<WslRuntime> {
  return {
    existsSync: runtime.existsSync ?? fs.existsSync,
    execFileSync: runtime.execFileSync ?? execFileSync,
  };
}

export function getPowerShellPath(runtime?: WslRuntime): string {
  const rt = runtimeOrDefault(runtime);
  const candidates = [
    "/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe",
    "/mnt/c/Windows/Sysnative/WindowsPowerShell/v1.0/powershell.exe",
  ];

  for (const candidate of candidates) {
    if (rt.existsSync(candidate)) return candidate;
  }

  throw new Error("PowerShell executable not found. Ensure WSL interop is enabled.");
}

export function runPowerShellFromWSL(
  args: string[],
  options?: { timeout?: number; runtime?: WslRuntime }
): string {
  const rt = runtimeOrDefault(options?.runtime);
  return String(
    rt.execFileSync(getPowerShellPath(rt), args, {
      encoding: "utf-8",
      timeout: options?.timeout ?? 30_000,
      stdio: ["pipe", "pipe", "pipe"],
    })
  );
}

export function wslToWindowsPath(wslPath: string, runtime?: WslRuntime): string {
  const rt = runtimeOrDefault(runtime);
  return String(
    rt.execFileSync("wslpath", ["-w", wslPath], {
      encoding: "utf-8",
      timeout: 5_000,
      stdio: ["pipe", "pipe", "pipe"],
    })
  ).trim();
}
