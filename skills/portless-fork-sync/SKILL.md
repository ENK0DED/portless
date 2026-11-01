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
- `apps/docs/content/docs/changelog.mdx`
- `apps/docs/tests/fixtures/docs-baseline.json`

## Agent Hints

- Prefer HTTPS with GitHub CLI credentials; it needs no SSH agent:

  ```bash
  git -c credential.helper='!gh auth git-credential' fetch https://github.com/vercel-labs/portless.git '+refs/heads/*:refs/remotes/upstream/*'
  ```

  Live SSH agent sockets are not only under `/tmp` (check `~/.ssh/agent/`), and signing may wait for a device approval the agent cannot give. Treat a hanging SSH operation as missing capability and hand off rather than retrying. Do not force-fetch upstream tags into the local tag namespace.

- When a branch push is authorized but SSH remains unavailable, use the HTTPS fork remote:

  ```bash
  git push https://github.com/ENK0DED/portless.git <branch>
  ```

- Keep `FORK.md`'s invariant and human-boundary decisions authoritative. Do not invent a second conflict rule or release procedure in this skill.
