# Portless Fork Notes

This repository is the ENK0DED fork of upstream `vercel-labs/portless`. Keep this file current whenever the fork adds behavior, release policy, package identity, or agent workflow that upstream does not own.

## Fork-Owned Invariants

### Package Identity

- npm package: `@enk0ded/portless`
- CLI command: `portless`
- Repository: `https://github.com/ENK0DED/portless`
- Release workflow registry check: `npm view @enk0ded/portless version`
- Install docs must use `npm install -g @enk0ded/portless` and `npm install -D @enk0ded/portless`

After every upstream sync, search for upstream package install strings:

```bash
rg 'npm install -g [p]ortless|npm install -D [p]ortless|npm view [p]ortless|"name": "[p]ortless"|github.com/vercel-labs/[p]ortless|node_modules/[p]ortless'
```

### Version Mapping

Fork releases use stable semver and reserve patch ranges by upstream patch:

```text
fork patch = ((upstream patch + 1) * 1000) + fork iteration
```

Examples:

- Upstream `0.14.0`, first fork release: `0.14.1000`
- Local-only release after that: `0.14.1001`
- Upstream `0.14.1`, first fork release: `0.14.2000`

This avoids prerelease semantics and keeps room for local-only releases between upstream syncs.

### Package Manager

This fork uses Bun for repository development.

- Keep `packageManager` set to `bun@1.3.11` or newer in `package.json`
- Keep `bun.lock`
- Do not keep `pnpm-lock.yaml` or `pnpm-workspace.yaml`
- CI, release workflows, Windows debug scripts, README, and `skills/portless/SKILL.md` must use `bun install` and `bun run ...`

Portless can still support pnpm as a child command or workspace format. Do not remove product support for pnpm just because this fork uses Bun.

### Suffix Environment Variable

This fork documents `PORTLESS_SUFFIX` as the preferred environment variable for custom suffixes. `PORTLESS_TLD` remains a compatibility alias.

Coverage:

- `packages/portless/src/cli-utils.test.ts` covers `PORTLESS_SUFFIX`, `PORTLESS_TLD`, and precedence
- `packages/portless/src/cli.ts` help output documents `PORTLESS_SUFFIX` first
- `README.md` and `skills/portless/SKILL.md` document `PORTLESS_SUFFIX` first

### Boolean Environment Variable Docs

Docs and CLI help only document boolean environment variables with `0` and `1`. Code may accept additional internal values when already supported, but do not add those alternatives to user-facing docs.

## Sync Checklist

1. Start from a clean worktree and create a backup branch at the current fork tip.
2. Fetch `origin` and `upstream` with a working SSH agent.
3. Merge `upstream/main` into local `main`.
4. Resolve conflicts by taking upstream feature code first, then reapply fork invariants from this file.
5. Remove upstream pnpm workspace files if they return.
6. Run the package-name search above and fix every hit unless it is intentionally testing compatibility.
7. Run `bun install` to refresh `bun.lock`.
8. Run focused tests for any fork invariant touched by the merge.
9. Run full verification before pushing.

## Verification Commands

Use these after every sync:

```bash
bun install
bun run format:check
bun run lint
bun run type-check
bun run build
bun run test
```

Run `bun run test:e2e` when source changes affect proxy lifecycle, framework flag injection, multi-app orchestration, sharing, or route cleanup.
