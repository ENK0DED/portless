# @enk0ded/portless

Replace port numbers with stable, named .localhost URLs for local development. For humans and agents.

```diff
- "dev": "next dev"                  # http://localhost:3000
+ "dev": "portless run next dev"     # https://myapp.localhost
```

## Install

**Global (recommended):**

```bash
npm install -g @enk0ded/portless
```

**Or as a project dev dependency:**

```bash
npm install -D @enk0ded/portless
```

> portless is pre-1.0. When installed per-project, different contributors may run different versions. The state directory format may change between releases, which can require re-running `portless trust`.

This README describes the ENK0DED fork published as `@enk0ded/portless`. The CLI command is still `portless`, but install, release, and local dependency checks use the scoped package name.

## Run your app

```bash
portless myapp next dev
# -> https://myapp.localhost
```

HTTPS with HTTP/2 is enabled by default. On first run, portless generates a local CA, trusts it, and binds port 443 (auto-elevates with sudo on macOS/Linux). Use `--no-tls` for plain HTTP.

The proxy auto-starts when you run an app. A random port (4000-4999) is assigned via the `PORT` environment variable. Most frameworks (Next.js, Express, Nuxt, etc.) respect this automatically. For frameworks that ignore `PORT` (Vite, VitePlus, Astro, React Router, Angular, Laravel, Expo, React Native, Wrangler), portless auto-injects the right `--port` flag and, when needed, a matching `--host` flag or Wrangler's `--ip` flag.

When auto-starting, portless reuses the configuration (port, TLS, suffix) from the most recent proxy run, so a restart or reboot does not silently revert to defaults. Explicit env vars (`PORTLESS_PORT`, `PORTLESS_HTTPS`, etc.) always take priority.

In non-interactive environments (no TTY, or `CI=1`), portless exits with a descriptive error instead of prompting, so task runners like turborepo and CI scripts fail early with a clear message.

## Configuration

Bare `portless` works out of the box. It runs the `"dev"` script from `package.json` through the proxy, inferring the app name from the package name, git root, or directory:

```bash
portless        # -> runs "dev" script, https://<project>.localhost
```

Use an optional `portless.json` to override defaults:

```json
{ "name": "myapp" }
```

```bash
portless        # -> runs "dev" script, https://myapp.localhost
```

The script defaults to `"dev"`. The name is inferred from `package.json` if not set in config.

### Monorepo

One `portless.json` at the repo root covers all workspace packages. Portless discovers packages from `pnpm-workspace.yaml`, or the `"workspaces"` field in `package.json` (npm, yarn, bun):

```json
{
  "apps": {
    "apps/web": { "name": "myapp" },
    "apps/api": { "name": "api.myapp" }
  }
}
```

```bash
portless        # from repo root: starts all workspace packages with a "dev" script
cd apps/web && portless   # start just one package
```

The `apps` map is optional and only needed for name overrides. Packages not listed still auto-discover with names inferred from their `package.json`.

Without an `apps` map, hostnames follow the `<package>.<project>.localhost` convention. The project name comes from the most common npm scope across workspace packages (e.g. `@myorg/web` and `@myorg/api` produce `myorg`), falling back to the workspace root directory name. If a package's short name matches the project name, it gets the bare `<project>.localhost` without duplication.

### Config fields

| Field     | Type    | Default  | Description                                               |
| --------- | ------- | -------- | --------------------------------------------------------- |
| `name`    | string  | inferred | Base app name. Worktree prefix still applies.             |
| `script`  | string  | `"dev"`  | Name of a `package.json` script to run.                   |
| `appPort` | number  | auto     | Fixed port for the child process.                         |
| `proxy`   | boolean | auto     | Whether to route through the proxy. Auto-detected.        |
| `apps`    | object  |          | Overrides for workspace packages, keyed by relative path. |
| `turbo`   | boolean | `true`   | Set `false` to use direct spawning instead of turborepo.  |

### package.json "portless" key

Instead of a separate `portless.json`, you can add a `"portless"` key to your `package.json`. A string value is shorthand for setting the name:

```json
{
  "name": "@myorg/web",
  "portless": "myapp"
}
```

An object supports all per-app fields (`name`, `script`, `appPort`, `proxy`):

```json
{
  "name": "@myorg/web",
  "portless": { "name": "myapp", "script": "dev:app" }
}
```

The `package.json` `"portless"` key takes precedence over `portless.json` app entries but is overridden by CLI flags.

### --script flag

Override the default script for a single invocation:

```bash
portless --script start       # run "start" instead of "dev"
portless --script test        # run "test" instead of "dev"
```

### Turborepo

To use portless with turborepo, put `portless` as the `dev` script and the real command in a separate script:

```json
{
  "scripts": {
    "dev": "portless",
    "dev:app": "next dev"
  },
  "portless": { "name": "myapp", "script": "dev:app" }
}
```

Turbo runs each package's `dev` script, which invokes portless. Portless reads the config, detects the package manager, and runs `bun run dev:app` (or npm/yarn/pnpm) through the proxy. No changes to `turbo.json` are needed.

`bun dev` at the root works through turbo as usual. People without portless can run `bun run dev:app` directly.

## Use in package.json

You can still use portless in `package.json` scripts:

```json
{
  "scripts": {
    "dev": "portless run next dev"
  }
}
```

With a `portless.json`, you can simplify to:

```json
{
  "scripts": {
    "dev": "next dev"
  }
}
```

Then run `portless` or `portless run` to go through the proxy.

## Subdomains

Organize services with subdomains:

```bash
portless api.myapp bun start
# -> https://api.myapp.localhost

portless docs.myapp next dev
# -> https://docs.myapp.localhost
```

By default, only explicitly registered subdomains are routed (strict mode). Use `--wildcard` when starting the proxy to allow any subdomain of a registered route to fall back to that app (e.g. `tenant1.myapp.localhost` routes to the `myapp` app without extra registration). To change wildcard mode for a running proxy, stop it and start it again with the desired mode.

## Git Worktrees

`portless run` automatically detects git worktrees. In a linked worktree, the branch name is prepended as a subdomain so each worktree gets its own URL without any config changes:

```bash
# Main worktree (no prefix)
portless run next dev   # -> https://myapp.localhost

# Linked worktree on branch "fix-ui"
portless run next dev   # -> https://fix-ui.myapp.localhost
```

Use `--name` to override the inferred base name while keeping the worktree prefix:

```bash
portless run --name myapp next dev   # -> https://fix-ui.myapp.localhost
```

Put `portless run` in your `package.json` once and it works everywhere. The main checkout uses the plain name, each worktree gets a unique subdomain. No collisions, no `--force`.

## Custom Suffixes

By default, portless uses the `localhost` suffix, which produces URLs like `https://myapp.localhost` and auto-resolves to `127.0.0.1` in most browsers. This fork uses "suffix" terminology because the value can be more than a single top-level label.

For one-off proxy starts, prefer `--suffix`:

```bash
portless proxy start --suffix test
portless myapp next dev
# -> https://myapp.test
```

For shell or service configuration, prefer `PORTLESS_SUFFIX`:

```bash
PORTLESS_SUFFIX=test portless proxy start
portless myapp next dev
# -> https://myapp.test
```

`PORTLESS_SUFFIX` accepts a single label such as `test` and dotted suffixes such as `server01.acme.com`:

```bash
PORTLESS_SUFFIX=server01.acme.com portless proxy start
portless myapp next dev
# -> https://myapp.server01.acme.com
```

`PORTLESS_SUFFIX` is read before the legacy `PORTLESS_TLD` variable. If both are set, `PORTLESS_SUFFIX` wins. `PORTLESS_TLD` and `--tld` remain supported so existing upstream-style environments and scripts keep working.

Suffix values are lowercased and validated as DNS labels: each label may contain lowercase letters, digits, and hyphens, must start and end with a letter or digit, and must be 63 characters or less. Leading dots, trailing dots, and consecutive dots are rejected.

Auto-elevated proxy starts pass the resolved `PORTLESS_STATE_DIR` through `sudo`, so a root-owned proxy uses the same per-user state and suffix settings as the command that started it. Set `PORTLESS_STATE_DIR` explicitly before running portless if you want a separate proxy state directory.

The proxy auto-syncs `/etc/hosts` for route hostnames, so `.test`, `.server01.acme.com`, and other configured suffixes resolve on your machine.

Recommended: `.test` for throwaway local names because it is IANA-reserved. Use a subdomain you control, such as `local.example.com`, when OAuth providers or other external systems require a public suffix. Avoid `.local` outside LAN mode because it conflicts with mDNS/Bonjour. Avoid bare public suffixes like `.dev` unless you understand the collision and HSTS implications.

## How it works

```mermaid
flowchart TD
    Browser["Browser<br>myapp.localhost"]
    Proxy["portless proxy<br>(port 80 or 443)"]
    App1[":4123<br>myapp"]
    App2[":4567<br>api"]

    Browser --> Proxy
    Proxy --> App1
    Proxy --> App2
```

1. **Start the proxy**: auto-starts when you run an app, or start explicitly with `portless proxy start`
2. **Run apps**: `portless <name> <command>` assigns a free port and registers with the proxy
3. **Access via URL**: `https://<name>.localhost` routes through the proxy to your app

## HTTP/2 + HTTPS

HTTPS with HTTP/2 is enabled by default. Browsers limit HTTP/1.1 to 6 connections per host, which bottlenecks dev servers that serve many unbundled files (Vite, Nuxt, etc.). HTTP/2 multiplexes all requests over a single connection.

On first run, portless generates a local CA and adds it to your system trust store. No browser warnings. No manual setup.

```bash
# Use your own certs (e.g., from mkcert)
portless proxy start --cert ./cert.pem --key ./key.pem

# Disable HTTPS (plain HTTP on port 80)
portless proxy start --no-tls

# If you skipped the trust prompt on first run, trust the CA later
portless trust
```

On Linux, `portless trust` supports Debian/Ubuntu, Arch, Fedora/RHEL/CentOS, and openSUSE (via `update-ca-certificates` or `update-ca-trust`). On Windows, it uses `certutil` to add the CA to the system trust store.

## Start at OS startup

Install the proxy as an OS startup service so clean HTTPS URLs are available after reboot without starting the proxy from a terminal:

```bash
portless service install
portless service install --lan
portless service install --wildcard
PORTLESS_STATE_DIR=~/.portless-lan PORTLESS_LAN=1 portless service install
portless service status
portless service uninstall
```

The service uses portless defaults unless install options or `PORTLESS_*` environment variables are provided: HTTPS on port 443 with `.localhost` names. `service install` accepts the proxy options you would use with `proxy start`, including `--port`, `--no-tls`, `--lan`, `--ip`, `--suffix`, `--tld`, `--wildcard`, `--cert`, and `--key`. Use `--state-dir <path>` or `PORTLESS_STATE_DIR=<path>` to choose where service state and logs are written.

The chosen service configuration is written into launchd, systemd, or Task Scheduler and reused after reboot. Custom service suffixes are persisted as `PORTLESS_SUFFIX`; `--tld` remains accepted as a compatibility alias. `portless service status` reports the installed port, HTTPS mode, configured suffix, LAN mode, wildcard mode, and state directory. macOS and Linux install a root-owned service so port 443 can bind at boot. Windows installs a Task Scheduler startup task that runs as SYSTEM. Installation and removal may require administrator privileges. `portless clean` automatically removes the service.

## LAN mode

```bash
portless proxy start --lan
portless proxy start --lan --https
portless proxy start --lan --ip 192.168.1.42
```

`--lan` switches the proxy to mDNS discovery: services are advertised as `<name>.local` and reachable from any device on the same network. Portless auto-detects your LAN IP and follows Wi-Fi/IP changes automatically, but you can pin another address with `--ip <address>` or by exporting `PORTLESS_LAN_IP`. Set `PORTLESS_LAN=1` in your shell (0/1 boolean) to make LAN mode the default whenever the proxy starts.

Portless remembers LAN mode via `proxy.lan`, so if you stop a LAN proxy and start it again, it stays in LAN mode. All proxy settings (port, TLS, suffix, LAN) are persisted and reused on auto-start unless overridden by explicit flags or env vars. Use `PORTLESS_LAN=0` for one start to switch back to `.localhost` mode. If a proxy is already running with different explicit LAN, TLS, or suffix settings, portless warns and asks you to stop it first.

LAN mode depends on the system mDNS tools that portless already spawns: macOS ships with `dns-sd`, while Linux uses `avahi-publish-address` from `avahi-utils` (install via `sudo apt install avahi-utils` or your distro’s equivalent). If the command is missing or your network isn’t reachable, `portless proxy start --lan` prints the relevant error and exits.

### Framework notes

- **Next.js**: add your `.local` hostnames to `allowedDevOrigins`:

  ```js
  // next.config.js
  module.exports = {
    allowedDevOrigins: ["myapp.local", "*.myapp.local"],
  };
  ```

- **Expo / React Native**: portless always injects `--port`. React Native also gets `--host 127.0.0.1`. Expo gets `--host localhost` outside LAN mode, but in LAN mode portless leaves Metro on its default LAN host behavior instead of forcing `--host` or `HOST`.
- **Laravel / Wrangler**: Laravel's `php artisan serve` gets `--port` and `--host 127.0.0.1`. Wrangler gets `--port` and `--ip 127.0.0.1` because Wrangler's `--host` option means route hostname, not bind address.

## Tailscale sharing

Share your dev server with teammates on your [Tailscale](https://tailscale.com) network:

```bash
portless myapp --tailscale next dev
# -> https://myapp.localhost           (local)
# -> https://devbox.yourteam.ts.net    (tailnet)
```

Each `--tailscale` app is root-mounted on its own Tailscale HTTPS port, so no framework `basePath` configuration is needed. The first app gets port 443, subsequent apps get 8443, 8444, etc.

```bash
portless myapp --tailscale next dev     # -> https://devbox.ts.net
portless api --tailscale bun start     # -> https://devbox.ts.net:8443
```

Use `--funnel` to expose your dev server to the public internet via [Tailscale Funnel](https://tailscale.com/kb/1223/funnel/):

```bash
portless myapp --funnel next dev
# -> https://devbox.yourteam.ts.net    (public)
```

Tailscale HTTPS certificates must be enabled before `--tailscale` or `--funnel` can register HTTPS URLs. Funnel must also be enabled for the tailnet and node before `--funnel` can register the public URL. If either setting is missing, portless exits before starting the child process.

Set `PORTLESS_TAILSCALE=1` in your shell profile or `.env` to share every app by default. `portless list` shows both local and tailnet URLs. Tailscale serve registrations are cleaned up automatically when the app exits.

Requires the Tailscale CLI to be installed and connected (`tailscale up`), with Tailscale HTTPS certificates enabled.

## ngrok sharing

Expose your dev server to the public internet with [ngrok](https://ngrok.com):

```bash
portless myapp --ngrok next dev
# -> https://myapp.localhost           (local)
# -> https://abc123.ngrok.app          (public)
```

Set `PORTLESS_NGROK=1` in your shell profile or `.env` to enable ngrok by default when portless runs an app. `portless list` shows both local and ngrok URLs. The ngrok tunnel is cleaned up automatically when the app exits.

Requires the ngrok CLI to be installed and authenticated. If ngrok reports an authentication error, run `ngrok config add-authtoken <token>` and try again.

## Commands

```bash
portless                        # Run dev script through proxy
portless                        # From monorepo root: run all workspace packages
portless run [--name <name>] [cmd] [args...]  # Infer name, run through proxy
portless <name> <cmd> [args...]  # Run app at https://<name>.localhost
portless alias <name> <port>     # Register a static route (e.g. for Docker)
portless alias <name> <port> --force  # Overwrite an existing route
portless alias --remove <name>   # Remove a static route
portless get <name>              # Print URL for a service
portless url <name>              # Alias for portless get
portless list                    # Show active routes
portless ls                      # Alias for portless list
portless status                  # Alias for portless list
portless trust                   # Add local CA to system trust store
portless clean                   # Remove state, CA trust entry, and hosts block
portless prune                   # Kill orphaned dev servers from crashed sessions
portless hosts sync              # Add routes to /etc/hosts (fixes Safari)
portless hosts clean             # Remove portless entries from /etc/hosts

# Disable portless (run command directly)
PORTLESS=0 bun dev               # Bypasses proxy, uses default port

# Child env assignments
portless myapp API_URL=1 next dev # Pass API_URL only to the child command

# Proxy control
portless proxy start             # Start the HTTPS proxy (port 443, daemon)
portless proxy start --no-tls    # Start without HTTPS (port 80)
portless proxy start --lan       # Start in LAN mode (mDNS .local for devices)
portless proxy start -p 1355     # Start on a custom port (no sudo)
portless proxy start --suffix test  # Use .test instead of .localhost
portless proxy start --tld test  # Compatibility alias for --suffix
portless proxy start --foreground  # Start in foreground for debugging
portless proxy start --wildcard  # Allow unregistered subdomains to fall back to parent
portless proxy stop              # Stop the proxy

# OS startup service
portless service install         # Start HTTPS proxy when the OS starts
portless service install --lan   # Start service in LAN mode
portless service install --wildcard  # Persist wildcard routing in the service
portless service status          # Show service and proxy status
portless service uninstall       # Remove the startup service
```

### Options

```
-p, --port <number>              Port for the proxy (default: 443, or 80 with --no-tls)
--no-tls                         Disable HTTPS (use plain HTTP on port 80)
--https                          Enable HTTPS (default, accepted for compatibility)
--lan                            Enable LAN mode (mDNS .local for real devices)
--ip <address>                   Pin a specific LAN IP (disables auto-follow; use with --lan)
--cert <path>                    Use a custom TLS certificate
--key <path>                     Use a custom TLS private key
--foreground                     Run proxy in foreground instead of daemon
--suffix <suffix>                Use a custom suffix instead of .localhost
--tld <tld>                      Compatibility alias for --suffix
--wildcard                       Allow unregistered subdomains to fall back to parent route
                                 Proxy-level only; restart proxy to change this mode
--state-dir <path>               Use a custom state directory with service install
--script <name>                  Run a specific package.json script (default: dev)
--app-port <number>              Use a fixed port for the app (skip auto-assignment)
--tailscale                      Share the app on your Tailscale network (tailnet)
--funnel                         Share the app publicly via Tailscale Funnel
--ngrok                          Share the app publicly via ngrok
--force                          Kill the existing process and take over its route
--name <name>                    Use <name> as the app name
```

### Environment variables

```
# Configuration
PORTLESS_PORT=<number>           Override the default proxy port
PORTLESS_APP_PORT=<number>       Use a fixed port for the app (same as --app-port)
PORTLESS_HTTPS=0                 Disable HTTPS (same as --no-tls)
PORTLESS_LAN=1                   Enable LAN mode when set to 1 (auto-detects LAN IP)
PORTLESS_LAN_IP=<address>        Pin a specific LAN IP for LAN mode
PORTLESS_SUFFIX=<suffix>         Use a custom suffix (e.g. test, acme.com; default: localhost)
PORTLESS_TLD=<tld>               Compatibility alias for PORTLESS_SUFFIX
PORTLESS_WILDCARD=1              Allow unregistered subdomains to fall back to parent route
PORTLESS_SYNC_HOSTS=0            Disable auto-sync of /etc/hosts (on by default)
PORTLESS_TAILSCALE=1             Share apps on your Tailscale network (same as --tailscale)
PORTLESS_FUNNEL=1                Share apps publicly via Tailscale Funnel (same as --funnel)
PORTLESS_NGROK=1                 Share apps publicly via ngrok (same as --ngrok)
PORTLESS_STATE_DIR=<path>        Override the state directory

# Injected into child processes
KEY=value before <cmd>            Adds an env var only to the child command
PORT                             Ephemeral port the child should listen on
HOST                             Usually 127.0.0.1 (omitted for Expo in LAN mode)
PORTLESS_URL                     Public URL (e.g. https://myapp.localhost)
PORTLESS_TAILSCALE_URL           Tailscale URL of the app (when --tailscale is active)
PORTLESS_NGROK_URL               ngrok URL of the app (when --ngrok is active)
NODE_EXTRA_CA_CERTS              Path to the portless CA (when HTTPS is active)
```

Prefer `PORTLESS_SUFFIX` for new configuration. It accepts single-label suffixes such as `test` and dotted suffixes such as `acme.com` or `server01.acme.com`. `PORTLESS_TLD` is only a compatibility alias and is ignored when `PORTLESS_SUFFIX` is set.

> **Reserved names:** `run`, `get`, `url`, `alias`, `hosts`, `list`, `ls`, `status`, `trust`, `clean`, `prune`, `proxy`, and `service` are subcommands and cannot be used as app names directly. Use `portless run <cmd>` to infer the name from your project, or `portless --name <name> <cmd>` to force any name including reserved ones.

## Uninstall / reset

To remove portless data from your machine (proxy state under `~/.portless` and the system state directory, the local CA from the OS trust store when portless installed it, and the portless block in `/etc/hosts`):

```bash
portless clean
```

macOS/Linux may prompt for `sudo`. Custom certificate paths passed with `--cert` and `--key` are not deleted.

## Safari / DNS

`.localhost` subdomains auto-resolve to `127.0.0.1` in Chrome, Firefox, and Edge. Safari relies on the system DNS resolver, which may not handle `.localhost` subdomains on all configurations.

If Safari can't find your `.localhost` URL:

```bash
portless hosts sync    # Add current routes to /etc/hosts
portless hosts clean   # Clean up later
```

Auto-syncs `/etc/hosts` for route hostnames by default (`.localhost`, custom suffixes, LAN `.local`). Set `PORTLESS_SYNC_HOSTS=0` to disable.

## Proxying Between Portless Apps

If your frontend dev server (e.g. Vite, webpack) proxies API requests to another portless app, make sure the proxy rewrites the `Host` header. Without this, portless routes the request back to the frontend in an infinite loop.

**Vite** (`vite.config.ts`):

```ts
server: {
  proxy: {
    "/api": {
      target: "https://api.myapp.localhost",
      changeOrigin: true,
      ws: true,
    },
  },
}
```

**webpack-dev-server** (`webpack.config.js`):

```js
devServer: {
  proxy: [{
    context: ["/api"],
    target: "https://api.myapp.localhost",
    changeOrigin: true,
  }],
}
```

Portless automatically sets `NODE_EXTRA_CA_CERTS` in child processes so Node.js trusts the portless CA. If you run a separate Node.js process outside portless, point it at the CA manually: `NODE_EXTRA_CA_CERTS=~/.portless/ca.pem`. Alternatively, use `--no-tls` for plain HTTP.

Portless detects this misconfiguration and responds with `508 Loop Detected` along with a message pointing to this fix.

## Development

This repo is a Bun workspace monorepo using [Turborepo](https://turbo.build). The publishable package lives in `packages/portless/`.

Use Node.js 24+ and Bun 1.3.14+ for repository development. The `.node-version` file pins the Node major for version managers.

```bash
bun install          # Install all dependencies
bun run build        # Build all packages
bun run test         # Run tests
bun run test:coverage # Run tests with coverage
bun run lint         # Lint all packages
bun run type-check   # Type-check all packages
bun run format       # Format all files with Prettier
```

## Fork Maintenance

This fork intentionally differs from upstream in a few areas:

- Published package identity is `@enk0ded/portless`; the command remains `portless`.
- Fork releases use high patch ranges, such as `0.14.1000`, to stay semver-compatible without colliding with upstream versions.
- Repository development uses Bun workspaces, `bun.lock`, Bun-powered CI, and Bun-based Windows debugging scripts.
- Custom domain configuration uses suffix terminology. `PORTLESS_SUFFIX` is the preferred environment variable, dotted suffixes are supported, and `PORTLESS_TLD` remains a compatibility alias.
- Local dependency detection checks `node_modules/@enk0ded/portless` so one-off `npx` or `pnpm dlx` downloads are still rejected.

See [FORK.md](./FORK.md) for the full list of fork-owned invariants and the upstream sync checklist.

## Requirements

- Node.js 24+
- macOS, Linux, or Windows
- Tailscale CLI (optional, for `--tailscale` and `--funnel`)
- ngrok CLI (optional, for `--ngrok`)
