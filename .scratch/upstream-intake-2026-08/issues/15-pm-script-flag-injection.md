# Adopt framework flag injection through package-manager scripts (#366)

Type: task
Status: resolved
Blocked by: 14

## Question

On `upstream-sync-v015`, adopt upstream #366 (`93acac4`): inject framework port/host flags through package-manager script indirection (e.g. `npm run dev` → underlying `vite`/`next` invocation) so frameworks launched via pm scripts receive the same injection as direct invocations. Adapt to the fork's surface: Bun-first script handling, the fork's `{PORT}`/`{HOST}`/`{PORTLESS_URL}` placeholders, existing framework injectors (including fork additions like VitePress, Rsbuild, Laravel, Wrangler), and the fork's Windows shim spawn paths from `68c17ff` (do not reintroduce a `cmd.exe` string-concatenation path). Import upstream's tests adapted to the fork's runner matrix. Run the verification gate and update the fork-only ledger.

## Answer

Implementation commit: `8fd6bfb` (`fix(cli): inject framework flags through package scripts`). The final ledger and ticket-resolution commit is the current `docs(fork): resolve ticket 15 and update ledger` commit.

Decisions:

- Added raw package-script resolution alongside tokenized resolution, with Bun-first support for exact `bun run`, `npm run`, `pnpm run`, and `yarn run` delegation. Safe scripts receive the same framework flags as direct commands, with npm's required `--` separator.
- Kept injection server-only and framework-aware, including VitePress, Rsbuild, Laravel `php artisan serve`, and Wrangler `--ip`. Existing flags, Expo connection modes, placeholders, script terminators, and unsafe shell boundaries remain respected.
- Reused the resolved framework identity for Expo LAN environment handling and multi-app package scripts. The fork's direct executable and Windows shim spawn paths remain unchanged.

Test coverage:

- Adapted direct and package-script unit coverage for the Bun, npm, pnpm, and yarn runner matrix, framework wrappers, server and non-server commands, shell safety, placeholders, and Expo behavior.
- Added CLI integration coverage for all four package managers and the shell-boundary differential sweep.
- Added raw script resolution coverage and preserved the existing fork Windows spawn tests.

Verification:

- `bun install --frozen-lockfile`
- `bun run lint`
- `bun run type-check`
- `bun run build`
- `bun run test` — 31 package test files passed, 1,089 tests passed, 3 skipped.
- `bun run test:e2e` — 11 files passed, 15 tests passed, 2 skipped.
- Changed-file Prettier check and `git diff --check` passed. The repository-wide formatter also scans pre-existing untracked `.scratch` documents and reports only those unrelated files.
- `bun run check:fork-ledger` is run after the final ledger commit.
