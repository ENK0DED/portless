# Changelog

## 0.15.14001

<!-- release:start -->

### Fork Sync

- **Backport batch**: Ports the upstream pull requests triaged for backport this round, including those opened after the charting pass, on top of the `0.15.14000` sync. Upstream is unchanged at `96a3bbb` (`0.15.13`). Most ports are `implemented differently`, so the fork's own flag loops, bind rules and sharing cleanup stay in place.

### Security

- **Pinned openssl for the installed service**: `service install` now resolves and checks `openssl` once and pins its absolute path in the launchd plist, systemd unit and Windows script through an internal `PORTLESS_SERVICE_OPENSSL` variable. Certificate generation in a pinned service never falls back to `PATH`, and the install warns when the pinned path sits in a location a normal user can write. This closes the route by which a user-influenced `PATH` could pick the binary a root or SYSTEM service runs. The pinned path is unverified on a real Windows host, so the Windows matrix in CI is the only check so far.

### New Features

- **Connection pooling redesign**: The proxy now gates dials per backend port at 16 pending connections with no cap on established sockets, so long-lived server-sent-event streams can no longer starve other requests. Idle sockets bypass the gate, queued clients wake as dials settle or sockets free up, connection setup has a 10 second connect-only deadline, and shutdown answers queued clients with 503 without opening new dials. Keep-alive pools keep up to 64 free sockets, and the IPv4 loopback attempt-timeout floor from upstream #510 is shared by every loopback dial.
- **`--tailscale-http`**: `--tailscale-http` and `PORTLESS_TAILSCALE_HTTP=1` share an app over a raw TCP forward from the tailnet to `127.0.0.1`, on port 80 and then 8080 upward, for tailnets without MagicDNS. It cannot combine with Funnel or Service sharing and records `tailscaleHttp` route metadata so crash cleanup removes the forward. Sharing now also fails early with a clear message when MagicDNS is off. A real tailnet is unverified.
- **Worktree prefix surface**: `--worktree-prefix` and `PORTLESS_WORKTREE_PREFIX` set the worktree label explicitly, and `--no-worktree` turns it off, on `run`, bare mode, `get`, `bg start` and `getUrl()`. The `worktreeBranch` config key, valid at the top level and per app, chooses between the last branch segment (the default) and the whole branch name. The precedence is flag, then environment variable, then git. An empty flag is an error that points to `--no-worktree`, and an empty variable turns the prefix off.
- **Peer URLs and port strategies**: Every proxied app in a monorepo run gets a path-aware `PORTLESS_URL_<APP>` variable for each peer. `appPortStrategy` (`random`, `stable`, `sequential`) and `appPortRange`, with `PORTLESS_APP_PORT_*` overrides, make app ports predictable and are replayed by `bg start` intents.
- **Self-daemonizing commands**: When a wrapped command exits on its own and a new listener holds the assigned port, the route moves to that listener, path- and label-aware, with sharing and orphan metadata cleared. A listener that existed before the command is never adopted and `bg` entries are skipped. A clean exit now waits up to 2 seconds for a daemon that binds late, which delays the exit of commands that really did finish.
- **Chrome trust on Linux**: `portless trust` also trusts the CA in the invoking user's existing NSS database, which Chrome and Chromium use, warns when that fails, and `portless untrust` removes it. `trust` now skips its prompt only when every store it writes already has the CA, including both the Linux and Windows stores on WSL. Real `certutil`, Chrome and WSL runs are unverified.
- **`portless proxy status`**: A read-only `proxy status` command, with `--json`, reports the running proxy's state without starting, stopping or elevating anything. The JSON adds `wildcard` and `lanIp` to upstream's keys, and the MCP server gains a matching `proxy_status` tool.
- **MCP batches**: `portless mcp` answers JSON-RPC batches for protocol 2025-03-26 in order, omits results for notifications, and returns `-32600` for invalid entries. The warning for LAN mode with mDNS off now reads "mDNS publishing is off" and says the proxy is still reachable from the network.
- **More frameworks and Vite versions**: `vinext` gets the port and host flags injected. Vite's allowed hosts are written for the app's Vite version: 8.1 and later get the comma list of exact sharing hostnames, and older or unknown versions get one prioritized host plus a notice.

### Bug Fixes

- **`proxy stop` strictness**: `proxy stop` accepts only `--port` and `-p`, and `proxy stop --help` now prints help. Before, any unknown argument, `--help` included, stopped the running proxy (#520). A trailing `--help` also prints help for `get`, `url` and `alias`.
- **Dead-owner routes**: The proxy checks route owners once a second in memory and reloads its routes when an owner dies, so a force-killed dev server answers 404 within about 2.5 seconds instead of staying routable. The dashboard marks it orphaned, nothing is written to `routes.json`, and a process the user cannot signal still counts as alive.
- **One proxy per state directory**: `proxy start` exits with an error when the state directory already tracks a live proxy on another port. `proxy stop -p <port>` stops only that port's listener, and a stopping proxy clears the state files only when they name it, so one proxy can no longer erase another's state (#540).
- **Empty `PORTLESS_STATE_DIR`**: An explicit but empty state directory no longer probes the default port during discovery, auto-start or `proxy start`, which could reach a proxy in the default location.
- **Turbo state directory**: The turbo integration writes its loader and `dev-manifest.json` into the resolved state directory instead of `~/.portless` when `PORTLESS_STATE_DIR` is set.
- **Response hop-by-hop headers**: Plain HTTP/1.1 responses lose `Connection`-named headers plus `keep-alive`, `proxy-connection` and `upgrade`, and keep `transfer-encoding` because the proxy relays the body framing.
- **Doctor Node check**: `service status` and `doctor` report when the service's pinned Node binary is missing.

### Breaking Changes

- **Stricter `proxy stop`**: Scripts that passed other arguments to `proxy stop` and relied on them being ignored now get the help text and the proxy keeps running. Use `--port` or `-p` only.
- **`proxy start` refuses a second proxy**: Starting a proxy on a different port while the state directory tracks a live one is now an error. Stop the first proxy, or use a separate `PORTLESS_STATE_DIR`.

### Maintenance

- **Bun minimum documented**: The README and the skill state Bun 1.4.4 as the minimum when running portless under Bun, because Bun 1.4.4 fixes TLS context setup for registered hostnames. Upstream's per-hostname workaround (#470) is not ported.
- **Test hygiene**: The `bg` and tunnel test suites no longer leak proxy daemons or fake `cloudflared` shim processes after a run.

### Contributors

- @enk0ded

<!-- release:end -->

## 0.15.14000

### Fork Sync

- **Upstream sync**: Merges upstream `0.15.6` through `0.15.13`. The code base is upstream `5758ac5`, and upstream's `0.15.13` release-prep commit `96a3bbb` is merged on top so the base is the released tag. The merge, the earlier advisor batch and every port of an arriving commit ship here, and the 15 backports that follow ship as `0.15.14001`.
- **Fork release mapping**: Tracks upstream `0.15.13` as `0.15.14000` for `@enk0ded/portless` and reserves `0.15.14001` for the backport batch.

### New Features

- **Unprivileged proxy mode**: `--unprivileged` and `PORTLESS_UNPRIVILEGED=1` bind the proxy to all interfaces without sudo, with a loopback-only peer guard on every proxy and redirect listener, including HTTP/2 Extended CONNECT streams. The mode is remembered across restarts and service installs, defaults to HTTP unless HTTPS is explicit, and skips CA trust. Automatic hosts sync stays off there; start prints `sudo portless hosts sync` guidance for suffixes that need hosts entries. `--lan` takes precedence and permits remote peers.
- **Probe-first elevation**: The proxy now probes its real bind targets and asks for sudo only when a listener needs root or the hosts file needs entries. If elevation fails, start stops with an error. The automatic fallback to port 1355 is gone.
- **Hosts-sync endpoint**: The proxy serves an authenticated hosts-sync endpoint (a per-start token file, a proxy challenge, origin and loopback checks) so route registration can ask a running proxy to sync the hosts file. It is disabled when hosts sync is off.
- **Direct-to-app tunnels**: Managed Cloudflare and ngrok tunnels now connect straight to the app's loopback port with the Host header rewritten to the route hostname, so public traffic no longer passes through the portless proxy. A path-prefixed route exposes the whole app and prints a notice. Exact manual `tunnel map` aliases still go through the proxy and now honor multiplex selection cookies. Adds `--cloudflare` and `PORTLESS_CLOUDFLARE=1` as an alias of `--tunnel cloudflare`, with `PORTLESS_CLOUDFLARE_URL` beside `PORTLESS_TUNNEL_URL`, background-intent support and shell completions.
- **`portless mcp`**: Adds the MCP server mapped onto this fork's CLI, with `suffix` support, `proxy_start` with `unprivileged`, read-only `bg` tools in the default profile, and `bg` start, stop and restart behind an opt-in. Sharing flags and `tunnel` are stated omissions.
- **JSON proxy errors and 421**: Portless-generated 404, 502 and 508 responses are HTML or JSON (`{error, upstream, message}`) depending on the client's `Accept` header, with `Vary: Accept`. Hostnames outside the configured suffix list now get 421 without an app list, and unmatched paths on the proxy's own tunnel or Tailscale hostnames get a 404 that lists no apps.
- **Route uptime**: The dashboard and the 404 page show how long each app has been up, and the 404 page gains a hostname filter with a newest-first toggle. `portless list` prints uptime and `list --json` reports `registered_at`.
- **Documentation site**: The docs moved to the Geistdocs theme with WebMCP, `llms.txt` and agent-readable Markdown pages. The theme's Vercel branding is replaced with a local navbar and footer carrying the fork wordmark, and the changelog page is now `apps/docs/content/docs/changelog.mdx`.

### Bug Fixes

- **Orphaned command processes**: Routes now record a verified process group. `portless run` and `portless prune` stop verified orphans from crashed sessions, and the daemon sweep never kills anything: orphans stay listed as "Orphaned" in `portless list`, `list --json` (`kind: "orphan"`) and the dashboard until pruned, and their sharing is still cleaned up.
- **`bg stop` timing**: `bg stop` now waits 12 seconds with SIGTERM before giving up, and `--force` also kills the verified child process group. Windows tunnel and multi-app spawners use the same orphan guard.
- **Hosts file safety**: A hosts file that is missing is created with only the portless block, one that cannot be read is never rewritten, and stale managed blocks are cleared when no routes remain.
- **Routes owned by other users**: A route whose process the current user lacks permission to signal is treated as alive, so the stale-route sweep no longer tears down other users' sharing.
- **Proxy fixes**: The most specific registered parent wins for wildcard fallback regardless of registration order, request bodies are drained after backend errors on every path, hop-by-hop request headers are stripped, and every port flag and variable rejects malformed values.
- **Framework injection**: Injected flags pass through `npm exec` and `npm x` after `--`, VitePress `dev`, `serve` and `preview` are covered, Astro subcommands are found after global options, and the node directory sits after the user's `PATH`.
- **Certificates and trust**: Cached certificates with invalid sibling wildcard names regenerate, and the WSL CA re-trust path is tested. The dead `isWSL` helper in `wsl-utils.ts` is removed.
- **Advisor batch**: The `bg` registry is written atomically and fails closed, `bg restart` keeps restart flags out of the child command, failed force stops are reported, tunnel aliases are cached between proxy reloads, and abandoned WebSocket handshakes are torn down. CI actions are pinned to immutable SHAs, the publish workflow is hardened, and CI now requires exactly one changelog marker pair.

### Breaking Changes

- **NetBird credentials in `bg` JSON**: `bg status --json` and `bg list --json` no longer print the stored NetBird password and PIN. They report `netbirdPasswordSet` and `netbirdPinSet` booleans in their place, and `bg restart` hands the stored credentials to the restarted run through `PORTLESS_NETBIRD_PASSWORD` and `PORTLESS_NETBIRD_PIN` instead of argv. Scripts that read the old credential fields from this JSON must switch to the new ones. The rename is not covered in the README, skill or help text.
- **Port 1355 fallback removed**: Starting the proxy without the privilege for its port no longer falls back to port 1355. Use `--unprivileged` or a port above 1023 explicitly.

### Maintenance

- **Bun 1.4.4 baseline**: The repository, CI and release workflow now pin Bun 1.4.4, because the merged lockfile fails a frozen install under older releases. `bun.lock` and `minimumReleaseAge` are kept.

### Contributors

- @enk0ded

## 0.15.6004

### Bug Fixes

- **HTTP/2 request bodies without content-length**: An HTTP/2 request that carried a body but no `content-length` (a `GET`, `DELETE`, or `OPTIONS` with DATA) was forwarded to the HTTP/1.1 backend without framing. On a pooled keep-alive socket the backend parsed those bytes as a second request that skipped the proxy's `X-Forwarded-*` and hop-count headers, reachable through shared URLs. The proxy now sends such bodies with `transfer-encoding: chunked`, and the stale-socket retry no longer replays an HTTP/2 request whose body was already consumed.

### Contributors

- @enk0ded

## 0.15.6003

### Bug Fixes

- **WebSocket extensions over HTTP/2**: The RFC 8441 Extended CONNECT bridge now answers the client only after the backend's `101` handshake and relays the backend's negotiated `Sec-WebSocket-Extensions` and `Sec-WebSocket-Protocol` verbatim. Backends that accept `permessage-deflate` previously sent compressed frames the browser was never told to expect, so HTTP/2 WebSockets dropped on the first frame in a reconnect loop. A backend handshake that fails validation now resets the stream instead of opening a WebSocket that dies immediately.

### Contributors

- @enk0ded

## 0.15.6002

### Backport Batch

- **Hosts and mDNS deduplication**: Same-hostname routes no longer create duplicate managed hosts-file lines or restart the mDNS publisher when only a backend port changes.
- **Atomic route persistence and cleanup**: `routes.json` writes now use atomic replacement, and a periodic stale-route sweep removes dead entries without terminating the process behind a route. Configure or disable it with `--routes-cleanup-interval` or `PORTLESS_ROUTES_CLEANUP_INTERVAL`.
- **Hostname resolution and LAN inference**: Registration warns when hostnames remain unresolvable, the daemon latches non-empty hosts-sync failures until recovery, and LAN mode follows the marker file even while its IP is temporarily unavailable.
- **Keep-alive backend connections**: Ordinary HTTP/1.1 forwarding now reuses capped loopback connections while upgrade, WebSocket, and HTTP/2 paths keep their existing connection handling.
- **Sharing hostnames in Vite**: Exact persisted Tailscale, ngrok, managed tunnel, and NetBird hostnames are added to Vite's allowed-hosts list across all sharing modes without introducing wildcards.
- **Linux and WSL CA trust guidance**: NixOS and unknown Linux distributions receive manual trust-store guidance instead of a silent Debian fallback, and WSL trust-state detection remains consistent across Linux and Windows stores.
- **Windows cmd.exe escaping security fix**: Hardened `.cmd` and `.bat` shim invocation against metacharacter injection through the shim path. The vulnerable path was reachable from `portless run … -- …` arguments and package scripts.
- **Flat worktree hostnames**: Opt-in flat worktree hostnames now use a shared prefix helper with collision hashing while preserving nested defaults.
- **Path-aware routing and configuration**: Adds strict path-prefix registration, raw-match verbatim forwarding, absolute-form handling, per-app `path` configuration, multi-app path splitting, and path-aware display output. During migration, now-invalid persisted path prefixes are removed from `routes.json` with a warning naming the `portless alias ... --path <valid-prefix>` re-registration command.

### Contributors

- @enk0ded

## 0.15.6001

### Feature Batch

- **Ordered suffix lists and LAN behavior**: `PORTLESS_SUFFIX` now supports ordered suffix lists with repeatable suffix flags, preserves explicit LAN suffix configuration, and publishes mDNS only for `.local` entries while routes, TLS, service, and state handling use the complete list.
- **Loopback-by-default binding**: Proxy and redirect listeners bind only to `127.0.0.1` and `::1` by default. LAN reachability now requires explicit `--lan`, which widens the listeners to all interfaces.
- **Tailscale hostname routing**: Exact persisted Tailscale Serve, Funnel, and Service hostnames now route to their matching apps while tunnel aliases remain strict.
- **Framework flag injection through package scripts**: Framework flags now pass safely through Bun, npm, pnpm, and yarn package scripts while preserving fork injectors, placeholders, and the Windows spawn design.
- **Residual WebSocket behaviors**: Cleartext HTTP/1.1 WebSocket upgrades on the TLS port now use strict route handling, and malformed backend handshakes return 502 instead of silently destroying the socket.
- **Fork-aware `portless doctor`**: The read-only diagnostics command now covers fork state including suffixes, bind scope, sudo handoff, CA trust, hosts and mDNS, background apps, and tunnel, Tailscale, and NetBird readiness.

### Contributors

- @enk0ded

## 0.15.6000

### Fork Sync

- **Upstream v0.15 sync**: Merges upstream v0.15.0 through v0.15.5 at `326e893`, including `portless doctor`, multi-TLD proxy support, loopback-only binding, sudo state and Windows/WSL CA trust, Tailscale hostname routing, IPv6 loopback dialing, worktree prefixes, RFC 8441 WebSocket proxying, multi-segment custom TLD validation, package-manager script flag injection, and the Windows service timeout fix.
- **Fork release mapping**: Tracks upstream `0.15.5` as `0.15.6000` for `@enk0ded/portless` and reserves `0.15.6001` for the feature batch that follows this merge.
- **Fork package identity**: Keeps the npm package under `@enk0ded/portless` while preserving the `portless` CLI command.
- **Bun workspace policy**: Keeps Bun as the repository package manager and preserves the fork's package, documentation, and workflow invariants.

### Contributors

- @enk0ded

## 0.15.5

### Bug Fixes

- **Multi-segment custom TLDs**: `--tld` and `PORTLESS_TLD` now accept dotted DNS names such as `dev.example.com`, so local URLs can mirror production structure. `validateTld` checks per-label DNS rules and the 253-character total limit, overlapping TLDs resolve by longest match, and cert cache filenames stay under the filesystem name limit for long hostnames. (#365)
- **WebSocket over HTTP/2**: Proxy now advertises RFC 8441 extended CONNECT and bridges `:protocol websocket` streams to an HTTP/1.1 upgrade against the backend, fixing dev server HMR for browsers that negotiate h2 over ALPN. Plain-HTTP upgrades on the TLS port are proxied instead of dropped, and a backend that rejects the handshake or answers with a bad `Sec-WebSocket-Accept` now gets a 502 instead of a silently destroyed socket. (#363)

### Contributors

- @Railly
- @KingPsychopath
- @erichurkman
- @sanjevirau

## 0.15.4

### Bug Fixes

- **Loopback-only proxy binding**: Outside LAN mode, the proxy and HTTP redirect listeners now bind only to `127.0.0.1` and `::1`, so Portless routes cannot be reached through LAN, VPN, or other network interfaces. LAN mode still binds to all interfaces explicitly. (#361)

### Contributors

- @ctate

## 0.15.3

### Bug Fixes

- **State directory under sudo**: Portless now resolves per-user state from the original sudo user's home, so an elevated proxy and unprivileged app processes share the same routes instead of writing to separate state directories. (#357)
- **Windows and WSL CA trust**: On WSL, `portless trust` now installs the local CA in both Linux and Windows trust stores, while `portless clean` removes the exact certificate from both. Failed trust-store cleanup preserves the CA identity for safe retries, including on native Windows. (#357)

### Contributors

- @ctate
- @gerardbalaoro

## 0.15.2

### Bug Fixes

- **Tailscale funnel routing**: Proxy now routes requests addressed to a route's Tailscale funnel or serve hostname, so `--funnel` and `--tailscale` apps reached at `<device>.ts.net` no longer return a 404, including when several apps share one hostname on different ports. (#352)
- **IPv6-only dev servers return 502**: Proxy now dials upstreams over both loopback families, fixing 502s when a dev server binds `::1` only, such as Vite on Node 17+. (#353)
- **Worktree prefix in multi-app mode**: Bare `portless` in a monorepo worktree now applies the branch prefix in multi-app mode as it already did for single apps, so hostnames no longer collide across worktrees. (#355)

### Contributors

- @Railly
- @ahfoysal

## 0.15.1

### New Features

- **Multi-TLD proxy support**: `--tld` is now repeatable and `PORTLESS_TLD` accepts comma separated values, so one proxy can serve the same app names across multiple TLDs. Routes, TLS, service state, hosts sync, framework environment, and workspace launches now use the full configured TLD list. (#344)

### Contributors

- @ctate

## 0.15.0

### New Features

- **`portless doctor`**: New read only diagnostics command checks Node.js, the state directory, proxy liveness, route entries, hostname resolution, HTTPS CA trust, and LAN prerequisites, then prints suggested fixes. (#337)

### Bug Fixes

- **HTTP/2 Host forwarding**: Proxy now forwards HTTP/2 `:authority` as `Host` to HTTP/1.1 backends, fixing apps that depend on Host and previously saw `127.0.0.1` for browser traffic. (#328)
- **`--force` takeover cleanup**: Exit cleanup now removes only routes still owned by the exiting process, so a forced takeover does not deregister the new owner's route. (#328)

### Contributors

- @ctate

## 0.14.1003

### Bug Fixes

- **Vite and Nuxt HMR over HTTP/2**: HTTP/2 Extended CONNECT WebSocket responses now include the negotiated `Sec-WebSocket-Protocol` header, so Vite's `vite-hmr` subprotocol works through the HTTPS proxy.
- **Auto-elevated trust flags**: `portless proxy start --skip-trust` is now preserved through the implicit sudo re-exec path, so privileged proxy starts do not add the CA to the trust store when the user opted out.
- **CLI test isolation**: CLI tests that exercise `portless clean` now isolate their home directory, preventing full-suite runs from deleting a developer's live `~/.portless` state.

### Documentation

- **CA and state behavior**: Clarifies that generated CA and server certificates live under the resolved state directory, are reused across proxy restarts, and are regenerated only when removed or cleaned.
- **Fork invariants**: Updates `FORK.md`, README, docs pages, CLI help, and the portless agent skill with the HMR subprotocol and privileged `--skip-trust` invariants.

### Contributors

- @enk0ded

## 0.14.1002

### New Features

- **Background app management**: Adds `portless bg` commands for long-lived local servers, with private logs, readiness tracking, status, restart, stop, clean, and prune integration.
- **Public sharing and route modes**: Adds Tailscale Service sharing, NetBird sharing, managed Cloudflare and ngrok tunnel aliases, path-scoped routes, and explicit h2c upstream routing for local HTTP/2 cleartext services.
- **Local browser surfaces**: Adds the read-only dashboard, public CA download page, and opt-in multiplexed hostname picker without rewriting app HTML or response headers.
- **HTTP/2 WebSockets**: Supports browser HMR WebSockets over HTTPS HTTP/2 using Extended CONNECT while validating backend WebSocket accept headers before forwarding payload.
- **Developer ergonomics**: Adds shell completions, JSON route and URL inspection, package config source reporting, and the programmatic `getUrl()` API.

### Security

- **Public exposure defaults**: Sharing features keep child apps loopback-bound by default, require explicit public exposure flags, and clean up managed public aliases or process metadata.
- **Safe internal pages**: The dashboard is read-only, reserved internal hostnames cannot be claimed by apps, and the certificate page serves only the public CA certificate.
- **Background process safety**: Background app state and logs use owner-only permissions, readiness uses an internal file handshake, and cleanup removes only exact owned routes.
- **Fork ledger enforcement**: CI now checks that `FORK.md` records every fork-only commit except the current ledger-maintenance commit.

### Maintenance

- **Open upstream PR coverage**: Documents every open upstream PR as implemented, implemented differently, or won't implement in the fork ledger.
- **Docs sweep**: Updates README, docs pages, CLI help, and the portless agent skill for the current command surface and security defaults.
- **Windows reliability**: Resolves managed Cloudflare and ngrok `.cmd` and `.bat` shims during preflight checks and startup, and gives OpenSSL certificate generation more headroom on slow Windows hosts.

### Contributors

- @enk0ded

## 0.14.1001

### Bug Fixes

- **Privileged proxy config**: Auto-elevated proxy starts and stops now pass the resolved `PORTLESS_STATE_DIR` through `sudo`, so passwordless sudo keeps the invoking user's suffix, port, TLS, and state configuration instead of falling back to root defaults.
- **Proxy suffix flag**: `portless proxy start --suffix <suffix>` now works directly, while `--tld` remains supported as a compatibility alias.

### Maintenance

- **Dependency refresh**: Updates the repository Bun baseline to `1.3.14` and refreshes workspace dependencies and `bun.lock`.
- **Fork documentation**: Expands `README.md`, `FORK.md`, and `skills/portless/SKILL.md` coverage for suffix behavior and privileged proxy state handoff.

### Contributors

- @enk0ded

## 0.14.1000

### Fork Sync

- **Upstream 0.14.0 merge**: Pulls in upstream changes through `e4f65fa`, including ngrok sharing, startup services, Tailscale sharing, config file support, multi-app orchestration, and recent HTTP/2 and takeover fixes.
- **Fork package identity**: Keeps npm publishing under `@enk0ded/portless` while preserving the `portless` CLI command.
- **Fork versioning**: Maps upstream `0.14.0` to fork version `0.14.1000`, reserving `0.14.1001` through `0.14.1999` for local-only fork releases before upstream `0.14.1` maps to `0.14.2000`.
- **Bun workspace policy**: Keeps Bun as the repository package manager and removes upstream pnpm workspace files from the fork.

### Contributors

- @ctate
- @enk0ded

## 0.14.0

### New Features

- **ngrok sharing**: New `--ngrok` flag exposes portless apps publicly through ngrok while keeping the local `.localhost` URL. Also configurable with `PORTLESS_NGROK=1`; child processes receive `PORTLESS_NGROK_URL`, and `portless list` shows active ngrok URLs. (#323)

### Improvements

- **ngrok tunnel lifecycle**: Portless now checks for the ngrok CLI before starting an app, surfaces install and authentication guidance, removes stopped ngrok URLs from route state, and terminates tunnel processes during app cleanup. (#323)

### Contributors

- @ctate

## 0.13.1

### New Features

- **Configurable startup services**: `portless service install` now persists proxy options such as `--port`, `--no-tls`, `--lan`, `--ip`, `--tld`, `--wildcard`, `--cert`, `--key`, and `--state-dir` into launchd, systemd, and Task Scheduler. `portless service status` now reports the installed service port, HTTPS mode, TLD, LAN mode, wildcard mode, and state directory.

### Bug Fixes

- **Service reinstall port changes**: Reinstalling the startup service with a different port now stops any existing proxy on the previous port before starting the new service.
- **Service install validation**: LAN service installs now fail early on platforms that cannot publish mDNS records, and service paths such as `~` are normalized before writing native service files.

### Requirements

- **Node.js 24**: The published package now requires Node.js 24 or newer, and fork repository development uses Bun. (#307)

### Contributors

- @ctate
- @skaldebane
- @ItalianScallian
- @neefrehman

## 0.13.0

### New Features

- **OS startup service**: New `portless service install`, `portless service status`, and `portless service uninstall` commands manage a native startup service for the HTTPS proxy across macOS launchd, Linux systemd, and Windows Task Scheduler. The service starts clean `.localhost` URLs after reboot, and `portless clean` removes it during cleanup. (#289)

### Bug Fixes

- **Tailscale readiness preflight**: `--tailscale` and `--funnel` now check Tailscale HTTPS and Funnel prerequisites before starting the child process, surfacing actionable errors instead of hanging during registration. (#282)

### Contributors

- @ctate
- @Anshuman71

## 0.12.0

### New Features

- **Tailscale sharing**: New `--tailscale` flag shares any portless app over your Tailscale network with zero framework config. Each app is root-mounted on its own Tailscale HTTPS port (443, 8443, 8444, ...) so no `basePath` configuration is needed. Works as a global flag, per-app flag (`portless myapp --tailscale next dev`), or env var (`PORTLESS_TAILSCALE=1`). (#262)
- **Tailscale Funnel**: New `--funnel` flag exposes apps to the public internet through Tailscale Funnel. Implies `--tailscale`. Also configurable via `PORTLESS_FUNNEL=1`. (#262)
- **`PORTLESS_TAILSCALE_URL` env var**: Child processes receive `PORTLESS_TAILSCALE_URL` containing the Tailscale HTTPS URL so apps can reference their public address. (#262)
- **Tailscale URLs in `portless list`**: The list command now shows tailnet URLs alongside local URLs when Tailscale sharing is active. (#262)

### Improvements

- **`portless prune` cleans stale Tailscale registrations**: Prune now removes orphaned `tailscale serve` entries left behind by dead CLI sessions. (#262)
- **`portless clean` removes Tailscale serve state**: Clean now tears down any Tailscale serve/funnel registrations alongside the usual CA and hosts file cleanup. (#262)

### Contributors

- @ctate

## 0.11.1

### New Features

- **`portless prune` command**: Safety net to find and kill orphaned dev servers left behind by dead CLI sessions. Reads stale route entries, checks if something is still listening on each port, and terminates the orphan.

### Bug Fixes

- **Zombie process orphaning on CLI crash**: Spawn child processes with `detached:true` on Unix so they get their own process group. Signal handlers now kill the entire group instead of just the immediate child, preventing orphaned dev servers from surviving CLI crashes or `kill -9`.

### Contributors

- @ctate

## 0.11.0

### New Features

- **Zero-arg mode**: Run bare `portless` from any project directory to auto-discover the dev script from `package.json` and start it through the proxy. No arguments, no config required. (#251)
- **Multi-app orchestration**: In monorepos, bare `portless` auto-discovers workspace packages (pnpm, npm, yarn, bun) and starts all dev scripts concurrently through the proxy. Each package gets a subdomain derived from its npm scope (e.g. `@acme/docs` becomes `docs.acme.localhost`). (#251)
- **Turborepo integration**: When `turbo.json` is present, portless delegates to `turbo run <script>` instead of spawning each app individually. Per-app `PORT`, `HOST`, and `PORTLESS_URL` are injected via a lightweight `--require` loader so turbo retains dependency ordering and task graph awareness. Set `turbo: false` in config to opt out. (#251)
- **`portless.json` config file**: Configure app name, script, port, and turbo settings without embedding portless in `package.json` scripts. Also supports a `"portless"` key in `package.json` as an inline alternative. (#251)
- **`--script` flag**: Override the default `"dev"` script for a single invocation (e.g. `portless --script start`). (#251)
- **Rsbuild support**: Auto-inject `--port` and `--host` CLI flags for Rsbuild dev server (#250)

### Bug Fixes

- **State directory moved to `~/.portless`**: All proxy state now lives in `~/.portless` instead of `/tmp/portless`, fixing repeated CA trust prompts on macOS (where `/tmp` is periodically cleaned) and a symlink local privilege escalation vulnerability (#251)
- **Duplicate macOS CA certificates**: Fix `security delete-certificate` failing with "is ambiguous" when multiple portless CA entries had accumulated in the keychain (#251)
- **CA trust marker caching**: Cache the CA fingerprint after a successful trust so subsequent proxy starts skip the OS security check and avoid re-triggering the macOS authentication dialog (#251)

### Improvements

- **Auto-trust CA on proxy auto-start**: When the proxy is auto-started and the CA is not yet trusted, portless automatically runs trust with proper sudo elevation (#251)
- **Package manager delegation**: Detects pnpm, yarn, bun, or npm and delegates script execution to the correct package manager (#251)
- **Non-server script detection**: Build-only tools (tsup, tsc, esbuild, etc.) are auto-detected and run without a proxy route. Use `proxy: false` in config for explicit control. (#251)
- **Monochrome CLI output**: Bold for headers and errors, dim for warnings and muted text, no color codes (#251)

### Contributors

- @ctate

## 0.10.3

### Bug Fixes

- **Stale TLD persisting across proxy restart**: Fix the proxy reverting to a stale TLD (e.g. `.local`) after restart because transient state markers were not cleaned up on stop (#235)

### Contributors

- @ctate

## 0.10.2

### New Features

- **Auto-inject `NODE_EXTRA_CA_CERTS`**: Child processes spawned by `portless run` now automatically receive `NODE_EXTRA_CA_CERTS` pointing to the portless CA certificate, so Node.js subprocesses trust the local CA without manual configuration (#220)

### Bug Fixes

- **Proxy startup on slow macOS `security` command**: Fix the proxy failing to start when the macOS `security` command takes longer than expected to verify CA trust (#229)
- **Lock contention with parallel commands**: Fix lock contention that could cause failures when multiple `portless` commands run simultaneously (#230)
- **`ERR_HTTP2_PROTOCOL_ERROR` during HMR**: Fix HTTP/2 stream reset flood during hot module replacement causing protocol errors (#231)
- **Proxy auto-start in non-interactive terminals**: Fix auto-start failing in non-interactive terminals (e.g. IDE task runners) and when previous proxy config exists (#232)

### Contributors

- @ctate

## 0.10.1

### New Features

- **`portless clean`**: New command stops the proxy if it is running, removes the local CA from the OS trust store when it was installed by portless, deletes allowlisted files under known state directories, and removes the portless-managed block from the hosts file. Custom `--cert` and `--key` paths are never removed. (#213)

### Improvements

- **Hosts file sync by default**: The proxy now keeps the hosts file in sync with active routes automatically (improves Safari and other setups where `.localhost` subdomains do not resolve to loopback). Set `PORTLESS_SYNC_HOSTS=0` to opt out. The managed block is removed from the hosts file when the proxy exits. (#213)

### Contributors

- @ctate

## 0.10.0

### New Features

- **LAN mode**: New `--lan` flag exposes portless services to phones and other devices on the same network via mDNS `.local` hostnames. Auto-detects the active LAN IP, follows network changes, and supports `--ip` / `PORTLESS_LAN_IP` overrides for VPN or multi-interface setups. Publishes mDNS records with platform-native tools (`dns-sd` on macOS, `avahi-publish-address` on Linux). Adds `*.local` to generated certificate SANs so HTTPS works for LAN hostnames. (#168)
- **VitePlus support**: Auto-inject `--port` for VitePlus (`vp`) dev server (#147)

### Contributors

- @gabimoncha
- @carderne

## 0.9.6

### Bug Fixes

- **WebSocket proxy memory leak**: Add socket close/end handlers to prevent memory leaks in the WebSocket proxy (#208)

### Contributors

- @ctate

## 0.9.5

### Bug Fixes

- **`--force` kills existing process**: `--force` now terminates the process that owns the conflicting route before registering a new one, instead of only removing the stale route entry (#204)
- **CA certificate included in TLS chain**: The proxy now sends the CA certificate as part of the TLS chain, fixing `UNABLE_TO_VERIFY_LEAF_SIGNATURE` errors in clients that do not have the portless CA in their trust store (#203)

### Contributors

- @ctate

## 0.9.4

### Bug Fixes

- **README missing from npm package**: The published npm package now includes its README. Previously `.gitignore` excluded the copied README during packing; an `.npmignore` override fixes this. (#197)

### Contributors

- @ctate

## 0.9.3

### Breaking Changes

- **Origin/Referer header rewriting removed**: The proxy no longer rewrites `Origin` and `Referer` headers. The feature introduced in 0.9.2 caused issues with certain backend frameworks and has been removed. (#195)

### Contributors

- @ctate

## 0.9.2

### New Features

- **Origin/Referer header rewriting**: The proxy now rewrites `Origin` and `Referer` headers for portless-managed hostnames so backend CSRF protections accept proxied requests (#189)

### Bug Fixes

- **Browser-blocked ports excluded from auto-selection**: Ports that browsers refuse to connect to (e.g. 6666, 6667) are now excluded from automatic port assignment (#192)
- **State directory preserved during sudo elevation**: Fix `portless trust` losing the state directory when elevating to sudo (#187)
- **Windows OpenSSL config detection**: Auto-detect `openssl.cnf` location on Windows when `OPENSSLDIR` points to a non-existent path (#183)

### Contributors

- @ctate

## 0.9.1

### New Features

- **Project dev dependency install**: portless can now be installed as a project dev dependency (`npm install -D @enk0ded/portless`) in addition to the global install. The `npx`/`dlx` guard now only blocks one-off downloads, not locally installed packages. (#179)

### Bug Fixes

- **`portless trust` on fresh install**: Fix `portless trust` failing on a fresh install when no CA certificate exists yet. The command now generates the CA and server certificates automatically before trusting. (#177)

### Contributors

- @ctate

## 0.9.0

### Breaking Changes

- **HTTPS on port 443 is now the default**: The proxy defaults to HTTPS on port 443 instead of HTTP on port 1355. Auto-elevates with sudo on macOS/Linux to bind privileged ports. Use `--no-tls` for plain HTTP on port 80, or `-p 1355` for the previous unprivileged port. (#172)
- **`PORTLESS_HTTPS` env var inverted**: HTTPS is on by default; set `PORTLESS_HTTPS=0` to disable (replaces the old `PORTLESS_HTTPS=1` opt-in). (#172)

### New Features

- **HTTP-to-HTTPS redirect**: When the HTTPS proxy runs on port 443, a companion HTTP server on port 80 automatically redirects all requests to HTTPS. (#172)
- **Auto-sudo for proxy lifecycle**: `portless proxy start` auto-elevates with sudo when binding privileged ports. `portless proxy stop` does the same when the running proxy is owned by root. (#172)
- **Clean URLs**: URLs are now `https://myapp.localhost` instead of `http://myapp.localhost:1355`. No port numbers to remember. (#172)

### Contributors

- @ctate

## 0.8.0

### Breaking Changes

- **Strict subdomain routing is now the default**: Subdomains no longer automatically match parent hostnames (e.g. `api.myapp.localhost` no longer routes to `myapp.localhost`). Use the `--wildcard` flag or `PORTLESS_WILDCARD=1` env var to restore the previous behavior. (#158)

### New Features

- **`--wildcard` flag**: Opt in to wildcard subdomain routing where subdomains match registered parent hostnames. Configurable via `PORTLESS_WILDCARD` env var. (#158)

### Bug Fixes

- **Cert generation with dots in `$HOME`**: Fix TLS certificate generation failing when the home directory path contains dots (#157)
- **DNS label limit for `--name` flag**: Fix regression where long `--name` values could exceed the 63-character DNS label limit (#144)
- **Windows `DEP0190` deprecation warning**: Silence Node.js deprecation warning on Windows by replacing `shell: true` with explicit `cmd.exe /d /s /c` spawning (#160)
- **Windows duplicate `PATH` entries**: Deduplicate `PATH` environment variables in child process spawn on Windows (#155)

### Improvements

- **Removed chalk dependency**: Replaced chalk with lightweight ANSI color utilities to reduce install size (#170)
- **Automated release process**: Added CI workflow for automated npm publishing and GitHub releases (#169)

### Contributors

- @ctate
- @mynameistito

## 0.7.2

### Bug Fixes

- **`--port` injection for package runners**: Fixed `--port` injection for commands run via package runners like `npx`, `pnpm dlx`, etc. (#150)
- **TLS cert generation**: Fixed TLS cert generation for long hostnames and proxy startup races (#149)
- **Proxy crash on ECONNRESET**: Handle `ECONNRESET` errors on TLS wrapper sockets to prevent proxy crash (#127)
- **Windows `node not recognized`**: Resolved `node not recognized` error on Windows when running `portless run` (#126)

### Documentation

- Added Windows to docs requirements section (#122)

### Improvements

- Added GitHub Action for automated npm publishing (#130)

## 0.7.1

### Documentation

- Updated docs site header (#118)

## 0.7.0

### Features

- **Windows support**: Full cross-platform support for Windows. Uses `os.tmpdir()` for state directory, `netstat -ano` for port detection, `shell: true` for command spawning, `certutil` for CA trust, and `windowsHide` for daemon spawn. Includes Windows CI job in GitHub Actions. (#6)

### Bug Fixes

- **`--name` sanitization in `portless run`**: Stop replacing dots with hyphens in `--name` values. Dots are valid and intentional in hostnames like `local.metaview`. The direct form and `portless get` already preserved dots; now `run --name` is consistent. (#108)
- **worktree prefix only for linked worktrees**: Only prepend the branch name for linked worktrees, not the root worktree. Previously any non-main branch got a prefix when multiple worktrees existed, even in the primary clone. (#108)
- **Windows hosts file paths**: Use platform-aware hosts file path (`C:\Windows\System32\drivers\etc\hosts` on Windows, `/etc/hosts` on Unix) and platform-appropriate error messages (Administrator vs sudo). (#113)

## 0.6.0

### Features

- **custom TLD**: Use `--tld` to set a custom TLD (e.g. `.test`) instead of `.localhost`. Configurable via `PORTLESS_TLD` env var. The proxy auto-syncs `/etc/hosts` for custom TLDs when started with sudo. Warns about risky TLDs like `.local` (mDNS/Bonjour conflicts) and `.dev` (Google-owned, HSTS). Recommended: `.test` (IANA-reserved, no collision risk). (#93)
- **`portless get` command**: Print the URL for a service, useful for wiring services together (e.g. `BACKEND_URL=$(portless get backend)`). Applies worktree prefix detection by default; use `--no-worktree` to skip it. (#88)
- **`--name` flag for `portless run`**: Override the inferred base name while preserving the worktree prefix (e.g. `portless run --name myapp next dev` in a worktree produces `fix-ui.myapp.localhost`). (#89)

### Bug Fixes

- **HTTPS proxy trust and stop on macOS with sudo**: Fix CA trust check and `proxy stop` when the proxy was started with sudo on macOS. (#98)
- **DNS label length for worktree hostnames**: Truncate worktree-prefixed hostnames to respect the 63-character DNS label limit. (#87)

## 0.5.2

### Documentation

- Add git worktree documentation to README, docs site, and agent skill. `portless run` automatically detects linked worktrees and prefixes the URL with the branch name (e.g. `fix-ui.myapp.localhost`).
- Document worktree support in 0.5.0 changelog entry.

## 0.5.1

### Bug Fixes

- **npm README**: Copy root `README.md` into the package at publish time so it appears on npmjs.com.
- **homepage**: Point npm homepage to https://port1355.dev.

## 0.5.0

### Features

- **`portless run` subcommand**: Automatically infer the project name from `package.json`, git root, or directory name instead of specifying it manually. In git worktrees, the branch name is prepended as a subdomain prefix (e.g. `fix-ui.myapp.localhost`) so each worktree gets a unique URL with no config changes. (#55, #68)
- **`portless alias` command**: Register routes for services not spawned by portless (e.g. Docker containers with published ports). Aliases persist across stale-route cleanup. (#73)
- **`PORTLESS_URL` env var**: Child processes now receive `PORTLESS_URL` containing the public `.localhost` URL (e.g. `http://myapp.localhost:1355`) so apps can self-reference their own URL. (#56)
- **`--app-port` flag**: Specify a fixed port for the app instead of automatic assignment. Also configurable via `PORTLESS_APP_PORT` env var. Useful when integrating with tools that provide their own port. (#72)
- **wildcard subdomain routing**: Subdomains now match registered hostnames (e.g. `tenant.myapp.localhost` matches `myapp.localhost`). Exact matches take priority over wildcard matches. (#71)
- **`/etc/hosts` sync**: Automatically sync `.localhost` hostnames to `/etc/hosts` for environments where `.localhost` does not resolve to `127.0.0.1` by default. (#74)
- **multi-distro Linux CA trust**: `portless trust` now supports Arch, Fedora/RHEL/CentOS, and openSUSE in addition to Debian/Ubuntu. Falls back to command probing when `/etc/os-release` detection fails. (#45)
- **Expo and React Native support**: Auto-inject `--port` and `--host` flags for `expo start` and `react-native start`. (#42)
- **branded error and status pages**: The proxy now renders styled HTML pages for 404, 502, 508, and other status codes instead of plain text. (#70)

### Bug Fixes

- **stream errors**: Handle proxy stream errors gracefully to prevent unhandled exceptions from crashing the proxy. (#57)

## 0.4.2

### Bug Fixes

- **spawn ENOENT**: Use `/bin/sh -c` for command execution so shell scripts and version-manager shims (nvm, fnm, mise) are resolved correctly. Prepend `node_modules/.bin` to `PATH` so local project binaries (e.g. `next`, `vite`) are found without a global install. (#21, #29)
- **sudo state directory permissions**: System state directory (`/tmp/portless`) now uses world-writable + sticky-bit permissions (`1777`) so non-root processes can register routes after a sudo proxy start. Route and state files created under sudo are chowned back to the real user. (#16)
- **duplicate route names**: `addRoute` now checks for an existing live route and throws `RouteConflictError` if the hostname is already registered by a running process. Use `--force` to override. (#38)
- **TLS SHA-1 rejection**: Force SHA-256 for all CA and server certificate generation. Detect and regenerate existing SHA-1 certificates automatically. Uses the `openssl` CLI for signature algorithm checks to maintain compatibility with Node.js < 24.9. (#36)
- **per-hostname certs for `.localhost` subdomains**: Issue a per-hostname certificate with an exact SAN for every `.localhost` subdomain (including single-level like `myapp.localhost`). `*.localhost` wildcard certs are invalid because `.localhost` is a reserved TLD per RFC 2606 section 2. (#18)
- **terminal left in raw mode**: Reset `stdin.setRawMode(false)` on process exit so the terminal is not left in raw mode after SIGINT. (#51)

### Features

- **proxy loop detection**: Detect forwarding loops (e.g. a Vite dev server proxying back through portless without `changeOrigin: true`) using the `X-Portless-Hops` header. Respond with `508 Loop Detected` and a message explaining the fix. Also detects loops on WebSocket upgrades. (#48, #52)
- **`--force` flag**: Override a route registered by another process with `portless <name> --force <cmd>`.

## 0.4.1

### Bug Fixes

- Fix Vite support and add e2e tests for 11 frameworks. (#32)

## 0.4.0

### Features

- HTTP/2 + HTTPS support with auto-generated local CA and per-hostname TLS certificates. (#10)

## 0.3.0

### Bug Fixes

- Fix proxy routing issues. (#4)

## 0.2.2

### Improvements

- Block `npx` / `pnpm dlx` usage and improve agent skill. (#1, #2)

## 0.2.1

### Bug Fixes

- Fix proxy routing issue.

## 0.2.0

### Features

- Add `--port` / `-p` flag to the proxy command.

## 0.1.0

Initial release.
