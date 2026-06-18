# Background App Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement upstream `vercel-labs/portless` PR #333 as fork-specific first-party background app management without weakening loopback-only defaults, route cleanup, sharing cleanup, or current fork features.

**Architecture:** Add `portless bg` as a CLI/process-supervision feature, not UI work. `bg start` should spawn this same portless entry point in detached `run` mode, store a locked registry under the active state directory, capture private capped logs, and use an internal ready-file handshake from `runApp()` instead of scraping stdout for URLs. The background layer must preserve all current foreground `run` features: path-scoped routes, h2c upstreams, managed tunnels, Tailscale Serve/Funnel/Service, ngrok, NetBird, LAN, suffix, custom app ports, command placeholders, and safe cleanup.

**Tech Stack:** TypeScript, Bun, Node `child_process`, Node `fs`, existing portless CLI parser patterns, existing JSON state stores, existing route and tunnel cleanup helpers, and Vitest tests run through `bun`.

---

## Source Assessment

- Upstream PR: <https://github.com/vercel-labs/portless/pull/333>
- Upstream title: `Add background app management`
- Upstream commit inspected: `9d53f313fc073aa75ea58bdbcbf9bc725133fcf4`
- Upstream branch: `bjesuiter/portless:portless-process-control`
- Upstream feature surface: `portless bg start`, `stop`, `restart`, `status`, `list`, `logs`, and `clean`.
- Upstream implementation shape: one new `packages/portless/src/bg.ts`, registry under `<state>/bg/registry.json`, logs under `<state>/bg/logs`, detached `portless run`, optional `--wait`, and docs/help integration.
- Reassessment: this is not UI-focused. It is a CLI/process lifecycle feature that may later feed a dashboard, but it is useful without browser UX work.

## Fork-Specific Decisions

- Implement the feature, but not by copying upstream directly.
- Use a locked registry. Multiple agents can operate in the same repo and state directory at the same time.
- Use `0700` directories and `0600` log files for bg state. Background logs can contain tokens, app secrets, cookies, request bodies, stack traces, or private URLs.
- Do not shell out to `tail` for log following. Implement log reads and follow behavior in Node.
- Do not determine readiness by parsing human stdout. Add an internal ready-file handshake from `runApp()` when it is launched by `portless bg`.
- Make readiness waiting the safe default for `bg start`. Default: wait up to 30 seconds. Add `--no-wait` for users who explicitly want fire-and-forget behavior. Keep `--wait [seconds]` to customize the timeout.
- If readiness times out, kill the spawned process group by default and remove the provisional registry entry. `--keep` may leave it running, but it must be visibly marked as not ready.
- Do not kill arbitrary processes just because they listen on the same port. Force cleanup may remove only the exact route owned by the bg entry PID and stop sharing processes recorded on that exact route.
- Keep public exposure explicit. Background mode only forwards sharing flags the user explicitly passes; it must not infer public tunnels or LAN exposure from being backgrounded.
- First pass supports macOS and Linux. Windows should fail early with a clear message and no state mutation until a separate Windows process-group design is implemented.
- Fix the upstream `--tail 0` bug: `portless bg logs <name> --tail 0` must print no log lines.

## User-Facing Command Shape

```bash
portless bg start [options] [command...]
portless bg stop [name] [--path <prefix>] [--force]
portless bg restart [name] [--path <prefix>] [--wait [seconds]] [--no-wait] [--keep]
portless bg status [name] [--path <prefix>] [--json]
portless bg list [--json]
portless bg logs [name] [--path <prefix>] [--tail <lines>] [--all] [--follow] [--errors] [--bg]
portless bg clean [name] [--path <prefix>] [--all] [--json]
```

`bg start` should accept the foreground run flags that make sense for one app:

```bash
--name <name>
--force
--app-port <number>
--h2c
--path <prefix>
--tunnel <provider>
--tunnel-hostname <hostname>
--tailscale
--tailscale-service
--tailscale-service-name <name>
--funnel
--ngrok
--netbird
--netbird-password <secret>
--netbird-pin <code>
--netbird-groups <csv>
--wait [seconds]
--no-wait
--keep
--json
```

No new boolean environment variables are required for this pass.

## Data Model

Create focused bg types instead of keeping everything inside `cli.ts`:

```ts
export interface BgRouteKey {
  hostname: string;
  pathPrefix: string;
}

export interface BgStartIntent {
  name?: string;
  cwd: string;
  commandArgs: string[];
  explicitCommand: boolean;
  force: boolean;
  appPort?: number;
  protocol?: RouteProtocol;
  pathPrefix: string;
  tunnel?: ManagedTunnelOptions;
  sharing: {
    tailscale: boolean;
    tailscaleService: boolean;
    tailscaleServiceName?: string;
    funnel: boolean;
    ngrok: boolean;
    netbird: boolean;
    netbirdPassword?: string;
    netbirdPin?: string;
    netbirdGroups?: string;
  };
}

export interface BgProcessEntry {
  version: 1;
  id: string;
  label: string;
  pid: number;
  cwd: string;
  startedAt: string;
  readyAt?: string;
  route?: BgRouteKey;
  url?: string;
  state: "starting" | "ready" | "stopped" | "unknown";
  intent: BgStartIntent;
}
```

The registry should be an array, not a record keyed only by name, because this fork supports route identity by `hostname + pathPrefix`.

## Task 1: Background Store And Log Primitives

**Files:**

- Create: `packages/portless/src/bg-store.ts`
- Create: `packages/portless/src/bg-store.test.ts`
- Create: `packages/portless/src/bg-logs.ts`
- Create: `packages/portless/src/bg-logs.test.ts`
- Modify: `packages/portless/src/clean-utils.ts`
- Modify: `packages/portless/src/clean-utils.test.ts`

- [ ] **Step 1: Write failing registry tests**

Add tests that cover these cases in `packages/portless/src/bg-store.test.ts`:

```ts
it("returns an empty registry when no bg registry exists", () => {});
it("persists entries with private file permissions", () => {});
it("updates by id without replacing unrelated entries", () => {});
it("removes by id without replacing unrelated entries", () => {});
it("loads only valid entries from a mixed registry", () => {});
it("uses a route key that includes hostname and path prefix", () => {});
it("serializes concurrent writes through a lock", () => {});
```

Run:

```bash
cd packages/portless && bun run test src/bg-store.test.ts
```

Expected: tests fail because the module does not exist.

- [ ] **Step 2: Write failing log tests**

Add tests that cover these cases in `packages/portless/src/bg-logs.test.ts`:

```ts
it("creates logs below a safe bg log directory", () => {});
it("uses filenames derived from a safe generated id", () => {});
it("caps large log files without breaking UTF-8 line boundaries", () => {});
it("returns the last N lines", () => {});
it("returns no lines for tail 0", () => {});
it("does not throw when a log file is missing", () => {});
```

Run:

```bash
cd packages/portless && bun run test src/bg-logs.test.ts
```

Expected: tests fail because the module does not exist.

- [ ] **Step 3: Implement `BgStore`**

Implement a lock-backed store with these rules:

- State directory: `<state>/bg`
- Registry path: `<state>/bg/registry.json`
- Lock path: `<state>/bg/registry.lock`
- Directory mode: `0o700`
- Registry file mode: `0o600`
- Lock behavior: same timeout, stale-lock threshold, jitter, and retry style as `RouteStore` and `TunnelAliasStore`
- Corrupt registry: warn and return an empty array, never throw from list/status paths
- Unknown future entry versions: ignore with a warning

- [ ] **Step 4: Implement log helpers**

Implement these exports in `bg-logs.ts`:

```ts
export function getBgLogPaths(stateDir: string, entryId: string): BgLogPaths;
export function appendBgLifecycleLog(paths: BgLogPaths, message: string): void;
export function truncateBgLogFile(filePath: string): void;
export function readLastBgLogLines(filePath: string, count: number): string[];
export function readWholeBgLog(filePath: string): string;
```

Use `0o600` for logs and `0o700` for directories. `readLastBgLogLines(filePath, 0)` must return `[]`.

- [ ] **Step 5: Extend `clean-utils` allowlist**

Add `bg` as a generated state directory that `removePortlessStateFiles()` can delete after `handleClean()` has stopped managed background apps.

- [ ] **Step 6: Verify and commit**

Run:

```bash
cd packages/portless && bun run test src/bg-store.test.ts src/bg-logs.test.ts src/clean-utils.test.ts
bun run lint
git diff --check
```

Commit:

```bash
git add packages/portless/src/bg-store.ts packages/portless/src/bg-store.test.ts packages/portless/src/bg-logs.ts packages/portless/src/bg-logs.test.ts packages/portless/src/clean-utils.ts packages/portless/src/clean-utils.test.ts
git commit -S -m "feat(bg): add background registry primitives"
```

Commit body must include upstream PR data: `vercel-labs/portless#333`, title `Add background app management`, upstream commit `9d53f313fc073aa75ea58bdbcbf9bc725133fcf4`, and the private log-file security decision.

## Task 2: CLI Parser, Dispatch, And Completion Surface

**Files:**

- Create: `packages/portless/src/bg.ts`
- Create: `packages/portless/src/bg.test.ts`
- Modify: `packages/portless/src/cli.ts`
- Modify: `packages/portless/src/cli.test.ts`

- [ ] **Step 1: Write failing parser tests**

Add tests for:

```ts
it("prints bg help", () => {});
it("dispatches bg help even when PORTLESS=0", () => {});
it("rejects unknown bg subcommands", () => {});
it("parses bg start with every current run flag", () => {});
it("rejects --keep with --no-wait", () => {});
it("rejects invalid --wait values", () => {});
it("keeps command arguments after the CLI separator untouched", () => {});
it("does not treat child command flags as bg flags after parsing stops", () => {});
```

Run:

```bash
cd packages/portless && bun run test src/bg.test.ts src/cli.test.ts
```

Expected: tests fail because `bg` is not implemented.

- [ ] **Step 2: Implement `handleBg()` shell**

`packages/portless/src/bg.ts` should export:

```ts
export async function handleBg(args: string[], options: { entryScript: string }): Promise<void>;
```

Initial implementation should support help, parser errors, early platform rejection, and stubs for subcommands. Do not start processes in this task.

- [ ] **Step 3: Wire top-level dispatch**

Update `cli.ts`:

- Add `bg` to top-level command completion metadata.
- Add `bg` to reserved names.
- Exclude `bg` from `PORTLESS=0` direct child-command bypass.
- Dispatch `args[0] === "bg"` to `handleBg()`.
- Add help output for `portless bg start` and `portless bg stop`.

- [ ] **Step 4: Verify and commit**

Run:

```bash
cd packages/portless && bun run test src/bg.test.ts src/cli.test.ts
bun run lint
git diff --check
```

Commit:

```bash
git add packages/portless/src/bg.ts packages/portless/src/bg.test.ts packages/portless/src/cli.ts packages/portless/src/cli.test.ts
git commit -S -m "feat(cli): add background command surface"
```

Commit body must include upstream PR #333 data and the decision that this is CLI process supervision, not UI work.

## Task 3: Ready Handshake And `bg start`

**Files:**

- Create: `packages/portless/src/bg-ready.ts`
- Create: `packages/portless/src/bg-ready.test.ts`
- Modify: `packages/portless/src/bg.ts`
- Modify: `packages/portless/src/bg.test.ts`
- Modify: `packages/portless/src/cli.ts`
- Modify: `packages/portless/src/cli.test.ts`

- [ ] **Step 1: Write failing ready-file tests**

Add tests for:

```ts
it("writes ready data atomically with private file permissions", () => {});
it("reads ready data for the expected bg id", () => {});
it("rejects ready data with a mismatched bg id", () => {});
it("times out without returning partial data", () => {});
```

Run:

```bash
cd packages/portless && bun run test src/bg-ready.test.ts
```

Expected: tests fail because the ready module does not exist.

- [ ] **Step 2: Add an internal ready-file contract**

Create `BgReadyPayload`:

```ts
export interface BgReadyPayload {
  version: 1;
  bgId: string;
  pid: number;
  hostname: string;
  pathPrefix: string;
  url: string;
  stateDir: string;
  appPort: number;
  proxyPort: number;
  tls: boolean;
  sharing: {
    tailscaleUrl?: string;
    tailscaleServiceUrl?: string;
    ngrokUrl?: string;
    tunnelUrl?: string;
    netbirdUrl?: string;
  };
}
```

`runApp()` should write this payload only when both internal env vars are present:

```ts
PORTLESS_BG_ID=<generated-id>
PORTLESS_BG_READY_PATH=<absolute-file-path>
```

The ready file should be written after route and sharing metadata is registered, but before the child app command is spawned. Normal foreground runs must not create ready files.

- [ ] **Step 3: Implement `bg start` spawning**

`bg start` should:

- Create a provisional registry entry in `starting` state.
- Open stdout, stderr, and lifecycle logs before spawning.
- Spawn `process.execPath` with `[entryScript, "run", ...runArgs]`.
- Use `detached: true`, `stdio: ["ignore", stdoutFd, stderrFd]`, and no shell.
- Pass through the current environment plus `PORTLESS_BG_ID` and `PORTLESS_BG_READY_PATH`.
- Wait up to 30 seconds by default for the ready payload.
- Accept `--wait [seconds]` to customize the timeout.
- Accept `--no-wait` to skip waiting.
- Accept `--keep` only when waiting is enabled.
- On timeout without `--keep`, terminate the process group and remove the provisional registry entry.
- On success, update the registry entry with route, URL, ready timestamp, and state `ready`.

- [ ] **Step 4: Preserve current foreground feature flags**

The start parser must forward these flags exactly to `portless run`:

- `--name`
- `--force`
- `--app-port`
- `--h2c`
- `--path`
- `--tunnel`
- `--tunnel-hostname`
- `--tailscale`
- `--tailscale-service`
- `--tailscale-service-name`
- `--funnel`
- `--ngrok`
- `--netbird`
- `--netbird-password`
- `--netbird-pin`
- `--netbird-groups`

- [ ] **Step 5: Add CLI integration tests**

Add tests that use small fixture projects and fake provider CLIs where needed:

```ts
it("starts a background process and records the ready route", async () => {});
it("sets state to starting when --no-wait is used", async () => {});
it("kills and removes a timed-out start by default", async () => {});
it("keeps a timed-out process when --keep is used", async () => {});
it("passes --path through and records the path-scoped URL", async () => {});
it("passes --h2c through and records h2c route metadata", async () => {});
it("passes managed tunnel flags through and records PORTLESS_TUNNEL_URL in child logs", async () => {});
```

- [ ] **Step 6: Verify and commit**

Run:

```bash
cd packages/portless && bun run test src/bg-ready.test.ts src/bg.test.ts src/cli.test.ts
bun run lint
git diff --check
```

Commit:

```bash
git add packages/portless/src/bg-ready.ts packages/portless/src/bg-ready.test.ts packages/portless/src/bg.ts packages/portless/src/bg.test.ts packages/portless/src/cli.ts packages/portless/src/cli.test.ts
git commit -S -m "feat(bg): start apps with readiness tracking"
```

Commit body must include upstream PR #333 data and the reason this fork uses a ready-file handshake instead of stdout URL scraping.

## Task 4: Status, List, And Logs

**Files:**

- Modify: `packages/portless/src/bg.ts`
- Modify: `packages/portless/src/bg.test.ts`
- Modify: `packages/portless/src/cli.test.ts`

- [ ] **Step 1: Write failing status and list tests**

Add tests for:

```ts
it("prints current bg status with URL and route state", async () => {});
it("prints JSON status with route and log paths", async () => {});
it("lists all background entries sorted by label", async () => {});
it("marks entries stopped when the pid is no longer alive", async () => {});
it("resolves route identity by hostname and path prefix", async () => {});
```

- [ ] **Step 2: Implement managed-process detection**

Use a layered check:

- PID must be alive.
- If route is present, its `pid` must match the bg entry PID and its `hostname + pathPrefix` must match.
- If route is temporarily absent, verify the command line with structured `ps` arguments on macOS/Linux, not shell interpolation.
- Never kill a process merely because command-line inspection fails. Treat it as `unknown` and require `--force` for destructive cleanup.

- [ ] **Step 3: Implement logs**

Support:

- stdout logs by default
- `--errors` for stderr
- `--bg` for lifecycle logs
- `--tail <lines>`
- `--tail 0`
- `--all`
- `--follow`

`--errors` and `--bg` must be mutually exclusive. `--follow` should use Node file watching or polling, not the external `tail` command.

- [ ] **Step 4: Verify and commit**

Run:

```bash
cd packages/portless && bun run test src/bg.test.ts src/cli.test.ts
bun run lint
git diff --check
```

Commit:

```bash
git add packages/portless/src/bg.ts packages/portless/src/bg.test.ts packages/portless/src/cli.test.ts
git commit -S -m "feat(bg): show background status and logs"
```

Commit body must include upstream PR #333 data and the `--tail 0` security and correctness fix.

## Task 5: Stop, Restart, Clean, And Prune Integration

**Files:**

- Create: `packages/portless/src/route-cleanup.ts`
- Create: `packages/portless/src/route-cleanup.test.ts`
- Modify: `packages/portless/src/bg.ts`
- Modify: `packages/portless/src/bg.test.ts`
- Modify: `packages/portless/src/cli.ts`
- Modify: `packages/portless/src/cli.test.ts`

- [ ] **Step 1: Extract exact route sharing cleanup**

Create a small helper that can clean public sharing metadata for one exact route:

```ts
export function cleanupRouteSharing(route: RouteMapping, options?: { stopTunnels?: boolean }): void;
```

It should call the existing helpers for:

- Tailscale Serve/Funnel/Service metadata
- ngrok PID metadata
- managed tunnel PID metadata and managed tunnel aliases
- NetBird expose PID metadata

It must not remove unrelated routes and must not kill arbitrary PIDs that happen to listen on the same app port.

- [ ] **Step 2: Implement `bg stop`**

Rules:

- Default stop sends `SIGTERM` to the process group and waits 5 seconds.
- If the process exits, remove the registry entry and exact route if still present.
- If the process does not exit, print an error and keep the registry entry.
- `--force` sends `SIGKILL`, removes the exact route owned by that PID, and cleans exact sharing metadata.
- `--json` returns machine-readable stop results.

- [ ] **Step 3: Implement `bg restart`**

Rules:

- Load the existing entry and reuse its stored intent and cwd.
- Stop first with the same safety rules as `bg stop`.
- Start again using the same ready behavior as `bg start`.
- Allow `--force`, `--wait [seconds]`, `--no-wait`, `--keep`, and `--json`.

- [ ] **Step 4: Implement `bg clean`**

Rules:

- Without `--all`, clean only the current inferred entry or provided name/path.
- With `--all`, clean all dead bg entries in the active state dir.
- Never stop a live process.
- Remove logs only for entries that are removed from the registry.

- [ ] **Step 5: Integrate `portless clean` and `portless prune`**

`portless clean` must stop all registered bg entries before deleting bg state. If a graceful stop times out, continue only when the user explicitly used a future `clean --force` flag or after adding a clear warning and leaving the bg state intact. The first implementation should avoid adding `clean --force`; prefer best-effort graceful stops plus warnings.

`portless prune` should remove dead bg entries and clean exact stale sharing metadata. It should not stop live bg apps unless a future explicit flag is added.

- [ ] **Step 6: Add lifecycle tests**

Add tests for:

```ts
it("stops a live background process gracefully", async () => {});
it("keeps the registry entry when graceful stop times out", async () => {});
it("force stop removes only the exact route owned by the bg pid", async () => {});
it("force stop does not kill unrelated processes on the same port", async () => {});
it("restart preserves cwd and original command intent", async () => {});
it("bg clean removes dead entries and their logs", async () => {});
it("bg clean does not stop live entries", async () => {});
it("portless clean stops bg entries before removing state", async () => {});
it("portless prune removes dead bg entries without stopping live entries", async () => {});
it("managed tunnel aliases are removed for stopped bg entries", async () => {});
```

- [ ] **Step 7: Verify and commit**

Run:

```bash
cd packages/portless && bun run test src/route-cleanup.test.ts src/bg.test.ts src/cli.test.ts
bun run lint
git diff --check
```

Commit:

```bash
git add packages/portless/src/route-cleanup.ts packages/portless/src/route-cleanup.test.ts packages/portless/src/bg.ts packages/portless/src/bg.test.ts packages/portless/src/cli.ts packages/portless/src/cli.test.ts
git commit -S -m "feat(bg): manage background lifecycle cleanup"
```

Commit body must include upstream PR #333 data and the decision not to kill arbitrary same-port processes.

## Task 6: Documentation, Agent Skill, And Fork Tracking

**Files:**

- Modify: `README.md`
- Modify: `skills/portless/SKILL.md`
- Modify: `packages/portless/src/cli.ts`
- Modify: `packages/portless/src/cli.test.ts`
- Modify: `FORK.md`

- [ ] **Step 1: Update user docs**

Document:

- `portless bg start`
- readiness default and `--no-wait`
- private log locations
- `status`, `list`, `logs`, `stop`, `restart`, and `clean`
- macOS/Linux support scope
- interaction with `--path`, `--h2c`, `--tunnel`, Tailscale Service, ngrok, and NetBird
- the fact that backgrounding does not widen bind hosts or public exposure

- [ ] **Step 2: Update agent skill**

Teach agents to prefer:

```bash
portless bg start
portless bg status --json
portless bg logs --tail 200
portless bg stop
```

for persistent dev servers. Make the skill explicit that background mode is not a public sharing feature by itself.

- [ ] **Step 3: Update CLI help tests**

Ensure help output includes `bg`, reserved names include `bg`, and command examples match the actual parser.

- [ ] **Step 4: Update FORK.md**

Mark #333 as `planned` until implementation lands, not UI-focused. Link this plan.

- [ ] **Step 5: Full verification and commit**

Run:

```bash
bun run lint
bun run build
bun run test
git diff --check
```

Commit:

```bash
git add README.md skills/portless/SKILL.md packages/portless/src/cli.ts packages/portless/src/cli.test.ts FORK.md
git commit -S -m "docs(bg): document background app management plan"
```

Commit body must include upstream PR #333 data and the final security defaults.

## Additional Tests Required Before Merge

- `bg-store.test.ts`: registry locking, corrupt registry handling, route-key identity, permissions.
- `bg-logs.test.ts`: private logs, tail behavior, tail zero, truncation, missing files.
- `bg-ready.test.ts`: atomic ready file writes, mismatched IDs, timeout behavior.
- `bg.test.ts`: parser coverage, state transitions, process detection, exact cleanup behavior.
- `route-cleanup.test.ts`: no arbitrary same-port kills, exact share cleanup for Tailscale, ngrok, tunnel aliases, NetBird.
- `cli.test.ts`: top-level dispatch, `PORTLESS=0`, help, start/status/list/logs/stop/restart/clean, JSON output, path/h2c/tunnel/share flag preservation.
- Existing suites: `routes.test.ts`, `proxy.test.ts`, `tunnel-aliases.test.ts`, `tunnel.test.ts`, `tailscale.test.ts`, `ngrok.test.ts`, and `netbird.test.ts` should keep passing without changed semantics.
- Optional manual smoke on Linux/macOS: start a fixture app, check URL, tail logs, restart, stop, and verify no route or tunnel alias remains.

## Verification Gate

Before considering #333 implemented in this fork:

```bash
cd packages/portless && bun run test src/bg-store.test.ts src/bg-logs.test.ts src/bg-ready.test.ts src/bg.test.ts src/route-cleanup.test.ts src/cli.test.ts
bun run lint
bun run build
bun run test
git diff --check
for commit in $(git rev-list --max-count=6 HEAD); do git verify-commit "$commit"; done
```

The branch must remain clean after verification.
