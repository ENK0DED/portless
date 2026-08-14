# Backfill per-PR triage stamps across the ledger

Type: task
Status: resolved
Blocked by: 29

## Question

On `upstream-sync-v015`, give every row of FORK.md's "Full Open Upstream PR State" table a **triage stamp**: the date it was triaged and the upstream PR **head SHA** at that moment. Read [Define the recurring standing procedure](08-define-recurring-procedure.md) for the rationale.

This runs **after** [Update FORK.md's triage ledger for the 14 new PRs](29-fork-md-ledger-update.md), which finalises the states this ticket stamps. It does not violate 29's "last commit" rule: 29 remains the last commit that *assigns* a triage state; this one only records provenance for states already final.

### Why

Ticket 02 read 10 closed and 38 open PRs by hand to establish that only #165 had changed materially enough to re-triage. That work is unrepeatable because the ledger records no per-PR provenance — the next pass, possibly a year out, would redo all of it. A stored head SHA turns it into a diff.

### What to do

- Add stamp columns (triage date + upstream head SHA) to the full open-PR state table.
- Backfill every row. Rows triaged in the 2026-06-18 pass carry that date; the 14 new PRs carry the date of the [Lock triage states and backport list for new PRs](07-lock-triage-states-backport-list.md) pass.
- Fetch head SHAs mechanically: `gh pr view <n> -R vercel-labs/portless --json headRefOid,updatedAt`.
- For a PR whose head has already moved since its triage date, record the SHA **as of triage** where it is recoverable, and otherwise record the current SHA with a note — a stamp that silently claims a PR is unchanged when it is not is worse than an honest gap.
- Note in the section that stamps are what `bun run check:upstream-drift` compares against, so a future pass knows to keep them current.

### Acceptance

- Every row in the table has a stamp, or an explicit noted gap.
- `bun run check:upstream-drift` runs clean against the backfilled table.
- No triage state changes in this commit — provenance only.
- Run FORK.md's verification gate. Do not push to `main`; do not open a PR.

## Answer

Commits:

- The final maintenance commit is `docs(fork): resolve ticket 33 and backfill ledger stamps`.

Stamp format:

- The full open-PR table now uses the exact ticket 32 columns `Triage date` and `Upstream head SHA`.
- All 52 rows carry the 2026-08-14 stamp date and the full 40-character upstream PR head OID fetched with `gh pr view <n> -R vercel-labs/portless --json headRefOid`.
- Rows whose decisions date from 2026-06-18 retain those decisions because ticket 02 verified they were unchanged; this pass records today's date and head SHA as their current provenance. No triage state or rationale changed.

Drift and verification:

- `bun run check:upstream-drift` reported `No upstream drift detected.` with no base commits ahead of recorded base `326e893`, no open-PR set drift, no stamp warnings, and no head drift.
- `bun run test:upstream-drift` passed all 7 tests.
- `bun run check:fork-ledger` passed.
- The full verification gate passed: `bun install`, `bun run format:check`, `bun run lint`, `bun run type-check`, `bun run build`, and `bun run test` with 1,227 tests passed and 3 skipped.
