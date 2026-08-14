---
name: portless-fork-sync
description: Use when syncing the ENK0DED portless fork with upstream, resolving upstream merge conflicts, preserving fork package identity, maintaining fork semver mapping, or checking fork-owned behavior after pulling upstream changes.
---

# Portless Fork Sync

## When to invoke

Use this skill to merge upstream `vercel-labs/portless` into the ENK0DED fork without losing fork-owned package identity, versioning, Bun workflow, local behavior, or the fork's upstream-PR triage record.

## Required Context

Read `FORK.md` in full before choosing an entry point, resolving conflicts, or running a sync. It is the canonical source of the trigger, sweep and sync procedure, fork-owned invariants, AFK and HITL boundaries, release mapping, and verification gate.

## Entry Point

Choose **sweep** when the task is PR triage only. Choose **sync** when it includes merging upstream and cutting a fork release. A sync includes a sweep. Follow the selected path in `FORK.md`; this skill does not duplicate that procedure.

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

## Agent Hints

- If SSH authentication fails, look for a reachable agent socket before handing off for missing capability:

  ```bash
  find /tmp -type s \( -name 'agent.*' -o -name '*ssh*' \) 2>/dev/null
  SSH_AUTH_SOCK=/tmp/path/to/agent ssh-add -l
  SSH_AUTH_SOCK=/tmp/path/to/agent git fetch --all --prune
  ```

- When a branch push is authorized but SSH remains unavailable, use the HTTPS fork remote:

  ```bash
  git push https://github.com/ENK0DED/portless.git <branch>
  ```

- Keep `FORK.md`'s invariant and human-boundary decisions authoritative. Do not invent a second conflict rule or release procedure in this skill.
