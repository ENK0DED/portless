# Product

## Register

product

## Users

Developers running local services. They reach portless's UI in two moments:

1. **In the terminal**, while starting/inspecting apps with the `portless` CLI — fast,
   text-only feedback they read at a glance between other commands.
2. **In the browser**, when the proxy answers a request — the not-found page that lists
   running apps, gateway/loop error pages, the CA-trust download page, the app-picker for
   multiplexed hosts, and the local dashboard at `portless.localhost`.

Both audiences are technical, time-pressed, and using portless as infrastructure, not as a
destination. The UI's job is to get them back to their own work as quickly as possible.

## Product Purpose

portless gives every local app a real hostname (`myapp.localhost`) with working HTTPS, no
config. Its own interface should feel like a quiet, trustworthy part of the local platform:
present when you need an answer (which app is this? why did it 502? is my CA trusted?),
invisible otherwise. Success is a user who never has to think about portless's UI — it tells
them exactly what is running, what went wrong, or what to do next, then gets out of the way.

## Brand Personality

Precise, calm, infrastructural. Three words: **minimal, exact, dependable.** The voice is the
voice of a good error message — plain, specific, never cute, always actionable. It borrows the
Vercel/Geist design tradition (this is a `vercel-labs` project): monochrome surfaces, one
restrained blue accent, generous whitespace, a single pixel display face for the big numeral.

## Anti-references

- Dashboards that shout: gradient hero metrics, rainbow status chips, marketing-grade cards.
- Cutesy devtool mascots, emoji-laden CLI output, ASCII-art banners.
- Heavy chrome (sidebars, tabs, breadcrumbs) on what are really single-purpose status pages.
- Anything that reads as "AI made that": eyebrow kickers, numbered section scaffolding,
  ghost-cards (1px border + wide soft shadow), over-rounded 24px+ cards, side-stripe accents.

## Design Principles

1. **The page is a sentence.** Each surface answers exactly one question. Lead with the answer,
   then the one action that resolves it. No surface earns a second concept.
2. **Status is the product.** What's running, what's exposed publicly, what's trusted — make
   state legible and honest. Never imply safety (public exposure, trusted CA) that isn't real.
3. **Match the existing grain.** There is a committed design language in `pages.ts`. New browser
   UI reuses its tokens and components rather than inventing a parallel look.
4. **Restraint over color.** Color carries meaning, not decoration: blue = link/action, the
   accent ramp for warnings/exposure, monochrome for everything else. The terminal stays nearly
   colorless by design (red=error, yellow=warn, dim=secondary, bold=emphasis).
5. **Secure by default, surfaced clearly.** Trust flows and public-exposure state get explicit,
   unmissable affordances; nothing dangerous happens without visible user intent.

## Accessibility & Inclusion

- WCAG 2.1 AA contrast on all body/secondary text in both light and dark schemes.
- Full keyboard operability and visible focus rings on every interactive element.
- `prefers-color-scheme` honored automatically (no JS, no flash) on proxy-served pages.
- `prefers-reduced-motion` honored: every transition has a crossfade/instant fallback.
- Pages must render and be fully usable with zero external requests (fonts inlined, no CDN).
