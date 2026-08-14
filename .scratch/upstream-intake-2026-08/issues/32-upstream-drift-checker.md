# Add the upstream-drift checker

Type: task
Status: resolved
Blocked by: 31

## Question

On `upstream-sync-v015`, add a tested script that answers "has upstream drifted from the ledger?" so a cold pass starts with a command instead of manual reading. Read [Define the recurring standing procedure](08-define-recurring-procedure.md) for the rationale.

Model it on `scripts/check-fork-ledger.ts` (`6a942d2`) — same structure, same testing bar, pure exported functions with a thin CLI wrapper.

### What it reports

1. **Set drift** — open upstream PRs missing from FORK.md's "Full Open Upstream PR State" table, and table entries no longer open upstream. This replaces SKILL.md step 8's `curl | jq | awk | comm` snippet.
2. **Stamp drift** — triaged PRs whose upstream head SHA no longer matches the head SHA recorded in their triage stamp, i.e. the PR materially changed since it was triaged. This is the check that would have surfaced #165's 2026-07-15 expansion without reading 48 PRs by hand.

Stamp drift depends on the stamps themselves, which [Backfill per-PR triage stamps](33-triage-stamp-backfill.md) adds after ticket 29. Handle a missing or unstamped row as **reported, not fatal** — the checker must be useful before the backfill lands and must not fail hard on a row it cannot evaluate.

### Invocation split

- `bun run check:upstream-drift` — **manual only**, run by the maintainer at the start of a pass. It must **not** be added to `ci.yml` or any workflow. Upstream moves independently of fork commits, so gating on it would fail PRs for reasons unrelated to the change under test.
- `bun run test:upstream-drift` — **added to `ci.yml`**, mirroring the existing `test:fork-ledger` step. Testing the fork's own script is self-caused drift and a fair gate; without it the tool rots silently across a possibly year-long gap between passes.

Do not add a `schedule:` workflow. Do not add a new workflow file at all.

### Acceptance

- `scripts/check-upstream-drift.ts` plus `scripts/check-upstream-drift.test.ts`, with parsing and comparison logic covered by unit tests against fixture markdown (no network in tests).
- Both `check:upstream-drift` and `test:upstream-drift` in root `package.json` scripts.
- `ci.yml` runs `test:upstream-drift` only.
- Exit code and output make "no drift" unmistakable, so a pass can stop there.
- Run FORK.md's verification gate. Do not push to `main`; do not open a PR.

## Answer

Commits:

- `2850ba7` (`feat: add upstream drift checker`) adds the checker, fixture tests, package scripts, and the CI unit-test step.
- The final maintenance commit (`docs(fork): resolve ticket 32 and update ledger`) records `2850ba7` in FORK.md and resolves this ticket.

Script behavior:

- Reads the recorded upstream base from FORK.md, reports commits in that base-to-`upstream/main` range, and explains how to fetch the upstream ref when Git cannot read it.
- Queries `vercel-labs/portless` with `gh pr list`, compares the live open-PR set with the full triage table, and gives a clear unavailable-or-unauthenticated error when the GitHub CLI cannot run.
- Reads triage date and head-SHA columns when present, reports changed heads, and reports missing stamps without making them fatal. The current unstamped table is handled with a warning.
- `check:upstream-drift` exits nonzero for actionable base, set, or stamp drift and prints an explicit no-drift result otherwise. `test:upstream-drift` has no network dependency.

Test coverage:

- Seven fixture tests cover recorded-base parsing, the current table without stamps, later stamp headers, GitHub CLI JSON parsing, independent base and set drift, changed head SHAs, prefix-compatible SHAs, and nonfatal missing stamps.

Verification:

- `bun install` completed with no changes.
- `bun run format:check`, `bun run lint`, `bun run type-check`, and `bun run build` passed.
- `bun run test` passed with 1,227 tests passed and 3 skipped.
- `bun run test:e2e` passed with 15 tests passed and 2 skipped.
- `bun run test:upstream-drift` passed all 7 tests; `bun run test:fork-ledger` passed all 5 tests.
- `bun run check:upstream-drift` correctly reported no base commits ahead, 14 live PRs missing from the current table, 10 table entries no longer open, and absent triage stamp columns, so it exited 1 for the live set drift.
- `bun run check:fork-ledger` remains green after the final maintenance commit.
