# Portless documentation

Author the six public pages in `content/docs`. The shared content feeds Geistdocs, native search, WebMCP, Markdown, and the existing docs chat backend.

## Dependency policy

The root `bunfig.toml` sets `[install] minimumReleaseAge = 172800`, so Bun refuses package versions published less than 48 hours ago. Upstream expresses the same gate as `minimumReleaseAge: 2880` (minutes) in `pnpm-workspace.yaml`. `@vercel/agent-readability` is excluded because this site pins it to an exact version.

Next.js is pinned to 16.3.4. `patches/next@16.3.4.patch` at the repository root, applied through the root `package.json` `patchedDependencies` field, contains only two substitutions, changing `setHeader` to `appendHeader` for Vary in the CommonJS and ESM app-page runtime templates. This preserves the documentation negotiation headers alongside Next's RSC headers without modifying global Node response prototypes. Recheck both runtime templates and production HTTP headers when upgrading Next.

## Response handling

RSC and prefetch requests bypass Markdown negotiation but retain the unprefixed language rewrite. Documentation responses use private, no-store caching, including explicit Markdown routes, with Vary covering representation-detection headers. The `/en` prefix redirects permanently to the unprefixed URL without setting a locale cookie.

## Verification

Use `bun run --cwd apps/docs build`, `bun run --cwd apps/docs type-check`, `bun run --cwd apps/docs test` and `bun run --cwd apps/docs test:routes` from the repository root. For a normal production build, leave `VERCEL_ENV` unset or set it to `production`. Preview builds retain noindex while all page and Markdown canonicals use the single `siteUrl` constant in `src/lib/site.ts`. It defaults to `https://github.com/ENK0DED/portless` until the docs are hosted, and `NEXT_PUBLIC_SITE_URL` overrides it at build time.

See [the regression guide](tests/README.md) for production/preview commands, frozen content baselines and server cleanup. [Verification](tests/VERIFICATION.md) records results and deployment limits. The route suite runs in Linux CI after the build.
