# Prepare release 0.15.6002

Type: task
Status: resolved
Blocked by: 33

## Question

On `upstream-sync-v015`, cut fork release `0.15.6002` covering the upstream open-PR backports, following FORK.md's release procedure and the pattern of [Prepare release 0.15.6000](11-prepare-release-0-15-6000.md) and [Prepare release 0.15.6001](18-prepare-release-0-15-6001.md).

This release is deliberately separate from `0.15.6000` (the upstream merge) and `0.15.6001` (the five sync features) so that "we synced upstream" and "we adopted upstream's open PRs" stay independently revertable.

Changelog scope — the work from tickets 20 through 28:

- Duplicate hosts-file lines and mDNS publisher churn for same-hostname routes (bug fix).
- Atomic `routes.json` writes plus the periodic stale-route sweep and its `--routes-cleanup-interval` flag.
- Unresolvable-hostname warnings, the daemon warn latch, and the LAN-inference fix.
- Keep-alive backend connections (cold dev-server load stalls).
- Sharing hostnames in the Vite allowed-hosts list, across all sharing modes.
- NixOS and unknown-distro CA trust guidance, plus the WSL trust-state fix.
- Windows cmd.exe argument escaping — **call this out as a security fix**; see ticket 26 for the reachability characterization.
- Flat worktree hostnames.
- Per-app `path` config, multi-app path splitting, and path-aware display output.

Keep the Package Identity and Version Mapping sections intact. Run the full FORK.md verification gate (format:check, lint, type-check, build, test) before tagging.

After this ticket the map's work is complete: file the PR from `upstream-sync-v015` to `main` and merge it, per the map's Notes.

## Answer

Commits:

- `db651e5` (`chore(release): prepare v0.15.6002`) bumps `@enk0ded/portless` to `0.15.6002`, adds the backport-batch entries to the root and docs changelogs, and updates the Version Mapping prose.
- The final maintenance commit (`docs(fork): resolve ticket 30 and update release ledger`) records the triage-stamp and release commits in the fork-only ledger and resolves this ticket.

Changelog scope:

- The nine backports from tickets 20–28 are covered: hosts and mDNS deduplication, atomic `routes.json` writes and tunable stale-route cleanup, hostname resolution warnings and LAN inference, keep-alive backend pooling, exact sharing hostnames in the Vite allowlist, NixOS and WSL CA trust fixes, flat worktree hostnames, and path-aware routing and configuration.
- The Windows cmd.exe escaping entry is called out as a security fix. Metacharacter injection through a shim path was reachable from `portless run … -- …` arguments and package scripts.
- The path-routing entry notes that migration removes now-invalid persisted prefixes from `routes.json` with a warning naming the `portless alias ... --path <valid-prefix>` re-registration command.

Verification:

- `bun install` completed with no changes.
- `bun run format:check`, `bun run lint`, `bun run type-check`, and `bun run build` passed. The build emitted the repository's existing non-fatal docs NFT warning.
- `bun run test` passed with 1,227 tests passed and 3 skipped.
- `bun run test:e2e` passed with 15 tests passed and 2 skipped.
- `bun run test:fork-ledger` passed all 5 tests and `bun run check:fork-ledger` is green.
- `bun run test:upstream-drift` passed all 7 tests and `bun run check:upstream-drift` reported no upstream drift.
- No tag, publish, push to `main`, or pull request was performed.
