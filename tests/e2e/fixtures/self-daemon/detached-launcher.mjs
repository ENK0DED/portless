import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Detaches the server into its own session and exits before it binds, like
// `astro dev` does when it detects an agent: the child leaves the launcher's
// process group, so only the port reveals it.
const server = path.join(path.dirname(fileURLToPath(import.meta.url)), "server.mjs");
spawn(process.execPath, [server], {
  detached: true,
  stdio: "ignore",
  env: { ...process.env, LISTEN_DELAY_MS: "500" },
}).unref();
