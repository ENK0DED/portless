# Update FORK.md's triage ledger for the 14 new PRs

Type: task
Status: resolved
Blocked by: 32

## Question

On `upstream-sync-v015`, update FORK.md's "Upstream Open PR Triage" section so every open upstream PR again carries a final state. **This must be the last commit that assigns a triage state**, after all backport code has landed — the states below are written as final, and the commit ordering is what keeps `main` from ever carrying a state that is a promise rather than a fact. Two commits follow it and neither assigns a state: [Backfill per-PR triage stamps](33-triage-stamp-backfill.md) records provenance only, and [Prepare release 0.15.6002](30-prepare-release-0-15-6002.md) is the release. [Rewrite FORK.md's standing procedure](31-fork-md-standing-procedure.md) lands *before* this ticket, so this diff stays about states rather than procedure.

Read [Lock triage states and backport list for new PRs](07-lock-triage-states-backport-list.md) for the full rationale behind each state; it is the specification.

**States to record** (14 new PRs):

| PR | State |
| --- | --- |
| #383 | `implemented differently` |
| #377 | `implemented differently` |
| #374 | `implemented differently` |
| #371 | `implemented` |
| #360 | `implemented differently` |
| #359 | `implemented differently` |
| #354 | `implemented differently` |
| #351 | `implemented` |
| #350 | `implemented differently` |
| #348 | `implemented differently` |
| #342 | `won't implement` |
| #341 | `won't implement` |
| #340 | `won't implement` |
| #335 | `implemented differently` |

Preserve the decision rationale for each in the ledger's "Decision and preserved rationale" column, with fork commit evidence — the ledger's purpose is to answer the same question next pass without re-deriving it. Two entries especially need their reasoning preserved: #342 and #341, so that future env-var-validation and regex-case security reports can be answered from the ledger; and #348, which **reversed** from the research recommendation once ticket 06 put multi-suffix in scope.

Also update `#165`'s existing entry: state stays `implemented differently`, but record that the 2026-07-15 expansion was re-triaged and produced backports (tickets 20 and 28).

Refresh the section's count line ("N implemented, N implemented differently, N won't implement") and its "Current Result" date and open-PR total, rechecked against upstream at the time of the commit.

**Record the state-choice rule** in the section so the next pass inherits it: `implemented differently` whenever the fork changes the surface, the safety default, or the integration shape; `implemented` when the fork ends up materially equivalent to upstream.

**One invariant rewording.** FORK.md:329 currently asserts that mutation endpoints need a separate CSRF and auth design, phrased as a security requirement. Two independent reviewers judged that over-broad *as a security claim* — a parameterless, idempotent, loopback-only endpoint that converges to state the daemon already writes autonomously carries negligible CSRF risk. The fork still declines such endpoints (see ticket 22), so keep the invariant, but restate it as a **simplicity and surface-area policy** rather than a security assertion, and note that a security-grade exception requires either an owner-only IPC channel or a capability token in a non-simple request header. Do not weaken the read-only dashboard decision itself.

Run the FORK.md verification gate. Do not push to `main`; do not open a PR.

## Answer

Commits:

- Verified the backport evidence used by the final rows: `5d89151` and `f95d7de` for #165, `c5fd9e5` for #383, `cb33fc7` for #374, `1d5ddd2` for #371, `89b151b` for #350, `a0c4433` for #351, `7fbfcf7` for #359, `019eecc` for #377, and `dcb43fd` for the #348 reversal through ticket 12. Existing fork commits cover #360, #354, and #335.
- The final maintenance commit (`docs(fork): resolve ticket 29 and update ledger`) records the triage rows and resolves this ticket.

Ledger shape:

- `FORK.md` now records the 52 open PRs on 2026-08-14 with 26 `implemented`, 19 `implemented differently`, and 7 `won't implement` states.
- The ten closed PRs (#321, #303, #302, #301, #300, #292, #286, #278, #277, and #67) are absent from the open-PR table and documented as closed unmerged. #286 remains `implemented` in the retained decision table.
- All 14 new PRs have ticket 07's final states and condensed rationale. #165 records the ticket 20 and 28 backports, #348 records its reversal, and the state-choice rule plus the read-only dashboard surface-area policy are durable in the section.

Verification:

- `bun run check:upstream-drift` reported no upstream drift and no open-PR-set drift. It reported only the permitted missing triage stamp columns.
- `bun install`, `bun run format:check`, `bun run lint`, `bun run type-check`, `bun run build`, `bun run test`, `bun run test:fork-ledger`, and `bun run check:fork-ledger` passed. The full suite reported 1,227 passed and 3 skipped.
