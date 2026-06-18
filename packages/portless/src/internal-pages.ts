import type { RouteInfo } from "./types.js";
import { escapeHtml, formatUrl, normalizePathPrefix } from "./utils.js";
import {
  APP_SCRIPT,
  ARROW_SVG,
  BACK_SVG,
  CHECK_SVG,
  COPY_SVG,
  DOWNLOAD_SVG,
  GLOBE_SVG,
  LAYERS_SVG,
  LOCK_SVG,
  appList,
  appRow,
  renderShell,
  renderWordmarkHero,
  type AppRowBadge,
} from "./pages.js";

// ---------------------------------------------------------------------------
// Internal portless pages served at reserved hostnames:
//   - the dashboard at  portless.<suffix>
//   - the CA trust page at  cert.<suffix>
//   - the multiplexed-host app picker (any host shared by several apps)
//
// Every page goes through renderShell (pages.ts) and uses the shared appRow
// component, so it matches the proxy error pages. See DESIGN.md.
// ---------------------------------------------------------------------------

/** Poll a state signature and refresh when the route table changes. */
function liveRefreshScript(statePath: string, signature: string): string {
  return `
(function(){
  var sig=${JSON.stringify(signature)};
  function tick(){
    if(document.hidden)return;
    fetch(${JSON.stringify(statePath)},{headers:{accept:'application/json'}})
      .then(function(r){return r.ok?r.json():null;})
      .then(function(d){if(d&&d.signature&&d.signature!==sig)location.reload();})
      .catch(function(){});
  }
  setInterval(tick,4000);
})();`;
}

function commandBlock(command: string): string {
  return `<div class="terminal"><span class="prompt">$ </span>${escapeHtml(command)}<button class="copy-btn" type="button" data-copy="${escapeHtml(
    command
  )}" aria-label="Copy command">${COPY_SVG}<span class="copy-label">Copy</span></button></div>`;
}

function badge(variant: string, label: string, icon = ""): string {
  return `<span class="badge badge-${variant}">${icon}${escapeHtml(label)}</span>`;
}

function routeName(route: RouteInfo): string {
  const pathPrefix = normalizePathPrefix(route.pathPrefix);
  return pathPrefix === "/" ? route.hostname : `${route.hostname}${pathPrefix}`;
}

/** Public-exposure entries for a route, used to flag and link shared apps. */
interface Exposure {
  kind: string;
  url?: string;
}

/** Hover explanation for a public-exposure badge. */
function exposureTitle(kind: string): string {
  switch (kind) {
    case "Funnel":
      return "Public on the internet via Tailscale Funnel";
    case "Tailscale":
      return "Shared on your Tailscale network (tailnet)";
    case "Tailscale Service":
      return "Shared as a stable Tailscale Service";
    case "ngrok":
      return "Public on the internet via ngrok";
    case "NetBird":
      return "Public via NetBird Peer Expose";
    default:
      return `Public on the internet via a managed ${kind} tunnel`;
  }
}

function routeExposures(route: RouteInfo): Exposure[] {
  const out: Exposure[] = [];
  if (route.tailscaleFunnel) out.push({ kind: "Funnel", url: route.tailscaleUrl });
  else if (route.tailscaleUrl) out.push({ kind: "Tailscale", url: route.tailscaleUrl });
  if (route.tailscaleServiceUrl)
    out.push({ kind: "Tailscale Service", url: route.tailscaleServiceUrl });
  if (route.ngrokUrl) out.push({ kind: "ngrok", url: route.ngrokUrl });
  if (route.tunnelUrl) {
    const provider = route.tunnelProvider
      ? route.tunnelProvider.charAt(0).toUpperCase() + route.tunnelProvider.slice(1)
      : "Tunnel";
    out.push({ kind: provider, url: route.tunnelUrl });
  }
  if (route.netbirdUrl) out.push({ kind: "NetBird", url: route.netbirdUrl });
  return out;
}

// ---------------------------------------------------------------------------
// Dashboard  (portless.<suffix>)
// ---------------------------------------------------------------------------

export interface DashboardData {
  routes: RouteInfo[];
  proxyPort: number;
  tls: boolean;
  suffix: string;
  /** Whether the local CA is installed in the OS trust store, if known. */
  caTrusted?: boolean;
  /** Reserved hostname of the certificate trust page (cert.<suffix>). */
  certHost: string;
  /** Signature of the current route table for live refresh. */
  signature: string;
}

/**
 * Render one route as the shared app row. Used by the dashboard and the 404
 * page so both show identical buttons (label / h2c / public-exposure badges).
 */
export function renderRouteRow(
  route: RouteInfo,
  opts: { url: string; copyUrl?: string; status?: "active" | "inactive"; newTab?: boolean }
): string {
  const badges: AppRowBadge[] = [];
  if (route.label) {
    badges.push({
      variant: "muted",
      label: route.label,
      icon: LAYERS_SVG,
      title: `Multiplex label — this hostname is shared by several apps; this one is "${route.label}"`,
    });
  }
  if (route.protocol === "h2c") {
    badges.push({
      variant: "accent",
      label: "h2c",
      title: "Forwards to an HTTP/2 cleartext upstream",
    });
  }
  for (const e of routeExposures(route)) {
    badges.push({
      variant: "warn",
      label: e.kind,
      icon: GLOBE_SVG,
      title: exposureTitle(e.kind),
      ...(e.url ? { href: e.url } : {}),
    });
  }
  return appRow({
    name: routeName(route),
    sub: `127.0.0.1:${route.port}`,
    href: opts.url,
    newTab: opts.newTab,
    status: opts.status,
    badges,
    ...(opts.copyUrl ? { copyUrl: opts.copyUrl } : {}),
  });
}

function dashboardAppRows(data: DashboardData): string {
  if (data.routes.length === 0) {
    return `<p class="empty">No apps running yet.</p>${commandBlock("portless myapp -- npm run dev")}`;
  }
  const rows = data.routes
    .slice()
    .sort((a, b) => routeName(a).localeCompare(routeName(b)))
    .map((route) => {
      const url = formatUrl(
        route.hostname,
        data.proxyPort,
        data.tls,
        normalizePathPrefix(route.pathPrefix)
      );
      return renderRouteRow(route, { url, copyUrl: url, status: "active", newTab: true });
    });
  return appList(rows);
}

/** Shared proxy/suffix/certificate info box, used by the dashboard and picker. */
interface ProxyInfo {
  suffix: string;
  proxyPort: number;
  tls: boolean;
  caTrusted?: boolean;
  certHost: string;
}

/** Build the cert page URL for the given proxy settings. */
function certPageUrl(d: ProxyInfo): string {
  const scheme = d.tls ? "https" : "http";
  const portPart = d.proxyPort === (d.tls ? 443 : 80) ? "" : `:${d.proxyPort}`;
  return `${scheme}://${d.certHost}${portPart}/`;
}

function renderProxySection(d: ProxyInfo): string {
  const proto = d.tls ? "HTTPS/2" : "HTTP";
  const listening = d.proxyPort === (d.tls ? 443 : 80) ? proto : `${proto} · port ${d.proxyPort}`;
  // The certificate row is always a link to the trust page — including when the
  // CA is already trusted — with a chevron so it clearly reads as clickable.
  const statusBadge =
    d.caTrusted === undefined
      ? badge("muted", "Set up trust", LOCK_SVG)
      : d.caTrusted
        ? badge("ok", "Trusted", CHECK_SVG)
        : badge("warn", "Set up trust", LOCK_SVG);
  return `<div class="section">
  <p class="label">Proxy</p>
  <ul class="kv">
    <li><span class="k">Suffix</span><span class="v">.${escapeHtml(d.suffix)}</span></li>
    <li><span class="k">Listening</span><span class="v">${escapeHtml(listening)}</span></li>
    <li class="kv-link"><a href="${escapeHtml(certPageUrl(d))}"><span class="k">Certificate</span><span class="v">${statusBadge}<span class="arrow">${ARROW_SVG}</span></span></a></li>
  </ul>
</div>`;
}

/**
 * Group routes into multiplexed hostnames — a hostname + path prefix shared by
 * two or more apps. Each becomes one entry linking to that host's app picker.
 */
function multiplexHosts(routes: RouteInfo[]): { host: string; count: number; labels: string[] }[] {
  const groups = new Map<string, RouteInfo[]>();
  for (const r of routes) {
    const key = `${r.hostname}|${normalizePathPrefix(r.pathPrefix)}`;
    const arr = groups.get(key);
    if (arr) arr.push(r);
    else groups.set(key, [r]);
  }
  const out: { host: string; count: number; labels: string[] }[] = [];
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    out.push({
      host: members[0].hostname,
      count: members.length,
      labels: members.map((m) => m.label).filter((l): l is string => !!l),
    });
  }
  out.sort((a, b) => a.host.localeCompare(b.host));
  return out;
}

function multiplexSection(data: DashboardData): string {
  const hosts = multiplexHosts(data.routes);
  if (hosts.length === 0) return "";
  const rows = hosts.map((m) =>
    appRow({
      name: m.host,
      sub: m.labels.join(" · ") || `${m.count} apps`,
      href: `${formatUrl(m.host, data.proxyPort, data.tls)}/__portless/switch`,
      newTab: true,
      badges: [
        {
          variant: "muted",
          label: `${m.count} apps`,
          icon: LAYERS_SVG,
          title: "Several apps share this hostname — open the app picker to choose",
        },
      ],
    })
  );
  return `<div class="section">
  <p class="label">Multiplexed <span class="count">${hosts.length}</span></p>
  ${appList(rows)}
</div>`;
}

export function renderDashboard(data: DashboardData): string {
  const proxySection = renderProxySection(data);

  const appsSection = `<div class="section">
  <p class="label">Apps <span class="count">${data.routes.length}</span></p>
  ${dashboardAppRows(data)}
</div>`;

  const body = `<div class="content wide">
  <p class="desc">Every local app portless is routing right now. Open one, or copy its URL.</p>
  ${proxySection}
  ${multiplexSection(data)}
  ${appsSection}
</div>`;

  const footerLinks = `<a href="https://portless.sh/commands">docs</a>`;

  return renderShell({
    title: "portless · dashboard",
    hero: renderWordmarkHero("Local dashboard"),
    body,
    top: true,
    footerLinks,
    script: APP_SCRIPT + liveRefreshScript("/__portless/state.json", data.signature),
  });
}

/** Read-only JSON snapshot for the dashboard's live refresh. */
export function dashboardStateJson(data: Pick<DashboardData, "routes" | "signature">): string {
  return JSON.stringify({
    signature: data.signature,
    apps: data.routes.map((r) => ({
      name: routeName(r),
      port: r.port,
      ...(r.label ? { label: r.label } : {}),
      ...(r.protocol && r.protocol !== "http1" ? { protocol: r.protocol } : {}),
      exposures: routeExposures(r).map((e) => e.kind),
    })),
  });
}

// ---------------------------------------------------------------------------
// Certificate trust page  (cert.<suffix>)
// ---------------------------------------------------------------------------

export interface CertPageData {
  suffix: string;
  /** Download path for the public CA certificate (served by the proxy). */
  downloadPath: string;
  /** SHA-256 fingerprint of the CA, shown so users can verify it. */
  fingerprint?: string;
  /** Whether this machine already trusts the CA, if known. */
  trustedHere?: boolean;
  /** URL of the local dashboard, for the back link. */
  dashboardUrl?: string;
}

function osPanel(id: string, steps: string[]): string {
  const items = steps.map((s) => `<li><span class="step-body">${s}</span></li>`).join("");
  return `<div class="tabpanel" id="${id}"><ol class="steps">${items}</ol></div>`;
}

export function renderCertPage(data: CertPageData): string {
  // Add a wrap opportunity after each colon so the long hash balances into
  // even lines (text-wrap: balance) instead of one full line + a short remainder.
  const fpValue = data.fingerprint ? escapeHtml(data.fingerprint).replaceAll(":", ":<wbr>") : "";
  const fp = data.fingerprint
    ? `<ul class="kv"><li><span class="k">SHA-256</span><span class="v fp">${fpValue}</span></li></ul>`
    : "";

  const trustedHere =
    data.trustedHere === true
      ? `<div class="callout"><span class="badge badge-ok">${CHECK_SVG}Trusted</span><span>This browser's machine already trusts the portless CA. New devices still need the steps below.</span></div>`
      : "";

  const download = `<a class="btn" href="${escapeHtml(
    data.downloadPath
  )}" download="portless-ca.pem">${DOWNLOAD_SVG}Download CA certificate</a>`;

  const macSteps = [
    "<strong>Download</strong> the certificate above.",
    "Open it — <strong>Keychain Access</strong> launches. Add it to the <strong>login</strong> keychain.",
    "Find <strong>“portless Local CA”</strong>, open it, expand <strong>Trust</strong>, and set <strong>“When using this certificate”</strong> to <strong>Always Trust</strong>.",
    'Restart your browser. On your own machine, <span class="inline-code">portless trust</span> does all of this for you.',
  ];
  const linuxSteps = [
    "<strong>Download</strong> the certificate above.",
    'Copy it into your trust anchors, e.g. <span class="inline-code">sudo cp portless-ca.pem /usr/local/share/ca-certificates/portless-ca.crt</span>.',
    'Run <span class="inline-code">sudo update-ca-certificates</span> (Debian/Ubuntu) or <span class="inline-code">sudo update-ca-trust</span> (Fedora/Arch/openSUSE).',
    "Firefox keeps its own store — import it under <strong>Settings → Privacy &amp; Security → Certificates → Authorities</strong>.",
  ];
  const winSteps = [
    "<strong>Download</strong> the certificate above.",
    "Double-click it and choose <strong>Install Certificate</strong>.",
    "Select <strong>Current User</strong>, then <strong>Place all certificates in the following store → Trusted Root Certification Authorities</strong>.",
    'Finish and restart your browser. From WSL, <span class="inline-code">portless trust</span> installs into the Windows store automatically.',
  ];
  const ffSteps = [
    "<strong>Download</strong> the certificate above.",
    "Open <strong>Settings → Privacy &amp; Security → Certificates → View Certificates</strong>.",
    "On the <strong>Authorities</strong> tab choose <strong>Import…</strong> and select the file.",
    "Tick <strong>“Trust this CA to identify websites”</strong> and confirm.",
  ];

  const tabs = `<div class="tabs">
  <input type="radio" name="os" id="os-mac" checked>
  <input type="radio" name="os" id="os-linux">
  <input type="radio" name="os" id="os-win">
  <input type="radio" name="os" id="os-ff">
  <div class="tablist" role="tablist">
    <label for="os-mac">macOS</label>
    <label for="os-linux">Linux</label>
    <label for="os-win">Windows</label>
    <label for="os-ff">Firefox</label>
  </div>
  <div class="panels">
    ${osPanel("panel-mac", macSteps)}
    ${osPanel("panel-linux", linuxSteps)}
    ${osPanel("panel-win", winSteps)}
    ${osPanel("panel-ff", ffSteps)}
  </div>
</div>`;

  const backBtn = data.dashboardUrl
    ? `<div class="center" style="margin-bottom:28px"><a class="btn btn-ghost back-btn" href="${escapeHtml(
        data.dashboardUrl
      )}">${BACK_SVG}Back to dashboard</a></div>`
    : "";

  const body = `<div class="content wide">
  ${backBtn}
  <p class="desc">Trust the local <strong>portless</strong> certificate authority so this device shows a green padlock for every <span class="inline-code">.${escapeHtml(
    data.suffix
  )}</span> app over HTTPS. Only the <strong>public</strong> certificate is offered here — the private key never leaves your machine.</p>
  ${trustedHere}
  <div class="section center"><div class="btn-row" style="justify-content:center">${download}</div></div>
  ${fp ? `<div class="section"><p class="label">Verify</p>${fp}</div>` : ""}
  <div class="section"><p class="label">Install</p>${tabs}</div>
  <div class="callout warn"><span>${LOCK_SVG}</span><span><strong>Only install CA certificates you trust.</strong> This authority can vouch for any HTTPS site to this device. Install it solely on machines you control for local development.</span></div>
</div>`;

  return renderShell({
    title: "portless · trust certificate",
    hero: renderWordmarkHero("Certificate authority"),
    body,
    top: true,
    footerLinks: `<a href="https://portless.sh/https">about HTTPS</a>`,
  });
}

// ---------------------------------------------------------------------------
// Multiplexed-host app picker
// ---------------------------------------------------------------------------

export interface AppPickerData extends ProxyInfo {
  host: string;
  /** Live members sharing this hostname. */
  members: { label: string; port: number; protocol?: string }[];
  /** Path that records a selection then redirects (?label=…). */
  selectPath: string;
  /** Currently selected label, if any. */
  current?: string;
}

export function renderAppPicker(data: AppPickerData): string {
  const rows = data.members
    .slice()
    .sort((a, b) => a.label.localeCompare(b.label))
    .map((m) =>
      appRow({
        name: m.label,
        sub: `127.0.0.1:${m.port}`,
        href: `${data.selectPath}?label=${encodeURIComponent(m.label)}`,
        status: m.label === data.current ? "active" : "inactive",
        badges:
          m.protocol === "h2c"
            ? [
                {
                  variant: "accent",
                  label: "h2c",
                  title: "Forwards to an HTTP/2 cleartext upstream",
                },
              ]
            : [],
      })
    );

  const body = `<div class="content">
  <p class="desc">Several apps share <strong>${escapeHtml(
    data.host
  )}</strong>. Pick which one to open — your choice is remembered for this hostname until you switch.</p>
  ${renderProxySection(data)}
  <div class="section"><p class="label">Apps <span class="count">${data.members.length}</span></p>
  ${appList(rows)}</div>
  <p class="desc" style="margin-top:24px;font-size:12px">Switch any time at <span class="inline-code">${escapeHtml(
    data.host
  )}/__portless/switch</span></p>
</div>`;

  return renderShell({
    title: `portless · choose an app`,
    hero: renderWordmarkHero("Choose an app"),
    body,
    top: true,
    script: APP_SCRIPT,
  });
}
