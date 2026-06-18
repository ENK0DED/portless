# Portless Fork Notes

This repository is the ENK0DED fork of upstream `vercel-labs/portless`. Keep this file current whenever the fork adds behavior, release policy, package identity, or agent workflow that upstream does not own.

## Fork-Only Commit Ledger

Regenerate the current fork-only history with:

```bash
git log --oneline --no-merges upstream/main..HEAD
```

Current fork-owned commits and what they protect:

| Commit    | Purpose                                                                                                                                                                                            |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `e4fb52d` | Switched repository development from pnpm to Bun, replaced lockfiles, updated CI/release scripts, Windows debug bootstrap, package scripts, and agent docs.                                        |
| `293a6cd` | Introduced suffix terminology in docs and comments so custom hostname endings are not described only as top-level domains.                                                                         |
| `7cc4b70` | Centralized TypeScript config, refined CLI and test behavior, added `PORTLESS_SUFFIX`, added dotted suffix validation, added suffix precedence tests, and updated package manager examples to Bun. |
| `9ef7bdf` | Prepared fork release `0.10.2`.                                                                                                                                                                    |
| `e3bf8af` | Fixed the fork release workflow's npm authentication path.                                                                                                                                         |
| `ce44bb0` | Prepared fork release `0.10.3`.                                                                                                                                                                    |
| `73a8c35` | Prepared fork release `0.10.4`.                                                                                                                                                                    |
| `038a893` | Prepared fork release `0.10.5`.                                                                                                                                                                    |
| `c613379` | Fixed workflow compatibility and changed Turbo package references from `portless#build` to `@enk0ded/portless#build`.                                                                              |
| `9b84042` | Adjusted CI e2e coverage for the fork's Node matrix.                                                                                                                                               |
| `2cf517c` | Updated CI to current Node 22 and 24 coverage.                                                                                                                                                     |
| `974f5dc` | Prepared fork release `0.10.6`, the pre-sync fork tip preserved by `backup/pre-upstream-sync-20260617`.                                                                                            |
| `f9b13e1` | Merged upstream `main` into the fork while preserving package identity, version mapping, Bun, suffix behavior, docs, tests, release workflow, Windows debugging, and the fork sync skill.          |
| `275a42a` | Fixed privileged proxy state handoff, added first-class proxy `--suffix` parsing, and documented the protected fork behavior.                                                                      |

## Fork-Owned Invariants

### Package Identity

- npm package: `@enk0ded/portless`
- CLI command: `portless`
- Repository: `https://github.com/ENK0DED/portless`
- package metadata author: `Eloy Rodriguez <officialenkoded@gmail.com>`
- Release workflow registry check: `npm view @enk0ded/portless version`
- Install docs must use `npm install -g @enk0ded/portless` and `npm install -D @enk0ded/portless`
- Runtime local-install detection must check `node_modules/@enk0ded/portless`, not `node_modules/portless`
- Turbo task references must use `@enk0ded/portless#build`

After every upstream sync, search for upstream package install strings:

```bash
rg 'npm install -g [p]ortless|npm install -D [p]ortless|npm view [p]ortless|"name": "[p]ortless"|github.com/vercel-labs/[p]ortless|node_modules/[p]ortless'
```

### Version Mapping

Fork releases use stable semver and reserve patch ranges by upstream patch:

```text
fork patch = ((upstream patch + 1) * 1000) + fork iteration
```

Examples:

- Upstream `0.14.0`, first fork release: `0.14.1000`
- Local-only release after that: `0.14.1001`
- Upstream `0.14.1`, first fork release: `0.14.2000`

This avoids prerelease semantics and keeps room for local-only releases between upstream syncs.

The current fork release `0.14.1001` tracks upstream `0.14.0` plus local fork fixes and maintenance updates. If upstream publishes `0.14.1`, the first synced fork release should be `0.14.2000`. If the fork ships another local-only change before the next upstream patch, use `0.14.1002`.

### Package Manager

This fork uses Bun for repository development.

- Keep `packageManager` set to `bun@1.3.14` or newer in `package.json`
- Keep `engines.bun` aligned with the required Bun version
- Keep root `workspaces` in `package.json`
- Keep `bun.lock`
- Do not keep `pnpm-lock.yaml` or `pnpm-workspace.yaml`
- CI, release workflows, Windows debug scripts, README, and `skills/portless/SKILL.md` must use `bun install` and `bun run ...`
- The pre-commit hook uses `bunx lint-staged`
- `.prettierignore` ignores `bun.lock`
- `.gitignore` and ESLint ignore rules should not reference `.pnpm-store`
- Windows debug bootstrap installs Bun, adds `C:\.bun\bin` to PATH, clones `https://github.com/ENK0DED/portless.git`, and rebuilds with `bun install` plus `bun run build`

Portless can still support pnpm as a child command or workspace format. Do not remove product support for pnpm just because this fork uses Bun.

### Suffix Environment Variable

This fork documents `PORTLESS_SUFFIX` as the preferred environment variable for custom suffixes. `PORTLESS_TLD` remains a compatibility alias.

Behavior to preserve:

- `PORTLESS_SUFFIX` is read before `PORTLESS_TLD`
- if both env vars are set, `PORTLESS_SUFFIX` wins
- empty values fall back to the default suffix `localhost`
- values are trimmed and lowercased
- single-label suffixes such as `test` are valid
- dotted suffixes such as `acme.com` and `server01.acme.com` are valid
- labels may contain lowercase letters, digits, and hyphens
- labels must start and end with a letter or digit
- labels must be 63 characters or less
- leading dots, trailing dots, and consecutive dots are invalid
- risky suffix warnings should inspect the terminal public suffix label, so `local.example.dev` warns because the final label is `dev`
- host parsing and proxy routing must support dotted suffixes
- service installs should write `PORTLESS_SUFFIX`, not `PORTLESS_TLD`, into native service environment
- `portless service install --suffix <suffix>` is the preferred service flag
- `portless service install --tld <tld>` remains a compatibility alias
- `portless proxy start --suffix <suffix>` is the preferred proxy flag
- `portless proxy start --tld <tld>` remains a compatibility alias
- the state marker file is still `proxy.tld` for compatibility with upstream and older local installs

Coverage:

- `packages/portless/src/cli-utils.test.ts` covers `PORTLESS_SUFFIX`, `PORTLESS_TLD`, and precedence
- `packages/portless/src/cli-utils.test.ts` covers dotted suffix validation
- `packages/portless/src/cli.test.ts` covers the proxy `--suffix` parser
- `packages/portless/src/utils.test.ts` covers hostname parsing with dotted suffixes
- `packages/portless/src/proxy.test.ts` covers routing with dotted suffixes
- `packages/portless/src/service.test.ts` covers service persistence through `PORTLESS_SUFFIX` and `--suffix`
- `packages/portless/src/cli.ts` help output documents `PORTLESS_SUFFIX` first
- `README.md` and `skills/portless/SKILL.md` document `PORTLESS_SUFFIX` first

Do not let an upstream merge restore a single-label-only validator or replace fork docs with only `PORTLESS_TLD`.

### Privileged Proxy State Handoff

This fork keeps all proxy state in the invoking user's state directory by default. That must continue to hold even when the proxy needs sudo for ports 80 or 443.

Behavior to preserve:

- `resolveStateDir()` returns `~/.portless` unless `PORTLESS_STATE_DIR` is set
- sudo proxy starts must run through `sudo env` and pass the resolved `PORTLESS_STATE_DIR`
- sudo proxy stops must also pass the resolved `PORTLESS_STATE_DIR`
- `buildSudoEnvArgs()` should preserve existing `PORTLESS_*` values, preserve `HOME`, and allow explicit overrides
- passwordless sudo must not make the proxy fall back to root's default config when the user has configured `PORTLESS_SUFFIX`, `PORTLESS_PORT`, `PORTLESS_HTTPS`, or another `PORTLESS_*` value

Coverage:

- `packages/portless/src/cli-utils.test.ts` covers sudo environment argument construction
- `packages/portless/src/cli.test.ts` covers `proxy start --suffix` writing the persisted suffix state

### Boolean Environment Variable Docs

Docs and CLI help only document boolean environment variables with `0` and `1`. Code may accept additional internal values when already supported, but do not add those alternatives to user-facing docs.

### TypeScript and Dependency Baseline

This fork uses a shared root `tsconfig.json` as the baseline for packages, apps, examples, and e2e tests. Preserve the centralized compiler defaults unless upstream introduces a stricter equivalent.

Current baseline:

- `target`: `ESNext`
- `module`: `ESNext`
- `moduleResolution`: `bundler`
- `strict`: `true`
- `skipLibCheck`: `true`
- `resolveJsonModule`: `true`

The fork also keeps dependency versions current through Bun. When upstream changes dependencies, refresh with `bun install` and keep `bun.lock` as the source of truth.

### Runtime Diagnostics

The fork preserves original error causes when OpenSSL certificate generation fails:

- `packages/portless/src/certs.ts` wraps failed OpenSSL calls with `{ cause: err }`
- `packages/portless/src/service.ts` wraps startup-service certificate preparation failures with `{ cause: err }`

This improves debugging without changing the user-facing message. Keep this when upstream rewrites certificate or service startup code.

### Docs, Skills, and Agent Workflow

Fork-specific docs live in more than one place and should be kept consistent:

- `README.md`: user-facing install, suffix, Bun development, and fork maintenance notes
- `FORK.md`: fork invariants, version mapping, and sync checklist
- `skills/portless/SKILL.md`: agent-facing usage guide for this package
- `skills/oauth/SKILL.md`: OAuth guidance should use suffix terminology
- `apps/docs/src/app/*`: docs site content should use `@enk0ded/portless` and suffix terminology
- `apps/docs/src/app/api/docs-chat/route.ts`: docs chat system prompt should identify the ENK0DED repo and `@enk0ded/portless`
- `skills/portless-fork-sync/SKILL.md`: local agentic process for repeating upstream syncs

The fork sync skill is part of the repository on purpose. Do not remove it during upstream syncs. Update it whenever the sync process changes.

## Upstream Open PR Triage

This fork periodically audits every open upstream PR in `vercel-labs/portless` and assigns one of these states:

- `implemented`: the fork contains materially equivalent behavior.
- `implemented differently`: the fork contains the behavior but changed design, names, safety defaults, or integration shape.
- `superseded`: the fork solves the underlying problem with a broader or safer mechanism, so the PR should not be merged as-is.
- `planned`: the fork accepts the feature direction, but implementation must follow a fork-specific plan before code is written.
- `deferred`: the PR may be useful, but needs separate design, hardening, or product discussion before implementation.
- `won't implement`: the fork intentionally rejects the change.

When a new upstream PR pass happens, update this section with the current date, PR list, and fork decision. The goal is to avoid repeatedly re-discussing PRs whose state is already known.

### 2026-06-18 Implementation Pass

| Upstream PR                                                                                                              | State                   | Fork commit | Notes                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------ | ----------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [#295 Add NetBird sharing with auth flags and end-to-end reachability](https://github.com/vercel-labs/portless/pull/295) | implemented differently | `ea60e3b`   | Added NetBird expose support, auth flags/env vars, route URL/PID metadata, child `PORTLESS_NETBIRD_URL`, stale expose cleanup in `clean`/`prune`, and docs. Unlike upstream, the fork keeps child apps bound to `127.0.0.1` by default and warns when NetBird is used without password, PIN, or groups.                       |
| [#286 resolve sudo state dir and trust Windows CA store from WSL](https://github.com/vercel-labs/portless/pull/286)      | implemented differently | `e989f85`   | Kept the fork's existing `PORTLESS_STATE_DIR`/sudo environment handoff because it is more explicit and preserves all configured `PORTLESS_*` values. Added WSL Windows CurrentUser Root trust/untrust via PowerShell interop, Windows-browser-oriented WSL trust checks, warning propagation, and fingerprint-based deletion. |
| [#85 shell completion command for bash, zsh, and fish](https://github.com/vercel-labs/portless/pull/85)                  | implemented differently | `5f20c3c`   | Added `portless completion <shell>` for bash, zsh, and fish, generated from the current fork command set instead of the stale upstream option list. Includes `get`/`url`, aliases, `clean`, `prune`, `service`, suffix/wildcard/LAN flags, Tailscale, ngrok, and NetBird flags.                                               |
| [#300 report package config source](https://github.com/vercel-labs/portless/pull/300)                                    | won't implement         | `6ab469f`   | Do not merge upstream's enum-shaped implementation. The fork already uses `LoadedConfig.sourcePath` to display `package.json`, `portless.json`, or `.config/portless.json` precisely; keep that fork-specific fix and reject further #300 work.                                                                               |

Security decisions from this pass:

- NetBird is public exposure. The fork does not silently widen child app binds to all interfaces. Apps remain loopback-bound unless a future explicit, reviewed opt-in is added.
- NetBird route metadata includes the expose process PID so public expose processes can be stopped during crash cleanup.
- WSL trust integration uses the Windows CurrentUser Root store for Windows browsers and removes certificates by SHA-1 fingerprint, not by common name.

Follow-up decisions on 2026-06-18:

- Detailed implementation plans for #309, #242, #165, and #104 live in `docs/superpowers/plans/2026-06-18-upstream-pr-feature-plans.md`.
- #309 is accepted as planned work, but only as a fork-specific Tailscale Service mode that preserves existing Serve and Funnel behavior.
- #278 remains deferred until we decide whether WebSocket-over-HTTP/2 HMR reliability is worth the added stream-level proxying surface.
- #242 is accepted as planned work with explicit `--h2c`; no backend protocol probing.
- #165 is accepted as planned work with explicit `--path`, longest-prefix matching, and strict path-boundary tests.
- #104 is accepted as planned work for explicit tunnels and alias mapping only. The fork should not copy upstream's zero-config single-app passthrough default because arbitrary public Host headers could otherwise reach a local app on production servers.
- #300, #292, and #141 are won't implement.
- #333, #264, #240, and #212 are UI-focused deferred work. Route them to an agent that is strong at browser UX, frontend behavior, and visual/security tradeoffs.

### UI-Focused Deferred Work

| Upstream PR                                                                            | Why it needs a UI-capable agent                                                                                                                                                                   |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [#333 Add background app management](https://github.com/vercel-labs/portless/pull/333) | Background process management needs a clear status, logs, start/stop/restart, failure, and cleanup experience. It should probably be designed alongside a dashboard or other interactive surface. |
| [#264 Multiplexed hostname routing](https://github.com/vercel-labs/portless/pull/264)  | Same-host app selection changes browser behavior with cookies and HTML mutation. It needs UX design plus careful review for auth redirects, response rewriting, and user-visible routing state.   |
| [#240 CA cert download](https://github.com/vercel-labs/portless/pull/240)              | CA download is a browser-delivered trust flow. It needs explicit user intent, clear install instructions, safe exposure boundaries, and a UI that avoids accidentally distributing CA material.   |
| [#212 Web dashboard](https://github.com/vercel-labs/portless/pull/212)                 | A dashboard is explicitly UI work and should be designed around route visibility, auth assumptions, public exposure state, cleanup controls, and safe defaults.                                   |

### Requested Comparison Notes

| Upstream PR                                                                                     | State           | Specific differences and decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------------------------------------------------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [#309 Tailscale Service sharing mode](https://github.com/vercel-labs/portless/pull/309)         | planned         | Adds `--tailscale-service` and stable Tailscale Service MagicDNS names. The fork should implement this as an additional Tailscale mode, not by replacing Serve/Funnel. Use `--tailscale-service-name <name>` for explicit names rather than optional flag values, persist service URL and pending approval metadata, and never imply Funnel or public exposure. See the plan file above.                                                                                                                                                                                                          |
| [#300 package config source](https://github.com/vercel-labs/portless/pull/300)                  | won't implement | Upstream adds a `source` enum. The fork's `sourcePath` is more flexible and already drives display labels through `6ab469f`, preserving `.config/portless.json` detail. Do not merge upstream's enum design.                                                                                                                                                                                                                                                                                                                                                                                      |
| [#292 Expo/Metro Node 17 localhost docs](https://github.com/vercel-labs/portless/pull/292)      | won't implement | The fork has a code-level family-agnostic loopback dial fix from #321 and Expo LAN handling that avoids forcing `HOST` in LAN mode. A documentation-only Node 17 workaround would be stale and less accurate than documenting current fork behavior if Expo regressions return.                                                                                                                                                                                                                                                                                                                   |
| [#278 WebSocket-over-HTTP/2 Extended CONNECT](https://github.com/vercel-labs/portless/pull/278) | deferred        | This enables browser HMR WebSockets over the same HTTPS/2 connection already negotiated with portless. Current proxy supports normal HTTP/2 requests and classic HTTP/1.1 WebSocket upgrades, but it does not advertise `SETTINGS_ENABLE_CONNECT_PROTOCOL` or bridge HTTP/2 `CONNECT` streams to backend WebSocket upgrades. Without it, browsers can fail Next.js Turbopack, Vite HMR, and React Fast Refresh sockets even though HTTP pages load correctly. This should be decided separately because it adds stream-level CONNECT handling and `Sec-WebSocket-Accept` validation requirements. |
| [#242 h2c upstream support for gRPC](https://github.com/vercel-labs/portless/pull/242)          | planned         | This is distinct from #278. It adds an explicit `--h2c` route protocol for upstream HTTP/2 cleartext and gRPC backends, preserving streaming and trailers. Current fork forwards upstreams over HTTP/1.1, so HTTP/2-only and gRPC backends are not covered. Implement with route protocol persistence, no auto-detection, session lifecycle tests, trailer tests, and unchanged HTTP/1.1 defaults. See the plan file above.                                                                                                                                                                       |
| [#165 path-based routing](https://github.com/vercel-labs/portless/pull/165)                     | planned         | Adds `--path <prefix>`/`PORTLESS_PATH`, route identity by `hostname + pathPrefix`, and longest-prefix dispatch. Implement only as an explicit route scope, preserve root route compatibility, keep full request paths unstripped, and add strict segment-boundary matching so `/api` cannot match `/api-v2`. See the plan file above.                                                                                                                                                                                                                                                             |
| [#141 custom port/host variable names](https://github.com/vercel-labs/portless/pull/141)        | won't implement | The fork already supports exact command placeholders `{PORT}`, `{HOST}`, and `{PORTLESS_URL}`, which are more explicit and avoid global env-var-name indirection. Do not add `--port-var`/`--host-var` unless a later real-world tool proves placeholders and standard `PORT`/`HOST` cannot work.                                                                                                                                                                                                                                                                                                 |
| [#104 tunnel support](https://github.com/vercel-labs/portless/pull/104)                         | planned         | The fork already has managed ngrok, Tailscale, Tailscale Funnel, and NetBird sharing. Planned remaining work is explicit tunnel alias mapping, optional generic `--tunnel <provider>`, Cloudflare Tunnel support, and `PORTLESS_TUNNEL_URL`. Do not implement upstream's zero-config single-app public Host passthrough by default; require explicit alias or managed tunnel setup. See the plan file above.                                                                                                                                                                                      |

### Won't Implement

| Upstream PR                                                                                                  | Decision                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [#300 Report package config source](https://github.com/vercel-labs/portless/pull/300)                        | won't implement. Keep the fork's `sourcePath` display fix from `6ab469f`; do not merge upstream's less flexible enum-shaped source model.                                              |
| [#292 Expo/Metro Node 17 localhost docs](https://github.com/vercel-labs/portless/pull/292)                   | won't implement. Current code-level loopback and LAN behavior is better than documenting an older Node 17 workaround.                                                                  |
| [#273 Add a tip about versions](https://github.com/vercel-labs/portless/pull/273)                            | won't implement. The fork has its own version mapping and release policy documented here. A generic upstream version tip would be confusing for `@enk0ded/portless`.                   |
| [#141 Custom port/host variable names](https://github.com/vercel-labs/portless/pull/141)                     | won't implement. Command placeholders cover the practical need more explicitly than global custom env-var names.                                                                       |
| [#116 configurable docs chat provider and MiniMax support](https://github.com/vercel-labs/portless/pull/116) | won't implement. The docs chat is not part of the portless runtime surface and adding third-party LLM provider config increases maintenance and secret-handling surface for this fork. |
| [#91 docs code block copy button](https://github.com/vercel-labs/portless/pull/91)                           | won't implement. It is docs-site polish, not a runtime or fork-invariant improvement. Reconsider only during a deliberate docs UX pass.                                                |

### Full Open Upstream PR State on 2026-06-18

| PR                                                                                                   | State                   | Fork decision                                                                                                                                                                                                     |
| ---------------------------------------------------------------------------------------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [#333 Add background app management](https://github.com/vercel-labs/portless/pull/333)               | deferred                | UI-focused. First-party `portless bg` is useful for agent workflows, but it introduces process supervision, logs, registry cleanup, and lifecycle security concerns. Needs design before implementation.          |
| [#331 Support Laravel port injection](https://github.com/vercel-labs/portless/pull/331)              | implemented             | Laravel `php artisan serve` gets port/host injection in current fork.                                                                                                                                             |
| [#329 Improve CLI ergonomics and error responses](https://github.com/vercel-labs/portless/pull/329)  | implemented             | Current fork includes the ergonomic/error handling improvements from the prior backport batch.                                                                                                                    |
| [#325 Prefix workspace app names in worktrees](https://github.com/vercel-labs/portless/pull/325)     | implemented             | Worktree prefixes apply to workspace app names.                                                                                                                                                                   |
| [#321 Dial loopback upstreams family-agnostically](https://github.com/vercel-labs/portless/pull/321) | implemented             | Proxy upstream dialing handles IPv4/IPv6 loopback selection.                                                                                                                                                      |
| [#317 Expose getUrl()](https://github.com/vercel-labs/portless/pull/317)                             | implemented             | Programmatic `getUrl()` API exists.                                                                                                                                                                               |
| [#311 Run cleanup handler on SIGHUP](https://github.com/vercel-labs/portless/pull/311)               | implemented             | Cleanup handles SIGHUP.                                                                                                                                                                                           |
| [#309 Tailscale Service sharing mode](https://github.com/vercel-labs/portless/pull/309)              | planned                 | See detailed notes and plan file above.                                                                                                                                                                           |
| [#308 Hostname command injection in hosts sync](https://github.com/vercel-labs/portless/pull/308)    | implemented             | Hosts-file operations avoid shell interpolation and validate/sanitize hostnames.                                                                                                                                  |
| [#306 Bypass Windows cmd.exe PATH limit](https://github.com/vercel-labs/portless/pull/306)           | implemented             | Windows spawning bypasses the cmd.exe PATH length limit.                                                                                                                                                          |
| [#304 Prefix workspace app URLs in git worktrees](https://github.com/vercel-labs/portless/pull/304)  | implemented             | Covered by the current worktree-prefix implementation.                                                                                                                                                            |
| [#303 Forward Vite flags through bun scripts](https://github.com/vercel-labs/portless/pull/303)      | implemented             | Package-script framework flags are forwarded through Bun scripts.                                                                                                                                                 |
| [#302 Probe free app ports on 127.0.0.1](https://github.com/vercel-labs/portless/pull/302)           | implemented             | Free app ports are probed on loopback.                                                                                                                                                                            |
| [#301 Service wildcard installs](https://github.com/vercel-labs/portless/pull/301)                   | implemented             | Startup service supports wildcard mode.                                                                                                                                                                           |
| [#300 Report package config source](https://github.com/vercel-labs/portless/pull/300)                | won't implement         | Reject upstream's enum design; keep fork-specific `sourcePath` behavior from `6ab469f`.                                                                                                                           |
| [#295 NetBird sharing](https://github.com/vercel-labs/portless/pull/295)                             | implemented differently | Implemented in `ea60e3b` with safer loopback default and PID cleanup.                                                                                                                                             |
| [#292 Expo/Metro localhost docs](https://github.com/vercel-labs/portless/pull/292)                   | won't implement         | See won't-implement table.                                                                                                                                                                                        |
| [#286 Sudo state dir and WSL CA trust](https://github.com/vercel-labs/portless/pull/286)             | implemented differently | WSL CA trust implemented in `e989f85`; sudo handling remains fork-owned.                                                                                                                                          |
| [#279 .config/portless.json](https://github.com/vercel-labs/portless/pull/279)                       | implemented             | `.config/portless.json` is supported.                                                                                                                                                                             |
| [#278 WebSocket-over-HTTP/2 Extended CONNECT](https://github.com/vercel-labs/portless/pull/278)      | deferred                | See detailed notes above.                                                                                                                                                                                         |
| [#277 Multi-segment custom TLDs](https://github.com/vercel-labs/portless/pull/277)                   | implemented differently | Covered by fork suffix support, including dotted suffixes and `PORTLESS_SUFFIX` precedence.                                                                                                                       |
| [#276 VitePress support](https://github.com/vercel-labs/portless/pull/276)                           | implemented             | VitePress auto-port injection exists.                                                                                                                                                                             |
| [#275 Tailscale HTTPS readiness](https://github.com/vercel-labs/portless/pull/275)                   | implemented             | Tailscale/Funnel readiness is checked before starting child apps.                                                                                                                                                 |
| [#273 Version tip](https://github.com/vercel-labs/portless/pull/273)                                 | won't implement         | See won't-implement table.                                                                                                                                                                                        |
| [#272 Wrangler port/ip injection](https://github.com/vercel-labs/portless/pull/272)                  | implemented             | Wrangler gets `--port` and `--ip`.                                                                                                                                                                                |
| [#270 Worktree prefix in monorepo default mode](https://github.com/vercel-labs/portless/pull/270)    | implemented             | Monorepo default mode applies worktree prefixes.                                                                                                                                                                  |
| [#264 Multiplexed hostname routing](https://github.com/vercel-labs/portless/pull/264)                | deferred                | UI-focused. Adds cookie-persisted app selection and HTML injection for same-host routing. It is risky for auth redirects and response mutation, so it needs a separate security/design pass.                      |
| [#261 Detect npm exec as package runner](https://github.com/vercel-labs/portless/pull/261)           | implemented             | Package-runner detection handles npm exec.                                                                                                                                                                        |
| [#257 JSON output for list/get](https://github.com/vercel-labs/portless/pull/257)                    | implemented             | `portless get --json` and `portless list --json` exist.                                                                                                                                                           |
| [#247 Only inject portless Node dir on Windows](https://github.com/vercel-labs/portless/pull/247)    | implemented             | Bun/Node PATH handling is fork-adjusted and Windows-safe.                                                                                                                                                         |
| [#245 Rsbuild support](https://github.com/vercel-labs/portless/pull/245)                             | implemented             | Rsbuild flag injection exists.                                                                                                                                                                                    |
| [#242 h2c upstream support for gRPC](https://github.com/vercel-labs/portless/pull/242)               | planned                 | See detailed notes and plan file above.                                                                                                                                                                           |
| [#240 CA cert download](https://github.com/vercel-labs/portless/pull/240)                            | deferred                | UI-focused. Useful for remote/forwarded workflows, but `cert.<suffix>` and raw CA download require careful exposure review. A future implementation should avoid leaking CA material beyond explicit user action. |
| [#238 Bun native runtime fast refresh](https://github.com/vercel-labs/portless/pull/238)             | implemented             | Bun native runtime handling avoids HOST-origin breakage.                                                                                                                                                          |
| [#237 Warn on LAN plus wildcard](https://github.com/vercel-labs/portless/pull/237)                   | implemented             | LAN/wildcard incompatibility is warned/rejected.                                                                                                                                                                  |
| [#212 Web dashboard](https://github.com/vercel-labs/portless/pull/212)                               | deferred                | UI-focused. A dashboard at `portless.localhost` is useful, but adds UI/security surface and should be designed together with route controls and auth assumptions.                                                 |
| [#167 Command placeholders](https://github.com/vercel-labs/portless/pull/167)                        | implemented             | `{PORT}`, `{HOST}`, and `{PORTLESS_URL}` placeholders exist.                                                                                                                                                      |
| [#166 Preserve path in 404 links](https://github.com/vercel-labs/portless/pull/166)                  | implemented             | 404 app links preserve request path.                                                                                                                                                                              |
| [#165 Path-based routing](https://github.com/vercel-labs/portless/pull/165)                          | planned                 | See detailed notes and plan file above.                                                                                                                                                                           |
| [#151 Reserve app ports and validate fixed inputs](https://github.com/vercel-labs/portless/pull/151) | implemented             | Browser-blocked fixed ports are rejected and automatic assignment avoids blocked ports.                                                                                                                           |
| [#141 Custom port/host env var names](https://github.com/vercel-labs/portless/pull/141)              | won't implement         | See won't-implement table.                                                                                                                                                                                        |
| [#136 Proxy detection behind pf redirects](https://github.com/vercel-labs/portless/pull/136)         | implemented             | Proxy health detection handles redirects.                                                                                                                                                                         |
| [#128 Generate CA during trust](https://github.com/vercel-labs/portless/pull/128)                    | implemented             | `portless trust` generates a missing CA.                                                                                                                                                                          |
| [#116 Docs chat provider config](https://github.com/vercel-labs/portless/pull/116)                   | won't implement         | See won't-implement table.                                                                                                                                                                                        |
| [#104 Tunnel support](https://github.com/vercel-labs/portless/pull/104)                              | planned                 | Existing providers cover part of the need; remaining explicit tunnel and alias work is planned. See detailed notes and plan file above.                                                                           |
| [#91 Docs copy button](https://github.com/vercel-labs/portless/pull/91)                              | won't implement         | See won't-implement table.                                                                                                                                                                                        |
| [#85 Shell completions](https://github.com/vercel-labs/portless/pull/85)                             | implemented differently | Implemented in `5f20c3c` with current fork flags.                                                                                                                                                                 |
| [#67 Tailscale serve provider mode](https://github.com/vercel-labs/portless/pull/67)                 | implemented differently | Current fork supports Tailscale Serve and Funnel with root-mounted per-app HTTPS ports.                                                                                                                           |

## Sync Checklist

1. Start from a clean worktree and create a backup branch at the current fork tip.
2. Fetch `origin` and `upstream` with a working SSH agent.
3. Merge `upstream/main` into local `main`.
4. Resolve conflicts by taking upstream feature code first, then reapply fork invariants from this file.
5. Remove upstream pnpm workspace files if they return.
6. Run the package-name search above and fix every hit unless it is intentionally testing compatibility.
7. Run `bun install` to refresh `bun.lock`.
8. Review `git log --oneline --no-merges upstream/main..HEAD` and update this ledger when the fork adds or removes fork-only commits.
9. Run focused tests for any fork invariant touched by the merge.
10. Run full verification before pushing.

## Verification Commands

Use these after every sync:

```bash
bun install
bun run format:check
bun run lint
bun run type-check
bun run build
bun run test
```

Run `bun run test:e2e` when source changes affect proxy lifecycle, framework flag injection, multi-app orchestration, sharing, or route cleanup.

Focused checks for fork invariants:

```bash
bun run test packages/portless/src/cli-utils.test.ts
bun run test packages/portless/src/utils.test.ts
bun run test packages/portless/src/proxy.test.ts
bun run test packages/portless/src/service.test.ts
rg 'npm install -g [p]ortless|npm install -D [p]ortless|npm view [p]ortless|"name": "[p]ortless"|github.com/vercel-labs/[p]ortless|node_modules/[p]ortless'
rg 'PORTLESS_TLD' README.md skills/portless/SKILL.md apps/docs/src/app
```

The final `PORTLESS_TLD` search is expected to find only compatibility-alias language.
