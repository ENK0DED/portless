# Docs regression verification

From the repository root:

```sh
bun run --cwd apps/docs test
bun run --cwd apps/docs test:routes
```

The unit suite runs separately from the Node built-in HTTP suite. No test dependencies are added. The HTTP runner requires an existing production build, starts its own `next start` process on an ephemeral `127.0.0.1` port, and terminates it after success, failure, SIGINT or SIGTERM. Requests do not follow redirects implicitly.

To build and verify production indexing explicitly:

```sh
VERCEL_ENV=production bun run --cwd apps/docs build
VERCEL_ENV=production DOCS_EXPECT_NOINDEX=0 bun run --cwd apps/docs test:routes
```

To verify preview indexing, build and run with matching environment values:

```sh
VERCEL_ENV=preview bun run --cwd apps/docs build
VERCEL_ENV=preview DOCS_EXPECT_NOINDEX=1 bun run --cwd apps/docs test:routes
```

A preview build replaces the local production build. Restore it with the production build command before running the default production assertions. `DOCS_EXPECT_NOINDEX` only changes test expectations; it does not configure Next.js or rebuild the app.

## Frozen content baseline

`fixtures/docs-baseline.json` records the fork's page content as of upstream `5758ac594e629c6ee9299ee03a71ece72162fd1f`. Upstream's own baseline hashes do not apply to this repository, because the fork pages differ (package name, suffix terminology, Bun examples, fork-only options and changelog history). The fixture holds, per page, exact metadata expectations, the SHA-256 of the MDX body (with the page title restored as a leading H1), the SHA-256 of the cleaned Markdown body served by the Markdown routes, SSR samples, and heading tuples `[level, text, id]`. Tests read this fixture without invoking git or regenerating expectations from the implementation.

Headings are taken from the MDX with fenced code blocks excluded. IDs are GitHub-style anchors: lowercase, punctuation removed, spaces turned into hyphens, and duplicates suffixed `-1`, `-2` in document order. The server-rendered HTML must expose each heading with exactly that ID. Footer headings are not part of this contract.

When intentionally changing documentation, review the source and update only the affected fixture values. Do not refresh hashes just to make an unexpected content difference pass. Every release adds a changelog entry, so every release also changes the `/changelog` hashes and headings: after editing `content/docs/changelog.mdx`, update that page's `mdxSha256`, `markdownBodySha256` and `headings` in the same commit. After a build, `bun run --cwd apps/docs update:baseline changelog` recomputes exactly those fields for the named page (omit the slug to recompute every page). Review the content change first, then the fixture diff.

## HTTP details

HTML assertions inspect attributes independently of order, parse JSON-LD, and examine SSR text rather than React serialization or error stacks. Next Flight requests include `?_rsc`, avoiding Next's cache-key normalization redirect. The browser-navigation case uses `node:http` because Node fetch overwrites `Sec-Fetch-Mode`. Font discovery accepts HTML preload tags or HTTP Link preloads.

The suite covers representation negotiation, full Vary inputs, private/no-store including HEAD, canonical redirects, invalid paths, agent indexes, environment-specific indexing, body search, and asset bypass. Known contract failures remain failing assertions rather than skips or implementation workarounds.
