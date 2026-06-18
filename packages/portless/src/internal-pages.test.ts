import { describe, it, expect } from "vitest";
import {
  renderDashboard,
  renderCertPage,
  renderAppPicker,
  dashboardStateJson,
} from "./internal-pages.js";
import type { RouteInfo } from "./types.js";

describe("renderDashboard", () => {
  const base = {
    proxyPort: 443,
    tls: true,
    suffix: "localhost",
    certHost: "cert.localhost",
    signature: "sig-1",
  };

  it("lists running apps with their ports", () => {
    const routes: RouteInfo[] = [
      { hostname: "web.localhost", port: 4001 },
      { hostname: "api.localhost", port: 4002 },
    ];
    const html = renderDashboard({ ...base, routes, caTrusted: true });
    expect(html).toContain("web.localhost");
    expect(html).toContain("api.localhost");
    expect(html).toContain("127.0.0.1:4001");
    expect(html).toContain("Local dashboard");
    expect(html).toContain("<html");
  });

  it("renders an empty state with a starter command when no apps run", () => {
    const html = renderDashboard({ ...base, routes: [] });
    expect(html).toContain("No apps running");
    expect(html).toContain("portless myapp");
  });

  it("flags publicly-exposed apps with a warning badge and links the public URL", () => {
    const routes: RouteInfo[] = [
      { hostname: "web.localhost", port: 4001, ngrokUrl: "https://abc.ngrok-free.dev" },
    ];
    const html = renderDashboard({ ...base, routes });
    expect(html).toContain("badge-warn");
    expect(html).toContain("https://abc.ngrok-free.dev");
    expect(html).toContain("ngrok");
  });

  it("shows the certificate as trusted or links the trust page", () => {
    const trusted = renderDashboard({ ...base, routes: [], caTrusted: true });
    expect(trusted).toContain("Trusted");

    const untrusted = renderDashboard({ ...base, routes: [], caTrusted: false });
    expect(untrusted).toContain("Set up trust");
    expect(untrusted).toContain("cert.localhost");
  });

  it("uses http scheme for cert link when TLS is off", () => {
    const html = renderDashboard({
      ...base,
      tls: false,
      proxyPort: 80,
      routes: [],
      caTrusted: false,
    });
    expect(html).toContain("http://cert.localhost/");
    expect(html).not.toContain("https://cert.localhost");
  });

  it("escapes HTML in route names to prevent injection", () => {
    const routes: RouteInfo[] = [
      { hostname: 'x"><script>alert(1)</script>.localhost', port: 4000 },
    ];
    const html = renderDashboard({ ...base, routes });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("includes the live-refresh poll and copy handler scripts", () => {
    const html = renderDashboard({ ...base, routes: [] });
    expect(html).toContain("/__portless/state.json");
    expect(html).toContain("clipboard");
  });

  it("lists multiplexed hostnames linking to the picker when a host is shared", () => {
    const routes: RouteInfo[] = [
      { hostname: "app.localhost", port: 4001, label: "main" },
      { hostname: "app.localhost", port: 4002, label: "hotfix" },
      { hostname: "web.localhost", port: 4003 },
    ];
    const html = renderDashboard({ ...base, routes });
    expect(html).toContain("Multiplexed");
    expect(html).toContain("app.localhost/__portless/switch");
  });

  it("omits the multiplexed section when no hostname is shared", () => {
    const html = renderDashboard({
      ...base,
      routes: [{ hostname: "web.localhost", port: 4001 }],
    });
    expect(html).not.toContain("Multiplexed");
  });
});

describe("dashboardStateJson", () => {
  it("emits a parseable snapshot with signature and apps", () => {
    const routes: RouteInfo[] = [
      { hostname: "web.localhost", port: 4001, label: "main" },
      { hostname: "api.localhost", port: 4002, protocol: "h2c" },
    ];
    const parsed = JSON.parse(dashboardStateJson({ routes, signature: "abc" }));
    expect(parsed.signature).toBe("abc");
    expect(parsed.apps).toHaveLength(2);
    expect(parsed.apps[0]).toMatchObject({ name: "web.localhost", port: 4001, label: "main" });
    expect(parsed.apps[1]).toMatchObject({ name: "api.localhost", protocol: "h2c" });
  });
});

describe("renderCertPage", () => {
  it("offers the public CA download and per-OS install steps", () => {
    const html = renderCertPage({
      suffix: "localhost",
      downloadPath: "/portless-ca.pem",
      fingerprint: "AB:CD",
    });
    expect(html).toContain("/portless-ca.pem");
    expect(html).toContain("Download CA certificate");
    expect(html).toContain("macOS");
    expect(html).toContain("Linux");
    expect(html).toContain("Windows");
    expect(html).toContain("Firefox");
    // <wbr> break hints are inserted at colons for balanced wrapping.
    expect(html.replaceAll("<wbr>", "")).toContain("AB:CD");
  });

  it("warns the user before trusting a CA", () => {
    const html = renderCertPage({ suffix: "localhost", downloadPath: "/portless-ca.pem" });
    expect(html).toContain("Only install CA certificates you trust");
  });

  it("shows a prominent back-to-dashboard button when given a dashboard URL", () => {
    const html = renderCertPage({
      suffix: "localhost",
      downloadPath: "/portless-ca.pem",
      dashboardUrl: "https://portless.localhost/",
    });
    expect(html).toContain('href="https://portless.localhost/"');
    expect(html).toContain("Back to dashboard");
  });

  it("never references the CA private key", () => {
    const html = renderCertPage({
      suffix: "localhost",
      downloadPath: "/portless-ca.pem",
      fingerprint: "AB:CD",
    });
    expect(html).not.toContain("ca-key");
    expect(html).not.toContain("PRIVATE KEY");
  });
});

describe("renderAppPicker", () => {
  const pickerBase = {
    suffix: "localhost",
    proxyPort: 443,
    tls: true,
    certHost: "cert.localhost",
    caTrusted: false,
  };

  it("lists members with selection links and marks the active one", () => {
    const html = renderAppPicker({
      ...pickerBase,
      host: "myapp.localhost",
      members: [
        { label: "main", port: 4001 },
        { label: "hotfix", port: 4002 },
      ],
      selectPath: "/__portless/select",
      current: "main",
    });
    expect(html).toContain("myapp.localhost");
    expect(html).toContain("/__portless/select?label=main");
    expect(html).toContain("/__portless/select?label=hotfix");
    expect(html).toContain("Active");
    expect(html).toContain("Choose an app");
  });

  it("includes the proxy info box with a cert link", () => {
    const html = renderAppPicker({
      ...pickerBase,
      host: "myapp.localhost",
      members: [{ label: "main", port: 4001 }],
      selectPath: "/__portless/select",
      current: "main",
    });
    expect(html).toContain("Proxy");
    expect(html).toContain("Certificate");
    expect(html).toContain('class="kv-link"');
    expect(html).toContain("cert.localhost");
  });

  it("encodes labels safely in selection links", () => {
    const html = renderAppPicker({
      ...pickerBase,
      host: "myapp.localhost",
      members: [{ label: "feature/x y", port: 4001 }],
      selectPath: "/__portless/select",
    });
    expect(html).toContain("label=feature%2Fx%20y");
  });
});
