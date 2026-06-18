import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import {
  buildNetbirdExposeArgs,
  ensureNetbirdReady,
  parseNetbirdExposeInfo,
  startNetbirdExpose,
  stopNetbirdExpose,
  type NetbirdCommandRunner,
  type NetbirdExposeProcess,
  type NetbirdExposeSpawner,
} from "./netbird.js";

interface MockResult {
  status?: number | null;
  stdout?: string;
  stderr?: string;
  error?: Error;
}

function createRunner(results: Record<string, MockResult>, calls: string[][] = []) {
  const runner: NetbirdCommandRunner = (args) => {
    calls.push(args);
    const result = results[args.join(" ")];
    if (!result) throw new Error(`Unexpected netbird call: ${args.join(" ")}`);
    return {
      status: result.status ?? 0,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
      ...(result.error ? { error: result.error } : {}),
    };
  };
  return runner;
}

class FakeProcess extends EventEmitter implements NetbirdExposeProcess {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  killed = false;
  killSignal: NodeJS.Signals | undefined;

  kill(signal?: NodeJS.Signals): boolean {
    this.killed = true;
    this.killSignal = signal;
    return true;
  }

  emitStdout(value: string): void {
    this.stdout.emit("data", Buffer.from(value));
  }

  emitStderr(value: string): void {
    this.stderr.emit("data", Buffer.from(value));
  }
}

const SUCCESS_OUTPUT = `Service exposed successfully!
  Name:     myapp-a1b2c3
  URL:      https://myapp-a1b2c3.proxy.example.com
  Domain:   myapp-a1b2c3.proxy.example.com
  Protocol: http
  Port:     4567

Press Ctrl+C to stop exposing.
`;

describe("ensureNetbirdReady", () => {
  it("returns connection status and fqdn when the daemon is connected", () => {
    const runner = createRunner({
      "status --json": {
        stdout: JSON.stringify({ daemonStatus: "Connected", fqdn: "devbox.netbird.cloud" }),
      },
    });

    expect(ensureNetbirdReady(runner)).toEqual({
      daemonStatus: "Connected",
      fqdn: "devbox.netbird.cloud",
    });
  });

  it("throws when the daemon is not connected", () => {
    const runner = createRunner({
      "status --json": {
        stdout: JSON.stringify({ daemonStatus: "NeedsLogin" }),
      },
    });

    expect(() => ensureNetbirdReady(runner)).toThrow("NetBird is not connected");
  });

  it("throws a specific install hint when the CLI is missing", () => {
    const error = Object.assign(new Error("spawn netbird ENOENT"), { code: "ENOENT" });
    const runner = createRunner({
      "status --json": {
        status: null,
        error,
      },
    });

    expect(() => ensureNetbirdReady(runner)).toThrow("NetBird CLI not found");
  });
});

describe("buildNetbirdExposeArgs", () => {
  it("builds a minimal expose command with the port last", () => {
    expect(buildNetbirdExposeArgs(4567)).toEqual(["expose", "4567"]);
  });

  it("passes supported auth options to netbird expose", () => {
    expect(
      buildNetbirdExposeArgs(4567, {
        password: "secret",
        pin: "123456",
        groups: ["devops", "Backend"],
        namePrefix: "myapp",
      })
    ).toEqual([
      "expose",
      "--with-password",
      "secret",
      "--with-pin",
      "123456",
      "--with-user-groups",
      "devops,Backend",
      "--with-name-prefix",
      "myapp",
      "4567",
    ]);
  });
});

describe("parseNetbirdExposeInfo", () => {
  it("extracts NetBird's success block even when it is printed to stderr", () => {
    expect(parseNetbirdExposeInfo(SUCCESS_OUTPUT)).toEqual({
      name: "myapp-a1b2c3",
      url: "https://myapp-a1b2c3.proxy.example.com",
      domain: "myapp-a1b2c3.proxy.example.com",
      protocol: "http",
    });
  });

  it("returns null until all required fields are present", () => {
    expect(parseNetbirdExposeInfo("Name: myapp\nURL: https://example.com\n")).toBeNull();
  });
});

describe("startNetbirdExpose", () => {
  it("resolves when the expose URL is printed on stderr", async () => {
    const fake = new FakeProcess();
    const calls: string[][] = [];
    const spawner: NetbirdExposeSpawner = (args) => {
      calls.push(args);
      return fake;
    };
    const promise = startNetbirdExpose(4567, { spawner, namePrefix: "myapp" });

    fake.emitStderr(SUCCESS_OUTPUT);

    const handle = await promise;
    expect(handle.info.url).toBe("https://myapp-a1b2c3.proxy.example.com");
    expect(calls[0]).toEqual(["expose", "--with-name-prefix", "myapp", "4567"]);
  });

  it("kills the child when stopped", async () => {
    const fake = new FakeProcess();
    const promise = startNetbirdExpose(4567, { spawner: () => fake });
    fake.emitStdout(SUCCESS_OUTPUT);

    stopNetbirdExpose(await promise);

    expect(fake.killed).toBe(true);
    expect(fake.killSignal).toBe("SIGTERM");
  });

  it("rejects and kills the child on timeout", async () => {
    const fake = new FakeProcess();
    const promise = startNetbirdExpose(4567, { spawner: () => fake, timeoutMs: 10 });

    await expect(promise).rejects.toThrow("Timed out waiting for netbird expose");
    expect(fake.killed).toBe(true);
  });
});
