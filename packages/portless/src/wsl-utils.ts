import * as fs from "node:fs";
import { execFileSync, type ExecFileSyncOptions } from "node:child_process";

type RuntimeReadFileSync = (
  path: fs.PathOrFileDescriptor,
  options?: BufferEncoding | { encoding?: BufferEncoding | null; flag?: string } | null
) => string | Buffer;

type RuntimeExecFileSync = (
  file: string,
  args?: readonly string[],
  options?: ExecFileSyncOptions
) => string | Buffer;

interface WslRuntime {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  readFileSync?: RuntimeReadFileSync;
  existsSync?: typeof fs.existsSync;
  execFileSync?: RuntimeExecFileSync;
}

function runtimeOrDefault(runtime: WslRuntime = {}): Required<WslRuntime> {
  return {
    platform: runtime.platform ?? process.platform,
    env: runtime.env ?? process.env,
    readFileSync: runtime.readFileSync ?? fs.readFileSync,
    existsSync: runtime.existsSync ?? fs.existsSync,
    execFileSync: runtime.execFileSync ?? execFileSync,
  };
}

export function isWSL(runtime?: WslRuntime): boolean {
  const rt = runtimeOrDefault(runtime);
  if (rt.platform !== "linux") return false;

  if (rt.env.WSL_DISTRO_NAME || rt.env.WSL_INTEROP) return true;

  try {
    const release = String(rt.readFileSync("/proc/sys/kernel/osrelease", "utf-8")).toLowerCase();
    if (release.includes("microsoft") || release.includes("wsl")) return true;
  } catch {
    // Fall through to wslinfo probing for newer WSL installs.
  }

  try {
    rt.execFileSync("wslinfo", ["--version"], {
      stdio: "pipe",
      timeout: 5_000,
    });
    return true;
  } catch {
    return false;
  }
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
