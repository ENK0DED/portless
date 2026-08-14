# Adopt portless doctor (#337) against the finished fork surface

Type: task
Status: resolved
Blocked by: 15

## Question

On `upstream-sync-v015`, adopt upstream #337 (`a112bae`) `portless doctor`, written against the fork's finished surface (this ticket is deliberately last in the feature chain so doctor is not rewritten twice). Beyond upstream's checks, doctor must understand the fork's model: suffix lists (`PORTLESS_SUFFIX`, ticket 12), loopback-default bind with LAN-mode widening (ticket 13), dotted suffixes, the `~/.portless` state layout with `PORTLESS_STATE_DIR` and the sudo inbound/outbound handoff, CA/cert state and the `cert.<suffix>` page, hosts-file sync, mDNS tooling presence, background apps (`portless bg`), tunnel providers (cloudflared/ngrok binaries), and Tailscale/NetBird availability. Keep it read-only diagnostics — no mutations. Update CLI help, completions (`5f20c3c` surface), README, `skills/portless/SKILL.md`, and docs-site command docs. Run the verification gate and update the fork-only ledger.

## Answer

Commits:

- `a455c86` adds the fork-aware `portless doctor` command, diagnostics engine, state markers, tests, CLI and completion integration, and user, agent, and docs-site documentation.
- The final `docs(fork)` resolution commit records `4b68d8d` and `a455c86` in the fork-only ledger and resolves this ticket.

Checklist implemented:

- Read-only snapshot collection and evaluation cover ordered and dotted suffixes, configured loopback or LAN bind scope, state-directory access, inbound and outbound sudo handoff, generated and custom TLS state, enabled or intentionally disabled `cert.<suffix>` pages, proxy and route liveness, hosts sync including mixed LAN suffix lists, exact `.local` mDNS support, background apps, Cloudflare and ngrok binaries, and Tailscale and NetBird readiness.
- HTTPS certificate-page probes use TLS without SNI, preventing diagnostic probes from generating hostname certificate cache entries. Windows command probes use the protected `.cmd` and `.bat` invocation path. Direct ngrok route metadata and malformed persisted suffix lists are diagnosed.
- CLI help, bash, zsh, and fish completions, README, `skills/portless/SKILL.md`, and the docs-site command page document the command and its non-mutating behavior.

Test coverage:

- `doctor.test.ts` has 19 tests covering healthy and degraded fork states, mixed LAN suffixes, malformed state, custom and disabled internal pages, a live TLS certificate page with byte-for-byte state preservation, sudo identity permissions, Windows shims, mesh readiness parsing, providers, routes, and background entries.
- CLI and state-marker tests cover command dispatch, `PORTLESS=0`, help, completions, empty-state immutability, custom-certificate lifecycle, disabled-internal-page lifecycle, and cleanup.

Verification:

- `bun run format:check && bun run lint && bun run type-check && bun run build && bun run test` passed on the final implementation state.
- The final implementation review found no remaining blocking issue.
- `bun run check:fork-ledger` passed with 108 fork commits checked before the final ledger-maintenance commit.
