# Portless Fork Notes

This repository is the ENK0DED fork of upstream `vercel-labs/portless`. Keep this file current whenever the fork adds behavior, release policy, package identity, or agent workflow that upstream does not own.

## Fork-Only Commit Ledger

Regenerate the current fork-only history with:

```bash
git log --oneline upstream/main..HEAD
```

Use that log as source material for behavior-protecting fork commits. A commit that only updates this ledger cannot know its own final hash, so it may be absent until the next sweep.

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
| `b0d79c2` | Prepared fork release `0.14.1001` after the upstream `0.14.0` sync.                                                                                                                                |
| `b929389` | Backported framework port injection coverage for current app runners.                                                                                                                              |
| `eba7e9a` | Backported loopback upstream dialing and Windows process-spawning fixes.                                                                                                                           |
| `b018cc9` | Backported CLI ergonomics and clearer proxy text errors.                                                                                                                                           |
| `347f32c` | Added `.config/portless.json` support for config files.                                                                                                                                            |
| `514350b` | Exposed the programmatic `getUrl()` API.                                                                                                                                                           |
| `eb1b33b` | Added JSON output for route and URL inspection commands.                                                                                                                                           |
| `3c992f9` | Validated hostnames before hosts-file synchronization to preserve command-injection hardening.                                                                                                     |
| `f795ba3` | Backported loopback port probing and SIGHUP cleanup handling.                                                                                                                                      |
| `874612a` | Backported small upstream runtime safety fixes.                                                                                                                                                    |
| `68ca8cf` | Backported Bun runtime and workspace worktree fixes.                                                                                                                                               |
| `68f1203` | Rejected browser-blocked fixed app ports and preserved safe automatic app-port assignment.                                                                                                         |
| `ce1eef8` | Generated a missing local CA during the trust helper path.                                                                                                                                         |
| `6023807` | Rejected redirected proxy health checks so stale or intercepted proxy checks do not look healthy.                                                                                                  |
| `22da38e` | Preserved request paths in proxy 404 app links.                                                                                                                                                    |
| `e56911d` | Added exact command placeholders for `{PORT}`, `{HOST}`, and `{PORTLESS_URL}`.                                                                                                                     |
| `ea60e3b` | Added NetBird sharing with explicit restriction flags, loopback-first child binding, route metadata, and cleanup support.                                                                          |
| `e989f85` | Added WSL Windows CurrentUser Root CA store integration while keeping fork-owned sudo state handoff behavior.                                                                                      |
| `5f20c3c` | Added shell completions generated from the current fork command and flag set.                                                                                                                      |
| `6ab469f` | Reported package config source names using the fork's flexible `sourcePath` model.                                                                                                                 |
| `3c435b3` | Recorded upstream PR triage decisions for the implementation pass.                                                                                                                                 |
| `c40774b` | Planned the remaining upstream PR follow-up work before implementation.                                                                                                                            |
| `89ac0a9` | Marked #212, #240, and #264 for dedicated UI-agent handling; #333 was later reassessed as CLI/process work.                                                                                        |
| `07792ee` | Added Tailscale Service sharing as an explicit mode without implying Funnel or public exposure.                                                                                                    |
| `516e2a7` | Added explicit h2c upstream route metadata and forwarding.                                                                                                                                         |
| `8f18de5` | Added explicit path-scoped routes with safe matching semantics.                                                                                                                                    |
| `260825b` | Added explicit tunnel aliases instead of accepting arbitrary public Host passthrough.                                                                                                              |
| `c7acb0b` | Planned the fork-specific background app management implementation for upstream PR #333.                                                                                                           |
| `33546d8` | Added locked background-app registry primitives.                                                                                                                                                   |
| `500929a` | Added the `portless bg` command surface.                                                                                                                                                           |
| `88ab929` | Started background apps with readiness tracking.                                                                                                                                                   |
| `0789278` | Added background status and log commands.                                                                                                                                                          |
| `9b1d098` | Managed background lifecycle cleanup for stop, restart, clean, and prune flows.                                                                                                                    |
| `0b00b63` | Documented background app management across user and agent surfaces.                                                                                                                               |
| `0d5feb2` | Marked upstream open PR coverage complete after the UI and CLI/process passes.                                                                                                                     |
| `75e3ace` | Added the local dashboard, certificate page, multiplexed routing, and shared internal-page shell.                                                                                                  |
| `b74f790` | Formatted background lifecycle tests.                                                                                                                                                              |
| `8043382` | Planned fork-specific HTTP/2 WebSocket compatibility for upstream PR #278.                                                                                                                         |
| `014b6e2` | Added HTTP/2 WebSocket handshake helpers for RFC 8441 Extended CONNECT.                                                                                                                            |
| `907ca07` | Supported browser HTTP/2 Extended CONNECT WebSocket traffic through the proxy.                                                                                                                     |
| `6824fb9` | Covered HTTP/2 WebSocket compatibility paths in tests.                                                                                                                                             |
| `341b26a` | Guarded HTTP/2 WebSocket session socket access before payload forwarding.                                                                                                                          |
| `ecf8f4a` | Documented HTTP/2 WebSocket support in the user, agent, and CLI help surfaces.                                                                                                                     |
| `cb0d38b` | Refreshed fork sweep records, upstream PR coverage checks, Bun docs drift, and HTTP/2 Extended CONNECT docs-site coverage.                                                                         |
| `29fb586` | Restored the fork verification gate by fixing TypeScript-only test and WSL runtime dependency-injection types.                                                                                     |
| `7f5a036` | Normalized background app source formatting so the repository Prettier gate stays green.                                                                                                           |

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
- `packages/portless/README.md` is a gitignored publish artifact generated from the root `README.md` by `packages/portless/package.json` `prepublishOnly`; do not edit or track it as source documentation

After every upstream sync, search for upstream package install strings outside this fork-maintenance ledger and the fork-sync skill itself:

```bash
rg --glob '!FORK.md' --glob '!skills/portless-fork-sync/SKILL.md' 'npm install -g [p]ortless|npm install -D [p]ortless|npm view [p]ortless|"name": "[p]ortless"|github.com/vercel-labs/[p]ortless|node_modules/[p]ortless'
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

This fork periodically audits every open upstream PR in `vercel-labs/portless`. The current ledger uses only these final states:

- `implemented`: the fork contains materially equivalent behavior.
- `implemented differently`: the fork contains the behavior but changed design, names, safety defaults, or integration shape.
- `won't implement`: the fork intentionally rejects the change.

If a future upstream PR pass needs temporary `planned` or `deferred` states, keep that discussion in this section with a concrete owner, date, and decision checkpoint. Do not leave current open PRs in temporary states after implementation work finishes.

### 2026-06-18 Current Result

Rechecked against upstream on 2026-06-18: GitHub reported 48 open PRs. Every open PR is listed below and has a final fork state: 28 implemented, 14 implemented differently, and 6 won't implement.

### Consolidated Non-Direct-Merge Decisions

| Upstream PR                                                                                                              | State                   | Fork commit evidence | Decision and preserved rationale                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------ | ----------------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [#333 Add background app management](https://github.com/vercel-labs/portless/pull/333)                                   | implemented differently | `33546d8`..`0b00b63` | Reassessed on 2026-06-18 as CLI/process supervision, not UI work. Implements `portless bg` with a locked registry, owner-only state and log permissions, private logs, readiness-file handshakes, status/list/logs, graceful stop/restart/clean, `clean`/`prune` integration, exact route cleanup, and no arbitrary same-port process killing.                                      |
| [#309 Tailscale Service sharing mode](https://github.com/vercel-labs/portless/pull/309)                                  | implemented differently | `07792ee`            | Adds `--tailscale-service`, `--tailscale-service-name <name>`, `PORTLESS_TAILSCALE_SERVICE=1`, and `PORTLESS_TAILSCALE_SERVICE_NAME`. The fork treats Service as an additional Tailscale mode beside Serve and Funnel, persists URL and pending approval metadata, uses explicit service names instead of optional flag values, and never implies Funnel or public exposure.        |
| [#300 Report package config source](https://github.com/vercel-labs/portless/pull/300)                                    | won't implement         | `6ab469f`            | Reject upstream's enum-shaped source model. The fork's `LoadedConfig.sourcePath` display is more flexible and already distinguishes `package.json`, `portless.json`, and `.config/portless.json`.                                                                                                                                                                                   |
| [#295 Add NetBird sharing with auth flags and end-to-end reachability](https://github.com/vercel-labs/portless/pull/295) | implemented differently | `ea60e3b`            | Adds NetBird expose support, auth flags and env vars, route URL/PID metadata, child `PORTLESS_NETBIRD_URL`, stale expose cleanup in `clean`/`prune`, and docs. The fork keeps child apps bound to `127.0.0.1` by default and warns when NetBird is used without password, PIN, or groups.                                                                                           |
| [#292 Expo/Metro Node 17 localhost docs](https://github.com/vercel-labs/portless/pull/292)                               | won't implement         | `f795ba3`, `68ca8cf` | Current code-level loopback dialing and Expo LAN behavior is better than documenting an older Node 17 workaround. If Expo regressions return, document current fork behavior instead of the stale workaround.                                                                                                                                                                       |
| [#286 resolve sudo state dir and trust Windows CA store from WSL](https://github.com/vercel-labs/portless/pull/286)      | implemented differently | `275a42a`, `e989f85` | Keeps the fork's existing `PORTLESS_STATE_DIR` and sudo environment handoff because it is explicit and preserves all configured `PORTLESS_*` values. Adds WSL Windows CurrentUser Root trust and untrust through PowerShell interop, Windows-browser-oriented WSL trust checks, warning propagation, and fingerprint-based deletion.                                                |
| [#278 WebSocket-over-HTTP/2 Extended CONNECT](https://github.com/vercel-labs/portless/pull/278)                          | implemented differently | `014b6e2`..`ecf8f4a` | Adds RFC 8441 Extended CONNECT for browser HMR WebSockets over HTTPS HTTP/2. Preserves strict route selection, exact tunnel aliases, path prefixes, multiplex selection cookies, internal reserved hosts, h2c-route exclusion, loopback-only backend dialing, manual HTTP/1.1 header safety checks, and `Sec-WebSocket-Accept` validation before forwarding backend payload.        |
| [#273 Add a tip about versions](https://github.com/vercel-labs/portless/pull/273)                                        | won't implement         | this file            | The fork has its own version mapping and release policy documented here. A generic upstream version tip would be confusing for `@enk0ded/portless`.                                                                                                                                                                                                                                 |
| [#264 Multiplexed hostname routing](https://github.com/vercel-labs/portless/pull/264)                                    | implemented differently | `75e3ace`            | Adds opt-in `--multiplex` and `--label` for multiple apps sharing one hostname. Selection uses a portless-served app picker plus a host-scoped cookie read before route lookup. The fork deliberately does not inject into or rewrite app HTML or headers, avoiding Content-Length, encoding, Set-Cookie, and auth-redirect breakage. Single-owner routing is unchanged by default. |
| [#242 h2c upstream support for gRPC](https://github.com/vercel-labs/portless/pull/242)                                   | implemented differently | `516e2a7`            | Adds explicit `--h2c`, `PORTLESS_H2C=1`, alias support, route metadata, list/JSON markers, upstream HTTP/2 cleartext forwarding, stream and trailer handling, cached upstream session cleanup, and unchanged HTTP/1.1 defaults. There is no backend protocol probing.                                                                                                               |
| [#240 CA cert download](https://github.com/vercel-labs/portless/pull/240)                                                | implemented differently | `75e3ace`            | Adds the reserved `cert.<suffix>` page. It serves only the public `ca.pem`, never the private key, shows the SHA-256 fingerprint, gives per-OS install steps, and requires explicit user action before download. `portless trust` remains the host-machine trust path.                                                                                                              |
| [#212 Web dashboard](https://github.com/vercel-labs/portless/pull/212)                                                   | implemented differently | `75e3ace`            | Adds the reserved read-only dashboard at `portless.<suffix>` with routes, ports, public exposure, CA trust status, live refresh, and copy/open affordances. It has no cross-origin mutation endpoints and never controls processes from the browser. The dashboard can be disabled with `PORTLESS_DASHBOARD=0`.                                                                     |
| [#165 Path-based routing](https://github.com/vercel-labs/portless/pull/165)                                              | implemented differently | `8f18de5`            | Adds explicit `--path <prefix>` and `PORTLESS_PATH`, route identity by `hostname + pathPrefix`, longest-prefix dispatch, full-path forwarding without stripping, `get`/`list`/alias visibility, and segment-boundary matching so `/api` cannot match `/api-v2`.                                                                                                                     |
| [#141 Custom port/host variable names](https://github.com/vercel-labs/portless/pull/141)                                 | won't implement         | `e56911d`            | Exact command placeholders `{PORT}`, `{HOST}`, and `{PORTLESS_URL}` cover the practical need more explicitly than global custom env-var-name indirection. Do not add `--port-var` or `--host-var` unless a later real-world tool proves placeholders and standard `PORT`/`HOST` cannot work.                                                                                        |
| [#116 configurable docs chat provider and MiniMax support](https://github.com/vercel-labs/portless/pull/116)             | won't implement         | this file            | The docs chat is not part of the portless runtime surface. Adding third-party LLM provider config increases maintenance and secret-handling surface for this fork.                                                                                                                                                                                                                  |
| [#104 tunnel support](https://github.com/vercel-labs/portless/pull/104)                                                  | implemented differently | `260825b`            | Adds `portless tunnel map/list/unmap`, generic `--tunnel <provider>` for `cloudflare` and `ngrok`, Cloudflare Quick Tunnel support through `cloudflared`, `PORTLESS_TUNNEL_URL`, managed tunnel cleanup, and exact aliases in `tunnel-aliases.json`. It checks local routes before aliases, rejects wildcard tunnel hosts, and never accepts arbitrary public Host passthrough.     |
| [#91 docs code block copy button](https://github.com/vercel-labs/portless/pull/91)                                       | won't implement         | this file            | This is docs-site polish, not a runtime or fork-invariant improvement. Reconsider only during a deliberate docs UX pass.                                                                                                                                                                                                                                                            |
| [#85 shell completion command for bash, zsh, and fish](https://github.com/vercel-labs/portless/pull/85)                  | implemented differently | `5f20c3c`            | Adds `portless completion <shell>` for bash, zsh, and fish, generated from the current fork command set instead of the stale upstream option list. Includes `get`/`url`, aliases, `clean`, `prune`, `service`, suffix/wildcard/LAN flags, Tailscale, ngrok, NetBird, h2c, path, tunnel, multiplex, and background flags.                                                            |

### Security Decisions To Preserve

- Public exposure stays explicit. NetBird, ngrok, Cloudflare Tunnel, Tailscale Funnel, and Tailscale Service never widen child app binds or imply another public exposure mode.
- Apps remain loopback-bound by default. Do not add an implicit all-interfaces bind for sharing features without a separate reviewed opt-in.
- Managed public exposure records enough PID or alias metadata for crash cleanup and stale-route cleanup.
- WSL trust integration targets the Windows CurrentUser Root store for Windows browsers and removes certificates by SHA-1 fingerprint, not by common name.
- Background apps use owner-only state and log permissions because logs can contain tokens, cookies, request bodies, stack traces, or private URLs.
- Background readiness uses an internal ready-file handshake, not human stdout parsing.
- Background cleanup removes only the exact owned route and sharing metadata. It must not kill arbitrary processes just because they listen on the same port.
- Internal browser pages are intercepted before route dispatch and at reserved hostnames, and user apps cannot claim those reserved names.
- The dashboard is read-only. Do not add browser process-control or mutation endpoints without a separate CSRF and auth design.
- The certificate page exposes only the public CA certificate. It never serves private key material.
- Multiplexing must not rewrite app HTML or response headers.
- h2c upstream support remains explicit through `--h2c` or `PORTLESS_H2C=1`; no backend protocol probing.
- HTTP/2 Extended CONNECT WebSockets reject internal hosts, h2c routes, missing routes, and looped requests; they validate backend `Sec-WebSocket-Accept` before forwarding payload.
- Path routing uses strict segment boundaries and forwards full paths unchanged.
- Public tunnel traffic routes only through exact managed aliases. Arbitrary public Host passthrough remains rejected.

### Retired Implementation Plans

The historical plan files under `docs/superpowers/plans/` were execution scaffolding for the 2026-06-18 upstream PR pass. Their lasting decisions are consolidated in this section, and the plan files were removed after implementation completed.

Retained source assessment:

| Upstream PR | Source details retained                                                                                                                                                                                                                                                     |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #333        | Upstream title `Add background app management`; inspected upstream commit `9d53f313fc073aa75ea58bdbcbf9bc725133fcf4`; upstream branch `bjesuiter/portless:portless-process-control`; upstream surface `bg start`, `stop`, `restart`, `status`, `list`, `logs`, and `clean`. |
| #278        | Upstream title `Fix WebSocket-over-HTTP/2 (RFC 8441 Extended CONNECT) for Turbopack and Vite HMR`; inspected upstream commits `9b41ef966bc039a1d5de23340886e55886c0898c`, `f23b827458b5b8fae5d9865468ed7f6a53654802`, and `c80ff6771315c696fab7240de7d3f513b8f0f6f1`.       |

Retained coverage anchors:

- #333 background coverage: locked registry, private logs, ready-file contract, command parser, foreground flag forwarding, status/list/logs, route identity by hostname and path prefix, stop/restart/clean/prune integration, exact sharing cleanup, `--tail 0`, and docs/help coverage.
- #309 Tailscale Service coverage: service-name normalization, structured Tailscale CLI calls, pending approval parsing, route metadata persistence, env and flag precedence, list/JSON output, child env, conflict handling with Serve/Funnel, and cleanup.
- #278 Extended CONNECT coverage: pure handshake helpers, manual HTTP/1.1 header safety, advertised `SETTINGS_ENABLE_CONNECT_PROTOCOL`, backend accept validation, path-scoped dispatch, exact tunnel alias dispatch, multiplex cookie dispatch, internal host rejection, h2c-route rejection, loop detection, and docs/help coverage.
- #242 h2c coverage: route protocol persistence, alias and run flag parsing, `PORTLESS_H2C=1`, list/JSON markers, h2c request and body streaming, header and trailer forwarding, session reuse and reconnect, mixed HTTP/1.1 and h2c dispatch, and safe 502 behavior.
- #165 path routing coverage: path normalization, invalid path rejection, route identity by hostname and prefix, root-route compatibility, force/remove precision, longest-prefix dispatch, segment-boundary checks, full-path forwarding, alias/get/list visibility, and env/flag precedence.
- #104 tunnel coverage: alias store persistence and validation, exact alias routing, unknown provider rejection, Cloudflare URL parsing and missing-binary errors, structured provider spawning, managed alias cleanup, public Host passthrough rejection, list/JSON output, and `PORTLESS_TUNNEL_URL` child env.
- #212, #240, and #264 UI coverage: shared page shell in `packages/portless/src/pages.ts`, reserved host interception in `proxy.ts`, reserved-name registration rejection, read-only dashboard behavior, public CA-only certificate page, and non-invasive multiplex app picker.

### Full Open Upstream PR State on 2026-06-18

Rechecked against upstream on 2026-06-18: GitHub reported 48 open PRs, and every open PR is listed below with a fork state. Every open PR is implemented, implemented differently, or won't implement.

| PR                                                                                                   | State                   | Fork decision                                                                                                                                                                                                                                        |
| ---------------------------------------------------------------------------------------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [#333 Add background app management](https://github.com/vercel-labs/portless/pull/333)               | implemented differently | Not UI-focused. First-party `portless bg` is implemented with fork-specific CLI lifecycle design: locked state, private logs, readiness handshake, exact route cleanup, and no arbitrary same-port process killing. See consolidated decision above. |
| [#331 Support Laravel port injection](https://github.com/vercel-labs/portless/pull/331)              | implemented             | Laravel `php artisan serve` gets port/host injection in current fork.                                                                                                                                                                                |
| [#329 Improve CLI ergonomics and error responses](https://github.com/vercel-labs/portless/pull/329)  | implemented             | Current fork includes the ergonomic/error handling improvements from the prior backport batch.                                                                                                                                                       |
| [#325 Prefix workspace app names in worktrees](https://github.com/vercel-labs/portless/pull/325)     | implemented             | Worktree prefixes apply to workspace app names.                                                                                                                                                                                                      |
| [#321 Dial loopback upstreams family-agnostically](https://github.com/vercel-labs/portless/pull/321) | implemented             | Proxy upstream dialing handles IPv4/IPv6 loopback selection.                                                                                                                                                                                         |
| [#317 Expose getUrl()](https://github.com/vercel-labs/portless/pull/317)                             | implemented             | Programmatic `getUrl()` API exists.                                                                                                                                                                                                                  |
| [#311 Run cleanup handler on SIGHUP](https://github.com/vercel-labs/portless/pull/311)               | implemented             | Cleanup handles SIGHUP.                                                                                                                                                                                                                              |
| [#309 Tailscale Service sharing mode](https://github.com/vercel-labs/portless/pull/309)              | implemented differently | Implemented as a fork-specific Tailscale Service mode with explicit service-name flag, pending approval metadata, and no implicit Funnel exposure.                                                                                                   |
| [#308 Hostname command injection in hosts sync](https://github.com/vercel-labs/portless/pull/308)    | implemented             | Hosts-file operations avoid shell interpolation and validate/sanitize hostnames.                                                                                                                                                                     |
| [#306 Bypass Windows cmd.exe PATH limit](https://github.com/vercel-labs/portless/pull/306)           | implemented             | Windows spawning bypasses the cmd.exe PATH length limit.                                                                                                                                                                                             |
| [#304 Prefix workspace app URLs in git worktrees](https://github.com/vercel-labs/portless/pull/304)  | implemented             | Covered by the current worktree-prefix implementation.                                                                                                                                                                                               |
| [#303 Forward Vite flags through bun scripts](https://github.com/vercel-labs/portless/pull/303)      | implemented             | Package-script framework flags are forwarded through Bun scripts.                                                                                                                                                                                    |
| [#302 Probe free app ports on 127.0.0.1](https://github.com/vercel-labs/portless/pull/302)           | implemented             | Free app ports are probed on loopback.                                                                                                                                                                                                               |
| [#301 Service wildcard installs](https://github.com/vercel-labs/portless/pull/301)                   | implemented             | Startup service supports wildcard mode.                                                                                                                                                                                                              |
| [#300 Report package config source](https://github.com/vercel-labs/portless/pull/300)                | won't implement         | Reject upstream's enum design; keep fork-specific `sourcePath` behavior from `6ab469f`.                                                                                                                                                              |
| [#295 NetBird sharing](https://github.com/vercel-labs/portless/pull/295)                             | implemented differently | Implemented in `ea60e3b` with safer loopback default and PID cleanup.                                                                                                                                                                                |
| [#292 Expo/Metro localhost docs](https://github.com/vercel-labs/portless/pull/292)                   | won't implement         | See won't-implement table.                                                                                                                                                                                                                           |
| [#286 Sudo state dir and WSL CA trust](https://github.com/vercel-labs/portless/pull/286)             | implemented differently | WSL CA trust implemented in `e989f85`; sudo handling remains fork-owned.                                                                                                                                                                             |
| [#279 .config/portless.json](https://github.com/vercel-labs/portless/pull/279)                       | implemented             | `.config/portless.json` is supported.                                                                                                                                                                                                                |
| [#278 WebSocket-over-HTTP/2 Extended CONNECT](https://github.com/vercel-labs/portless/pull/278)      | implemented differently | RFC 8441 Extended CONNECT support is implemented with strict route selection, exact aliases, h2c-route exclusion, internal-host rejection, loopback-only backend dialing, and accept validation before payload forwarding.                           |
| [#277 Multi-segment custom TLDs](https://github.com/vercel-labs/portless/pull/277)                   | implemented differently | Covered by fork suffix support, including dotted suffixes and `PORTLESS_SUFFIX` precedence.                                                                                                                                                          |
| [#276 VitePress support](https://github.com/vercel-labs/portless/pull/276)                           | implemented             | VitePress auto-port injection exists.                                                                                                                                                                                                                |
| [#275 Tailscale HTTPS readiness](https://github.com/vercel-labs/portless/pull/275)                   | implemented             | Tailscale/Funnel readiness is checked before starting child apps.                                                                                                                                                                                    |
| [#273 Version tip](https://github.com/vercel-labs/portless/pull/273)                                 | won't implement         | See won't-implement table.                                                                                                                                                                                                                           |
| [#272 Wrangler port/ip injection](https://github.com/vercel-labs/portless/pull/272)                  | implemented             | Wrangler gets `--port` and `--ip`.                                                                                                                                                                                                                   |
| [#270 Worktree prefix in monorepo default mode](https://github.com/vercel-labs/portless/pull/270)    | implemented             | Monorepo default mode applies worktree prefixes.                                                                                                                                                                                                     |
| [#264 Multiplexed hostname routing](https://github.com/vercel-labs/portless/pull/264)                | implemented differently | Opt-in `--multiplex`/`--label` with a portless-served app picker and host-scoped selection cookie; no app-HTML/header injection. See consolidated decision above.                                                                                    |
| [#261 Detect npm exec as package runner](https://github.com/vercel-labs/portless/pull/261)           | implemented             | Package-runner detection handles npm exec.                                                                                                                                                                                                           |
| [#257 JSON output for list/get](https://github.com/vercel-labs/portless/pull/257)                    | implemented             | `portless get --json` and `portless list --json` exist.                                                                                                                                                                                              |
| [#247 Only inject portless Node dir on Windows](https://github.com/vercel-labs/portless/pull/247)    | implemented             | Bun/Node PATH handling is fork-adjusted and Windows-safe.                                                                                                                                                                                            |
| [#245 Rsbuild support](https://github.com/vercel-labs/portless/pull/245)                             | implemented             | Rsbuild flag injection exists.                                                                                                                                                                                                                       |
| [#242 h2c upstream support for gRPC](https://github.com/vercel-labs/portless/pull/242)               | implemented differently | Explicit `--h2c` route mode is implemented with unchanged HTTP/1.1 defaults and no protocol probing.                                                                                                                                                 |
| [#240 CA cert download](https://github.com/vercel-labs/portless/pull/240)                            | implemented differently | `cert.<suffix>` page serves only the public `ca.pem` (never the key) with fingerprint and per-OS steps, on explicit user action. See consolidated decision above.                                                                                    |
| [#238 Bun native runtime fast refresh](https://github.com/vercel-labs/portless/pull/238)             | implemented             | Bun native runtime handling avoids HOST-origin breakage.                                                                                                                                                                                             |
| [#237 Warn on LAN plus wildcard](https://github.com/vercel-labs/portless/pull/237)                   | implemented             | LAN/wildcard incompatibility is warned/rejected.                                                                                                                                                                                                     |
| [#212 Web dashboard](https://github.com/vercel-labs/portless/pull/212)                               | implemented differently | Read-only dashboard at `portless.<suffix>` (route/port/exposure/CA status); no cross-origin mutation. Disable with `PORTLESS_DASHBOARD=0`. See consolidated decision above.                                                                          |
| [#167 Command placeholders](https://github.com/vercel-labs/portless/pull/167)                        | implemented             | `{PORT}`, `{HOST}`, and `{PORTLESS_URL}` placeholders exist.                                                                                                                                                                                         |
| [#166 Preserve path in 404 links](https://github.com/vercel-labs/portless/pull/166)                  | implemented             | 404 app links preserve request path.                                                                                                                                                                                                                 |
| [#165 Path-based routing](https://github.com/vercel-labs/portless/pull/165)                          | implemented differently | Explicit `--path` route scopes are implemented with longest-prefix matching, full-path forwarding, and segment-boundary checks.                                                                                                                      |
| [#151 Reserve app ports and validate fixed inputs](https://github.com/vercel-labs/portless/pull/151) | implemented             | Browser-blocked fixed ports are rejected and automatic assignment avoids blocked ports.                                                                                                                                                              |
| [#141 Custom port/host env var names](https://github.com/vercel-labs/portless/pull/141)              | won't implement         | See won't-implement table.                                                                                                                                                                                                                           |
| [#136 Proxy detection behind pf redirects](https://github.com/vercel-labs/portless/pull/136)         | implemented             | Proxy health detection handles redirects.                                                                                                                                                                                                            |
| [#128 Generate CA during trust](https://github.com/vercel-labs/portless/pull/128)                    | implemented             | `portless trust` generates a missing CA.                                                                                                                                                                                                             |
| [#116 Docs chat provider config](https://github.com/vercel-labs/portless/pull/116)                   | won't implement         | See won't-implement table.                                                                                                                                                                                                                           |
| [#104 Tunnel support](https://github.com/vercel-labs/portless/pull/104)                              | implemented differently | Explicit tunnel aliases, managed Cloudflare/ngrok provider selection, and `PORTLESS_TUNNEL_URL` are implemented without arbitrary public Host passthrough.                                                                                           |
| [#91 Docs copy button](https://github.com/vercel-labs/portless/pull/91)                              | won't implement         | See won't-implement table.                                                                                                                                                                                                                           |
| [#85 Shell completions](https://github.com/vercel-labs/portless/pull/85)                             | implemented differently | Implemented in `5f20c3c` with current fork flags.                                                                                                                                                                                                    |
| [#67 Tailscale serve provider mode](https://github.com/vercel-labs/portless/pull/67)                 | implemented differently | Current fork supports Tailscale Serve and Funnel with root-mounted per-app HTTPS ports.                                                                                                                                                              |

## Sync Checklist

1. Start from a clean worktree and create a backup branch at the current fork tip.
2. Fetch `origin` and `upstream` with a working SSH agent.
3. Merge `upstream/main` into local `main`.
4. Resolve conflicts by taking upstream feature code first, then reapply fork invariants from this file.
5. Remove upstream pnpm workspace files if they return.
6. Run the package-name search above and fix every hit outside intentional upstream PR references or compatibility tests.
7. Run `bun install` to refresh `bun.lock`.
8. Compare the live upstream open PR set with "Full Open Upstream PR State" and update that table when upstream opens or closes PRs.
9. Review `git log --oneline upstream/main..HEAD` and update this ledger when the fork adds or removes behavior-protecting fork-only commits. The ledger-maintenance commit itself can be picked up by the next sweep.
10. Run focused tests for any fork invariant touched by the merge.
11. Run full verification before pushing.

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
rg --glob '!FORK.md' --glob '!skills/portless-fork-sync/SKILL.md' 'npm install -g [p]ortless|npm install -D [p]ortless|npm view [p]ortless|"name": "[p]ortless"|github.com/vercel-labs/[p]ortless|node_modules/[p]ortless'
rg 'PORTLESS_TLD' README.md skills/portless/SKILL.md apps/docs/src/app
```

The final `PORTLESS_TLD` search is expected to find only compatibility-alias language.
