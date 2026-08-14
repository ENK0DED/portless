# Route requests addressed to a route's Tailscale hostname (fork-shaped #352)

Type: task
Status: claimed
Blocked by: 13

## Question

On `upstream-sync-v015`, re-derive upstream #352 (`4209ca8`) inside the fork's tiered `findRoute`: requests whose Host is a route's persisted Tailscale hostname resolve to that route. Extend beyond upstream to also match `tailscaleServiceUrl` (the fork's Tailscale Service mode metadata). Preserve the fork's strict route-selection order — exact tunnel aliases, path prefixes, multiplex selection cookies, internal reserved hosts, and loop detection all keep precedence; the Tailscale-hostname tier must not create an arbitrary public-Host passthrough (match only exact persisted hostnames, consistent with FORK.md's Security Decisions). Add routing tests for Serve/Funnel and Service hostnames, including a non-matching `.ts.net` host being rejected. Run the verification gate and update the fork-only ledger.
