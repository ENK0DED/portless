import { GEIST_SANS_400, GEIST_SANS_500, GEIST_MONO_400, GEIST_PIXEL } from "./fonts.js";
import { escapeHtml } from "./utils.js";

// ---------------------------------------------------------------------------
// Inline icons
//
// Every page served by the proxy must render with zero external requests, so
// icons are tiny inline SVGs that inherit `currentColor`. Keep them stroke
// based and on a 16px viewbox to match the existing arrow.
// ---------------------------------------------------------------------------

export const ARROW_SVG =
  '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M6.5 3.5L11 8l-4.5 4.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

export const BACK_SVG =
  '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M12.5 8H4.5M8 4 4 8l4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

export const LOCK_SVG =
  '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="3" y="7" width="10" height="6.5" rx="1.5" stroke="currentColor" stroke-width="1.5"/><path d="M5 7V5a3 3 0 0 1 6 0v2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';

export const CHECK_SVG =
  '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3.5 8.5l3 3 6-6.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

export const DOWNLOAD_SVG =
  '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 2.5v7m0 0L5 6.5m3 3l3-3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 11.5v1A1.5 1.5 0 0 0 4.5 14h7a1.5 1.5 0 0 0 1.5-1.5v-1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';

export const COPY_SVG =
  '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="5.5" y="5.5" width="8" height="8" rx="1.5" stroke="currentColor" stroke-width="1.4"/><path d="M3.5 10.5A1.5 1.5 0 0 1 2.5 9V3.5A1.5 1.5 0 0 1 4 2h5.5a1.5 1.5 0 0 1 1.5 1" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>';

export const GLOBE_SVG =
  '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="5.75" stroke="currentColor" stroke-width="1.3"/><path d="M2.5 8h11M8 2.25c1.6 1.6 2.4 3.6 2.4 5.75S9.6 12.15 8 13.75C6.4 12.15 5.6 10.15 5.6 8S6.4 3.85 8 2.25z" stroke="currentColor" stroke-width="1.3"/></svg>';

export const X_SVG =
  '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';

export const LAYERS_SVG =
  '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 2.2 2 5.4 8 8.6l6-3.2z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M2.5 8.7 8 11.7l5.5-3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>';

// ---------------------------------------------------------------------------
// Shared stylesheet
//
// This is the single source of truth for the portless browser design system.
// Every proxy-served surface (error pages, the dashboard, the certificate
// trust page, the multiplexed app picker) renders through `renderShell` and
// reuses these tokens and components so the whole product reads as one piece.
// See DESIGN.md for the rationale behind each token.
// ---------------------------------------------------------------------------

const PAGE_STYLES = `
  @font-face {
    font-family: 'Geist';
    src: url('${GEIST_SANS_400}') format('woff2');
    font-weight: 400;
    font-display: swap;
  }
  @font-face {
    font-family: 'Geist';
    src: url('${GEIST_SANS_500}') format('woff2');
    font-weight: 500;
    font-display: swap;
  }
  @font-face {
    font-family: 'Geist Mono';
    src: url('${GEIST_MONO_400}') format('woff2');
    font-weight: 400;
    font-display: swap;
  }
  @font-face {
    font-family: 'Geist Pixel';
    src: url('${GEIST_PIXEL}') format('woff2');
    font-weight: 400;
    font-display: swap;
  }
  *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
  :root {
    --bg: #fff;
    --fg: #171717;
    --border: #eaeaea;
    --border-strong: #d4d4d4;
    --surface: #fafafa;
    --surface-2: #f4f4f4;
    --text-2: #666;
    --text-3: #767676;
    --accent: #0070f3;
    --accent-fg: #fff;
    --accent-weak: rgba(0,112,243,0.10);
    --ok: #1a7f37;
    --ok-weak: rgba(26,127,55,0.11);
    --warn: #9a6700;
    --warn-weak: rgba(154,103,0,0.12);
    --warn-border: rgba(154,103,0,0.30);
    --danger: #cf222e;
    --danger-weak: rgba(207,34,46,0.10);
    /* "Inactive" status badge — a rose so the not-selected app reads at a glance. */
    --idle: #c0344e;
    --idle-weak: rgba(192,52,78,0.10);
    --font-sans: 'Geist', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
    --font-mono: 'Geist Mono', 'SFMono-Regular', Menlo, Monaco, Consolas, monospace;
    --radius: 12px;
    --radius-sm: 8px;
    --ease: cubic-bezier(0.22, 1, 0.36, 1);
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #000;
      --fg: #ededed;
      --border: rgba(255,255,255,0.1);
      --border-strong: rgba(255,255,255,0.2);
      --surface: #111;
      --surface-2: #161616;
      --text-2: #8f8f8f;
      --text-3: #949494;
      --accent: #3291ff;
      --accent-fg: #001;
      --accent-weak: rgba(50,145,255,0.14);
      --ok: #3fb950;
      --ok-weak: rgba(63,185,80,0.15);
      --warn: #d29922;
      --warn-weak: rgba(210,153,34,0.15);
      --warn-border: rgba(210,153,34,0.35);
      --danger: #f85149;
      --danger-weak: rgba(248,81,73,0.15);
      --idle: #f7768e;
      --idle-weak: rgba(247,118,142,0.16);
    }
  }
  html { height: 100%; }
  body {
    font-family: var(--font-sans);
    background: var(--bg);
    color: var(--fg);
    min-height: 100%;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }
  a { color: inherit; }
  .page {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 48px 24px;
  }
  .page.page-top { justify-content: flex-start; padding-top: clamp(48px, 12vh, 128px); }

  /* Hero -------------------------------------------------------------------- */
  .hero {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
  }
  .hero h1 {
    font-family: 'Geist Pixel', var(--font-mono);
    font-size: clamp(80px, 15vw, 144px);
    font-weight: 400;
    line-height: 1;
    letter-spacing: -0.04em;
    color: var(--fg);
  }
  .hero h2 {
    font-size: 13px;
    font-weight: 400;
    color: var(--text-3);
    margin-top: 16px;
    text-transform: uppercase;
    letter-spacing: 0.15em;
  }
  .wordmark {
    font-family: 'Geist Pixel', var(--font-mono);
    font-size: clamp(40px, 8vw, 64px);
    font-weight: 400;
    line-height: 1;
    letter-spacing: -0.03em;
    color: var(--fg);
  }
  .wordmark .dot { color: var(--accent); }

  /* Content column ---------------------------------------------------------- */
  .content {
    margin-top: 56px;
    width: 100%;
    max-width: 480px;
  }
  .content.wide { max-width: 640px; }
  .desc {
    font-size: 14px;
    color: var(--text-2);
    text-align: center;
    line-height: 1.7;
    text-wrap: pretty;
  }
  .desc strong {
    color: var(--fg);
    font-weight: 500;
  }
  .desc code, .inline-code {
    font-family: var(--font-mono);
    font-size: 0.92em;
    background: var(--surface-2);
    border-radius: 5px;
    padding: 1px 5px;
  }
  .section { margin-top: 32px; }
  .label {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    font-weight: 500;
    color: var(--text-3);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    margin-bottom: 10px;
  }
  .count {
    font-variant-numeric: tabular-nums;
    font-size: 11px;
    letter-spacing: 0;
    color: var(--text-2);
    background: var(--surface-2);
    border-radius: 999px;
    padding: 1px 8px;
  }

  /* Card list (app rows) ---------------------------------------------------- */
  .card {
    list-style: none;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    overflow: hidden;
  }
  .card > li { border-bottom: 1px solid var(--border); }
  .card > li:last-child { border-bottom: none; }
  /*
   * App row — the single reference row used by the dashboard, the app picker,
   * and the 404 page. Two lines inside one hovering entry: the top line holds
   * the name, the other badges, and the open arrow; the line below holds the
   * status badge and the Copy URL button. The whole entry links to its target
   * via a stretched link (.app-link::after); badges take pointer events (so
   * their tooltips and pointer cursor work) and a script forwards non-link
   * badge clicks back to the row link.
   */
  .app-item {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 12px 16px;
    transition: background 0.15s var(--ease);
  }
  .app-item:hover, .app-item:focus-within { background: var(--surface); }
  .app-item:focus-within { outline: 2px solid var(--accent); outline-offset: -2px; }
  .app-main { display: flex; align-items: center; gap: 10px; }
  .app-link {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
    text-decoration: none;
    color: inherit;
  }
  .app-link::after { content: ""; position: absolute; inset: 0; }
  .app-link:focus { outline: none; }
  .app-name {
    font-size: 14px;
    font-weight: 500;
    word-break: break-all;
    transition: color 0.15s var(--ease);
  }
  .app-item:hover .app-name { color: var(--accent); }
  .app-sub {
    font-size: 12px;
    color: var(--text-3);
    font-family: var(--font-mono);
    word-break: break-all;
  }
  /*
   * Badge rows sit above the stretched link. The rows are click-through (gaps
   * fall to the row link); badges and the copy button take pointer events so
   * their tooltips and cursor work, and a script forwards non-link badge clicks
   * back to the row link.
   */
  .app-extras, .app-actions {
    position: relative;
    z-index: 1;
    pointer-events: none;
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    justify-content: flex-end;
  }
  .app-extras:empty, .app-actions:empty { display: none; }
  /* Second line: status badge on the left, Copy URL button on the right. */
  .app-actions { justify-content: space-between; }
  .app-extras .badge, .app-actions .badge, .app-copy { pointer-events: auto; }
  .app-extras a.badge:hover, .app-actions a.badge:hover { filter: brightness(1.06); }
  .app-arrow {
    color: var(--text-3);
    display: flex;
    flex-shrink: 0;
    transition: transform 0.2s var(--ease), color 0.2s var(--ease);
  }
  .app-item:hover .app-arrow { transform: translateX(2px); color: var(--text-2); }
  .app-copy {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 24px;
    padding: 0 10px;
    font-family: var(--font-sans);
    font-size: 11px;
    color: var(--text-3);
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 7px;
    cursor: pointer;
    white-space: nowrap;
    transition: color 0.15s var(--ease), border-color 0.15s var(--ease);
  }
  .app-copy:hover { color: var(--fg); border-color: var(--border-strong); }
  .app-copy:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .app-copy svg { width: 13px; height: 13px; }
  .app-copy.copied { color: var(--ok); border-color: var(--ok); }

  /* Badges ------------------------------------------------------------------ */
  .badge {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: 24px;
    font-family: var(--font-sans);
    font-size: 11px;
    font-weight: 500;
    line-height: 1;
    padding: 0 9px;
    border-radius: 999px;
    letter-spacing: 0.02em;
    white-space: nowrap;
    text-decoration: none;
    cursor: pointer;
  }
  .badge svg { width: 12px; height: 12px; }
  .badge-ok { color: var(--ok); background: var(--ok-weak); }
  .badge-warn { color: var(--warn); background: var(--warn-weak); }
  .badge-danger { color: var(--danger); background: var(--danger-weak); }
  .badge-accent { color: var(--accent); background: var(--accent-weak); }
  .badge-muted { color: var(--text-3); background: var(--surface-2); }
  .badge-idle { color: var(--idle); background: var(--idle-weak); }

  /* Certificate row — the whole row links to the trust page, with the same
     hover treatment as the app list rows. */
  .kv > li.kv-link { padding: 0; display: block; }
  .kv-link > a {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 12px 16px;
    text-decoration: none;
    color: inherit;
    transition: background 0.15s var(--ease);
  }
  .kv-link > a:hover { background: var(--surface); }
  .kv-link > a:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
  .kv-link .v { display: inline-flex; align-items: center; gap: 8px; }
  .kv-link .arrow {
    color: var(--text-3);
    display: flex;
    transition: transform 0.2s var(--ease), color 0.2s var(--ease);
  }
  .kv-link > a:hover .arrow { transform: translateX(2px); color: var(--text-2); }
  .kv-link > a:hover .badge { filter: brightness(1.06); }

  /* Buttons ----------------------------------------------------------------- */
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    font-family: var(--font-sans);
    font-size: 14px;
    font-weight: 500;
    line-height: 1;
    padding: 11px 18px;
    border-radius: var(--radius-sm);
    border: 1px solid transparent;
    background: var(--accent);
    color: var(--accent-fg);
    text-decoration: none;
    cursor: pointer;
    transition: filter 0.15s var(--ease), background 0.15s var(--ease), border-color 0.15s var(--ease);
  }
  .btn:hover { filter: brightness(1.08); }
  .btn:active { filter: brightness(0.96); }
  .btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .btn-ghost {
    background: transparent;
    color: var(--fg);
    border-color: var(--border-strong);
  }
  .btn-ghost:hover { background: var(--surface); filter: none; }
  .btn-row { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 8px; }
  .back-btn svg { transition: transform 0.2s var(--ease); }
  .back-btn:hover svg { transform: translateX(-2px); }

  /* Terminal / command block ------------------------------------------------ */
  .terminal {
    position: relative;
    font-family: var(--font-mono);
    font-size: 13px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 14px 20px;
    line-height: 1.7;
    color: var(--fg);
    word-break: break-word;
  }
  .terminal .prompt {
    color: var(--text-3);
    user-select: none;
  }
  pre.terminal { white-space: pre-wrap; }
  .copy-btn {
    position: absolute;
    top: 8px;
    right: 8px;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-family: var(--font-sans);
    font-size: 11px;
    color: var(--text-3);
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 4px 8px;
    cursor: pointer;
    opacity: 0;
    transition: opacity 0.15s var(--ease), color 0.15s var(--ease);
  }
  .terminal:hover .copy-btn, .copy-btn:focus-visible { opacity: 1; }
  .copy-btn:hover { color: var(--fg); }
  .copy-btn svg { width: 13px; height: 13px; }
  .copy-btn.copied { color: var(--ok); border-color: var(--ok); }

  /* Key/value detail rows --------------------------------------------------- */
  .kv {
    list-style: none;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    overflow: hidden;
  }
  .kv > li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 12px 16px;
    border-bottom: 1px solid var(--border);
    font-size: 13px;
  }
  .kv > li:last-child { border-bottom: none; }
  .kv .k { color: var(--text-3); white-space: nowrap; }
  .kv .v { font-family: var(--font-mono); color: var(--fg); text-align: right; word-break: break-all; }
  .kv .v.fp { word-break: normal; overflow-wrap: anywhere; text-wrap: balance; }

  /* Steps (ordered instructions) ------------------------------------------- */
  .steps { list-style: none; counter-reset: step; display: flex; flex-direction: column; gap: 14px; }
  .steps > li {
    counter-increment: step;
    display: grid;
    grid-template-columns: 24px 1fr;
    gap: 12px;
    align-items: start;
  }
  .steps > li::before {
    content: counter(step);
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border-radius: 999px;
    background: var(--surface-2);
    color: var(--fg);
    font-size: 12px;
    font-weight: 500;
    font-variant-numeric: tabular-nums;
  }
  .steps .step-body {
    font-size: 14px;
    color: var(--text-2);
    line-height: 1.6;
    padding-top: 2px;
    text-wrap: pretty;
  }
  .steps strong { color: var(--fg); font-weight: 500; }

  /* CSS-only tabs (OS selector) -------------------------------------------- */
  .tabs input { position: absolute; opacity: 0; pointer-events: none; }
  .tablist { display: flex; gap: 4px; padding: 4px; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-sm); }
  .tablist label {
    flex: 1;
    text-align: center;
    font-size: 13px;
    font-weight: 500;
    color: var(--text-2);
    padding: 8px 10px;
    border-radius: 6px;
    cursor: pointer;
    transition: background 0.15s var(--ease), color 0.15s var(--ease);
  }
  .tablist label:hover { color: var(--fg); }
  .tabpanel { display: none; margin-top: 20px; }
  .tabs #os-mac:checked ~ .tablist label[for="os-mac"],
  .tabs #os-linux:checked ~ .tablist label[for="os-linux"],
  .tabs #os-win:checked ~ .tablist label[for="os-win"],
  .tabs #os-ff:checked ~ .tablist label[for="os-ff"] {
    background: var(--bg);
    color: var(--fg);
    box-shadow: 0 1px 2px rgba(0,0,0,0.06);
  }
  .tabs #os-mac:checked ~ .panels #panel-mac,
  .tabs #os-linux:checked ~ .panels #panel-linux,
  .tabs #os-win:checked ~ .panels #panel-win,
  .tabs #os-ff:checked ~ .panels #panel-ff { display: block; }
  .tabs label:focus-within { outline: 2px solid var(--accent); outline-offset: 2px; }

  /* Callout ----------------------------------------------------------------- */
  .callout {
    display: flex;
    gap: 10px;
    font-size: 13px;
    line-height: 1.6;
    color: var(--text-2);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 12px 14px;
  }
  .callout.warn { background: var(--warn-weak); border-color: var(--warn-border); color: var(--warn); margin-top: 28px; }
  .callout strong { color: var(--fg); font-weight: 500; }
  .callout.warn strong { color: var(--warn); }

  .empty {
    font-size: 14px;
    color: var(--text-3);
    text-align: center;
    padding: 32px 0;
  }
  .center { text-align: center; }

  /* Footer ------------------------------------------------------------------ */
  .footer {
    margin-top: 64px;
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 11px;
    color: var(--text-3);
    font-family: var(--font-mono);
    letter-spacing: 0.08em;
  }
  .footer a { color: var(--text-3); text-decoration: none; transition: color 0.15s var(--ease); }
  .footer a:hover { color: var(--text-2); }
  .footer .sep { opacity: 0.5; }

  @media (prefers-reduced-motion: reduce) {
    * { transition: none !important; animation: none !important; }
  }
`;

// ---------------------------------------------------------------------------
// Shell + hero
// ---------------------------------------------------------------------------

interface ShellOptions {
  title: string;
  hero: string;
  body: string;
  /** Anchor content to the top instead of vertically centering (long pages). */
  top?: boolean;
  /** Optional inline footer links rendered after the wordmark. */
  footerLinks?: string;
  /** Optional inline script appended before </body> (must be self-contained). */
  script?: string;
}

/** Render the shared HTML document used by every proxy-served page. */
export function renderShell(opts: ShellOptions): string {
  const footerLinks = opts.footerLinks ? `<span class="sep">·</span>${opts.footerLinks}` : "";
  const script = opts.script ? `<script>${opts.script}</script>` : "";
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="robots" content="noindex">
<title>${opts.title}</title>
<style>${PAGE_STYLES}</style>
</head>
<body>
<div class="page${opts.top ? " page-top" : ""}">
${opts.hero}
${opts.body}
<p class="footer"><a href="https://github.com/ENK0DED/portless">portless</a>${footerLinks}</p>
</div>
${script}
</body>
</html>`;
}

/** Big status-numeral hero used by error pages (404 / 502 / 508). */
export function renderNumeralHero(status: number, statusText: string): string {
  return `<div class="hero"><h1>${status}</h1><h2>${statusText}</h2></div>`;
}

/** Wordmark hero used by the dashboard / certificate pages. */
export function renderWordmarkHero(subtitle: string): string {
  return `<div class="hero"><div class="wordmark">portless<span class="dot">.</span></div><h2>${subtitle}</h2></div>`;
}

/**
 * Render a standard portless error/status page.
 *
 * The proxy calls this for the 404 not-found, 502 bad-gateway, and 508
 * loop-detected responses. Pass APP_SCRIPT as `script` when the body contains
 * app rows (the 404 app list) so copy buttons and row navigation work.
 */
export function renderPage(
  status: number,
  statusText: string,
  body: string,
  script?: string
): string {
  return renderShell({
    title: `${status} - ${statusText}`,
    hero: renderNumeralHero(status, statusText),
    body,
    ...(script ? { script } : {}),
  });
}

// ---------------------------------------------------------------------------
// App row — the single reference row component
//
// One row design, used by the dashboard, the app picker, and the 404 page.
// The whole row links to `href` (stretched over the row to its border); the
// optional copy button and any link badges remain individually clickable.
// ---------------------------------------------------------------------------

/**
 * Shared client script for app-row pages. Two jobs in one delegated listener:
 *  - copy buttons (`[data-copy]`) write to the clipboard;
 *  - because badges are pointer-events:auto (so their title tooltips work), a
 *    click anywhere in a row that isn't a link or button forwards to the row's
 *    link, keeping the whole row navigable. No-JS clicks on non-badge areas
 *    still work via the stretched `.app-link::after`.
 */
export const APP_SCRIPT = `
document.addEventListener('click',function(e){
  var b=e.target.closest('[data-copy]');
  if(b){
    if(navigator.clipboard)navigator.clipboard.writeText(b.getAttribute('data-copy')).then(function(){
      var l=b.querySelector('.copy-label');if(!l)return;
      var p=l.textContent;l.textContent='Copied';b.classList.add('copied');
      setTimeout(function(){l.textContent=p;b.classList.remove('copied');},1200);
    }).catch(function(){});
    return;
  }
  if(e.target.closest('a,button'))return;
  var item=e.target.closest('.app-item');
  if(item){var link=item.querySelector('.app-link');if(link)link.click();}
});`;

export interface AppRowBadge {
  /** ok | warn | danger | accent | muted | idle */
  variant: string;
  label: string;
  /** Raw inline SVG, optional. */
  icon?: string;
  /** When set, the badge is a link (kept clickable above the row link). */
  href?: string;
  /** Tooltip text (e.g. to explain a multiplex label). */
  title?: string;
}

export interface AppRowOptions {
  name: string;
  sub?: string;
  href: string;
  /** Open the row link in a new tab (dashboard / 404); omit for in-page nav (picker). */
  newTab?: boolean;
  /**
   * Status pill, rendered last (its own aligned column): a green "Active" or a
   * slate "Inactive".
   */
  status?: "active" | "inactive";
  badges?: AppRowBadge[];
  /** When set, renders a "Copy URL" button (requires APP_SCRIPT on the page). */
  copyUrl?: string;
}

function renderBadge(b: AppRowBadge): string {
  const inner = `${b.icon ?? ""}${escapeHtml(b.label)}`;
  const title = b.title ? ` title="${escapeHtml(b.title)}"` : "";
  return b.href
    ? `<a class="badge badge-${b.variant}" href="${escapeHtml(b.href)}" target="_blank" rel="noopener"${title}>${inner}</a>`
    : `<span class="badge badge-${b.variant}"${title}>${inner}</span>`;
}

/** Render one app row. The single reference design shared across pages. */
export function appRow(o: AppRowOptions): string {
  const badgesHtml = (o.badges ?? []).map(renderBadge).join("");
  const status =
    o.status === "active"
      ? renderBadge({ variant: "ok", label: "Active", icon: CHECK_SVG })
      : o.status === "inactive"
        ? renderBadge({ variant: "idle", label: "Inactive", icon: X_SVG })
        : "";
  const copy = o.copyUrl
    ? `<button class="app-copy" type="button" data-copy="${escapeHtml(o.copyUrl)}" aria-label="Copy URL">${COPY_SVG}<span class="copy-label">Copy URL</span></button>`
    : "";

  const target = o.newTab ? ' target="_blank" rel="noopener"' : "";
  const sub = o.sub ? `<span class="app-sub">${escapeHtml(o.sub)}</span>` : "";

  // Top line: name + other badges + arrow. Second line (inside the same entry):
  // the status badge and the Copy URL button.
  return `<li class="app-item">
  <div class="app-main">
    <a class="app-link" href="${escapeHtml(o.href)}"${target}><span class="app-name">${escapeHtml(o.name)}</span>${sub}</a>
    <span class="app-extras">${badgesHtml}</span>
    <span class="app-arrow">${ARROW_SVG}</span>
  </div>
  <div class="app-actions">${status}${copy}</div>
</li>`;
}

/** Wrap app rows in the bordered card list. */
export function appList(rows: string[]): string {
  return `<ul class="card app-list">${rows.join("")}</ul>`;
}
