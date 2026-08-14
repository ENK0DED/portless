# Rewrite FORK.md's standing procedure and narrow the fork-sync skill

Type: task
Status: resolved
Blocked by: 28

## Question

On `upstream-sync-v015`, make FORK.md the single canonical home of the upstream-intake procedure and narrow `skills/portless-fork-sync/SKILL.md` to defer to it. Read [Define the recurring standing procedure](08-define-recurring-procedure.md) — it is the specification for everything below.

**This commit must land before [Update FORK.md's triage ledger for the 14 new PRs](29-fork-md-ledger-update.md)**, which is pinned as the last commit that assigns triage states. Both edit FORK.md; landing this first keeps 29's diff about states, not procedure.

### Fix the live contradiction first

FORK.md's Sync Checklist step 4 currently reads *"keeping fork code in regions covered by an invariant unless upstream is demonstrably better on the merits"* (inverted by ticket 10). `skills/portless-fork-sync/SKILL.md` step 6 still reads *"Take upstream source behavior when upstream added product features or bug fixes"* — the pre-inversion rule that ticket 06 overturned. A cold agent reading the skill would resolve conflicts by the wrong rule. Remove the stale wording from SKILL.md as part of the narrowing.

### FORK.md changes

1. **Two entry points.** Document upstream intake as one procedure with two paths: a **sweep** (PR triage only — diff the live open-PR set and the triage stamps against the ledger; cheap; produces ledger updates or a list of PRs needing a decision) and a **sync** (merge plus release; includes a sweep). Explain *why* they are split: PR triage goes stale continuously while merges are batchy, which is how the ledger sat two months behind current code.

2. **Trigger.** State plainly that intake is **manually triggered only**, whenever the maintainer judges upstream has moved enough to be worth a pass — possibly monthly, yearly, or never again. No cadence may be assumed, and nothing scheduled (no `schedule:` workflow, no scheduled agent, no CI drift gate) may be added. Record that automation *inside* a running pass is welcome; the rule constrains only how a pass begins.

3. **AFK / HITL rule.** Adopt the wayfinder skill's definitions rather than inventing a taxonomy — quote the criterion (HITL is worked *with* a human who speaks for themselves; the agent never stands in for the human's side of it; AFK is driven by the agent alone), then record the three reasons a step stops for the maintainer:
   - **judgment** — assigning a final triage state to any PR whose state would *change*; resolving a conflict in any region a FORK.md invariant covers; ruling anything out of scope;
   - **capability** — the agent cannot reach it (credentials, the maintainer's machine, an account); agent hands over a precise checklist. State this as a rule, **not** a hardcoded list — reachability varies per pass;
   - **consequence** — capable but not authorized: dispatching `release.yml` (a real `@enk0ded/portless` publish) and merging the sync PR to `main` stop for the maintainer *even with working credentials*.

   Record what is AFK: fetching, drift diffing, ledger-set reconciliation, mechanical backports, the verification gate, release mechanics short of publishing, and reading upstream PRs (research — belongs to subagents).

4. **Map threshold.** A sweep never charts a wayfinder map. A sync charts one only when the pass surfaces genuine decisions (contested conflicts, backports worth arguing about); a clean merge just runs the checklist.

5. **Release step.** The checklist currently ends at "run full verification before pushing" and never mentions releasing, though the version-mapping formula sits two sections above. Add an explicit final step: a sync pass always cuts a fork release, referencing the formula; publishing is HITL by consequence.

6. **Drift-checker usage.** Document `bun run check:upstream-drift` as the first step of any pass, replacing the `curl | jq | awk | comm` snippet as the canonical instruction. (The script itself is [Add the upstream-drift checker](32-upstream-drift-checker.md); if that ticket has not landed yet, reference the command and note the script is pending — do not re-inline the shell snippet.)

7. **Self-sufficiency.** State that the procedure never requires reading a past wayfinder map or any `.scratch/` artifact — those are disposable, and a fresh clone must be able to run a full pass from the repo alone.

### SKILL.md changes

Narrow it to skill-shaped content only: when to invoke, which entry point to pick, the conflict hotspot list, and agent-facing hints (SSH-agent fallback, HTTPS push). **Do not delete information outright** — anything currently living only in SKILL.md moves into FORK.md first. Replace the duplicated `## Workflow` and `## Before Finishing` procedure with a pointer to FORK.md's canonical sections.

## Answer

Commits:

- `cf009cf` (`docs(fork): rewrite standing sync procedure`) makes `FORK.md` the canonical standing procedure and narrows `skills/portless-fork-sync/SKILL.md` to entry-point routing, conflict hotspots, and agent hints.
- The final maintenance commit (`docs(fork): resolve ticket 31 and update ledger`) records the preceding fork commits in the ledger and resolves this ticket.

What moved where:

- `FORK.md` now documents the manual-only trigger, sweep and sync entry points, the first-step drift-checker command, the AFK and HITL criterion with judgment, capability, and consequence stops, map threshold, fresh-clone rule, conflict hotspots, verification gate, and final release formula.
- The workflow details previously unique to the skill now live in `FORK.md`, including worktree setup, fetch fallback, merge priority, invariant searches, dependency refresh, release handoff, and completion checks.
- `skills/portless-fork-sync/SKILL.md` points agents to `FORK.md`, retains the conflict hotspot list, and keeps SSH-agent and HTTPS-push hints. The stale upstream-first conflict rule and duplicated workflow are removed.
- The ledger now records `80a0fc0` and `cf009cf`. Drift checking is documented as manual `bun run check:upstream-drift` and CI `bun run test:upstream-drift`; both scripts are pending the next ticket, ticket 32. No scheduled trigger or live CI drift gate was added.

Verification:

- `bun install` completed with no changes.
- `bun run format:check`, `bun run lint`, `bun run type-check`, `bun run build`, and `bun run test` passed. The test suite reports 33 files passed, 1,227 tests passed, and 3 skipped.
- `bun run test:fork-ledger` passed all 5 tests.
- `bun run check:fork-ledger` passed with 139 fork commits checked after the final maintenance commit.
- `bun run check:upstream-drift` and `bun run test:upstream-drift` were not run because ticket 32 has not added those scripts yet.

### Acceptance

- No procedural rule exists in two places with different wording.
- SKILL.md contains no conflict-resolution rule of its own.
- FORK.md answers, without any external artifact: how a pass starts, which entry point, what stops for the human and why, whether to chart a map, and how it ends.
- Run FORK.md's verification gate. Do not push to `main`; do not open a PR.
