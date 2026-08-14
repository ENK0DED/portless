# Reimplement multi-suffix as PORTLESS_SUFFIX lists (fork-shaped #344)

Type: task
Status: resolved
Blocked by: 11

## Question

On `upstream-sync-v015`, implement multiple-suffix support fork-shaped, per [Decide the v0.15 sync strategy](06-decide-v015-sync-strategy.md) (Answer: "#344 multi-TLD" verdict + "Implementation notes"). Not a merge take of upstream `527578e` — reimplement on the fork's model: `PORTLESS_SUFFIX` accepts comma lists and `--suffix` may repeat; fork precedence preserved (`PORTLESS_SUFFIX` wins over `PORTLESS_TLD`, trim/lowercase, dotted suffixes valid); the `proxy.tld` state marker stays for compatibility; service installs persist the list via `PORTLESS_SUFFIX`. Adopt #365's residuals here: 253-char total budget, skip-invalid-persisted-entry warning, longest-suffix-first `parseHostnames`. Update FORK.md's Suffix invariant language for lists (including amendment 1's risky-suffix rule if ticket 10 has not already applied it) and extend the invariant's test coverage list accordingly. Keep every existing suffix test green; add list-precedence, list-parsing, and longest-suffix-first routing tests. Run the verification gate and update the fork-only ledger.

## Added by ticket 07: adopt upstream #348 here

[Lock triage states and backport list for new PRs](07-lock-triage-states-backport-list.md) gives #348 the state `implemented differently`, implemented as part of this ticket — it is only expressible once suffix lists exist. Two independent reviewers judged upstream better on both halves.

**LAN mode preserves an explicitly configured suffix list.** Today LAN mode hard-forces `local`: `cli-utils.ts:490-546` (`effectiveTld = options.lanMode ? "local" : options.tld`), `cli.ts:188-275` (`config.tld = "local"`), plus the "Ignoring --suffix" warning at `cli.ts:4327-4335`. Change it so an explicit `PORTLESS_SUFFIX` value or any repeated `--suffix` values are preserved in LAN mode, deduplicated in order, with `local` appended if absent. Plain `--lan` with no explicit suffix keeps today's `local`-only default. Drop the ignore warning. Mirror it in `service install` (persist the list via `PORTLESS_SUFFIX`, never `PORTLESS_TLD`).

Carry explicitness as **data**, not as a re-derivation from a non-empty list — upstream's `hasExplicitLanInput` check is only safe because its caller already reduced implicit LAN config to `["local"]`, and the fork should not inherit that coupling. Persist the suffix list and the LAN marker separately; never infer network exposure from list membership.

**The `mdnsFqdn()` guard is mandatory, not optional.** `mdns.ts:144-178` `publish()` currently does `hostname.endsWith(".local") ? hostname : hostname + ".local"`. That is unreachable today only because LAN mode erases custom suffixes — the fork **acquires** the doubled-suffix bug the moment this ticket preserves them, publishing `myapp.test.local` records and spawning a needless publisher child per custom-suffix route. Guard it: publish only hostnames whose final suffix is exactly `.local`, returning early for everything else, before any publisher spawns. Add coverage for custom-plus-`local` suffix lists and for same-hostname path routes.

Apply the fork's existing risky-suffix warning logic to the non-`local` members of the merged list.

Tradeoff, for the record: a LAN-bound proxy will answer for both `app.<custom>` and `app.local`, creating two browser origins with distinct cookies, storage and OAuth callback identities. That is acceptable because the custom suffix was explicit, and it does not widen network exposure — LAN mode already makes the proxy reachable, and the second name aliases the same explicitly registered route.

## Answer

Implemented as a fork-shaped reimplementation on `upstream-sync-v015`.

Commits:

- `dcb43fd` (`feat: support ordered suffix lists`) implements the behavior, tests, and user and agent documentation.
- `e261c65` (`docs(fork): record suffix list implementation`) records `207b3ff` and `dcb43fd` in the fork-only ledger.

Design decisions:

- `PORTLESS_SUFFIX` parses comma-separated ordered lists, wins over `PORTLESS_TLD`, and preserves trim, lowercase, deduplication, dotted suffix, label, and 253-character validation rules. Preferred `--suffix` flags may repeat and win over repeated compatibility `--tld` flags when both forms are present.
- `proxy.tlds` stores the complete newline-delimited list. `proxy.tld` remains the primary-suffix compatibility marker. Invalid persisted list members are warned about and skipped individually.
- Suffix explicitness is carried through proxy and service configuration as `tldsExplicit`. LAN state remains a separate marker and is never inferred from `local` list membership. Plain LAN mode uses only `local`; explicit LAN lists retain their order and append `local` when absent.
- Route registration and cleanup are atomic across suffixes while retaining fork-owned protocol, path-prefix, and multiplex-label metadata. CLI apps, aliases, workspaces, Turbo manifests, Vite allowed hosts, proxy internal pages, TLS SNI, and services use the full list.
- `mdnsFqdn()` accepts only exact `.local` hostnames. Non-local members return before publisher discovery or child spawn, and repeated same-hostname path routes share one publication.
- Proxy 404 suggestions strip the longest configured suffix first. Reserved dashboard and certificate hosts are recognized on every configured suffix.
- Services persist the resolved list only through `PORTLESS_SUFFIX` and expose every member through repeated preferred flags.
- `README.md`, `skills/portless/SKILL.md`, CLI help, docs-site pages, and the FORK.md Suffix Lists invariant now describe the list model and LAN behavior.

Coverage added or extended:

- List precedence, parsing, normalization, deduplication, empty explicitness, repeated flag emission, persistence compatibility, invalid-entry recovery, and LAN explicitness in `cli-utils.test.ts`.
- Repeated proxy suffix lifecycle and multi-suffix alias registration in `cli.test.ts`, including replacement of the obsolete LAN ignore-warning assertion.
- Multi-suffix service commands, `PORTLESS_SUFFIX` persistence, status output, and explicit LAN list preservation in `service.test.ts`.
- Longest-suffix-first 404 suggestions and internal pages on secondary suffixes in `proxy.test.ts`.
- Exact `.local` guarding, mixed custom-plus-local lists, and duplicate same-hostname path publication in `mdns.test.ts`.
- Existing `utils.test.ts` coverage verifies longest-suffix-first `parseHostnames`, per-suffix 253-character handling, and overlapping dotted suffixes.

Verification:

- `bun install`: green, no dependency changes.
- `bun run format:check`: green with the untracked `.scratch` tracker temporarily outside the Prettier scan, then restored unchanged. The initial scan reported unrelated tracker files that this ticket forbids editing.
- `bun run lint`: green.
- `bun run type-check`: green.
- `bun run build`: green, including the docs production build. The existing Next.js NFT tracing warning remains non-fatal.
- `bun run test`: green, 1,030 passed and 2 skipped.
- `bun run test:e2e`: green, 15 passed and 2 environment-dependent Python cases skipped.
- Focused suffix, mDNS, service, proxy, and hostname suites: 360 passed.
- Fork package-identity grep: no matches.
- `PORTLESS_TLD` documentation grep: remaining matches are compatibility language or historical changelog entries.
- `bun run check:fork-ledger`: green, 91 fork commits checked.
