import { afterEach, beforeEach, describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  blockMatchesHostnames,
  checkHostResolution,
  cleanHostsFile,
  extractManagedBlock,
  getManagedHostnames,
  removeBlock,
  buildBlock,
  shouldAutoSyncHosts,
  syncHostsFile,
} from "./hosts.js";

// ---------------------------------------------------------------------------
// extractManagedBlock
// ---------------------------------------------------------------------------

describe("extractManagedBlock", () => {
  it("returns empty array when no markers exist", () => {
    const content = "127.0.0.1 localhost\n::1 localhost\n";
    expect(extractManagedBlock(content)).toEqual([]);
  });

  it("returns empty array when only start marker exists", () => {
    const content = "# portless-start\n127.0.0.1 myapp.localhost\n";
    expect(extractManagedBlock(content)).toEqual([]);
  });

  it("returns empty array when only end marker exists", () => {
    const content = "127.0.0.1 myapp.localhost\n# portless-end\n";
    expect(extractManagedBlock(content)).toEqual([]);
  });

  it("returns empty array when end marker comes before start marker", () => {
    const content = "# portless-end\n127.0.0.1 myapp.localhost\n# portless-start\n";
    expect(extractManagedBlock(content)).toEqual([]);
  });

  it("extracts lines between markers", () => {
    const content = [
      "127.0.0.1 localhost",
      "# portless-start",
      "127.0.0.1 myapp.localhost",
      "127.0.0.1 api.localhost",
      "# portless-end",
      "",
    ].join("\n");
    expect(extractManagedBlock(content)).toEqual([
      "127.0.0.1 myapp.localhost",
      "127.0.0.1 api.localhost",
    ]);
  });

  it("trims whitespace from extracted lines", () => {
    const content = "# portless-start\n  127.0.0.1 myapp.localhost  \n# portless-end\n";
    expect(extractManagedBlock(content)).toEqual(["127.0.0.1 myapp.localhost"]);
  });

  it("filters out empty lines", () => {
    const content = "# portless-start\n\n127.0.0.1 myapp.localhost\n\n# portless-end\n";
    expect(extractManagedBlock(content)).toEqual(["127.0.0.1 myapp.localhost"]);
  });

  it("returns empty array when block is empty", () => {
    const content = "# portless-start\n# portless-end\n";
    expect(extractManagedBlock(content)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// removeBlock
// ---------------------------------------------------------------------------

describe("removeBlock", () => {
  it("returns content unchanged when no markers exist", () => {
    const content = "127.0.0.1 localhost\n";
    expect(removeBlock(content)).toBe("127.0.0.1 localhost\n");
  });

  it("removes the managed block and normalizes newlines", () => {
    const content = [
      "127.0.0.1 localhost",
      "",
      "# portless-start",
      "127.0.0.1 myapp.localhost",
      "# portless-end",
      "",
    ].join("\n");
    const result = removeBlock(content);
    expect(result).not.toContain("portless-start");
    expect(result).not.toContain("myapp.localhost");
    expect(result).toContain("127.0.0.1 localhost");
    expect(result.endsWith("\n")).toBe(true);
  });

  it("does not leave more than 2 consecutive newlines", () => {
    const content =
      "127.0.0.1 localhost\n\n\n# portless-start\n127.0.0.1 x.localhost\n# portless-end\n\n\nother\n";
    const result = removeBlock(content);
    expect(result).not.toMatch(/\n{3,}/);
  });

  it("preserves content before and after the block", () => {
    const content = "before\n# portless-start\nentry\n# portless-end\nafter\n";
    const result = removeBlock(content);
    expect(result).toContain("before");
    expect(result).toContain("after");
  });
});

// ---------------------------------------------------------------------------
// buildBlock
// ---------------------------------------------------------------------------

describe("buildBlock", () => {
  it("returns empty string for empty hostnames array", () => {
    expect(buildBlock([])).toBe("");
  });

  it("builds a single-entry block with markers", () => {
    const result = buildBlock(["myapp.localhost"]);
    expect(result).toBe("# portless-start\n127.0.0.1 myapp.localhost\n# portless-end");
  });

  it("builds a multi-entry block", () => {
    const result = buildBlock(["myapp.localhost", "api.localhost"]);
    const lines = result.split("\n");
    expect(lines[0]).toBe("# portless-start");
    expect(lines[1]).toBe("127.0.0.1 myapp.localhost");
    expect(lines[2]).toBe("127.0.0.1 api.localhost");
    expect(lines[3]).toBe("# portless-end");
  });

  it("deduplicates hostnames shared by multiple routes", () => {
    expect(buildBlock(["myapp.localhost", "myapp.localhost"])).toBe(
      "# portless-start\n127.0.0.1 myapp.localhost\n# portless-end"
    );
  });

  it("produces a block that extractManagedBlock can parse", () => {
    const hostnames = ["a.localhost", "b.localhost"];
    const block = buildBlock(hostnames);
    const extracted = extractManagedBlock(block);
    expect(extracted).toEqual(["127.0.0.1 a.localhost", "127.0.0.1 b.localhost"]);
  });

  it("rejects hostnames that could inject extra hosts entries", () => {
    expect(() => buildBlock(["safe.localhost", "evil.localhost\n1.2.3.4 bank.com"])).toThrow(
      "Unsafe hostname"
    );
  });

  it("rejects malformed DNS labels before writing a hosts block", () => {
    expect(() => buildBlock(["-bad.localhost"])).toThrow("Unsafe hostname");
    expect(() => buildBlock(["bad-.localhost"])).toThrow("Unsafe hostname");
    expect(() => buildBlock(["bad..localhost"])).toThrow("Unsafe hostname");
  });
});

// ---------------------------------------------------------------------------
// shouldAutoSyncHosts
// ---------------------------------------------------------------------------

describe("shouldAutoSyncHosts", () => {
  it("returns true when unset", () => {
    expect(shouldAutoSyncHosts(undefined)).toBe(true);
  });

  it("returns false for 0 and false", () => {
    expect(shouldAutoSyncHosts("0")).toBe(false);
    expect(shouldAutoSyncHosts("false")).toBe(false);
  });

  it("returns true for 1 and true", () => {
    expect(shouldAutoSyncHosts("1")).toBe(true);
    expect(shouldAutoSyncHosts("true")).toBe(true);
  });

  it("returns true for other non-empty values", () => {
    expect(shouldAutoSyncHosts("yes")).toBe(true);
    expect(shouldAutoSyncHosts("")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// checkHostResolution
// ---------------------------------------------------------------------------

describe("checkHostResolution", () => {
  it("resolves localhost to 127.0.0.1", async () => {
    const result = await checkHostResolution("localhost");
    expect(result).toBe(true);
  });

  it("returns false for a nonexistent domain", async () => {
    const result = await checkHostResolution("this-should-never-exist.invalid");
    expect(result).toBe(false);
  });
});

describe("blockMatchesHostnames", () => {
  const block = "# portless-start\n127.0.0.1 a.localhost\n127.0.0.1 b.localhost\n# portless-end";

  it("accepts the exact managed hostname set regardless of order", () => {
    expect(blockMatchesHostnames(block, ["b.localhost", "a.localhost"])).toBe(true);
  });

  it("rejects missing, stale, duplicate, or non-loopback entries", () => {
    expect(blockMatchesHostnames(block, ["a.localhost"])).toBe(false);
    expect(blockMatchesHostnames(block, ["a.localhost", "c.localhost"])).toBe(false);
    expect(
      blockMatchesHostnames("# portless-start\n127.0.0.1 a.localhost a.localhost\n# portless-end", [
        "a.localhost",
      ])
    ).toBe(false);
    expect(
      blockMatchesHostnames("# portless-start\n10.0.0.1 a.localhost\n# portless-end", [
        "a.localhost",
      ])
    ).toBe(false);
  });

  it("accepts aliases and inline comments in a managed line", () => {
    expect(
      blockMatchesHostnames(
        "# portless-start\n127.0.0.1 a.localhost b.localhost # managed\n# portless-end",
        ["a.localhost", "b.localhost"]
      )
    ).toBe(true);
  });

  it("ignores standalone comments inside the managed block", () => {
    expect(
      blockMatchesHostnames("# portless-start\n# routes\n127.0.0.1 a.localhost\n# portless-end", [
        "a.localhost",
      ])
    ).toBe(true);
  });

  it("treats an absent managed block as correct only for no hostnames", () => {
    expect(blockMatchesHostnames("127.0.0.1 localhost\n", [])).toBe(true);
    expect(blockMatchesHostnames("127.0.0.1 localhost\n", ["a.localhost"])).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Hosts file write path (real temp files, never the system hosts file)
// ---------------------------------------------------------------------------

describe("hosts file write path", () => {
  let dir: string;
  let hostsPath: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "portless-hosts-test-"));
    hostsPath = path.join(dir, "hosts");
  });

  afterEach(() => {
    try {
      fs.chmodSync(hostsPath, 0o644);
    } catch {
      // The file may not exist.
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("preserves foreign entries beside the managed block", () => {
    fs.writeFileSync(hostsPath, "127.0.0.1 my-other-thing\n::1 localhost\n");

    expect(syncHostsFile(["a.localhost"], hostsPath)).toBe(true);

    const content = fs.readFileSync(hostsPath, "utf-8");
    expect(content).toContain("127.0.0.1 my-other-thing\n");
    expect(content).toContain("::1 localhost\n");
    expect(extractManagedBlock(content)).toEqual(["127.0.0.1 a.localhost"]);
  });

  it("is idempotent", () => {
    fs.writeFileSync(hostsPath, "127.0.0.1 localhost\n");

    expect(syncHostsFile(["a.localhost"], hostsPath)).toBe(true);
    const first = fs.readFileSync(hostsPath, "utf-8");
    expect(syncHostsFile(["a.localhost"], hostsPath)).toBe(true);

    expect(fs.readFileSync(hostsPath, "utf-8")).toBe(first);
  });

  it("deduplicates repeated hostnames", () => {
    expect(syncHostsFile(["a.localhost", "a.localhost"], hostsPath)).toBe(true);
    expect(getManagedHostnames(hostsPath)).toEqual(["a.localhost"]);
  });

  it("removes stale entries when the hostname list shrinks", () => {
    syncHostsFile(["a.localhost", "b.localhost"], hostsPath);
    expect(syncHostsFile(["b.localhost"], hostsPath)).toBe(true);
    expect(getManagedHostnames(hostsPath)).toEqual(["b.localhost"]);
  });

  it("clears a stale block when there are no hostnames", () => {
    fs.writeFileSync(
      hostsPath,
      "127.0.0.1 foreign\n\n# portless-start\n127.0.0.1 stale.localhost\n# portless-end\n"
    );

    expect(syncHostsFile([], hostsPath)).toBe(true);

    const content = fs.readFileSync(hostsPath, "utf-8");
    expect(content).not.toContain("portless-start");
    expect(content).not.toContain("portless-end");
    expect(content).not.toContain("stale.localhost");
    expect(content).toContain("127.0.0.1 foreign");
  });

  it("does not create a missing file when there is nothing to write", () => {
    expect(syncHostsFile([], hostsPath)).toBe(true);
    expect(fs.existsSync(hostsPath)).toBe(false);
  });

  it("creates a missing file holding only the managed block", () => {
    expect(fs.existsSync(hostsPath)).toBe(false);

    expect(syncHostsFile(["a.localhost", "b.localhost"], hostsPath)).toBe(true);

    expect(fs.readFileSync(hostsPath, "utf-8")).toBe(
      "# portless-start\n127.0.0.1 a.localhost\n127.0.0.1 b.localhost\n# portless-end\n"
    );
  });

  it("cannot create a file in a directory that does not exist", () => {
    expect(syncHostsFile(["a.localhost"], path.join(dir, "missing", "hosts"))).toBe(false);
  });

  // chmod based denial does not work for root or on Windows, so those runs
  // cannot reproduce an unreadable file.
  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "refuses to rewrite a file that exists but cannot be read",
    () => {
      const original = "127.0.0.1 my-other-thing\n::1 localhost\n";
      fs.writeFileSync(hostsPath, original);
      fs.chmodSync(hostsPath, 0o000);

      expect(syncHostsFile(["a.localhost"], hostsPath)).toBe(false);
      expect(syncHostsFile([], hostsPath)).toBe(false);
      expect(cleanHostsFile(hostsPath)).toBe(false);
      expect(getManagedHostnames(hostsPath)).toEqual([]);

      fs.chmodSync(hostsPath, 0o644);
      expect(fs.readFileSync(hostsPath, "utf-8")).toBe(original);
    }
  );

  it("writes in place so a symlinked hosts file keeps its link", () => {
    const target = path.join(dir, "real-hosts");
    fs.writeFileSync(target, "127.0.0.1 localhost\n");
    fs.symlinkSync(target, hostsPath);

    expect(syncHostsFile(["a.localhost"], hostsPath)).toBe(true);

    expect(fs.lstatSync(hostsPath).isSymbolicLink()).toBe(true);
    expect(fs.readFileSync(target, "utf-8")).toContain("127.0.0.1 a.localhost");
  });

  it("keeps the file mode and leaves no temp file behind", () => {
    fs.writeFileSync(hostsPath, "127.0.0.1 localhost\n", { mode: 0o640 });
    fs.chmodSync(hostsPath, 0o640);
    const inode = fs.statSync(hostsPath).ino;

    expect(syncHostsFile(["a.localhost"], hostsPath)).toBe(true);

    const stat = fs.statSync(hostsPath);
    expect(stat.ino).toBe(inode);
    if (process.platform !== "win32") expect(stat.mode & 0o777).toBe(0o640);
    expect(fs.readdirSync(dir)).toEqual(["hosts"]);
  });

  it("rejects an unsafe hostname without touching the file", () => {
    const original = "127.0.0.1 localhost\n";
    fs.writeFileSync(hostsPath, original);

    expect(syncHostsFile(["bad host.localhost"], hostsPath)).toBe(false);

    expect(fs.readFileSync(hostsPath, "utf-8")).toBe(original);
  });

  it("round-trips managed hostnames", () => {
    syncHostsFile(["a.localhost", "b.localhost"], hostsPath);
    expect(getManagedHostnames(hostsPath)).toEqual(["a.localhost", "b.localhost"]);
  });

  it("reads no managed hostnames from a missing file", () => {
    expect(getManagedHostnames(hostsPath)).toEqual([]);
  });

  it("cleanHostsFile removes the block and keeps foreign lines", () => {
    fs.writeFileSync(hostsPath, "127.0.0.1 foreign\n");
    syncHostsFile(["a.localhost"], hostsPath);

    expect(cleanHostsFile(hostsPath)).toBe(true);

    expect(fs.readFileSync(hostsPath, "utf-8")).toBe("127.0.0.1 foreign\n");
  });

  it("cleanHostsFile leaves a file without markers untouched", () => {
    const original = "127.0.0.1 foreign\r\n";
    fs.writeFileSync(hostsPath, original);

    expect(cleanHostsFile(hostsPath)).toBe(true);

    expect(fs.readFileSync(hostsPath, "utf-8")).toBe(original);
  });

  it("cleanHostsFile treats a missing file as already clean", () => {
    expect(cleanHostsFile(hostsPath)).toBe(true);
    expect(fs.existsSync(hostsPath)).toBe(false);
  });

  it("keeps foreign lines in a CRLF file", () => {
    fs.writeFileSync(hostsPath, "127.0.0.1 foreign\r\n::1 localhost\r\n");

    expect(syncHostsFile(["a.localhost"], hostsPath)).toBe(true);

    const content = fs.readFileSync(hostsPath, "utf-8");
    expect(content).toContain("127.0.0.1 foreign");
    expect(content).toContain("::1 localhost");
    expect(getManagedHostnames(hostsPath)).toEqual(["a.localhost"]);
  });
});
