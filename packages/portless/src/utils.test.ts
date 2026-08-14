import { afterEach, describe, it, expect, vi } from "vitest";
import {
  assertRegistrablePathPrefix,
  escapeHtml,
  formatUrl,
  isErrnoException,
  matchesPathPrefix,
  normalizePathPrefix,
  parseHostname,
  parseHostnames,
  resolveUserHome,
} from "./utils.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("resolveUserHome", () => {
  it("uses the invoking user's home under sudo", () => {
    expect(
      resolveUserHome({
        platform: "linux",
        env: { SUDO_USER: "alice", HOME: "/root" },
        homedir: "/root",
        passwdHome: () => "/home/alice",
      })
    ).toBe("/home/alice");
  });

  it("keeps a preserved non-root home under sudo", () => {
    expect(
      resolveUserHome({
        platform: "darwin",
        env: { SUDO_USER: "alice", HOME: "/Users/alice" },
        homedir: "/var/root",
      })
    ).toBe("/Users/alice");
  });

  it("uses the effective user's home without sudo", () => {
    expect(
      resolveUserHome({
        platform: "linux",
        env: { HOME: "/root" },
        homedir: "/root",
      })
    ).toBe("/root");
  });

  it("falls back to the platform convention when passwd lookup fails", () => {
    expect(
      resolveUserHome({
        platform: "linux",
        env: { SUDO_USER: "alice", HOME: "/root" },
        homedir: "/root",
        passwdHome: () => null,
      })
    ).toBe("/home/alice");
  });
});

describe("escapeHtml", () => {
  it("escapes angle brackets", () => {
    expect(escapeHtml("<script>alert(1)</script>")).toBe("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("escapes ampersands", () => {
    expect(escapeHtml("foo & bar")).toBe("foo &amp; bar");
  });

  it("escapes quotes", () => {
    expect(escapeHtml("\"hello\" & 'world'")).toBe("&quot;hello&quot; &amp; &#39;world&#39;");
  });

  it("returns empty string unchanged", () => {
    expect(escapeHtml("")).toBe("");
  });

  it("leaves safe text unchanged", () => {
    expect(escapeHtml("hello world")).toBe("hello world");
  });
});

describe("isErrnoException", () => {
  it("returns true for a Node.js system error", () => {
    const err = new Error("fail") as NodeJS.ErrnoException;
    err.code = "ENOENT";
    expect(isErrnoException(err)).toBe(true);
  });

  it("returns false for a plain Error without code", () => {
    expect(isErrnoException(new Error("plain"))).toBe(false);
  });

  it("returns false for a string", () => {
    expect(isErrnoException("something")).toBe(false);
  });

  it("returns false for null", () => {
    expect(isErrnoException(null)).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(isErrnoException(undefined)).toBe(false);
  });

  it("returns false for a plain object with code", () => {
    expect(isErrnoException({ code: "ENOENT", message: "fail" })).toBe(false);
  });

  it("returns false for an Error with a non-string code", () => {
    const err = new Error("fail");
    (err as unknown as Record<string, unknown>).code = 42;
    expect(isErrnoException(err)).toBe(false);
  });
});

describe("formatUrl", () => {
  it("omits port for standard HTTP port (80)", () => {
    expect(formatUrl("myapp.localhost", 80)).toBe("http://myapp.localhost");
  });

  it("includes port for non-standard ports", () => {
    expect(formatUrl("myapp.localhost", 1355)).toBe("http://myapp.localhost:1355");
    expect(formatUrl("myapp.localhost", 8080)).toBe("http://myapp.localhost:8080");
    expect(formatUrl("myapp.localhost", 3000)).toBe("http://myapp.localhost:3000");
  });

  it("appends non-root route path prefixes", () => {
    expect(formatUrl("myapp.localhost", 1355, false, "/api")).toBe(
      "http://myapp.localhost:1355/api"
    );
    expect(formatUrl("myapp.localhost", 443, true, "/docs/v1")).toBe(
      "https://myapp.localhost/docs/v1"
    );
  });
});

describe("normalizePathPrefix", () => {
  it.each([
    [undefined, "/"],
    ["/", "/"],
    ["/api", "/api"],
    ["/docs/v1", "/docs/v1"],
    ["/api///", "/api"],
  ] as const)("normalizes %s to %s", (input, expected) => {
    expect(normalizePathPrefix(input)).toBe(expected);
  });

  it.each(["", "   ", "api", "?x=1", "/api?x=1", "/api#frag", "/api\nv1"])(
    "rejects invalid path prefix %s",
    (input) => {
      expect(() => normalizePathPrefix(input)).toThrow("Invalid path prefix");
    }
  );
});

describe("assertRegistrablePathPrefix", () => {
  it.each([
    "/",
    "/api",
    "/api/",
    "/docs/v1",
    "/v1.0",
    "/caf%C3%A9",
    "/~user",
    "/a:b@c",
    "/a,b;c=d",
    "/!$&'()*+",
    "/encoded%20space",
  ])("accepts the registrable prefix %s", (prefix) => {
    expect(() => assertRegistrablePathPrefix(prefix)).not.toThrow();
  });

  it.each([
    ["", "must start with /"],
    ["api", "must start with /"],
    ["/a b", "space"],
    ["/a\tb", "control character"],
    ["/a?b", "query delimiter"],
    ["/a#b", "fragment delimiter"],
    ["/a\\b", "backslash"],
    ["/a//b", "empty path segment"],
    ["/a/./b", '"." path segment'],
    ["/a/../b", '".." path segment'],
    ["/a%", "malformed percent escape"],
    ["/a%2", "malformed percent escape"],
    ["/a%GG", "malformed percent escape"],
    ["/a%2Fb", "percent-encoded slash"],
    ["/a%2eb", "percent-encoded dot"],
    ["/a[b", 'character "["'],
  ])("rejects %s because it contains an offending construct", (prefix, reason) => {
    expect(() => assertRegistrablePathPrefix(prefix)).toThrow(reason);
  });

  it("tells users how to encode a non-ASCII prefix", () => {
    expect(() => assertRegistrablePathPrefix("/café")).toThrow('use "/caf%C3%A9"');
  });
});

describe("matchesPathPrefix", () => {
  it("matches root against all request paths", () => {
    expect(matchesPathPrefix("/", "/")).toBe(true);
    expect(matchesPathPrefix("/api", "/")).toBe(true);
  });

  it("matches exact prefixes and child segments", () => {
    expect(matchesPathPrefix("/api", "/api")).toBe(true);
    expect(matchesPathPrefix("/api/users", "/api")).toBe(true);
    expect(matchesPathPrefix("/api/users?active=1", "/api")).toBe(true);
  });

  it("does not match partial path segments", () => {
    expect(matchesPathPrefix("/api-v2", "/api")).toBe(false);
    expect(matchesPathPrefix("/apis", "/api")).toBe(false);
  });
});

describe("parseHostname", () => {
  it("appends .localhost to simple name", () => {
    expect(parseHostname("myapp")).toBe("myapp.localhost");
  });

  it("preserves existing .localhost suffix", () => {
    expect(parseHostname("myapp.localhost")).toBe("myapp.localhost");
  });

  it("strips http:// protocol", () => {
    expect(parseHostname("http://myapp")).toBe("myapp.localhost");
  });

  it("strips https:// protocol", () => {
    expect(parseHostname("https://myapp")).toBe("myapp.localhost");
  });

  it("strips path after hostname", () => {
    expect(parseHostname("myapp/some/path")).toBe("myapp.localhost");
  });

  it("strips protocol and path", () => {
    expect(parseHostname("http://myapp.localhost/path")).toBe("myapp.localhost");
  });

  it("converts to lowercase", () => {
    expect(parseHostname("MyApp")).toBe("myapp.localhost");
  });

  it("handles subdomain-style names", () => {
    expect(parseHostname("api.myapp")).toBe("api.myapp.localhost");
  });

  it("handles hyphens", () => {
    expect(parseHostname("my-app")).toBe("my-app.localhost");
  });

  it("throws on empty input", () => {
    expect(() => parseHostname("")).toThrow("Hostname cannot be empty");
  });

  it("throws on whitespace-only input", () => {
    expect(() => parseHostname("   ")).toThrow("Hostname cannot be empty");
  });

  it("throws on invalid characters", () => {
    expect(() => parseHostname("my app")).toThrow("Invalid hostname");
  });

  it("throws on hostname starting with hyphen", () => {
    expect(() => parseHostname("-myapp")).toThrow("Invalid hostname");
  });

  it("throws on hostname ending with hyphen", () => {
    expect(() => parseHostname("myapp-")).toThrow("Invalid hostname");
  });

  it("throws on special characters", () => {
    expect(() => parseHostname("my@app")).toThrow("Invalid hostname");
  });

  it("throws on consecutive dots", () => {
    expect(() => parseHostname("my..app")).toThrow("consecutive dots are not allowed");
  });

  it("accepts numeric hostnames", () => {
    expect(parseHostname("123")).toBe("123.localhost");
  });

  it("handles protocol with .localhost already present", () => {
    expect(parseHostname("https://test.localhost")).toBe("test.localhost");
  });

  it("throws on label exceeding 63 characters", () => {
    const longLabel = "a".repeat(64);
    expect(() => parseHostname(longLabel)).toThrow("exceeds 63-character DNS limit");
  });

  it("accepts label at exactly 63 characters", () => {
    const label63 = "a".repeat(63);
    expect(parseHostname(label63)).toBe(`${label63}.localhost`);
  });

  it("throws when any label in multi-part hostname exceeds 63 characters", () => {
    const longLabel = "a".repeat(64);
    expect(() => parseHostname(`prefix.${longLabel}`)).toThrow("exceeds 63-character DNS limit");
  });

  describe("custom TLD", () => {
    it("appends custom TLD suffix", () => {
      expect(parseHostname("myapp", "test")).toBe("myapp.test");
    });

    it("preserves existing custom TLD suffix", () => {
      expect(parseHostname("myapp.test", "test")).toBe("myapp.test");
    });

    it("strips .localhost suffix when using a different TLD", () => {
      expect(parseHostname("myapp.localhost", "test")).toBe("myapp.test");
    });

    it("strips .localhost subsuffix when using a different TLD", () => {
      expect(parseHostname("api.myapp.localhost", "test")).toBe("api.myapp.test");
    });

    it("handles subdomain with custom TLD", () => {
      expect(parseHostname("api.myapp", "test")).toBe("api.myapp.test");
    });

    it("handles multi-segment custom TLDs", () => {
      expect(parseHostname("myapp", "local.example.dev")).toBe("myapp.local.example.dev");
      expect(parseHostname("api.myapp", "local.example.dev")).toBe("api.myapp.local.example.dev");
      expect(parseHostname("myapp.local.example.dev", "local.example.dev")).toBe(
        "myapp.local.example.dev"
      );
    });

    it("rejects a final hostname over 253 characters", () => {
      const label = "a".repeat(63);
      const tld = [label, label, label, "b".repeat(60)].join(".");
      expect(() => parseHostname("myapp", tld)).toThrow("exceeds 253-character DNS limit");
    });

    it("throws on empty input with custom TLD", () => {
      expect(() => parseHostname("", "test")).toThrow("Hostname cannot be empty");
    });

    it("throws on bare TLD suffix", () => {
      expect(() => parseHostname(".test", "test")).toThrow("Hostname cannot be empty");
    });

    it("validates characters with custom TLD", () => {
      expect(() => parseHostname("my app", "test")).toThrow("Invalid hostname");
    });

    it("works with dev TLD", () => {
      expect(parseHostname("myapp", "dev")).toBe("myapp.dev");
    });

    it("supports dotted suffixes", () => {
      expect(parseHostname("myapp", "acme.com")).toBe("myapp.acme.com");
      expect(parseHostname("myapp.acme.com", "acme.com")).toBe("myapp.acme.com");
    });

    it("supports multi-label suffixes", () => {
      expect(parseHostname("api.myapp", "server01.acme.com")).toBe("api.myapp.server01.acme.com");
    });

    it("treats a bare dotted suffix as empty input", () => {
      expect(() => parseHostname(".acme.com", "acme.com")).toThrow("Hostname cannot be empty");
    });
  });
});

describe("parseHostnames", () => {
  it("builds one hostname per TLD", () => {
    expect(parseHostnames("myapp", ["localhost", "test"])).toEqual([
      "myapp.localhost",
      "myapp.test",
    ]);
  });

  it("strips an active TLD before building all hostnames", () => {
    expect(parseHostnames("api.myapp.test", ["localhost", "test"])).toEqual([
      "api.myapp.localhost",
      "api.myapp.test",
    ]);
  });

  it("strips the longest matching TLD when configured TLDs overlap", () => {
    expect(parseHostnames("app.dev.example.com", ["example.com", "dev.example.com"])).toEqual([
      "app.example.com",
      "app.dev.example.com",
    ]);
  });

  it("deduplicates TLDs", () => {
    expect(parseHostnames("myapp", ["test", "test"])).toEqual(["myapp.test"]);
  });

  it("skips a TLD that pushes the hostname past 253 chars and keeps the rest", () => {
    const label = "a".repeat(62);
    const longTld = [label, label, label, label].join("."); // 251 chars, valid TLD
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(parseHostnames("myapp", ["localhost", longTld])).toEqual(["myapp.localhost"]);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining(longTld));
    } finally {
      warn.mockRestore();
    }
  });

  it("still throws when no TLD survives", () => {
    expect(() => parseHostnames("my..app", ["localhost", "test"])).toThrow(/consecutive dots/);
  });
});
