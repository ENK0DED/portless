# Portless Fork Notes

This repository is the ENK0DED fork of upstream `vercel-labs/portless`. Keep this file current whenever the fork adds behavior, release policy, package identity, or agent workflow that upstream does not own.

## Fork-Only Commit Ledger

Regenerate the current fork-only history with:

```bash
git log --oneline upstream/main..HEAD
```

Use that log as source material for behavior-protecting fork commits. A commit that only updates this ledger cannot know its own final hash, so it may be absent until the next sweep.

Current fork-owned commits and what they protect:

| Commit    | Purpose                                                                                                                                                                                                |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `e4fb52d` | Switched repository development from pnpm to Bun, replaced lockfiles, updated CI/release scripts, Windows debug bootstrap, package scripts, and agent docs.                                            |
| `293a6cd` | Introduced suffix terminology in docs and comments so custom hostname endings are not described only as top-level domains.                                                                             |
| `7cc4b70` | Centralized TypeScript config, refined CLI and test behavior, added `PORTLESS_SUFFIX`, added dotted suffix validation, added suffix precedence tests, and updated package manager examples to Bun.     |
| `9ef7bdf` | Prepared fork release `0.10.2`.                                                                                                                                                                        |
| `e3bf8af` | Fixed the fork release workflow's npm authentication path.                                                                                                                                             |
| `ce44bb0` | Prepared fork release `0.10.3`.                                                                                                                                                                        |
| `73a8c35` | Prepared fork release `0.10.4`.                                                                                                                                                                        |
| `038a893` | Prepared fork release `0.10.5`.                                                                                                                                                                        |
| `c613379` | Fixed workflow compatibility and changed Turbo package references from `portless#build` to `@enk0ded/portless#build`.                                                                                  |
| `9b84042` | Adjusted CI e2e coverage for the fork's Node matrix.                                                                                                                                                   |
| `2cf517c` | Updated CI to current Node 22 and 24 coverage.                                                                                                                                                         |
| `974f5dc` | Prepared fork release `0.10.6`, the pre-sync fork tip preserved by `backup/pre-upstream-sync-20260617`.                                                                                                |
| `f9b13e1` | Merged upstream `main` into the fork while preserving package identity, version mapping, Bun, suffix behavior, docs, tests, release workflow, Windows debugging, and the fork sync skill.              |
| `275a42a` | Fixed privileged proxy state handoff, added first-class proxy `--suffix` parsing, and documented the protected fork behavior.                                                                          |
| `b0d79c2` | Prepared fork release `0.14.1001` after the upstream `0.14.0` sync.                                                                                                                                    |
| `b929389` | Backported framework port injection coverage for current app runners.                                                                                                                                  |
| `eba7e9a` | Backported loopback upstream dialing and Windows process-spawning fixes.                                                                                                                               |
| `b018cc9` | Backported CLI ergonomics and clearer proxy text errors.                                                                                                                                               |
| `347f32c` | Added `.config/portless.json` support for config files.                                                                                                                                                |
| `514350b` | Exposed the programmatic `getUrl()` API.                                                                                                                                                               |
| `eb1b33b` | Added JSON output for route and URL inspection commands.                                                                                                                                               |
| `3c992f9` | Validated hostnames before hosts-file synchronization to preserve command-injection hardening.                                                                                                         |
| `f795ba3` | Backported loopback port probing and SIGHUP cleanup handling.                                                                                                                                          |
| `874612a` | Backported small upstream runtime safety fixes.                                                                                                                                                        |
| `68ca8cf` | Backported Bun runtime and workspace worktree fixes.                                                                                                                                                   |
| `68f1203` | Rejected browser-blocked fixed app ports and preserved safe automatic app-port assignment.                                                                                                             |
| `ce1eef8` | Generated a missing local CA during the trust helper path.                                                                                                                                             |
| `6023807` | Rejected redirected proxy health checks so stale or intercepted proxy checks do not look healthy.                                                                                                      |
| `22da38e` | Preserved request paths in proxy 404 app links.                                                                                                                                                        |
| `e56911d` | Added exact command placeholders for `{PORT}`, `{HOST}`, and `{PORTLESS_URL}`.                                                                                                                         |
| `ea60e3b` | Added NetBird sharing with explicit restriction flags, loopback-first child binding, route metadata, and cleanup support.                                                                              |
| `e989f85` | Added WSL Windows CurrentUser Root CA store integration while keeping fork-owned sudo state handoff behavior.                                                                                          |
| `5f20c3c` | Added shell completions generated from the current fork command and flag set.                                                                                                                          |
| `6ab469f` | Reported package config source names using the fork's flexible `sourcePath` model.                                                                                                                     |
| `3c435b3` | Recorded upstream PR triage decisions for the implementation pass.                                                                                                                                     |
| `c40774b` | Planned the remaining upstream PR follow-up work before implementation.                                                                                                                                |
| `89ac0a9` | Marked #212, #240, and #264 for dedicated UI-agent handling; #333 was later reassessed as CLI/process work.                                                                                            |
| `07792ee` | Added Tailscale Service sharing as an explicit mode without implying Funnel or public exposure.                                                                                                        |
| `516e2a7` | Added explicit h2c upstream route metadata and forwarding.                                                                                                                                             |
| `8f18de5` | Added explicit path-scoped routes with safe matching semantics.                                                                                                                                        |
| `260825b` | Added explicit tunnel aliases instead of accepting arbitrary public Host passthrough.                                                                                                                  |
| `c7acb0b` | Planned the fork-specific background app management implementation for upstream PR #333.                                                                                                               |
| `33546d8` | Added locked background-app registry primitives.                                                                                                                                                       |
| `500929a` | Added the `portless bg` command surface.                                                                                                                                                               |
| `88ab929` | Started background apps with readiness tracking.                                                                                                                                                       |
| `0789278` | Added background status and log commands.                                                                                                                                                              |
| `9b1d098` | Managed background lifecycle cleanup for stop, restart, clean, and prune flows.                                                                                                                        |
| `0b00b63` | Documented background app management across user and agent surfaces.                                                                                                                                   |
| `0d5feb2` | Marked upstream open PR coverage complete after the UI and CLI/process passes.                                                                                                                         |
| `75e3ace` | Added the local dashboard, certificate page, multiplexed routing, and shared internal-page shell.                                                                                                      |
| `b74f790` | Formatted background lifecycle tests.                                                                                                                                                                  |
| `8043382` | Planned fork-specific HTTP/2 WebSocket compatibility for upstream PR #278.                                                                                                                             |
| `014b6e2` | Added HTTP/2 WebSocket handshake helpers for RFC 8441 Extended CONNECT.                                                                                                                                |
| `907ca07` | Supported browser HTTP/2 Extended CONNECT WebSocket traffic through the proxy.                                                                                                                         |
| `6824fb9` | Covered HTTP/2 WebSocket compatibility paths in tests.                                                                                                                                                 |
| `341b26a` | Guarded HTTP/2 WebSocket session socket access before payload forwarding.                                                                                                                              |
| `ecf8f4a` | Documented HTTP/2 WebSocket support in the user, agent, and CLI help surfaces.                                                                                                                         |
| `cb0d38b` | Refreshed fork sweep records, upstream PR coverage checks, Bun docs drift, and HTTP/2 Extended CONNECT docs-site coverage.                                                                             |
| `29fb586` | Restored the fork verification gate by fixing TypeScript-only test and WSL runtime dependency-injection types.                                                                                         |
| `7f5a036` | Normalized background app source formatting so the repository Prettier gate stays green.                                                                                                               |
| `da69f4f` | Clarified fork-only ledger maintenance expectations.                                                                                                                                                   |
| `62ef55c` | Consolidated upstream open PR triage into one canonical fork ledger and removed retired execution scaffolding.                                                                                         |
| `2a40cff` | Removed obsolete execution-plan references from fork documentation.                                                                                                                                    |
| `9167707` | Updated the fork-only ledger with recent documentation maintenance commits before adding automated enforcement.                                                                                        |
| `6a942d2` | Added a tested fork-only ledger freshness checker and CI enforcement.                                                                                                                                  |
| `72fd965` | Recorded the fork-only ledger guard commits so automated ledger enforcement had a current baseline.                                                                                                    |
| `b6ab543` | Aligned the docs-site service install documentation with preferred suffix terminology.                                                                                                                 |
| `33f013c` | Recorded the docs sweep commits in the fork-only ledger.                                                                                                                                               |
| `1f4e6f9` | Updated the fork-only ledger after the final docs sweep.                                                                                                                                               |
| `5131bb2` | Prepared fork release `0.14.1002` for the upstream PR backport pass.                                                                                                                                   |
| `5d98e81` | Updated the fork-only ledger for the release preparation commit.                                                                                                                                       |
| `68c17ff` | Fixed Windows child command spawning for package-manager and tunnel shims while keeping unsupported background lifecycle tests scoped to macOS and Linux.                                              |
| `b4fdaa1` | Updated the fork-only ledger for the Windows child-spawning portability fix.                                                                                                                           |
| `ab5e32f` | Preserved Windows `Path` inheritance in CLI fixtures that prepend shim directories for child command tests.                                                                                            |
| `69f3d9b` | Updated the fork-only ledger for the Windows path fixture preservation commit.                                                                                                                         |
| `474fbce` | Normalized CLI test harness PATH casing on Windows so shim-based child command fixtures use the intended test PATH.                                                                                    |
| `75b65f8` | Updated the fork-only ledger for the Windows CLI fixture PATH normalization commit.                                                                                                                    |
| `01f4dfa` | Resolved managed tunnel `.cmd` and `.bat` shims for Windows Cloudflare and ngrok preflight checks and startup.                                                                                         |
| `be97903` | Updated the fork-only ledger for the managed tunnel Windows shim fix.                                                                                                                                  |
| `9c2eb09` | Hardened Windows process-spawn-heavy tests and OpenSSL certificate generation timeouts for slow CI hosts.                                                                                              |
| `e8b0fe9` | Updated the fork-only ledger for the Windows timeout hardening commit.                                                                                                                                 |
| `de166e0` | Added Windows managed tunnel and OpenSSL reliability notes to the `0.14.1002` release changelogs.                                                                                                      |
| `ab250bd` | Updated the fork-only ledger for the Windows reliability release-note commit.                                                                                                                          |
| `f22e276` | Merged the signed `prepare-v0.14.1002` release branch into `main` while preserving the upstream PR coverage and release preparation history.                                                           |
| `fa79183` | Updated the fork-only ledger for the signed `prepare-v0.14.1002` release merge commit.                                                                                                                 |
| `16d85ed` | Prepared fork release `0.14.1003` with HMR subprotocol forwarding, privileged `--skip-trust` propagation, CA reuse documentation, and release metadata.                                                |
| `b729e1f` | Updated the fork-only ledger with the release merge and the `0.14.1003` preparation commit.                                                                                                            |
| `e3c746e` | Merged upstream v0.15.5 at `326e893` while preserving fork identity, version mapping, Bun, suffix behavior, docs, tests, release workflow, Windows debugging, and the fork sync skill.                 |
| `05b2c69` | Prepared fork release `0.15.6000` for the post-merge feature batch.                                                                                                                                    |
| `207b3ff` | Updated the fork-only ledger for the `0.15.6000` release preparation commit.                                                                                                                           |
| `dcb43fd` | Added ordered `PORTLESS_SUFFIX` lists, repeatable suffix flags, explicit LAN list preservation, exact `.local` mDNS publishing, and multi-suffix route, TLS, service, and state handling.              |
| `e261c65` | Recorded the release-ledger and ordered suffix-list implementation commits in the fork-only ledger.                                                                                                    |
| `d3c3f57` | Resolved Wayfinder ticket 12 with implementation decisions, coverage, and verification evidence.                                                                                                       |
| `92370cb` | Finalized the suffix-list ledger before the loopback-bind implementation.                                                                                                                              |
| `a8fc980` | Added loopback-by-default proxy and redirect binds with per-target TLS wrappers, LAN-mode widening, and socket-level bind coverage.                                                                    |
| `6d93382` | Recorded the loopback-bind implementation in the fork-only ledger.                                                                                                                                     |
| `c405ea9` | Added exact persisted Tailscale Serve, Funnel, and Service hostname routing while preserving exact tunnel aliases and rejecting unrelated public hosts.                                                |
| `624fd7c` | Resolved Wayfinder ticket 14 with Tailscale hostname routing decisions, coverage, and verification evidence.                                                                                           |
| `e2b89f2` | Recorded the complete fork-only ledger after resolving Tailscale hostname routing ticket 14.                                                                                                           |
| `2959046` | Recorded final ledger verification after ticket 14.                                                                                                                                                    |
| `8fd6bfb` | Injected framework flags through safe Bun, npm, pnpm, and yarn package scripts while preserving fork framework and Windows-spawn behavior.                                                             |
| `e2b237b` | Recorded the package-script flag injection ticket resolution and ledger rows for the 0.15 sync feature batch.                                                                                          |
| `11c28fe` | Proxied cleartext HTTP/1.1 WebSocket upgrades on the TLS port through strict route selection and answered 502 on malformed backend WebSocket handshakes.                                               |
| `df47943` | Merged the ticket 17 worktree branch bringing residual #363 WebSocket behaviors into the sync branch.                                                                                                  |
| `199c5ef` | Excluded the untracked `.scratch` agent tracker directory from the repository Prettier gate.                                                                                                           |
| `e8fab11` | Updated the fork-only ledger for the ticket 15 resolution and the ticket 17 integration merge.                                                                                                         |
| `4b68d8d` | Recorded the `.scratch` Prettier exclusion and integrated ticket-resolution commits in the fork-only ledger.                                                                                           |
| `a455c86` | Added read-only, fork-aware `portless doctor` diagnostics across suffix, bind, state, certificate, routing, background, and sharing surfaces.                                                          |
| `8b25491` | Finalized the `portless doctor` ticket resolution and recorded its implementation in the fork-only ledger.                                                                                             |
| `4dd7f00` | Prepared fork release `0.15.6001` with the six-feature batch changelogs and the `0.15.6002` upstream-PR backport reservation.                                                                          |
| `4a6bacf` | Finalized the `0.15.6001` ledger refresh and resolved Wayfinder ticket 18.                                                                                                                             |
| `5d89151` | Deduplicated same-hostname hosts-file lines and keyed mDNS reload detection on the hostname set to stop publisher churn.                                                                               |
| `a0c4433` | Guided NixOS and unknown Linux distros through CA trust instead of silently assuming the Debian layout, and aligned WSL trust detection with trustCA.                                                  |
| `7fbfcf7` | Hardened Windows cmd shim argument escaping with cmdEscape helpers, outer /s quoting, and /v:off while keeping direct-exe spawning.                                                                    |
| `019eecc` | Added opt-in flat worktree hostnames on a consolidated prefix helper with getUrl parity and collision hashing.                                                                                         |
| `c5fd9e5` | Persisted routes.json atomically with a directory watcher and added a tunable dead-PID stale-route sweep.                                                                                              |
| `0f15a57` | Recorded the final v0.15.6001 ledger cleanup.                                                                                                                                                          |
| `efce0d6` | Merged the ticket 21 worktree branch bringing atomic route persistence and the stale-route sweep into the sync branch.                                                                                 |
| `0581a75` | Merged the ticket 25 worktree branch bringing NixOS CA trust guidance into the sync branch.                                                                                                            |
| `903f79f` | Merged the ticket 26 worktree branch bringing Windows cmd escaping hardening into the sync branch.                                                                                                     |
| `066f906` | Merged the ticket 27 worktree branch bringing flat worktree hostnames into the sync branch.                                                                                                            |
| `91de9c0` | Merged the ticket 20 worktree branch bringing hosts and mDNS deduplication into the sync branch.                                                                                                       |
| `925d875` | Aligned the doctor Windows shim test with the hardened cmd escaping invocation shape.                                                                                                                  |
| `d161f0a` | Recorded the 0.15.6002 backport batch integration in the fork-only ledger.                                                                                                                             |
| `cb33fc7` | Warned on unresolvable registered hostnames with a daemon warn latch, fixed marker-based LAN inference, and deduplicated exact hosts blocks without adding a mutation endpoint.                        |
| `5b057c8` | Merged the ticket 22 worktree branch bringing the hostname resolution warning into the sync branch.                                                                                                    |
| `777ef1d` | Recorded the doctor shim test alignment and backport batch rows in the fork-only ledger.                                                                                                               |
| `1d5ddd2` | Pooled HTTP/1.1 backend connections with a capped loopback keep-alive agent, idempotent-only replay, and shutdown cleanup while keeping upgrade paths unpooled.                                        |
| `accac85` | Merged the ticket 23 worktree branch bringing keep-alive backend pooling into the sync branch.                                                                                                         |
| `3580990` | Recorded the ticket 22 integration rows in the fork-only ledger.                                                                                                                                       |
| `89b151b` | Injected exact persisted Tailscale, ngrok, tunnel, and NetBird hostnames into the Vite allowed-hosts list with no wildcards.                                                                           |
| `0a53cc3` | Merged the ticket 24 worktree branch bringing sharing-hostname Vite allowlisting into the sync branch.                                                                                                 |
| `f032b71` | Recorded the ticket 23 integration rows in the fork-only ledger.                                                                                                                                       |
| `f95d7de` | Added strict path-prefix registration, raw-match verbatim-forward routing with the arbitrated absolute-form handling, per-app path config, multi-app path splitting, and simple routes.json migration. |
| `674074e` | Merged the ticket 28 worktree branch bringing strict multi-app path routing into the sync branch.                                                                                                      |
| `1c66ed3` | Recorded the ticket 24 integration rows in the fork-only ledger.                                                                                                                                       |
| `80a0fc0` | Recorded the ticket 28 integration in the fork-only ledger.                                                                                                                                            |
| `cf009cf` | Rewrote the standing upstream-intake procedure in FORK.md and narrowed the fork-sync skill to canonical-procedure routing and agent hints.                                                             |
| `a29e83b` | Resolved ticket 31 and recorded the standing-procedure and ticket 28 ledger commits.                                                                                                                   |
| `2850ba7` | Added a tested upstream-drift checker for the recorded base, live open-PR set, and optional triage head stamps, with manual CLI and CI test wiring.                                                    |
| `2000772` | Resolved ticket 32 and recorded the upstream-drift checker in the fork-only ledger.                                                                                                                    |
| `b5151e1` | Resolved ticket 29 and recorded the final open-PR triage ledger before provenance stamps were backfilled.                                                                                              |
| `589bb36` | Backfilled 2026-08-14 triage dates and upstream head SHAs for every open-PR ledger row.                                                                                                                |
| `db651e5` | Prepared fork release `0.15.6002` with the nine upstream-PR backport entries, including the Windows cmd.exe security fix and routes.json migration warning.                                            |

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

The current fork release `0.15.6002` tracks upstream `0.15.5` plus the upstream-PR backport batch from tickets 20–28: hosts and mDNS deduplication, atomic route persistence and stale-route cleanup, hostname resolution warnings and LAN inference, keep-alive backend connections, exact sharing hostnames in Vite's allowlist, NixOS and WSL CA trust fixes, hardened Windows cmd.exe escaping, flat worktree hostnames, and path-aware routing and configuration. If the fork ships another local-only change before upstream publishes `0.15.6`, use `0.15.6003`. If upstream publishes `0.15.6`, the first synced fork release should be `0.15.7000`.

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

### Suffix Lists

This fork documents `PORTLESS_SUFFIX` as the preferred environment variable for ordered custom suffix lists. `PORTLESS_TLD` remains a compatibility alias.

Behavior to preserve:

- `PORTLESS_SUFFIX` accepts comma-separated values and is read before `PORTLESS_TLD`
- if both env vars are set, the complete `PORTLESS_SUFFIX` list wins
- empty values fall back to the default suffix `localhost`
- list members are trimmed, lowercased, and deduplicated in order
- single-label suffixes such as `test` are valid
- dotted suffixes such as `acme.com` and `server01.acme.com` are valid
- labels may contain lowercase letters, digits, and hyphens
- labels must start and end with a letter or digit
- labels must be 63 characters or less
- each full suffix and generated hostname must be 253 characters or less
- leading dots, trailing dots, and consecutive dots are invalid
- risky suffix warnings match exact ownership-class entries such as bare `com`, while the tree-wide `local`, `dev`, and `app` risks also apply to dotted suffixes ending in those labels
- warnings apply independently to every configured suffix; LAN mode suppresses only the appended `local` member
- host parsing and proxy routing must support dotted and overlapping suffixes, matching the longest suffix first
- invalid persisted list entries are skipped with a warning without discarding valid entries
- service installs write the complete list to `PORTLESS_SUFFIX`, never `PORTLESS_TLD`, in native service environments
- `portless service install --suffix <suffix>` and `portless proxy start --suffix <suffix>` are preferred and repeatable
- repeatable `--tld <tld>` remains a compatibility alias
- explicit suffix configuration is carried as data; it must not be reconstructed from list contents
- explicit LAN lists are preserved in order with `local` appended when absent; plain LAN mode remains `local` only
- LAN exposure is persisted separately from suffixes and must never be inferred from list membership
- mDNS publishes only exact `.local` hostnames and never synthesizes `.local` for another suffix
- `proxy.tlds` persists the complete list; `proxy.tld` remains the primary-suffix compatibility marker for upstream and older local installs

Coverage:

- `packages/portless/src/cli-utils.test.ts` covers list parsing, precedence, normalization, validation, persistence, invalid-entry recovery, and LAN explicitness
- `packages/portless/src/cli.test.ts` covers repeated proxy `--suffix` flags, list persistence, and multi-suffix alias registration
- `packages/portless/src/utils.test.ts` covers dotted suffix parsing and longest-suffix-first hostname parsing
- `packages/portless/src/proxy.test.ts` covers dotted routing, overlapping suffix suggestions, and internal pages on secondary suffixes
- `packages/portless/src/service.test.ts` covers list persistence through `PORTLESS_SUFFIX`, repeated `--suffix`, and explicit LAN list preservation
- `packages/portless/src/mdns.test.ts` covers the exact `.local` guard for mixed LAN suffix lists
- `packages/portless/src/cli.ts` help output documents `PORTLESS_SUFFIX` first
- `README.md` and `skills/portless/SKILL.md` document `PORTLESS_SUFFIX` first

Do not let an upstream merge restore a singleton or single-label-only model, reintroduce suffix-derived LAN exposure, or replace fork docs with only `PORTLESS_TLD`.

### Privileged Proxy State Handoff

This fork keeps all proxy state in the invoking user's state directory by default. That must continue to hold even when the proxy needs sudo for ports 80 or 443.

Behavior to preserve:

- `resolveStateDir()` returns `~/.portless` unless `PORTLESS_STATE_DIR` is set
- direct `sudo portless ...` invocations must resolve `SUDO_USER` to the invoking user's home so inbound privileged commands use the same state directory
- sudo proxy starts must run through `sudo env` and pass the resolved `PORTLESS_STATE_DIR`
- sudo proxy stops must also pass the resolved `PORTLESS_STATE_DIR`
- `buildSudoEnvArgs()` should preserve existing `PORTLESS_*` values, preserve `HOME`, and allow explicit overrides
- passwordless sudo must not make the proxy fall back to root's default config when the user has configured `PORTLESS_SUFFIX`, `PORTLESS_PORT`, `PORTLESS_HTTPS`, or another `PORTLESS_*` value
- sudo proxy starts must pass `--skip-trust` through the privileged re-exec command when the user provided it
- generated CA and server certificate files should be created under the resolved state directory and reused across proxy restarts
- deleting or cleaning CA/certificate files is expected to rotate the CA on the next HTTPS proxy start

Coverage:

- `packages/portless/src/cli-utils.test.ts` covers sudo environment argument construction
- `packages/portless/src/cli.test.ts` covers `proxy start --suffix` writing the persisted suffix state
- `packages/portless/src/cli.test.ts` covers `--skip-trust` propagation through the sudo re-exec command

### HTTP/2 WebSocket HMR Compatibility

This fork supports browser HMR WebSockets over HTTPS HTTP/2 through RFC 8441 Extended CONNECT.

Behavior to preserve:

- the proxy must advertise `SETTINGS_ENABLE_CONNECT_PROTOCOL` on HTTP/2 TLS sessions
- Extended CONNECT WebSockets must use the same strict route selection rules as HTTP requests
- internal hostnames, h2c upstream routes, missing routes, and forwarding loops must be rejected
- Extended CONNECT backend WebSocket upgrades must validate `Sec-WebSocket-Accept` before any backend payload is forwarded
- when the browser requests a single `Sec-WebSocket-Protocol`, the HTTP/2 response must include that subprotocol and the backend must echo the same value before payload forwarding starts
- Vite and Nuxt HMR rely on this subprotocol path for `vite-hmr`

Coverage:

- `packages/portless/src/proxy.test.ts` covers RFC 8441 Extended CONNECT WebSocket bridging
- `packages/portless/src/proxy.test.ts` covers negotiated WebSocket subprotocol forwarding
- `packages/portless/src/h2-websocket.test.ts` covers the HTTP/2 WebSocket handshake helper

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

This fork audits every open upstream PR in `vercel-labs/portless`. The current ledger uses only these final states:

- `implemented`: the fork contains materially equivalent behavior.
- `implemented differently`: the fork contains the behavior but changed design, names, safety defaults, or integration shape.
- `won't implement`: the fork intentionally rejects the change.

State-choice rule: use `implemented differently` whenever the fork changes the upstream surface, safety default, or integration shape. Use `implemented` when the fork ends up materially equivalent to upstream. These are final states for the code present at the audit date, not promises for future work.

If a future upstream PR pass needs temporary `planned` or `deferred` states, keep that discussion in this section with a concrete owner, date, and decision checkpoint. Do not leave current open PRs in temporary states after implementation work finishes.

### 2026-08-14 Current Result

Rechecked against upstream on 2026-08-14: GitHub reported 52 open PRs. Every open PR is listed below and has a final fork state: 26 implemented, 19 implemented differently, and 7 won't implement.

The ten PRs that closed since the 2026-06-18 pass were all closed unmerged: #321, #303, #302, #301, #300, #292, #286, #278, #277, and #67. None will arrive through the v0.15 sync, so their fork decisions stand independently. They are intentionally absent from the open-PR table below; retained non-direct-merge rows preserve the decisions that still need historical context.

### Consolidated Non-Direct-Merge Decisions

| Upstream PR                                                                                                              | State                   | Fork commit evidence            | Decision and preserved rationale                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------------------------------------------------------ | ----------------------- | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [#383 Atomic routes.json writes and stale-route sweep](https://github.com/vercel-labs/portless/pull/383)                 | implemented differently | `c5fd9e5`                       | Backports atomic routes writes and stale-route cleanup with temp-file mode and ownership handling, lock coordination, and directory watching so consecutive renames still reload. The sweep also preserves the fork's exact sharing cleanup.                                                                                                                                                                    |
| [#377 Flat worktree hostnames](https://github.com/vercel-labs/portless/pull/377)                                         | implemented differently | `019eecc`                       | Adds an opt-in flat hostname mode through a consolidated prefix helper, with a `portless.json` setting, environment precedence, collision hashing, and route metadata preservation that upstream lacks.                                                                                                                                                                                                         |
| [#374 Unresolvable-hostname warning and hosts sync](https://github.com/vercel-labs/portless/pull/374)                    | implemented differently | `cb33fc7`                       | Adopts resolution warnings, the hosts-sync failure latch, and LAN-mode inference. It deliberately omits `POST /.portless/hosts-sync`: the watcher and polling fallback already converge quickly, so the endpoint is declined on simplicity and surface-area grounds rather than as a blanket security claim.                                                                                                    |
| [#371 Keep-alive upstream agent](https://github.com/vercel-labs/portless/pull/371)                                       | implemented             | `1d5ddd2`                       | The fork's capped per-proxy keep-alive agent is materially equivalent for ordinary HTTP/1.1 forwarding. WebSocket, h2c, and Extended CONNECT paths retain their specialized handling.                                                                                                                                                                                                                           |
| [#360 RFC 8441 WebSocket](https://github.com/vercel-labs/portless/pull/360)                                              | implemented differently | `014b6e2`..`11c28fe`            | The fork's RFC 8441 implementation keeps stricter route, host, protocol, and backend-accept validation. Upstream superseded #360 with merged #363, but the fork's #278-lineage design remains intentionally different.                                                                                                                                                                                          |
| [#359 Windows command escaping](https://github.com/vercel-labs/portless/pull/359)                                        | implemented differently | `7fbfcf7`                       | Adopts hardened `windowsArgvQuote` and `cmdEscape` handling, including outer `/s /c` quoting for `.cmd` and `.bat` shims, while preserving the fork's direct-executable spawning instead of routing every child through `cmd.exe`. This is a security fix for untrusted script names and forwarded arguments; package script bodies already have code-execution authority.                                      |
| [#354 Windows argument escaping](https://github.com/vercel-labs/portless/pull/354)                                       | implemented differently | `68c17ff`                       | The headline vulnerable path is already absent because the fork spawns direct executables. The broader escaping defects are covered by #359's backport, so this remains a fork-shaped implementation rather than an upstream copy.                                                                                                                                                                              |
| [#351 NixOS and unknown-distro CA trust](https://github.com/vercel-labs/portless/pull/351)                               | implemented             | `a0c4433`                       | Adds NixOS and generic manual trust guidance and aligns WSL trust detection with either-store success while retaining the fork's error wrapping and injectable cleanup behavior.                                                                                                                                                                                                                                |
| [#350 Tailscale hosts in Vite's allowlist](https://github.com/vercel-labs/portless/pull/350)                             | implemented differently | `89b151b`                       | Adds exact lower-case persisted hostnames for Tailscale, ngrok, managed tunnels, and NetBird. The fork rejects blanket `.ts.net` or sharing-host wildcards and extends the allowlist to all managed sharing modes.                                                                                                                                                                                              |
| [#348 Preserve custom suffixes in LAN mode](https://github.com/vercel-labs/portless/pull/348)                            | implemented differently | `dcb43fd`                       | **Reversed from the research recommendation.** Once ticket 12 put ordered suffix lists in scope, the fork adopted LAN preservation in its list model and guarded `mdnsFqdn()` against doubled `.local` publication.                                                                                                                                                                                             |
| [#342 `PORTLESS_STATE_DIR` deletion](https://github.com/vercel-labs/portless/pull/342)                                   | won't implement         | this file                       | The threat model does not hold, and the proposed homedir restriction would break the fork's sudo state-handoff invariant. Keep the explicit state-directory behavior and its owner-aware cleanup.                                                                                                                                                                                                               |
| [#341 Uppercase scheme in `parseHostname`](https://github.com/vercel-labs/portless/pull/341)                             | won't implement         | this file                       | Execution disproves the report's premise: the fork throws on the uppercase scheme rather than silently returning an unsafe parse result. No behavior change is warranted.                                                                                                                                                                                                                                       |
| [#340 Worktree hostname template](https://github.com/vercel-labs/portless/pull/340)                                      | won't implement         | `019eecc`                       | The `{name}` template overlaps the flat-worktree problem without its collision validation, and it would drop route metadata. The fork's consolidated helper provides the safer scoped alternative.                                                                                                                                                                                                              |
| [#335 Custom ngrok URLs](https://github.com/vercel-labs/portless/pull/335)                                               | implemented differently | `260825b`                       | Exact managed tunnel aliases cover the use case with provider lifecycle, route validation, cleanup, and no arbitrary public Host passthrough. This is safer and more explicit than accepting custom public host input.                                                                                                                                                                                          |
| [#333 Add background app management](https://github.com/vercel-labs/portless/pull/333)                                   | implemented differently | `33546d8`..`0b00b63`            | Reassessed on 2026-06-18 as CLI/process supervision, not UI work. Implements `portless bg` with a locked registry, owner-only state and log permissions, private logs, readiness-file handshakes, status/list/logs, graceful stop/restart/clean, `clean`/`prune` integration, exact route cleanup, and no arbitrary same-port process killing.                                                                  |
| [#309 Tailscale Service sharing mode](https://github.com/vercel-labs/portless/pull/309)                                  | implemented differently | `07792ee`                       | Adds `--tailscale-service`, `--tailscale-service-name <name>`, `PORTLESS_TAILSCALE_SERVICE=1`, and `PORTLESS_TAILSCALE_SERVICE_NAME`. The fork treats Service as an additional Tailscale mode beside Serve and Funnel, persists URL and pending approval metadata, uses explicit service names instead of optional flag values, and never implies Funnel or public exposure.                                    |
| [#300 Report package config source](https://github.com/vercel-labs/portless/pull/300)                                    | won't implement         | `6ab469f`                       | Reject upstream's enum-shaped source model. The fork's `LoadedConfig.sourcePath` display is more flexible and already distinguishes `package.json`, `portless.json`, and `.config/portless.json`.                                                                                                                                                                                                               |
| [#295 Add NetBird sharing with auth flags and end-to-end reachability](https://github.com/vercel-labs/portless/pull/295) | implemented differently | `ea60e3b`                       | Adds NetBird expose support, auth flags and env vars, route URL/PID metadata, child `PORTLESS_NETBIRD_URL`, stale expose cleanup in `clean`/`prune`, and docs. The fork keeps child apps bound to `127.0.0.1` by default and warns when NetBird is used without password, PIN, or groups.                                                                                                                       |
| [#292 Expo/Metro Node 17 localhost docs](https://github.com/vercel-labs/portless/pull/292)                               | won't implement         | `f795ba3`, `68ca8cf`            | Current code-level loopback dialing and Expo LAN behavior is better than documenting an older Node 17 workaround. If Expo regressions return, document current fork behavior instead of the stale workaround.                                                                                                                                                                                                   |
| [#286 resolve sudo state dir and trust Windows CA store from WSL](https://github.com/vercel-labs/portless/pull/286)      | implemented             | `275a42a`, `e989f85`, `8d04fb8` | Combines upstream's inbound `SUDO_USER` home resolution with the fork's outbound `PORTLESS_STATE_DIR` and `PORTLESS_*` sudo environment handoff. WSL trust and cleanup cover both Linux and the Windows CurrentUser Root store, preserve CA identity when cleanup must be retried, and remove certificates by fingerprint.                                                                                      |
| [#278 WebSocket-over-HTTP/2 Extended CONNECT](https://github.com/vercel-labs/portless/pull/278)                          | implemented differently | `014b6e2`..`ecf8f4a`            | Adds RFC 8441 Extended CONNECT for browser HMR WebSockets over HTTPS HTTP/2. Preserves strict route selection, exact tunnel aliases, path prefixes, multiplex selection cookies, internal reserved hosts, h2c-route exclusion, loopback-only backend dialing, manual HTTP/1.1 header safety checks, negotiated subprotocol forwarding, and `Sec-WebSocket-Accept` validation before forwarding backend payload. |
| [#273 Add a tip about versions](https://github.com/vercel-labs/portless/pull/273)                                        | won't implement         | this file                       | The fork has its own version mapping and release policy documented here. A generic upstream version tip would be confusing for `@enk0ded/portless`.                                                                                                                                                                                                                                                             |
| [#264 Multiplexed hostname routing](https://github.com/vercel-labs/portless/pull/264)                                    | implemented differently | `75e3ace`                       | Adds opt-in `--multiplex` and `--label` for multiple apps sharing one hostname. Selection uses a portless-served app picker plus a host-scoped cookie read before route lookup. The fork deliberately does not inject into or rewrite app HTML or headers, avoiding Content-Length, encoding, Set-Cookie, and auth-redirect breakage. Single-owner routing is unchanged by default.                             |
| [#242 h2c upstream support for gRPC](https://github.com/vercel-labs/portless/pull/242)                                   | implemented differently | `516e2a7`                       | Adds explicit `--h2c`, `PORTLESS_H2C=1`, alias support, route metadata, list/JSON markers, upstream HTTP/2 cleartext forwarding, stream and trailer handling, cached upstream session cleanup, and unchanged HTTP/1.1 defaults. There is no backend protocol probing.                                                                                                                                           |
| [#240 CA cert download](https://github.com/vercel-labs/portless/pull/240)                                                | implemented differently | `75e3ace`                       | Adds the reserved `cert.<suffix>` page. It serves only the public `ca.pem`, never the private key, shows the SHA-256 fingerprint, gives per-OS install steps, and requires explicit user action before download. `portless trust` remains the host-machine trust path.                                                                                                                                          |
| [#212 Web dashboard](https://github.com/vercel-labs/portless/pull/212)                                                   | implemented differently | `75e3ace`                       | Adds the reserved read-only dashboard at `portless.<suffix>` with routes, ports, public exposure, CA trust status, live refresh, and copy/open affordances. It has no cross-origin mutation endpoints and never controls processes from the browser. The dashboard can be disabled with `PORTLESS_DASHBOARD=0`.                                                                                                 |
| [#165 Path-based routing](https://github.com/vercel-labs/portless/pull/165)                                              | implemented differently | `8f18de5`, `5d89151`, `f95d7de` | Re-triaged after upstream's 2026-07-15 expansion. The routing engine remains a stricter superset with raw matching, full-path forwarding, longest-prefix dispatch, and segment boundaries; tickets 20 and 28 backported same-host hosts/mDNS dedupe, per-app `path` config, multi-app splitting, and sharing-URL integration.                                                                                   |
| [#141 Custom port/host variable names](https://github.com/vercel-labs/portless/pull/141)                                 | won't implement         | `e56911d`                       | Exact command placeholders `{PORT}`, `{HOST}`, and `{PORTLESS_URL}` cover the practical need more explicitly than global custom env-var-name indirection. Do not add `--port-var` or `--host-var` unless a later real-world tool proves placeholders and standard `PORT`/`HOST` cannot work.                                                                                                                    |
| [#116 configurable docs chat provider and MiniMax support](https://github.com/vercel-labs/portless/pull/116)             | won't implement         | this file                       | The docs chat is not part of the portless runtime surface. Adding third-party LLM provider config increases maintenance and secret-handling surface for this fork.                                                                                                                                                                                                                                              |
| [#104 tunnel support](https://github.com/vercel-labs/portless/pull/104)                                                  | implemented differently | `260825b`                       | Adds `portless tunnel map/list/unmap`, generic `--tunnel <provider>` for `cloudflare` and `ngrok`, Cloudflare Quick Tunnel support through `cloudflared`, `PORTLESS_TUNNEL_URL`, managed tunnel cleanup, and exact aliases in `tunnel-aliases.json`. It checks local routes before aliases, rejects wildcard tunnel hosts, and never accepts arbitrary public Host passthrough.                                 |
| [#91 docs code block copy button](https://github.com/vercel-labs/portless/pull/91)                                       | won't implement         | this file                       | This is docs-site polish, not a runtime or fork-invariant improvement. Reconsider only during a deliberate docs UX pass.                                                                                                                                                                                                                                                                                        |
| [#85 shell completion command for bash, zsh, and fish](https://github.com/vercel-labs/portless/pull/85)                  | implemented differently | `5f20c3c`                       | Adds `portless completion <shell>` for bash, zsh, and fish, generated from the current fork command set instead of the stale upstream option list. Includes `get`/`url`, aliases, `clean`, `prune`, `service`, suffix/wildcard/LAN flags, Tailscale, ngrok, NetBird, h2c, path, tunnel, multiplex, and background flags.                                                                                        |

### Security Decisions To Preserve

- Public exposure stays explicit. NetBird, ngrok, Cloudflare Tunnel, Tailscale Funnel, and Tailscale Service never widen child app binds or imply another public exposure mode.
- The proxy binds only to 127.0.0.1 and ::1 by default; widening it is explicit through LAN mode alone.
- Apps remain loopback-bound by default. Do not add an implicit all-interfaces bind for sharing features without a separate reviewed opt-in.
- Managed public exposure records enough PID or alias metadata for crash cleanup and stale-route cleanup.
- WSL trust integration targets the Windows CurrentUser Root store for Windows browsers and removes certificates by SHA-1 fingerprint, not by common name.
- Background apps use owner-only state and log permissions because logs can contain tokens, cookies, request bodies, stack traces, or private URLs.
- Background readiness uses an internal ready-file handshake, not human stdout parsing.
- Background cleanup removes only the exact owned route and sharing metadata. It must not kill arbitrary processes just because they listen on the same port.
- Internal browser pages are intercepted before route dispatch and at reserved hostnames, and user apps cannot claim those reserved names.
- The dashboard remains read-only as a simplicity and surface-area policy. Do not add browser process-control or mutation endpoints merely for convenience. A security-grade exception requires either an owner-only IPC channel or a capability token in a non-simple request header.
- The certificate page exposes only the public CA certificate. It never serves private key material.
- Multiplexing must not rewrite app HTML or response headers.
- h2c upstream support remains explicit through `--h2c` or `PORTLESS_H2C=1`; no backend protocol probing.
- HTTP/2 Extended CONNECT WebSockets reject internal hosts, h2c routes, missing routes, and looped requests; they forward a single negotiated subprotocol such as `vite-hmr` and validate backend `Sec-WebSocket-Accept` before forwarding payload.
- Path routing uses strict segment boundaries and forwards full paths unchanged.
- Tailscale Serve, Funnel, and Service traffic routes only through exact persisted route hostnames. Unrelated `.ts.net` hosts and arbitrary public Host passthrough remain rejected.
- Public tunnel traffic routes only through exact managed aliases. Arbitrary public Host passthrough remains rejected.

### Retained Source And Coverage Notes

The following source assessments and coverage anchors are part of the permanent upstream PR ledger for the 2026-06-18 implementation pass.

Retained source assessment:

| Upstream PR | Source details retained                                                                                                                                                                                                                                                     |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #333        | Upstream title `Add background app management`; inspected upstream commit `9d53f313fc073aa75ea58bdbcbf9bc725133fcf4`; upstream branch `bjesuiter/portless:portless-process-control`; upstream surface `bg start`, `stop`, `restart`, `status`, `list`, `logs`, and `clean`. |
| #278        | Upstream title `Fix WebSocket-over-HTTP/2 (RFC 8441 Extended CONNECT) for Turbopack and Vite HMR`; inspected upstream commits `9b41ef966bc039a1d5de23340886e55886c0898c`, `f23b827458b5b8fae5d9865468ed7f6a53654802`, and `c80ff6771315c696fab7240de7d3f513b8f0f6f1`.       |

Retained coverage anchors:

- #333 background coverage: locked registry, private logs, ready-file contract, command parser, foreground flag forwarding, status/list/logs, route identity by hostname and path prefix, stop/restart/clean/prune integration, exact sharing cleanup, `--tail 0`, and docs/help coverage.
- #309 Tailscale Service coverage: service-name normalization, structured Tailscale CLI calls, pending approval parsing, route metadata persistence, env and flag precedence, list/JSON output, child env, conflict handling with Serve/Funnel, and cleanup.
- #278 Extended CONNECT coverage: pure handshake helpers, manual HTTP/1.1 header safety, advertised `SETTINGS_ENABLE_CONNECT_PROTOCOL`, backend accept validation, negotiated subprotocol forwarding, path-scoped dispatch, exact tunnel alias dispatch, multiplex cookie dispatch, internal host rejection, h2c-route rejection, loop detection, and docs/help coverage.
- #242 h2c coverage: route protocol persistence, alias and run flag parsing, `PORTLESS_H2C=1`, list/JSON markers, h2c request and body streaming, header and trailer forwarding, session reuse and reconnect, mixed HTTP/1.1 and h2c dispatch, and safe 502 behavior.
- #165 path routing coverage: path normalization, invalid path rejection, route identity by hostname and prefix, root-route compatibility, force/remove precision, longest-prefix dispatch, segment-boundary checks, full-path forwarding, alias/get/list visibility, and env/flag precedence.
- #104 tunnel coverage: alias store persistence and validation, exact alias routing, unknown provider rejection, Cloudflare URL parsing and missing-binary errors, structured provider spawning, managed alias cleanup, public Host passthrough rejection, list/JSON output, and `PORTLESS_TUNNEL_URL` child env.
- #352 Tailscale hostname coverage: exact `tailscaleUrl` and `tailscaleServiceUrl` routing, path-aware and port-normalized authority selection, and rejection of unrelated `.ts.net` hosts.
- #212, #240, and #264 UI coverage: shared page shell in `packages/portless/src/pages.ts`, reserved host interception in `proxy.ts`, reserved-name registration rejection, read-only dashboard behavior, public CA-only certificate page, and non-invasive multiplex app picker.

### Full Open Upstream PR State on 2026-08-14

Rechecked against upstream on 2026-08-14: GitHub reported 52 open PRs, and every open PR is listed below with a final fork state. Every open PR is implemented, implemented differently, or won't implement.

Stamp convention: the triage date below records the 2026-08-14 verification pass. PRs whose decisions remain from 2026-06-18 keep those decisions because ticket 02 verified that they were unchanged, but receive today's date and upstream head SHA here; PRs re-triaged or first triaged in this pass use the same date. `bun run check:upstream-drift` compares each recorded upstream head SHA with the live PR head.

| PR                                                                                                       | State                   | Fork decision                                                                                                                                                                                                                                                                                                                 | Triage date | Upstream head SHA                          |
| -------------------------------------------------------------------------------------------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ------------------------------------------ |
| [#383 Atomic routes.json writes and stale-route sweep](https://github.com/vercel-labs/portless/pull/383) | implemented differently | Atomic routes writes, stale-route cleanup, lock coordination, and directory watching are fork-shaped in `c5fd9e5`; exact sharing cleanup is preserved.                                                                                                                                                                        | 2026-08-14  | `41dc49cfe94763cb940a7fd778f78f2ac398011c` |
| [#377 Flat worktree hostnames](https://github.com/vercel-labs/portless/pull/377)                         | implemented differently | Opt-in flat hostnames use the consolidated prefix helper, config and environment precedence, collision hashing, and preserved route metadata in `019eecc`.                                                                                                                                                                    | 2026-08-14  | `9bf71d1054c8d924f14b9b4757b42c69cf061c12` |
| [#374 Unresolvable-hostname warning and hosts sync](https://github.com/vercel-labs/portless/pull/374)    | implemented differently | `cb33fc7` adds warnings, a failure latch, and LAN inference. The upstream sync endpoint is omitted as unnecessary polling and watcher surface; this is a simplicity decision, not a blanket security claim.                                                                                                                   | 2026-08-14  | `5b536e919b488e1de7fb0ae6f022093a008ba3a`  |
| [#371 Keep-alive upstream agent](https://github.com/vercel-labs/portless/pull/371)                       | implemented             | HTTP/1.1 forwarding uses the materially equivalent capped keep-alive agent from `1d5ddd2`.                                                                                                                                                                                                                                    | 2026-08-14  | `d7fc97dde0ba97683d092ab3a0cd9aee02f94d53` |
| [#360 RFC 8441 WebSocket](https://github.com/vercel-labs/portless/pull/360)                              | implemented differently | The fork's stricter #278-lineage Extended CONNECT implementation in `014b6e2`..`11c28fe` differs from upstream's superseded design.                                                                                                                                                                                           | 2026-08-14  | `016dc88878371ff1cec59f565fd0a55b8bc5693a` |
| [#359 Windows command escaping](https://github.com/vercel-labs/portless/pull/359)                        | implemented differently | `7fbfcf7` hardens `.cmd` and `.bat` shim escaping while retaining direct executable spawning. This is a security fix for untrusted script names and forwarded arguments.                                                                                                                                                      | 2026-08-14  | `c4d1bf8cef5b245f8868a92e25594f60fa996509` |
| [#354 Windows argument escaping](https://github.com/vercel-labs/portless/pull/354)                       | implemented differently | The original direct-executable fix is in `68c17ff`; the broader escaping coverage is in #359's `7fbfcf7`.                                                                                                                                                                                                                     | 2026-08-14  | `a3d34e8b9e2323812b4b3af839b4c8f523f2fa9c` |
| [#351 NixOS and unknown-distro CA trust](https://github.com/vercel-labs/portless/pull/351)               | implemented             | NixOS and generic trust guidance plus WSL either-store detection landed materially equivalent in `a0c4433`.                                                                                                                                                                                                                   | 2026-08-14  | `9fa1dd56afa6495862cbdf19d4489146296cc597` |
| [#350 Tailscale hosts in Vite's allowlist](https://github.com/vercel-labs/portless/pull/350)             | implemented differently | `89b151b` allows exact persisted sharing hostnames for all managed modes, without blanket `.ts.net` or sharing-host wildcards.                                                                                                                                                                                                | 2026-08-14  | `ae7b2ef2503866e56773a1d4abdd688248b6b1c0` |
| [#348 Preserve custom suffixes in LAN mode](https://github.com/vercel-labs/portless/pull/348)            | implemented differently | Reversed after ticket 12: `dcb43fd` adopts fork-shaped suffix-list LAN preservation and guards mDNS from doubled `.local` publication.                                                                                                                                                                                        | 2026-08-14  | `36c31a04c5548b70273c2acd2b49f9ffc63589ef` |
| [#342 `PORTLESS_STATE_DIR` deletion](https://github.com/vercel-labs/portless/pull/342)                   | won't implement         | The threat model is invalid and the proposed homedir restriction conflicts with the sudo state-handoff invariant.                                                                                                                                                                                                             | 2026-08-14  | `129331e681f6962977b5cddd9ad18f5218c8b404` |
| [#341 Uppercase scheme in `parseHostname`](https://github.com/vercel-labs/portless/pull/341)             | won't implement         | Execution shows the fork throws instead of silently accepting the reported parse, so no fix is needed.                                                                                                                                                                                                                        | 2026-08-14  | `fa87b5cd34154543ca555caafd79a0ea776f6ce2` |
| [#340 Worktree hostname template](https://github.com/vercel-labs/portless/pull/340)                      | won't implement         | Overlaps #377, lacks its collision and output validation, and would drop route metadata.                                                                                                                                                                                                                                      | 2026-08-14  | `65ee36031aa13fb5576b41433acdb961dc2e5c58` |
| [#335 Custom ngrok URLs](https://github.com/vercel-labs/portless/pull/335)                               | implemented differently | Exact managed tunnel aliases in `260825b` cover custom URLs with explicit validation and cleanup instead of arbitrary public Host passthrough.                                                                                                                                                                                | 2026-08-14  | `bb14b3bcff6551cf5d6258be31ff8e0d2cfab22f` |
| [#333 Add background app management](https://github.com/vercel-labs/portless/pull/333)                   | implemented differently | Not UI-focused. First-party `portless bg` is implemented with fork-specific CLI lifecycle design: locked state, private logs, readiness handshake, exact route cleanup, and no arbitrary same-port process killing. See consolidated decision above.                                                                          | 2026-08-14  | `985a2d4eb68e01375f4ea02adc136cafa42f685d` |
| [#331 Support Laravel port injection](https://github.com/vercel-labs/portless/pull/331)                  | implemented             | Laravel `php artisan serve` gets port/host injection in current fork.                                                                                                                                                                                                                                                         | 2026-08-14  | `0a6d89e16f53cd10c92bd211875f85df91c9bf74` |
| [#329 Improve CLI ergonomics and error responses](https://github.com/vercel-labs/portless/pull/329)      | implemented             | Current fork includes the ergonomic/error handling improvements from the prior backport batch.                                                                                                                                                                                                                                | 2026-08-14  | `21f4919e78b68954b3ca272df4e56ac5476f060f` |
| [#325 Prefix workspace app names in worktrees](https://github.com/vercel-labs/portless/pull/325)         | implemented             | Worktree prefixes apply to workspace app names.                                                                                                                                                                                                                                                                               | 2026-08-14  | `d47399bf0b70ff717a23d31f0a0514e2a909ed77` |
| [#317 Expose getUrl()](https://github.com/vercel-labs/portless/pull/317)                                 | implemented             | Programmatic `getUrl()` API exists.                                                                                                                                                                                                                                                                                           | 2026-08-14  | `e5c2771d81883eada232ce958f83ad777facff5f` |
| [#311 Run cleanup handler on SIGHUP](https://github.com/vercel-labs/portless/pull/311)                   | implemented             | Cleanup handles SIGHUP.                                                                                                                                                                                                                                                                                                       | 2026-08-14  | `084e363d745e6c90f8faccb6c5dc20ce50ccc18a` |
| [#309 Tailscale Service sharing mode](https://github.com/vercel-labs/portless/pull/309)                  | implemented differently | Implemented as a fork-specific Tailscale Service mode with explicit service-name flag, pending approval metadata, and no implicit Funnel exposure.                                                                                                                                                                            | 2026-08-14  | `15460a1569a8c924de54d7698c591b60772d824e` |
| [#308 Hostname command injection in hosts sync](https://github.com/vercel-labs/portless/pull/308)        | implemented             | Hosts-file operations avoid shell interpolation and validate/sanitize hostnames.                                                                                                                                                                                                                                              | 2026-08-14  | `1763523d4d89154c2db6d609f098e5b61107b030` |
| [#306 Bypass Windows cmd.exe PATH limit](https://github.com/vercel-labs/portless/pull/306)               | implemented             | Windows spawning bypasses the cmd.exe PATH length limit.                                                                                                                                                                                                                                                                      | 2026-08-14  | `4a14c6294a26853107f20ab0eee2c21af3b208d0` |
| [#304 Prefix workspace app URLs in git worktrees](https://github.com/vercel-labs/portless/pull/304)      | implemented             | Covered by the current worktree-prefix implementation.                                                                                                                                                                                                                                                                        | 2026-08-14  | `e04a30d01842398176517fd5b3ef8d9acbc5f8a8` |
| [#295 NetBird sharing](https://github.com/vercel-labs/portless/pull/295)                                 | implemented differently | Implemented in `ea60e3b` with safer loopback default and PID cleanup.                                                                                                                                                                                                                                                         | 2026-08-14  | `75296f9cd834e4866f1ac31f0600b553bf8def10` |
| [#279 .config/portless.json](https://github.com/vercel-labs/portless/pull/279)                           | implemented             | `.config/portless.json` is supported.                                                                                                                                                                                                                                                                                         | 2026-08-14  | `04e48608bf46e1f33e435e884a8e2ec12b2c49cb` |
| [#276 VitePress support](https://github.com/vercel-labs/portless/pull/276)                               | implemented             | VitePress auto-port injection exists.                                                                                                                                                                                                                                                                                         | 2026-08-14  | `e281814e4f1484cdf179f7074a06c283978c26f3` |
| [#275 Tailscale HTTPS readiness](https://github.com/vercel-labs/portless/pull/275)                       | implemented             | Tailscale/Funnel readiness is checked before starting child apps.                                                                                                                                                                                                                                                             | 2026-08-14  | `2f13a8cf4b1945c41ea351f77e5015d4097f1fbd` |
| [#273 Version tip](https://github.com/vercel-labs/portless/pull/273)                                     | won't implement         | See won't-implement table.                                                                                                                                                                                                                                                                                                    | 2026-08-14  | `f4c6112821b1b047df24690ab7a4a73fa3555dc7` |
| [#272 Wrangler port/ip injection](https://github.com/vercel-labs/portless/pull/272)                      | implemented             | Wrangler gets `--port` and `--ip`.                                                                                                                                                                                                                                                                                            | 2026-08-14  | `9a170d5c6e5b4b7e377e9d4728ee5720a7942075` |
| [#270 Worktree prefix in monorepo default mode](https://github.com/vercel-labs/portless/pull/270)        | implemented             | Monorepo default mode applies worktree prefixes.                                                                                                                                                                                                                                                                              | 2026-08-14  | `39f0884d67352884fc1ef2cc42637537108101d7` |
| [#264 Multiplexed hostname routing](https://github.com/vercel-labs/portless/pull/264)                    | implemented differently | Opt-in `--multiplex`/`--label` with a portless-served app picker and host-scoped selection cookie; no app-HTML/header injection. See consolidated decision above.                                                                                                                                                             | 2026-08-14  | `58e892f0eadc642e46df1b7945dd8bb312056e66` |
| [#261 Detect npm exec as package runner](https://github.com/vercel-labs/portless/pull/261)               | implemented             | Package-runner detection handles npm exec.                                                                                                                                                                                                                                                                                    | 2026-08-14  | `fc6eeb3c7310d6b39d84f4a16db4f96630dc5f0c` |
| [#257 JSON output for list/get](https://github.com/vercel-labs/portless/pull/257)                        | implemented             | `portless get --json` and `portless list --json` exist.                                                                                                                                                                                                                                                                       | 2026-08-14  | `1fc9015b652e1ae8c7f18394c84d9fe9c4559618` |
| [#247 Only inject portless Node dir on Windows](https://github.com/vercel-labs/portless/pull/247)        | implemented             | Bun/Node PATH handling is fork-adjusted and Windows-safe.                                                                                                                                                                                                                                                                     | 2026-08-14  | `70ec61d84865cb96826c1c18d8fa6342a50697b4` |
| [#245 Rsbuild support](https://github.com/vercel-labs/portless/pull/245)                                 | implemented             | Rsbuild flag injection exists.                                                                                                                                                                                                                                                                                                | 2026-08-14  | `6e0ced1feda8f57517a618ebaefd780e7e529fb8` |
| [#242 h2c upstream support for gRPC](https://github.com/vercel-labs/portless/pull/242)                   | implemented differently | Explicit `--h2c` route mode is implemented with unchanged HTTP/1.1 defaults and no protocol probing.                                                                                                                                                                                                                          | 2026-08-14  | `bae23ff16aa750f099a7b4b7cc4671c99e8334e4` |
| [#240 CA cert download](https://github.com/vercel-labs/portless/pull/240)                                | implemented differently | `cert.<suffix>` page serves only the public `ca.pem` (never the key) with fingerprint and per-OS steps, on explicit user action. See consolidated decision above.                                                                                                                                                             | 2026-08-14  | `b9e883571e2c937a2027c0f9a979c69e8d544900` |
| [#238 Bun native runtime fast refresh](https://github.com/vercel-labs/portless/pull/238)                 | implemented             | Bun native runtime handling avoids HOST-origin breakage.                                                                                                                                                                                                                                                                      | 2026-08-14  | `7da5969024639f66b58a8cf9b06a423eeee0cc00` |
| [#237 Warn on LAN plus wildcard](https://github.com/vercel-labs/portless/pull/237)                       | implemented             | LAN/wildcard incompatibility is warned/rejected.                                                                                                                                                                                                                                                                              | 2026-08-14  | `9e5f19c020811b0ca1fdf21cd3d42ec24c3e5a10` |
| [#212 Web dashboard](https://github.com/vercel-labs/portless/pull/212)                                   | implemented differently | Read-only dashboard at `portless.<suffix>` (route/port/exposure/CA status); no cross-origin mutation. Disable with `PORTLESS_DASHBOARD=0`. See consolidated decision above.                                                                                                                                                   | 2026-08-14  | `907518a6af7ed46a73c9cbc04a8467ad735a543a` |
| [#167 Command placeholders](https://github.com/vercel-labs/portless/pull/167)                            | implemented             | `{PORT}`, `{HOST}`, and `{PORTLESS_URL}` placeholders exist.                                                                                                                                                                                                                                                                  | 2026-08-14  | `74c45615ec8961fbfc3d4bffcd7a8af4f9c9f3ac` |
| [#166 Preserve path in 404 links](https://github.com/vercel-labs/portless/pull/166)                      | implemented             | 404 app links preserve request path.                                                                                                                                                                                                                                                                                          | 2026-08-14  | `6b62cc56ed99b076a967b618de68171a8106962d` |
| [#165 Path-based routing](https://github.com/vercel-labs/portless/pull/165)                              | implemented differently | Re-triaged after upstream's 2026-07-15 expansion. The routing engine remains a stricter superset with raw matching, full-path forwarding, longest-prefix dispatch, and segment boundaries; tickets 20 and 28 backported same-host hosts/mDNS dedupe, per-app `path` config, multi-app splitting, and sharing-URL integration. | 2026-08-14  | `5b056b59dd04ce66ef44803c164d55d773bf15bc` |
| [#151 Reserve app ports and validate fixed inputs](https://github.com/vercel-labs/portless/pull/151)     | implemented             | Browser-blocked fixed ports are rejected and automatic assignment avoids blocked ports.                                                                                                                                                                                                                                       | 2026-08-14  | `dedb2caa154081b0317eb6b54086999d30addcdf` |
| [#141 Custom port/host env var names](https://github.com/vercel-labs/portless/pull/141)                  | won't implement         | See won't-implement table.                                                                                                                                                                                                                                                                                                    | 2026-08-14  | `0f1b2290165f9fab56ee87ba26b040449986e4ec` |
| [#136 Proxy detection behind pf redirects](https://github.com/vercel-labs/portless/pull/136)             | implemented             | Proxy health detection handles redirects.                                                                                                                                                                                                                                                                                     | 2026-08-14  | `b3920def7c56e5c75886330975c8ac66921a592f` |
| [#128 Generate CA during trust](https://github.com/vercel-labs/portless/pull/128)                        | implemented             | `portless trust` generates a missing CA.                                                                                                                                                                                                                                                                                      | 2026-08-14  | `40540bf032859e5f29aa579c7903e2df9d93c23c` |
| [#116 Docs chat provider config](https://github.com/vercel-labs/portless/pull/116)                       | won't implement         | See won't-implement table.                                                                                                                                                                                                                                                                                                    | 2026-08-14  | `46b8f9c7cfd69a61df2a20168dd3852bee21cf1b` |
| [#104 Tunnel support](https://github.com/vercel-labs/portless/pull/104)                                  | implemented differently | Explicit tunnel aliases, managed Cloudflare/ngrok provider selection, and `PORTLESS_TUNNEL_URL` are implemented without arbitrary public Host passthrough.                                                                                                                                                                    | 2026-08-14  | `c1b6674b5606255eb55ec4dca26627d1465c3c44` |
| [#91 Docs copy button](https://github.com/vercel-labs/portless/pull/91)                                  | won't implement         | See won't-implement table.                                                                                                                                                                                                                                                                                                    | 2026-08-14  | `39d2ac8a8c13dbf96508df12b0021255930222a5` |
| [#85 Shell completions](https://github.com/vercel-labs/portless/pull/85)                                 | implemented differently | Implemented in `5f20c3c` with current fork flags.                                                                                                                                                                                                                                                                             | 2026-08-14  | `d356c047e580ad03b5cdc0b51647eeab733c96dc` |

## Sync Checklist

`FORK.md` is the canonical standing procedure for upstream intake. Read it before resolving conflicts. The fork-sync skill routes agents to this document and keeps only skill-shaped guidance beside the pointer.

A pass starts only when the maintainer explicitly starts it. Nothing in this repository starts a pass automatically. Automation inside a running pass is welcome, but it does not choose when intake begins.

### Choose an entry point

Upstream intake has two entry points because PR triage becomes stale continuously while merging and releasing are batch operations. Keeping them separate makes a cheap triage pass possible without pretending that a merge is needed.

- **Sweep** is triage only. Diff the live open-PR set and each PR's triage stamp against the ledger. A stamp records the date of triage and the upstream PR head SHA at that point. A sweep produces ledger updates or a list of PRs that need the maintainer's decision. It does not merge upstream code or cut a release.
- **Sync** is merge plus release and always includes a sweep first. It carries the sweep's ledger reconciliation into the merge, verification, and release steps below.

### Start every pass

1. Run `bun run check:upstream-drift` first. This is a manual command for the start of a pass, never a CI drift gate. The checker is added by the next ticket, ticket 32; if this checkout does not have the command yet, record it as pending and do not restore the retired inline shell pipeline.
2. Run `git status --short --branch` and start from a clean worktree at the current fork tip. Create a backup branch before changing it.
3. Fetch `origin` and `upstream`. If the default SSH agent cannot authenticate, find a reachable agent socket and retry the fetch with that socket. If no reachable credentials exist, stop for the maintainer under the capability rule below and hand over the exact fetch command and missing access.
   ```bash
   find /tmp -type s \( -name 'agent.*' -o -name '*ssh*' \) 2>/dev/null
   SSH_AUTH_SOCK=/tmp/path/to/agent ssh-add -l
   SSH_AUTH_SOCK=/tmp/path/to/agent git fetch --all --prune
   ```
4. Choose **sweep** or **sync**. A sync performs the sweep before merging anything.

### Sweep path

1. Reconcile the live open-PR set and the triage stamps with the matching table in this file. The drift checker reports both set drift and PR-head drift.
2. Have research subagents read upstream PRs and report evidence for any row that needs a decision. Keep the final state vocabulary to `implemented`, `implemented differently`, or `won't implement`.
3. Update rows whose state is already settled, or stop for the maintainer before changing a final state. Preserve the triage date, upstream head SHA, decision rationale, and fork commit evidence.
4. Run the relevant ledger checks. A sweep never charts a wayfinder map, even when it produces a list of decisions for a later sync.

### Sync path

After the sweep has handed back all required judgment decisions, continue in this order:

1. Compare `git log --oneline --decorate upstream/main..HEAD` and `git log --oneline --decorate HEAD..upstream/main` before merging.
2. Merge `upstream/main` with `git merge upstream/main --no-edit` into the sync branch.
3. Resolve conflicts by keeping fork code in regions covered by a `FORK.md` invariant unless upstream is demonstrably better on the merits. Take upstream where the fork has no implementation.
4. Remove upstream pnpm workspace files if they return. Run `bun install` to refresh `bun.lock`.
5. Run the package-identity search in the Package Identity invariant and fix every hit outside intentional upstream PR references or compatibility tests. Also run the package-manager command search and conflict-marker search:
   ```bash
   rg '[p]npm install|[p]npm build|[p]npm test|[p]npm lint|[p]npm type-check|[p]npm format|[p]npm dev|[p]npm run dev:app'
   rg -n '^[<]{7}|^[=]{7}|^[>]{7}'
   ```
6. Apply only mechanical backports and the decisions already made in the sweep. Stop for the maintainer when a conflict touches an invariant or when scope must be ruled in or out.
7. Review `git log --oneline upstream/main..HEAD` and update the fork-only ledger for behavior-protecting fork commits. The ledger-maintenance commit itself may be picked up by the next sweep.
8. Run focused tests for every fork invariant touched by the merge, then run the full verification gate below.
9. Prepare the sync branch and its release notes. Do not push `main` directly. If a sync PR is opened, merging that PR to `main` remains a maintainer action under the consequence rule. When a branch push is authorized but SSH remains unavailable, use `git push https://github.com/ENK0DED/portless.git <branch>`.
10. End every sync with a fork release. Apply the Version Mapping formula, `fork patch = ((upstream patch + 1) * 1000) + fork iteration`, to select the next version and update the matching release material. Preparing the release is AFK; dispatching `release.yml` for the real `@enk0ded/portless` publish is HITL by consequence, so the agent stops before publishing.

### AFK and HITL boundaries

Use wayfinder's criterion: **HITL** is human in the loop, worked with a human who speaks for themselves; **AFK** is driven by the agent alone. A HITL step resolves through that live exchange, and the agent never stands in for the human's side of it.

Stop for the maintainer for exactly these reasons:

- **Judgment:** assigning a final triage state to any PR whose state would change, resolving a conflict in a region covered by a `FORK.md` invariant, or ruling anything out of scope.
- **Capability:** the agent cannot reach the required credential, the maintainer's machine, or an account. This is a rule rather than a hardcoded list because reachability varies by pass. Hand over a precise checklist of the remaining actions.
- **Consequence:** the agent is capable but not authorized to perform an outward or irreversible action. Dispatching `release.yml` for a real `@enk0ded/portless` publish and merging the sync PR to `main` are HITL by consequence, even when working credentials are available.

Fetching, drift diffing, ledger-set reconciliation, mechanical backports, the verification gate, release mechanics short of publishing, and reading upstream PRs as research are AFK. The agent may perform them alone when the judgment, capability, and consequence boundaries are clear.

### Map threshold and fresh-clone rule

A sweep never charts a wayfinder map. A sync charts one only when the pass surfaces genuine decisions, such as contested conflicts or backports worth arguing about. A clean merge runs the checklist without a map.

The procedure must run from the repository alone. It never requires a past wayfinder map or any `.scratch/` artifact. Those artifacts are disposable; durable invariants, state-choice rules, decision rationales, and this standing procedure belong in tracked repository documents.

### Conflict hotspots and completion gate

Expect recurring conflicts in `package.json`, `packages/portless/package.json`, `bun.lock`, `.github/workflows/ci.yml`, `.github/workflows/release.yml`, `README.md`, `skills/portless/SKILL.md`, `packages/portless/src/cli.ts`, `packages/portless/src/cli.test.ts`, `packages/portless/src/cli-utils.test.ts`, `CHANGELOG.md`, and `apps/docs/src/app/changelog/page.mdx`. When behavior changes commands, flags, config, or human-facing usage, update the corresponding user and agent surfaces together.

Before finishing a sync, confirm the fork package identity, the Version Mapping formula, the absence of unscoped upstream install commands, the absence of conflict markers, the live open-PR set, the verification outcomes, and the maintainer handoffs still outstanding.

## Verification Commands

Use these after every sync:

```bash
bun install
bun run format:check
bun run lint
bun run type-check
bun run build
bun run test
bun run test:fork-ledger
bun run check:fork-ledger
```

The next ticket, ticket 32, adds `bun run test:upstream-drift`; when it lands, run that command in CI to test the repository's drift-checker implementation. This is a test of the local checker, not a live upstream drift gate. Until ticket 32 adds the script, keep this reference marked as pending and do not add a workflow or CI check that fails because upstream moved.

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
