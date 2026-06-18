# Upstream PR Feature Plans Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the accepted upstream PR ideas from `vercel-labs/portless` PRs #309, #242, #165, and #104 in this fork without weakening secure defaults or breaking the fork's current CLI, route store, proxy, sharing, Bun, suffix, and docs behavior.

**Architecture:** Keep each feature opt-in and explicit. Extend the current `RouteMapping` metadata model and proxy dispatch path only where the feature needs it, keep default hostname routing and HTTP/1.1 upstream behavior unchanged, and preserve existing `--tailscale`, `--funnel`, `--ngrok`, `--netbird`, suffix, wildcard, LAN, and cleanup semantics.

**Tech Stack:** TypeScript, Bun, Node `http`, `http2`, `net`, existing portless route store JSON files, existing CLI parser helpers, and existing Vitest-style tests run through `bun run test`.

---

## Shared Constraints

- Do not import upstream code directly without re-checking it against this fork's current files.
- Keep public exposure explicit. No feature may silently expose an app outside loopback, a tailnet, or an explicitly configured tunnel hostname.
- Keep default route matching hostname-only until `--path` is explicitly used.
- Keep default upstream proxying HTTP/1.1 until `--h2c` is explicitly used.
- Keep existing command flags working. New generic tunnel or service flags must not remove `--tailscale`, `--funnel`, `--ngrok`, or `--netbird`.
- Update `README.md`, `skills/portless/SKILL.md`, and `packages/portless/src/cli.ts` help whenever a planned implementation adds user-facing flags, env vars, or commands.
- Document boolean env vars only as `0` and `1`.
- Use `bun` commands for all repo verification.

## Task 1: PR #309 Tailscale Service Sharing

**Files:**

- Modify: `packages/portless/src/tailscale.ts`
- Modify: `packages/portless/src/tailscale.test.ts`
- Modify: `packages/portless/src/types.ts`
- Modify: `packages/portless/src/routes.ts`
- Modify: `packages/portless/src/routes.test.ts`
- Modify: `packages/portless/src/cli.ts`
- Modify: `packages/portless/src/cli.test.ts`
- Modify: `README.md`
- Modify: `skills/portless/SKILL.md`
- Modify: `FORK.md`

**Design:**

- Add Tailscale Service as a third Tailscale mode beside Serve and Funnel, not as a replacement.
- Prefer `--tailscale-service` as a boolean flag that infers the service name from the final effective app name.
- Add `--tailscale-service-name <name>` for explicit service names. Do not rely on optional values on `--tailscale-service`, because this CLI accepts child commands and optional values can consume the first command token.
- Add `PORTLESS_TAILSCALE_SERVICE=1` and `PORTLESS_TAILSCALE_SERVICE_NAME=<name>`.
- Keep `--tailscale-service` mutually exclusive with `--tailscale` and `--funnel` unless a later design proves useful coexistence.
- Never imply Funnel. A Tailscale Service URL is tailnet-scoped unless Tailscale itself is configured otherwise.
- Treat service admin approval as a first-class pending state. If `tailscale serve` exits successfully but reports that admin approval or MagicDNS readiness is pending, store and display that pending state instead of claiming the URL is reachable.

**Implementation steps:**

- [ ] Add route metadata fields: `tailscaleServiceName?: string`, `tailscaleServiceUrl?: string`, and `tailscaleServicePending?: boolean`.
- [ ] Extend `RouteMetadataPatch` so those fields can be written and cleared with `updateRoute()`.
- [ ] Add `buildTailscaleServiceName(appName: string): string` in `tailscale.ts`. Lowercase names, replace unsupported characters with hyphens, trim leading and trailing hyphens, cap labels to the DNS label limit, and fall back to `portless`.
- [ ] Add service registration helpers in `tailscale.ts`. Use structured `spawnSync` or the existing command runner shape, not shell interpolation.
- [ ] Parse `tailscale status --json` and `tailscale serve status --json` to detect node DNS name, service URL, existing services, and pending approval.
- [ ] Add cleanup helper support to unregister service routes by service name. Keep existing Serve and Funnel cleanup intact.
- [ ] Extend `parseRunArgs()`, `parseAppArgs()`, global flag stripping, completion metadata, and help text.
- [ ] Wire the parsed fields through `handleRunMode()`, `handleNamedMode()`, and `runApp()` without changing existing parameter meanings.
- [ ] Register the service after the local route is created, store metadata immediately, and clear metadata if registration fails after partial setup.
- [ ] Add `PORTLESS_TAILSCALE_SERVICE_URL` to child env only when a URL is available.
- [ ] Add list and JSON output fields for service URL and pending state.
- [ ] Add `clean` and `prune` cleanup for service metadata.
- [ ] Update docs with the approval caveat and the difference between Serve, Funnel, and Service mode.
- [ ] Commit with original PR data in the body, including `vercel-labs/portless#309`, the upstream title, and the fork security decisions.

**Tests to add:**

- `tailscale.test.ts`: service-name normalization covers normal names, dotted worktree-prefixed names, invalid characters, empty names, and long labels.
- `tailscale.test.ts`: service registration builds the expected Tailscale CLI arguments and never invokes a shell.
- `tailscale.test.ts`: pending approval output is parsed and surfaced without throwing when Tailscale exits successfully.
- `tailscale.test.ts`: service cleanup is a no-op when no service metadata exists and removes the exact service when it does.
- `routes.test.ts`: service metadata persists, loads, and clears, while older routes without those fields still load.
- `cli.test.ts`: help includes `--tailscale-service` and `--tailscale-service-name`.
- `cli.test.ts`: flags work before the app name, after the app name, and under `run`.
- `cli.test.ts`: env vars activate the feature and explicit CLI values win over env values.
- `cli.test.ts`: `--tailscale-service` conflicts with `--tailscale` and `--funnel`.
- `cli.test.ts`: list text and JSON include service URL and pending approval state.
- `cli.test.ts`: child env includes `PORTLESS_TAILSCALE_SERVICE_URL` only when a resolved URL exists.
- `cli.test.ts`: failure before service registration does not leave stale service metadata.
- `cli.test.ts`: `clean` and `prune` call service cleanup for stale routes.

**Verification:**

```bash
bun run test -- packages/portless/src/tailscale.test.ts
bun run test -- packages/portless/src/routes.test.ts
bun run test -- packages/portless/src/cli.test.ts
bun run build
bun run test
git diff --check
```

## Task 2: PR #242 h2c Upstream Support

**Files:**

- Modify: `packages/portless/src/types.ts`
- Modify: `packages/portless/src/routes.ts`
- Modify: `packages/portless/src/routes.test.ts`
- Modify: `packages/portless/src/proxy.ts`
- Modify: `packages/portless/src/proxy.test.ts`
- Modify: `packages/portless/src/cli.ts`
- Modify: `packages/portless/src/cli.test.ts`
- Modify: `README.md`
- Modify: `skills/portless/SKILL.md`
- Modify: `FORK.md`

**Design:**

- Add explicit `--h2c` support for upstream cleartext HTTP/2 backends such as local gRPC services.
- Persist the upstream protocol on the route as `protocol?: "http1" | "h2c"`. Treat missing protocol as `http1` for backward compatibility.
- Do not auto-detect backend protocol. Probing could trigger side effects on local services and creates ambiguous failures.
- Do not add HTTPS-to-backend support in this pass.
- Preserve HTTP/1.1 behavior and WebSocket upgrade behavior for every route without `protocol: "h2c"`.

**Implementation steps:**

- [ ] Add `protocol?: "http1" | "h2c"` to `RouteInfo` and `RouteMapping`.
- [ ] Extend route creation so `RouteStore.addRoute()` can persist protocol atomically with hostname, port, and PID. Avoid adding the route and patching protocol afterward, because the proxy watches the file and could serve one request with the wrong protocol during the race.
- [ ] Add `protocol` to `RouteMetadataPatch` only if later updates need it. Prefer immutable route protocol after route creation.
- [ ] Extend `parseRunArgs()` and `parseAppArgs()` with `--h2c`.
- [ ] Add `PORTLESS_H2C=1`.
- [ ] Thread the parsed protocol through `runApp()` and alias registration where appropriate. Alias routes may need `portless alias <name> <port> --h2c` so Dockerized gRPC services work without a child process.
- [ ] Add `proxyH2c()` in `proxy.ts`. It should create or reuse one `http2.ClientHttp2Session` per `127.0.0.1:<port>` and close cached sessions on `goaway`, `close`, and `error`.
- [ ] Convert incoming request headers to HTTP/2 pseudo-headers. Set `:method`, `:path`, `:scheme`, and `:authority`.
- [ ] Strip hop-by-hop headers and HTTP/2 pseudo-headers that should not pass through.
- [ ] Preserve forwarded metadata: `x-forwarded-host`, `x-forwarded-proto`, `x-forwarded-for`, and the portless hop counter.
- [ ] Forward request bodies and response bodies as streams.
- [ ] Preserve response status, normal headers, and gRPC trailers for HTTP/2 downstream clients.
- [ ] For HTTP/1.1 downstream clients, use `res.addTrailers()` as best effort, but document that gRPC clients should speak HTTP/2 to portless.
- [ ] Include protocol in list and JSON output so users can see that a route is h2c.
- [ ] Update completions and docs.
- [ ] Commit with original PR data in the body, including `vercel-labs/portless#242`, the upstream title, and the explicit non-goals.

**Tests to add:**

- `routes.test.ts`: protocol persists on new routes and missing protocol loads as HTTP/1.1.
- `routes.test.ts`: route conflict handling remains hostname-based until path routing is implemented.
- `cli.test.ts`: `--h2c` appears in help, works in named mode, works in `run`, works in `alias`, and works through `PORTLESS_H2C=1`.
- `cli.test.ts`: list text and JSON include h2c protocol.
- `proxy.test.ts`: h2c route dispatch reaches an `http2.createServer()` backend.
- `proxy.test.ts`: default route dispatch still uses HTTP/1.1.
- `proxy.test.ts`: `:authority` is the original public host and target backend port where required by Node's client API.
- `proxy.test.ts`: hop-by-hop headers are stripped.
- `proxy.test.ts`: `x-forwarded-*` and portless hop headers are preserved and incremented.
- `proxy.test.ts`: POST body streams through h2c.
- `proxy.test.ts`: non-200 status and normal response headers propagate.
- `proxy.test.ts`: multi-chunk streaming response propagates without buffering.
- `proxy.test.ts`: gRPC trailers propagate to HTTP/2 clients.
- `proxy.test.ts`: trailers-only gRPC response is represented correctly.
- `proxy.test.ts`: session reuse occurs for repeated requests.
- `proxy.test.ts`: session reconnect occurs after close or goaway.
- `proxy.test.ts`: mixed HTTP/1.1 and h2c routes in the same proxy process dispatch independently.
- `proxy.test.ts`: unreachable h2c backend returns the existing 502 style without leaking internal stack traces.

**Verification:**

```bash
bun run test -- packages/portless/src/proxy.test.ts
bun run test -- packages/portless/src/routes.test.ts
bun run test -- packages/portless/src/cli.test.ts
bun run build
bun run test
git diff --check
```

## Task 3: PR #165 Path-Based Routing

**Files:**

- Modify: `packages/portless/src/types.ts`
- Modify: `packages/portless/src/utils.ts`
- Modify: `packages/portless/src/utils.test.ts`
- Modify: `packages/portless/src/routes.ts`
- Modify: `packages/portless/src/routes.test.ts`
- Modify: `packages/portless/src/proxy.ts`
- Modify: `packages/portless/src/proxy.test.ts`
- Modify: `packages/portless/src/cli.ts`
- Modify: `packages/portless/src/cli.test.ts`
- Modify: `README.md`
- Modify: `skills/portless/SKILL.md`
- Modify: `FORK.md`

**Design:**

- Add `--path <prefix>` and `PORTLESS_PATH=<prefix>` as opt-in route scoping.
- Add `pathPrefix?: string` to `RouteInfo` and `RouteMapping`. Treat missing prefix as `/`.
- Route identity becomes `hostname + normalized pathPrefix`, but only for conflict detection and removal. Existing route files with no path prefix continue to behave as root routes.
- Use exact hostname or wildcard host matching first, then choose the longest path prefix match.
- Enforce path segment boundaries. `/api` matches `/api` and `/api/users`, but not `/api-v2`.
- Forward the full request path unchanged. Do not strip prefixes by default, because that would force different backend behavior than direct access.
- Keep `get`, `url`, `list`, `alias`, cleanup, LAN, wildcard, and mDNS behavior compatible with root routes.

**Implementation steps:**

- [ ] Add `normalizePathPrefix(value: string | undefined): string` in `utils.ts`.
- [ ] Reject empty strings, values not starting with `/`, values containing query strings, values containing fragments, and values with control characters.
- [ ] Normalize duplicate trailing slashes to one canonical prefix, preserving `/` as root.
- [ ] Add `matchesPathPrefix(requestPath: string, prefix: string): boolean`.
- [ ] Add `pathPrefix?: string` to route types and route persistence.
- [ ] Update `RouteStore.addRoute()`, `removeRoute()`, `updateRoute()`, and conflict errors so a hostname can have multiple path prefixes.
- [ ] Update stale process cleanup so stale route removal removes the correct `hostname + pathPrefix` record.
- [ ] Update `findRoute()` in `proxy.ts` to accept the request path and use longest-prefix routing among exact host matches, then wildcard host matches when strict mode is disabled.
- [ ] Update 404 pages and plain text 404 responses to show path prefixes.
- [ ] Extend CLI parsing for named mode, `run`, `get`, `url`, `alias`, `list`, and removal commands where a route key is needed.
- [ ] Add `--path` to completions.
- [ ] Update `formatUrl()` or add a small helper so `get` and list displays can append the route path.
- [ ] Ensure LAN and mDNS still publish by hostname only. Path prefixes are HTTP routing metadata, not DNS records.
- [ ] Update docs with examples for local API gateways, microfrontends, and monorepos.
- [ ] Commit with original PR data in the body, including `vercel-labs/portless#165`, the upstream title, and the boundary-match security decision.

**Tests to add:**

- `utils.test.ts`: path normalization accepts `/`, `/api`, and `/docs/v1`.
- `utils.test.ts`: path normalization rejects `api`, empty strings, `?x=1`, `/api#frag`, and control characters.
- `utils.test.ts`: boundary matching accepts `/api` and `/api/users`, and rejects `/api-v2`.
- `routes.test.ts`: same hostname with `/api` and `/docs` can coexist.
- `routes.test.ts`: same hostname with same path conflicts while live.
- `routes.test.ts`: root route remains compatible with old route files.
- `routes.test.ts`: remove route removes only the requested path prefix.
- `routes.test.ts`: force override only replaces the matching hostname and path prefix.
- `proxy.test.ts`: exact host root route still works.
- `proxy.test.ts`: longest path prefix wins.
- `proxy.test.ts`: wildcard host plus path routing works.
- `proxy.test.ts`: path prefix is not stripped before forwarding.
- `proxy.test.ts`: `/api-v2` does not match `/api`.
- `cli.test.ts`: `--path` works before and after the app name and under `run`.
- `cli.test.ts`: `PORTLESS_PATH` works and CLI flag wins over env.
- `cli.test.ts`: `get`, `url`, and `list` include path prefixes in text and JSON.
- `cli.test.ts`: `alias <name> <port> --path <prefix>` registers an alias route at the path.
- `cli.test.ts`: invalid path values fail before starting a child process.

**Verification:**

```bash
bun run test -- packages/portless/src/utils.test.ts
bun run test -- packages/portless/src/routes.test.ts
bun run test -- packages/portless/src/proxy.test.ts
bun run test -- packages/portless/src/cli.test.ts
bun run build
bun run test
git diff --check
```

## Task 4: PR #104 Tunnel Support

**Files:**

- Create: `packages/portless/src/tunnel.ts`
- Create: `packages/portless/src/tunnel.test.ts`
- Create: `packages/portless/src/tunnel-aliases.ts`
- Create: `packages/portless/src/tunnel-aliases.test.ts`
- Modify: `packages/portless/src/types.ts`
- Modify: `packages/portless/src/proxy.ts`
- Modify: `packages/portless/src/proxy.test.ts`
- Modify: `packages/portless/src/routes.ts`
- Modify: `packages/portless/src/routes.test.ts`
- Modify: `packages/portless/src/ngrok.ts`
- Modify: `packages/portless/src/ngrok.test.ts`
- Modify: `packages/portless/src/cli.ts`
- Modify: `packages/portless/src/cli.test.ts`
- Modify: `packages/portless/src/index.ts`
- Modify: `README.md`
- Modify: `skills/portless/SKILL.md`
- Modify: `FORK.md`

**Design:**

- Implement the useful parts of upstream #104, but do not copy its zero-config single-app passthrough as a default.
- Public tunnel requests must route only through an explicit managed tunnel or an explicit alias mapping.
- Keep existing `--ngrok` behavior working. A future generic `--tunnel ngrok` can call the same provider, but it must not remove `--ngrok`.
- Add Cloudflare Tunnel as an optional provider through the installed `cloudflared` binary. Do not add new runtime dependencies unless a provider genuinely requires them and has been reviewed.
- Add exact hostname aliasing: `portless tunnel map <route> <external-host>`, `portless tunnel unmap <external-host>`, and `portless tunnel list`.
- Store tunnel aliases in a separate state file such as `tunnel-aliases.json` rather than mixing public hostnames into `routes.json`.
- Design alias records to include `externalHostname`, `targetHostname`, and optional `targetPathPrefix`. The path field should default to `/` so this feature can compose with PR #165 when that lands.
- Add `PORTLESS_TUNNEL=<provider>` and `PORTLESS_TUNNEL_URL` child env. `PORTLESS_TUNNEL` is a provider selector, not a boolean.
- Managed tunnels must clean up both the tunnel process and the alias mapping on child exit, `clean`, and `prune`.

**Implementation steps:**

- [ ] Add `TunnelProvider`, `TunnelInstance`, and provider result types in `tunnel.ts`.
- [ ] Move shared ngrok process parsing into the provider shape while preserving exports used by current `--ngrok` tests.
- [ ] Add a Cloudflare provider that runs `cloudflared tunnel --url http://127.0.0.1:<proxyPort>` or the reviewed equivalent command for quick tunnels.
- [ ] Parse Cloudflare output for the generated HTTPS URL and fail with actionable install or auth guidance.
- [ ] Add `tunnel-aliases.ts` with file locking or reuse the route store's lock discipline so alias writes are race-safe.
- [ ] Validate alias hostnames with hostname validation that rejects spaces, control characters, URL schemes, paths, and wildcard hosts unless a later security review explicitly allows wildcards.
- [ ] Add `getTunnelAliases?: () => TunnelAlias[]` to `ProxyServerOptions`.
- [ ] Update `findRoute()` to check exact route hostnames first, then exact tunnel alias hostnames, then existing wildcard fallback. This preserves local hostname priority.
- [ ] Do not add fallback routing for arbitrary non-localhost Host headers. If users want tunnel routing, they must create a tunnel or alias explicitly.
- [ ] Add `portless tunnel map`, `unmap`, and `list` subcommands.
- [ ] Add `--tunnel <provider>` and optional `--tunnel-hostname <hostname>` to named mode and `run`. `--tunnel-hostname` is for providers that support stable custom hostnames.
- [ ] Wire managed tunnel startup after proxy readiness and route creation, then register the generated alias.
- [ ] Set `PORTLESS_TUNNEL_URL` for the child process when managed tunnel startup succeeds.
- [ ] Store managed tunnel PID and alias metadata on the route or in a companion tunnel state file so cleanup can find it.
- [ ] Update list text and JSON output to show tunnel URLs and aliases.
- [ ] Update docs with a warning that ngrok and Cloudflare URLs expose apps to the public internet.
- [ ] Commit with original PR data in the body, including `vercel-labs/portless#104`, the upstream title, and the fork decision to require explicit alias or managed tunnel routing.

**Tests to add:**

- `tunnel-aliases.test.ts`: aliases persist, load, update, remove, and survive old missing state files.
- `tunnel-aliases.test.ts`: invalid external hostnames are rejected.
- `tunnel-aliases.test.ts`: exact aliases do not permit wildcard host routing.
- `tunnel.test.ts`: provider selection accepts `ngrok` and `cloudflare`, and rejects unknown providers.
- `tunnel.test.ts`: Cloudflare provider parses generated URLs and handles missing binary errors.
- `tunnel.test.ts`: providers use structured spawn arguments, not shell strings.
- `proxy.test.ts`: explicit tunnel alias routes to the selected target.
- `proxy.test.ts`: arbitrary non-localhost Host header does not route to the only app without an alias.
- `proxy.test.ts`: direct route hostname still wins over an alias with the same host if such a conflict is allowed.
- `proxy.test.ts`: tunnel alias plus path prefix composes when path routing is present.
- `cli.test.ts`: `portless tunnel map`, `unmap`, and `list` validate arguments and update alias state.
- `cli.test.ts`: `--tunnel ngrok` and `--tunnel cloudflare` work in named mode and `run`.
- `cli.test.ts`: `PORTLESS_TUNNEL=cloudflare` activates the provider.
- `cli.test.ts`: managed tunnel startup sets `PORTLESS_TUNNEL_URL` for the child process.
- `cli.test.ts`: managed tunnel failure tears down any partial alias.
- `cli.test.ts`: child exit tears down managed tunnel process and alias.
- `cli.test.ts`: `clean` and `prune` remove managed tunnel aliases and stop tracked tunnel processes.
- `cli.test.ts`: list text and JSON include explicit tunnel aliases and managed tunnel URLs.

**Verification:**

```bash
bun run test -- packages/portless/src/tunnel.test.ts
bun run test -- packages/portless/src/tunnel-aliases.test.ts
bun run test -- packages/portless/src/proxy.test.ts
bun run test -- packages/portless/src/routes.test.ts
bun run test -- packages/portless/src/cli.test.ts
bun run build
bun run test
git diff --check
```
