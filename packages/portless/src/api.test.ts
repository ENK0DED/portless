import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { getUrl } from "./api.js";
import { getUrl as getUrlFromIndex } from "./index.js";

function writeStateMarkers(
  dir: string,
  options: { port?: number; tls?: boolean; tld?: string } = {}
): void {
  fs.mkdirSync(dir, { recursive: true });
  if (options.port !== undefined) {
    fs.writeFileSync(path.join(dir, "proxy.port"), String(options.port));
  }
  if (options.tls) {
    fs.writeFileSync(path.join(dir, "proxy.tls"), "1");
  }
  if (options.tld !== undefined) {
    fs.writeFileSync(path.join(dir, "proxy.tld"), options.tld);
  }
}

describe("getUrl", () => {
  let tmpDir: string;
  let stateDir: string;
  let originalEnv: Record<string, string | undefined>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "portless-api-"));
    stateDir = path.join(tmpDir, "state");
    originalEnv = {
      PORTLESS_STATE_DIR: process.env.PORTLESS_STATE_DIR,
      PORTLESS_SUFFIX: process.env.PORTLESS_SUFFIX,
      PORTLESS_TLD: process.env.PORTLESS_TLD,
    };
    process.env.PORTLESS_STATE_DIR = stateDir;
    delete process.env.PORTLESS_SUFFIX;
    delete process.env.PORTLESS_TLD;
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns the URL and components from persisted HTTPS markers", async () => {
    writeStateMarkers(stateDir, { port: 443, tls: true });

    const result = await getUrl("myapp", { worktree: false });

    expect(result).toMatchObject({
      url: "https://myapp.localhost",
      hostname: "myapp.localhost",
      port: 443,
      tls: true,
      tld: "localhost",
    });
  });

  it("returns HTTP with the proxy port when TLS marker is absent", async () => {
    writeStateMarkers(stateDir, { port: 1355 });

    const result = await getUrl("myapp", { worktree: false });

    expect(result.url).toBe("http://myapp.localhost:1355");
    expect(result.tls).toBe(false);
  });

  it("uses a custom suffix when proxy.tld is set", async () => {
    writeStateMarkers(stateDir, { port: 443, tls: true, tld: "test" });

    const result = await getUrl("api.myapp", { worktree: false });

    expect(result.url).toBe("https://api.myapp.test");
    expect(result.hostname).toBe("api.myapp.test");
    expect(result.tld).toBe("test");
  });

  it("rejects invalid hostname characters", async () => {
    writeStateMarkers(stateDir, { port: 443, tls: true });

    await expect(getUrl("my@app", { worktree: false })).rejects.toThrow(/Invalid hostname/);
  });

  it("coerces to the URL string without serializing toString", async () => {
    writeStateMarkers(stateDir, { port: 443, tls: true });

    const result = await getUrl("myapp", { worktree: false });

    expect(`${result}`).toBe("https://myapp.localhost");
    expect(String(result)).toBe("https://myapp.localhost");
    expect(result + "/health").toBe("https://myapp.localhost/health");
    expect(Object.keys(result).sort()).toEqual([
      "hostname",
      "pathPrefix",
      "port",
      "tld",
      "tls",
      "url",
    ]);
    expect(JSON.parse(JSON.stringify(result))).toEqual({
      url: "https://myapp.localhost",
      hostname: "myapp.localhost",
      port: 443,
      tls: true,
      tld: "localhost",
      pathPrefix: "/",
    });
  });

  it("is exported from the package root", async () => {
    writeStateMarkers(stateDir, { port: 443, tls: true });

    const result = await getUrlFromIndex("myapp", { worktree: false });

    expect(result.url).toBe("https://myapp.localhost");
  });
});

describe("getUrl worktree behavior", { timeout: 15_000 }, () => {
  function gitAvailable(): boolean {
    try {
      execFileSync("git", ["--version"], { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  }

  function runGit(cwd: string, args: string[]): string {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  }

  function initRepoWithCommit(repoDir: string): void {
    fs.mkdirSync(repoDir, { recursive: true });
    runGit(repoDir, ["init"]);
    runGit(repoDir, ["branch", "-M", "main"]);
    runGit(repoDir, [
      "-c",
      "user.name=Test",
      "-c",
      "user.email=t@t",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "--allow-empty",
      "-m",
      "init",
    ]);
  }

  let tmpDir: string;
  let stateDir: string;
  let originalEnv: Record<string, string | undefined>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "portless-api-wt-"));
    stateDir = path.join(tmpDir, "state");
    originalEnv = {
      PORTLESS_STATE_DIR: process.env.PORTLESS_STATE_DIR,
      PORTLESS_SUFFIX: process.env.PORTLESS_SUFFIX,
      PORTLESS_TLD: process.env.PORTLESS_TLD,
    };
    process.env.PORTLESS_STATE_DIR = stateDir;
    delete process.env.PORTLESS_SUFFIX;
    delete process.env.PORTLESS_TLD;
    writeStateMarkers(stateDir, { port: 443, tls: true });
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it.skipIf(!gitAvailable())("applies the branch as a subdomain in a linked worktree", async () => {
    const repo = path.join(tmpDir, "repo");
    initRepoWithCommit(repo);
    runGit(repo, ["branch", "feature-x"]);
    const wtDir = path.join(tmpDir, "wt-feature-x");
    runGit(repo, ["worktree", "add", wtDir, "feature-x"]);

    const result = await getUrl("myapp", { cwd: wtDir });

    expect(result.url).toBe("https://feature-x.myapp.localhost");
    expect(result.hostname).toBe("feature-x.myapp.localhost");
  });

  it.skipIf(!gitAvailable())("skips the worktree prefix when worktree is false", async () => {
    const repo = path.join(tmpDir, "repo");
    initRepoWithCommit(repo);
    runGit(repo, ["branch", "feature-x"]);
    const wtDir = path.join(tmpDir, "wt-feature-x");
    runGit(repo, ["worktree", "add", wtDir, "feature-x"]);

    const result = await getUrl("myapp", { cwd: wtDir, worktree: false });

    expect(result.url).toBe("https://myapp.localhost");
  });
});
