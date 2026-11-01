import { describe, expect, it, vi } from "vitest";
import { findUserWritableLocation, resolveOpensslBinary } from "./openssl-path.js";

const ok = { status: 0, stdout: "OpenSSL 3.0.13 30 Jan 2024\n" };

describe("resolveOpensslBinary", () => {
  it("returns the first runnable absolute match on a POSIX PATH", () => {
    const run = vi.fn(() => ok);
    const result = resolveOpensslBinary({
      platform: "linux",
      pathEnv: "/usr/local/bin:/usr/bin:/bin",
      isFile: (p) => p === "/usr/bin/openssl" || p === "/bin/openssl",
      run,
    });
    expect(result).toBe("/usr/bin/openssl");
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith("/usr/bin/openssl");
  });

  it("skips relative and empty PATH entries", () => {
    const seen: string[] = [];
    const result = resolveOpensslBinary({
      platform: "linux",
      pathEnv: ":.:bin:/usr/bin",
      isFile: (p) => {
        seen.push(p);
        return p.endsWith("/openssl");
      },
      run: () => ok,
    });
    expect(result).toBe("/usr/bin/openssl");
    expect(seen).toEqual(["/usr/bin/openssl"]);
  });

  it("falls through a binary that does not run to the next one", () => {
    const result = resolveOpensslBinary({
      platform: "linux",
      pathEnv: "/broken:/usr/bin",
      isFile: () => true,
      run: (binary) => (binary.startsWith("/broken") ? { status: 127, stdout: "" } : ok),
    });
    expect(result).toBe("/usr/bin/openssl");
  });

  it("fails with a clear message when nothing is found", () => {
    expect(() =>
      resolveOpensslBinary({
        platform: "linux",
        pathEnv: "/usr/bin",
        isFile: () => false,
        run: () => ok,
      })
    ).toThrow(/working openssl binary.*No openssl executable was found on PATH/);
  });

  it("names the candidates that were found but could not run", () => {
    expect(() =>
      resolveOpensslBinary({
        platform: "linux",
        pathEnv: "/usr/bin",
        isFile: () => true,
        run: () => ({ status: 1, stdout: "" }),
      })
    ).toThrow(/Found but could not run: \/usr\/bin\/openssl/);
  });

  it("resolves openssl.exe through PATHEXT on Windows", () => {
    const seen: string[] = [];
    const result = resolveOpensslBinary({
      platform: "win32",
      pathEnv: 'C:\\Windows\\System32;"C:\\Program Files\\Git\\mingw64\\bin"',
      pathExt: ".COM;.EXE;.BAT;.CMD",
      isFile: (p) => {
        seen.push(p);
        return p === "C:\\Program Files\\Git\\mingw64\\bin\\openssl.exe";
      },
      run: () => ok,
    });
    expect(result).toBe("C:\\Program Files\\Git\\mingw64\\bin\\openssl.exe");
    expect(seen).toContain("C:\\Windows\\System32\\openssl.com");
    expect(seen).toContain("C:\\Windows\\System32\\openssl.exe");
    expect(seen.some((p) => /\.(bat|cmd)$/.test(p))).toBe(false);
  });

  it("falls back to openssl.exe when PATHEXT lists no runnable extension", () => {
    const result = resolveOpensslBinary({
      platform: "win32",
      pathEnv: "C:\\OpenSSL\\bin",
      pathExt: ".BAT;.CMD",
      isFile: (p) => p === "C:\\OpenSSL\\bin\\openssl.exe",
      run: () => ok,
    });
    expect(result).toBe("C:\\OpenSSL\\bin\\openssl.exe");
  });

  it("suggests an install route on Windows when nothing is found", () => {
    expect(() =>
      resolveOpensslBinary({
        platform: "win32",
        pathEnv: "C:\\Windows",
        isFile: () => false,
        run: () => ok,
      })
    ).toThrow(/winget install -e --id ShiningLight\.OpenSSL\.Dev/);
  });
});

describe("findUserWritableLocation", () => {
  const root = { uid: 0, mode: 0o40755 };

  it("returns null when the file and every parent are root-owned and not group or world writable", () => {
    expect(
      findUserWritableLocation("/usr/bin/openssl", {
        platform: "linux",
        realpath: (p) => p,
        stat: () => root,
      })
    ).toBeNull();
  });

  it("flags a parent directory owned by a regular user", () => {
    expect(
      findUserWritableLocation("/opt/homebrew/bin/openssl", {
        platform: "darwin",
        realpath: (p) => p,
        stat: (p) => (p === "/opt/homebrew" ? { uid: 501, mode: 0o40755 } : root),
      })
    ).toBe("/opt/homebrew");
  });

  it("flags a world-writable directory", () => {
    expect(
      findUserWritableLocation("/srv/tools/openssl", {
        platform: "linux",
        realpath: (p) => p,
        stat: (p) => (p === "/srv/tools" ? { uid: 0, mode: 0o40777 } : root),
      })
    ).toBe("/srv/tools");
  });

  it("follows symlinks before checking ownership", () => {
    expect(
      findUserWritableLocation("/usr/local/bin/openssl", {
        platform: "linux",
        realpath: () => "/home/alice/.local/openssl/bin/openssl",
        stat: (p) => (p.startsWith("/home/alice") ? { uid: 1000, mode: 0o100755 } : root),
      })
    ).toBe("/home/alice/.local/openssl/bin/openssl");
  });

  it("flags Windows locations under the installing user's profile", () => {
    const env = {
      USERPROFILE: "C:\\Users\\Alice",
      LOCALAPPDATA: "C:\\Users\\Alice\\AppData\\Local",
    };
    expect(
      findUserWritableLocation("C:\\Users\\Alice\\tools\\openssl.exe", { platform: "win32", env })
    ).toBe("C:\\Users\\Alice");
    expect(
      findUserWritableLocation("C:\\Program Files\\Git\\mingw64\\bin\\openssl.exe", {
        platform: "win32",
        env,
      })
    ).toBeNull();
    expect(
      findUserWritableLocation("C:\\Users\\AliceBob\\openssl.exe", { platform: "win32", env })
    ).toBeNull();
  });
});
