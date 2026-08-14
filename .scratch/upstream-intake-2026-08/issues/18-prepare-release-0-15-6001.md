# Prepare fork release 0.15.6001 with the feature batch

Type: task
Status: resolved
Blocked by: 17

## Question

On `upstream-sync-v015`, prepare fork release `0.15.6001` batching the five feature commits plus the #363 residuals (tickets 12–17), following the fork's release ritual: version bump, changelog entries per feature, FORK.md Version Mapping prose update, and fork-only ledger refresh so the CI freshness gate stays green. If [Lock triage states and backport list for new PRs](07-lock-triage-states-backport-list.md) has resolved by the time this ticket runs and its backport tickets are wired to land in this same branch, coordinate: either fold their notes into this changelog if they landed before this release, or leave them for `0.15.6002` and say so in the Version Mapping prose. Do not publish; tagging/publish happens post-merge. Run the verification gate.
 
## Answer

Commits:

- `4dd7f00` `chore(release): prepare v0.15.6001` bumps `@enk0ded/portless` to `0.15.6001`, adds the six feature-batch entries to the root and docs changelogs, and updates the Version Mapping prose.
- The final `docs(fork)` maintenance commit records `8b25491` and `4dd7f00` in the fork-only ledger and resolves this ticket.

Release scope:

- The changelogs cover ordered suffix lists with #348 LAN behavior, loopback-by-default binding with explicit `--lan` required for LAN reachability, exact Tailscale hostname routing, package-script framework flag injection, the #363 residual WebSocket behaviors, and fork-aware `portless doctor`.
- `FORK.md` maps `0.15.6001` to the feature batch and reserves `0.15.6002` for the upstream-PR backport batch in tickets 20–28. Those backports are not included in this release.
- No tag, publish, or push to `main` was performed.

Verification:

- `bun install` completed with no lockfile changes.
- `bun run format:check`, `bun run lint`, `bun run type-check`, `bun run build`, and `bun run test` passed. The suite reports 1,118 tests passed and 3 skipped.
- `bun run test:fork-ledger` and `bun run check:fork-ledger` passed on the final maintenance state.
