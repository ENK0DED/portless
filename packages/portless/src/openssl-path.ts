import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";

/**
 * Internal variable set only by the installed system service definition. It
 * holds the absolute path of the openssl binary chosen at `service install`
 * time, so a root or SYSTEM proxy never resolves `openssl` through a PATH that
 * may contain user-writable directories. Interactive runs leave it unset and
 * keep the plain `openssl` lookup. Intentionally undocumented: it is not a
 * user-facing setting.
 */
export const SERVICE_OPENSSL_ENV = "PORTLESS_SERVICE_OPENSSL";

export type ResolveOpensslOptions = {
  platform?: NodeJS.Platform;
  /** The PATH to search. Defaults to `process.env.PATH`. */
  pathEnv?: string;
  /** Windows PATHEXT. Defaults to `process.env.PATHEXT`. */
  pathExt?: string;
  /** Whether `candidate` is an existing regular file. */
  isFile?: (candidate: string) => boolean;
  /** Run `<binary> version`; returns the exit status and stdout. */
  run?: (binary: string) => { status: number | null; stdout: string };
};

function defaultIsFile(candidate: string): boolean {
  try {
    if (!fs.statSync(candidate).isFile()) return false;
    if (process.platform !== "win32") fs.accessSync(candidate, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function defaultRun(binary: string): { status: number | null; stdout: string } {
  const result = spawnSync(binary, ["version"], {
    encoding: "utf-8",
    timeout: 10_000,
    windowsHide: true,
  });
  return { status: result.status, stdout: result.stdout ?? "" };
}

/**
 * Executable names to try for `openssl` in each PATH directory. On Windows this
 * honors PATHEXT but keeps only `.exe` and `.com`, because `execFile` cannot
 * run `.bat` or `.cmd` files without a shell.
 */
function opensslFileNames(platform: NodeJS.Platform, pathExt: string | undefined): string[] {
  if (platform !== "win32") return ["openssl"];
  const exts = (pathExt || ".COM;.EXE;.BAT;.CMD")
    .split(";")
    .map((ext) => ext.trim().toLowerCase())
    .filter((ext) => ext === ".exe" || ext === ".com");
  const unique = [...new Set(exts.length > 0 ? exts : [".exe"])];
  return unique.map((ext) => `openssl${ext}`);
}

/**
 * Resolve `openssl` to an absolute path once, at `service install` time, and
 * check that it runs. Throws a message that tells the user what to fix when no
 * working binary is found. Relative and empty PATH entries are skipped so the
 * result never depends on the current directory.
 *
 * This still trusts the installer's PATH once, the same way the service pins
 * `process.execPath` for Node. What it removes is the run-time lookup, where a
 * user-writable directory could shadow the real binary for a root or SYSTEM
 * process long after install.
 */
export function resolveOpensslBinary(options: ResolveOpensslOptions = {}): string {
  const platform = options.platform ?? process.platform;
  const pathApi = platform === "win32" ? path.win32 : path.posix;
  const delimiter = platform === "win32" ? ";" : ":";
  const pathEnv = options.pathEnv ?? process.env.PATH ?? "";
  const isFile = options.isFile ?? defaultIsFile;
  const run = options.run ?? defaultRun;
  const names = opensslFileNames(platform, options.pathExt ?? process.env.PATHEXT);

  const failures: string[] = [];
  for (const rawDir of pathEnv.split(delimiter)) {
    const dir = rawDir.trim().replace(/^"(.*)"$/, "$1");
    if (!dir || !pathApi.isAbsolute(dir)) continue;
    for (const name of names) {
      const candidate = pathApi.join(dir, name);
      if (!isFile(candidate)) continue;
      const result = run(candidate);
      if (result.status === 0 && result.stdout.trim()) return candidate;
      failures.push(candidate);
    }
  }

  const tried =
    failures.length > 0
      ? ` Found but could not run: ${failures.join(", ")}.`
      : " No openssl executable was found on PATH.";
  const hint =
    platform === "win32"
      ? "Install it with: winget install -e --id ShiningLight.OpenSSL.Dev, or add Git's bundled copy (C:\\Program Files\\Git\\mingw64\\bin) to PATH, then re-run `portless service install`."
      : "Install openssl (it ships with macOS and most Linux distributions) and make sure it is on PATH, then re-run `portless service install`.";
  throw new Error(`The portless service needs a working openssl binary.${tried} ${hint}`);
}

function windowsUserDirs(env: NodeJS.ProcessEnv): string[] {
  return [env.USERPROFILE, env.LOCALAPPDATA, env.APPDATA, env.TEMP, env.TMP].filter(
    (dir): dir is string => Boolean(dir)
  );
}

/**
 * Return the first location on `binary`'s path that a non-privileged user could
 * rewrite, or null. On Unix that is the file or any directory above it that is
 * not owned by root or is group or world writable. On Windows, where ACLs are
 * not inspected, it is a location under the installing user's profile or temp
 * directories. Used to warn at install time; it never blocks the install.
 */
export function findUserWritableLocation(
  binary: string,
  options: {
    platform?: NodeJS.Platform;
    env?: NodeJS.ProcessEnv;
    stat?: (p: string) => { uid: number; mode: number } | null;
    realpath?: (p: string) => string;
  } = {}
): string | null {
  const platform = options.platform ?? process.platform;

  if (platform === "win32") {
    const normalize = (p: string) =>
      path.win32
        .normalize(p)
        .toLowerCase()
        .replace(/[\\/]+$/, "");
    const target = normalize(binary);
    for (const dir of windowsUserDirs(options.env ?? process.env)) {
      const base = normalize(dir);
      if (target === base || target.startsWith(`${base}\\`)) return dir;
    }
    return null;
  }

  const stat =
    options.stat ??
    ((p: string) => {
      try {
        return fs.statSync(p);
      } catch {
        return null;
      }
    });
  const realpath = options.realpath ?? ((p: string) => fs.realpathSync(p));
  let current: string;
  try {
    current = realpath(binary);
  } catch {
    current = binary;
  }

  for (;;) {
    const info = stat(current);
    if (info && (info.uid !== 0 || (info.mode & 0o022) !== 0)) return current;
    const parent = path.posix.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}
