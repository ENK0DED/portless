# Route requests addressed to a route's Tailscale hostname (fork-shaped #352)

Type: task
Status: resolved
Blocked by: 13

## Question

On `upstream-sync-v015`, re-derive upstream #352 (`4209ca8`) inside the fork's tiered `findRoute`: requests whose Host is a route's persisted Tailscale hostname resolve to that route. Extend beyond upstream to also match `tailscaleServiceUrl` (the fork's Tailscale Service mode metadata). Preserve the fork's strict route-selection order — exact tunnel aliases, path prefixes, multiplex selection cookies, internal reserved hosts, and loop detection all keep precedence; the Tailscale-hostname tier must not create an arbitrary public-Host passthrough (match only exact persisted hostnames, consistent with FORK.md's Security Decisions). Add routing tests for Serve/Funnel and Service hostnames, including a non-matching `.ts.net` host being rejected. Run the verification gate and update the fork-only ledger.

## Answer

Commits:

- `c405ea9` adds exact persisted Tailscale Serve, Funnel, and Service hostname routing, path-aware selection, authority normalization, tests, and user-facing documentation.
- `624fd7c` updates the fork-only ledger and records this ticket as resolved. `e2b89f2` records the remaining ledger entries found by the checker.

Decisions:

- `findRoute` keeps exact local paths first, exact tunnel aliases next, then exact Tailscale authorities and hostname matches, followed by the existing optional local wildcard fallback.
- Both `tailscaleUrl` and `tailscaleServiceUrl` are parsed as persisted authorities. Matching is case-insensitive and treats an explicit HTTPS `:443` as the default port.
- Internal reserved pages, loop detection, and multiplex cookie selection remain ahead of route lookup. No `.ts.net` wildcard or arbitrary public Host passthrough was added.

Test coverage:

- Added Serve and Funnel hostname tests, a Tailscale Service hostname test, longest path-prefix coverage, and rejection of an unrelated `.ts.net` hostname.
- Focused proxy suite: 89 passed.

Verification:

- `bun install` passed with no dependency changes.
- `bun run lint`, `bun run type-check`, `bun run build`, `bun run test`, and `bun run test:e2e` passed. Unit tests: 1,041 passed and 2 skipped. E2e tests: 15 passed and 2 skipped.
- `bun run check:fork-ledger` passed with 99 fork commits checked.
- The full gate passed from a clean detached worktree: `bun run format:check`, `bun run lint`, `bun run type-check`, `bun run build`, and `bun run test`.
