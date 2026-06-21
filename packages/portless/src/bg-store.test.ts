import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { BgStore, type BgProcessEntry } from "./bg-store.js";

function sampleEntry(overrides: Partial<BgProcessEntry> = {}): BgProcessEntry {
  return {
    version: 1,
    id: "bg_01",
    label: "api",
    pid: process.pid,
    cwd: "/tmp/api",
    startedAt: "2026-06-18T00:00:00.000Z",
    state: "starting",
    intent: {
      cwd: "/tmp/api",
      commandArgs: ["bun", "run", "dev"],
      explicitCommand: true,
      force: false,
      pathPrefix: "/",
      sharing: {
        tailscale: false,
        tailscaleService: false,
        funnel: false,
        ngrok: false,
        netbird: false,
      },
    },
    ...overrides,
  };
}

describe("BgStore", () => {
  let tmpDir: string;
  let store: BgStore;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "portless-bg-store-"));
    store = new BgStore(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns an empty registry when no bg registry exists", () => {
    expect(store.loadEntries()).toEqual([]);
  });

  it("persists entries with private file permissions", () => {
    store.upsertEntry(sampleEntry());

    const paths = store.getPaths();
    expect(store.loadEntries()).toEqual([sampleEntry()]);
    if (process.platform !== "win32") {
      expect(fs.statSync(paths.rootDir).mode & 0o777).toBe(0o700);
      expect(fs.statSync(paths.registryPath).mode & 0o777).toBe(0o600);
    }
  });

  it("updates by id without replacing unrelated entries", () => {
    store.upsertEntry(sampleEntry({ id: "bg_01", label: "api" }));
    store.upsertEntry(sampleEntry({ id: "bg_02", label: "web" }));

    store.updateEntry("bg_01", {
      state: "ready",
      readyAt: "2026-06-18T00:00:01.000Z",
      url: "https://api.localhost",
    });

    expect(store.loadEntries().map((entry) => [entry.id, entry.label, entry.state])).toEqual([
      ["bg_01", "api", "ready"],
      ["bg_02", "web", "starting"],
    ]);
  });

  it("removes by id without replacing unrelated entries", () => {
    store.upsertEntry(sampleEntry({ id: "bg_01", label: "api" }));
    store.upsertEntry(sampleEntry({ id: "bg_02", label: "web" }));

    expect(store.removeEntry("bg_01")).toBe(true);
    expect(store.removeEntry("bg_03")).toBe(false);
    expect(store.loadEntries().map((entry) => entry.id)).toEqual(["bg_02"]);
  });

  it("loads only valid entries from a mixed registry", () => {
    store.ensureDirs();
    fs.writeFileSync(
      store.getPaths().registryPath,
      JSON.stringify([
        sampleEntry(),
        { version: 2, id: "future" },
        { version: 1, id: "missing-fields" },
        null,
      ])
    );

    expect(store.loadEntries()).toEqual([sampleEntry()]);
  });

  it("uses a route key that includes hostname and path prefix", () => {
    store.upsertEntry(
      sampleEntry({
        id: "root",
        route: { hostname: "api.localhost", pathPrefix: "/" },
      })
    );
    store.upsertEntry(
      sampleEntry({
        id: "path",
        route: { hostname: "api.localhost", pathPrefix: "/v1" },
      })
    );

    expect(store.findByRoute("api.localhost", "/")?.id).toBe("root");
    expect(store.findByRoute("api.localhost", "/v1")?.id).toBe("path");
  });

  it("serializes concurrent writes through a lock", async () => {
    await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        Promise.resolve().then(() => {
          const isolatedStore = new BgStore(tmpDir);
          isolatedStore.upsertEntry(sampleEntry({ id: `bg_${index}`, label: `app-${index}` }));
        })
      )
    );

    expect(store.loadEntries()).toHaveLength(10);
  });
});
