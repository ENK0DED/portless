---
name: portless-fork-sync
description: Use when syncing the ENK0DED portless fork with upstream, resolving upstream merge conflicts, preserving fork package identity, maintaining fork semver mapping, or checking fork-owned behavior after pulling upstream changes.
---

# Portless Fork Sync

## Overview

Use this skill to merge upstream `vercel-labs/portless` into the ENK0DED fork without losing fork-owned package identity, versioning, Bun workflow, local behavior, or the fork's upstream-PR triage record.

## Required Context

Read `FORK.md` before resolving conflicts. It is the source of truth for fork-owned invariants and verification.

## Workflow

1. Confirm the worktree is clean:

```bash
git status --short --branch
```

2. If SSH auth fails, find a working agent socket and prefix git network commands with it:

```bash
find /tmp -type s \( -name 'agent.*' -o -name '*ssh*' \) 2>/dev/null
SSH_AUTH_SOCK=/tmp/path/to/agent ssh-add -l
SSH_AUTH_SOCK=/tmp/path/to/agent git fetch --all --prune
```

3. Create a local backup branch before merging:

```bash
git branch backup/pre-upstream-sync-YYYYMMDD
```

4. Compare fork-only and upstream-only commits:

```bash
git log --oneline --decorate upstream/main..HEAD
git log --oneline --decorate HEAD..upstream/main
```

5. Merge upstream:

```bash
git merge upstream/main --no-edit
```

6. Resolve conflicts with this priority:

- Take upstream source behavior when upstream added product features or bug fixes.
- Reapply fork invariants from `FORK.md`.
- Keep `@enk0ded/portless` in package metadata, install docs, CLI help, release workflow, and tests.
- Map upstream versions with the fork formula in `FORK.md`.
- Keep Bun as the repo package manager. Remove `pnpm-lock.yaml` and `pnpm-workspace.yaml` if upstream restores them.
- Preserve `PORTLESS_SUFFIX` as the documented custom suffix env var. Keep `PORTLESS_TLD` as a compatibility alias.

7. Run invariant searches:

```bash
rg --glob '!FORK.md' --glob '!skills/portless-fork-sync/SKILL.md' 'npm install -g [p]ortless|npm install -D [p]ortless|npm view [p]ortless|"name": "[p]ortless"|github.com/vercel-labs/[p]ortless|node_modules/[p]ortless'
rg '[p]npm install|[p]npm build|[p]npm test|[p]npm lint|[p]npm type-check|[p]npm format|[p]npm dev|[p]npm run dev:app'
rg -n '^[<]{7}|^[=]{7}|^[>]{7}'
```

8. Verify the open upstream PR set is fully represented in `FORK.md`:

```bash
live=$(mktemp)
doc=$(mktemp)
curl -fsSL 'https://api.github.com/repos/vercel-labs/portless/pulls?state=open&per_page=100' | jq -r '.[].number' | sort -n > "$live"
awk '/### Full Open Upstream PR State on/{flag=1; next} /## Sync Checklist/{flag=0} flag { while (match($0, /#[0-9]+/)) { print substr($0, RSTART + 1, RLENGTH - 1); $0 = substr($0, RSTART + RLENGTH) } }' FORK.md | sort -n > "$doc"
comm -3 "$live" "$doc"
```

If `comm` prints anything, update `FORK.md`. Every currently open upstream PR should be marked `implemented`, `implemented differently`, or `won't implement`. If a future pass temporarily needs `planned` or `deferred`, keep the discussion directly in `FORK.md` with an owner, date, and decision checkpoint.

9. Refresh dependencies with Bun:

```bash
bun install
```

10. Run verification:

```bash
bun run format:check
bun run lint
bun run type-check
bun run build
bun run test
```

Run `bun run test:e2e` when merged changes affect proxy lifecycle, framework flag injection, route cleanup, sharing, or multi-app orchestration.

## Conflict Hotspots

Expect recurring conflicts in:

- `package.json`
- `packages/portless/package.json`
- `bun.lock`
- `.github/workflows/ci.yml`
- `.github/workflows/release.yml`
- `README.md`
- `skills/portless/SKILL.md`
- `packages/portless/src/cli.ts`
- `packages/portless/src/cli.test.ts`
- `packages/portless/src/cli-utils.test.ts`
- `CHANGELOG.md`
- `apps/docs/src/app/changelog/page.mdx`

When behavior changes commands, flags, config, or human-facing usage, update README, `skills/portless/SKILL.md`, CLI help, and relevant docs pages under `apps/docs/src/app` together.

## Before Finishing

Confirm these facts explicitly:

- `packages/portless/package.json` uses `@enk0ded/portless`.
- The fork version follows the `FORK.md` formula.
- No upstream install command points to the unscoped npm package.
- The live upstream open PR set matches the `FORK.md` open PR state table.
- No conflict markers remain.
- Verification commands were run and their outcomes are known.
