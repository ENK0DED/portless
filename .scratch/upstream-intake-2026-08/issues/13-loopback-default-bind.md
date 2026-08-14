# Adopt loopback-by-default proxy bind (#361)

Type: task
Status: resolved
Blocked by: 12

## Question

On `upstream-sync-v015`, adopt upstream #361's loopback-by-default bind per [Decide the v0.15 sync strategy](06-decide-v015-sync-strategy.md) ("Implementation notes"): bind **two servers per port** (`127.0.0.1` and `::1` with `ipv6Only: true`), instantiating the fork's byte-peeking TLS wrapper (`proxy.ts:1219`) per bind target, and applying the same rule to the port-80 redirect listener (`cli.ts:709`). Widening is keyed off the `lanMode` flag derived from `proxy.lan` (not `activeLanIp`, which `cli.ts:540` nulls when mDNS tooling is absent; `service.ts:307-313` persists `lanMode`/`lanIp` separately). No `--bind` escape hatch — upstream ships none. **Keep the fork's hard exit** when `--lan` is used without mDNS tooling (`cli.ts:4376-4388`); do not adopt upstream's soft-disable. Requires multi-suffix (ticket 12) landed first — the bind hunk and Vite-allowlist code call `formatViteAllowedHosts(tlds)`. Port upstream's socket-level bind tests (the fork has zero bind-address coverage). Add FORK.md Security Decisions line (amendment 4): proxy binds loopback-only by default; widening is explicit via LAN mode alone. Run the verification gate and update the fork-only ledger.

## Answer

Implemented on `upstream-sync-v015`.

Commit:

- `a8fc980` (`feat: bind proxy on loopback by default`) adds explicit IPv4 and IPv6 listener targets, per-target proxy and port-80 redirect listeners, per-target TLS wrapper construction, LAN-mode widening keyed from `lanMode`, socket-level bind coverage, and the required user, agent, CLI, and FORK documentation. The ledger update and ticket resolution are included in the following ledger-maintenance commit.

Decisions:

- Normal mode binds `127.0.0.1` and `::1`; the IPv6 target always uses `ipv6Only: true`.
- LAN mode binds `0.0.0.0` and `::`, also with `ipv6Only: true` for IPv6. The same target set is used by the port-80 HTTP-to-HTTPS redirect listener.
- Each bind target gets its own `createProxyServer` instance, preserving the fork's byte-peeking TLS wrapper per listener.
- Bind widening is selected from the effective persisted `lanMode` configuration, never from `activeLanIp`. The fork's hard exit for LAN mode without mDNS tooling remains intact, and no `--bind` escape hatch was added.

Coverage:

- `cli-utils.test.ts` covers target selection plus real IPv4 loopback, IPv6 loopback when available, and IPv4 wildcard socket binds.
- `cli.test.ts` verifies the built proxy accepts HTTP over IPv6 loopback and reports the IPv4 and IPv6 listener endpoints.
- Existing TLS, lifecycle, and hard-exit coverage remains green.

Verification:

- `bun install`: green, no dependency changes.
- `bun run format:check`: green with the untracked `.scratch/upstream-intake-2026-08` intake directory temporarily outside the scan and restored unchanged. The unfiltered scan reports 21 pre-existing unformatted scratch files, which this ticket does not edit.
- `bun run lint`: green.
- `bun run type-check`: green.
- `bun run build`: green, including the docs production build. The existing non-fatal Next.js NFT tracing warning remains.
- `bun run test`: green, 30 files with 1,036 tests passed and 2 skipped.
- `bun run test:e2e`: green, 15 tests passed and 2 environment-dependent Python tests skipped.
- `bun run check:fork-ledger`: green after recording the prior ledger HEAD `92370cb` and implementation commit `a8fc980`, and green again after the resolution ledger commit with 96 fork commits checked.
