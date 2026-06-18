# Design

Visual system for portless's two UI surfaces: the **proxy-served browser pages**
(`packages/portless/src/pages.ts`) and the **terminal CLI output** (`colors.ts` + `cli.ts`).
The docs site (`apps/docs`) is a separate Next.js surface documented at the end.

This is an existing, committed design language. New browser UI — the `portless.localhost`
dashboard, the CA-trust download page, and the multiplexed-host app picker — MUST reuse the
tokens and components below so every page reads as one product.

## Theme

Light and dark, switched purely by `@media (prefers-color-scheme)` — no JS, no class toggle,
no flash. The mood is a quiet local control panel: near-white or near-black surface, a single
oversized pixel numeral as the only display gesture, everything else small and exact.

## Color (proxy pages — source of truth)

Defined as CSS custom properties on `:root`, overridden in the dark media query.

| Token       | Light     | Dark                    | Role                              |
| ----------- | --------- | ----------------------- | --------------------------------- |
| `--bg`      | `#fff`    | `#000`                  | Page background                   |
| `--fg`      | `#171717` | `#ededed`               | Primary text, the big numeral     |
| `--border`  | `#eaeaea` | `rgba(255,255,255,0.1)` | Card / terminal / divider borders |
| `--surface` | `#fafafa` | `#111`                  | Terminal blocks, hover fills      |
| `--text-2`  | `#666`    | `#888`                  | Secondary body text               |
| `--text-3`  | `#a1a1a1` | `#666`                  | Tertiary: labels, ports, footer   |
| `--accent`  | `#0070f3` | `#3291ff`               | Links, hovered app names, focus   |

Extension tokens for the new work (compose from the same hues; keep chroma restrained):

- `--success` `#0070f3`-neighbor green only where state is genuinely good (CA trusted): light
  `#0a7f3f`, dark `#3fb950`. Use sparingly.
- `--warn` for public-exposure / untrusted state: light `#b25000`, dark `#d29922`.
- `--danger` for destructive controls (stop/clean): light `#d12d2d`, dark `#f15a5a`.

All pairings must clear 4.5:1 for body text, 3:1 for large/bold. Never gray-on-tint.

## Typography

Four self-hosted woff2 faces, inlined as base64 data URLs in `fonts.ts` (zero network):

- **Geist** (400, 500) — `--font-sans`, all UI text. Fallback `system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif`.
- **Geist Mono** (400) — `--font-mono`, ports, commands, terminal blocks, footer.
- **Geist Pixel** (400) — display only: the giant status numeral in `.hero h1`.

Scale and rules in use:

- Hero numeral: `clamp(80px, 15vw, 144px)`, `line-height: 1`, `letter-spacing: -0.04em`.
  (This exceeds the skill's 96px ceiling intentionally — it is a single glyph, not a heading,
  and is the one display gesture the brand allows. Do not add a second oversized element.)
- Hero subtitle (`h2`): 13px, uppercase, `letter-spacing: 0.15em`, `--text-3`.
- Body (`.desc`): 14px, `line-height: 1.7`, `--text-2`; `strong` → `--fg` at weight 500.
- Section label (`.label`): 12px, weight 500, uppercase, `letter-spacing: 0.1em`, `--text-3`.
- Mono/terminal: 13px, `line-height: 1.7`.
- Footer: 11px mono, `letter-spacing: 0.08em`, `--text-3`.

Note: the small uppercase `.label` is a deliberate, reused system element (the section header
for "Active apps"), not a per-section eyebrow. Keep it for genuine section headers only.

## Components (proxy pages)

- **`.page`** — full-viewport flex column, centered, `padding: 32px 24px`.
- **`.hero`** — the numeral + uppercase subtitle stack. Used by every status page.
- **`.content`** — `max-width: 480px`, `margin-top: 56px`. The single content column.
- **`.card` / `.card-link`** — bordered 12px-radius list; each row is a flex link with a
  `.name`, a `.meta` group (`.port` mono + `.arrow` SVG), hover fills `--surface`, name and
  arrow shift to `--accent`. This is the app-list primitive — reuse it for the dashboard.
- **`.terminal`** — 12px-radius `--surface` block, mono, with a non-selectable `.prompt`
  (`$ `). Used to show the exact command the user should run. `pre.terminal` wraps.
- **`.empty`** — centered `--text-3` message for "No apps running."
- **`.section`** — `margin-top: 32px` rhythm unit; `.label` + content.
- **`.footer`** — the word `portless`, 11px mono, bottom of every page.
- **`ARROW_SVG`** — the 16px chevron used in card links.

`renderPage(status, statusText, body)` is the shared shell: doctype, inlined `PAGE_STYLES`,
`<meta name="color-scheme" content="light dark">`, the `.hero`, the body, the footer. Every
new browser page goes through it so chrome stays identical.

## Layout

Single centered column, `max-width: 480px`, vertical rhythm in 32px `.section` steps. No
sidebars, no grids, no tabs. The dashboard may widen its column and use a borderless or
`auto-fit` list, but stays a single centered column with the same hero + footer frame.

## Motion

Currently minimal and tasteful: `background 0.15s`, `color 0.15s`, and `transform 0.2s` on
`.card-link` hover (the arrow nudges 2px). Keep motion at this level — short ease, transform/
opacity/background only. Any new motion needs a `@media (prefers-reduced-motion: reduce)`
fallback. No bounce, no elastic, no entrance reveals that gate content visibility.

## Terminal UI (CLI)

`colors.ts` keeps a deliberately restrained palette where color carries meaning, not decoration:

- `red` (errors), `yellow` (warnings), `green` (success / status), `cyan` (commands and URLs to
  copy), `bold` (emphasis), `dim`/`gray` (secondary). `cyan.bold` is the primary-URL highlight.
- **Identity (no color) on purpose**: `blue` (short hint prose like "Usage:"/"Try:" reads fine
  without color) and `white` (plain text). Do not add more colors; this is not a rainbow CLI.
- Respect `NO_COLOR` / `FORCE_COLOR` / TTY detection (already implemented). In non-TTY contexts
  (tests, pipes) everything degrades to plain text.
- No emoji, no ASCII-art banners, no spinners. Section headers use `colors.bold("Usage:")`-style
  labels. Sentence-case messages, terminal punctuation, one idea per line, with the next command
  shown indented and ready to copy.

## Docs site (`apps/docs`)

Separate stack: Next.js + Tailwind v4 + Inter. Pure monochrome (`--foreground #171717` /
`--primary` = foreground; no blue accent), `.dark` class toggle. Tokens in
`apps/docs/src/app/globals.css`. New docs pages follow the existing MDX + `layout.tsx` +
`docs-navigation.ts` pattern; keep the monochrome, Inter, table-and-code aesthetic already
established there rather than importing the proxy pages' blue accent.
