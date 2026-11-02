// Recomputes the content-derived fields of tests/fixtures/docs-baseline.json
// (MDX hash, Markdown body hash, headings) from the current content/docs MDX.
// Run after `bun run build`, and only after reviewing the content change:
//
//   bun run --cwd apps/docs update:baseline            # all pages
//   bun run --cwd apps/docs update:baseline changelog  # one page by slug
//
// Titles, descriptions and SSR samples are hand-authored and never touched.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import process from "node:process";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath, URL } from "node:url";
import { format, resolveConfig } from "prettier";
import { siteUrl } from "../src/lib/site.ts";

const { AbortSignal, fetch } = globalThis;
const root = new URL("../", import.meta.url);
const fixture = new URL("tests/fixtures/docs-baseline.json", root);
const only = new Set(process.argv.slice(2));
const hash = (value) => createHash("sha256").update(value).digest("hex");
const slugify = (text) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .trim()
    .replace(/\s/g, "-");
const plain = (text) =>
  text
    .replace(/`/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\*\*|__/g, "")
    .trim();

function headingsOf(body, title) {
  const headings = [[1, title, slugify(title)]];
  const seen = new Map();
  let fenced = false;
  for (const line of body.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      continue;
    }
    const match = fenced ? null : /^(#{2,6})\s+(.*?)\s*#*$/.exec(line);
    if (!match) continue;
    const text = plain(match[2]);
    const base = slugify(text);
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    headings.push([match[1].length, text, count ? `${base}-${count}` : base]);
  }
  return headings;
}

const socket = createServer();
await new Promise((resolve, reject) => {
  socket.once("error", reject);
  socket.listen(0, "127.0.0.1", resolve);
});
const port = socket.address().port;
await new Promise((resolve) => socket.close(resolve));

const server = spawn(
  process.execPath,
  [
    fileURLToPath(import.meta.resolve("next/dist/bin/next")),
    "start",
    "--hostname",
    "127.0.0.1",
    "--port",
    String(port),
  ],
  { cwd: fileURLToPath(root), stdio: "inherit", env: { ...process.env, NODE_ENV: "production" } }
);
let code = 0;
try {
  const url = `http://127.0.0.1:${port}`;
  for (let ready = false, attempt = 0; !ready; attempt++) {
    if (attempt > 600) throw new Error("Docs server did not become ready. Run the build first.");
    try {
      const response = await fetch(`${url}/robots.txt`, { signal: AbortSignal.timeout(1000) });
      await response.body?.cancel();
      ready = response.ok;
    } catch {
      await sleep(100);
    }
  }
  const data = JSON.parse(await readFile(fixture, "utf8"));
  for (const page of data.pages) {
    const slug = page.path === "/" ? "index" : page.path.slice(1);
    if (only.size > 0 && !only.has(slug)) continue;
    const raw = await readFile(new URL(`content/docs/${slug}.mdx`, root), "utf8");
    const body = raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "");
    const canonical = `${siteUrl}${page.path === "/" ? "" : page.path}`;
    const response = await fetch(`${url}${page.path === "/" ? "/index.md" : `${page.path}.md`}`, {
      headers: { "user-agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(30000),
    });
    const markdown = await response.text();
    const frontmatter = `---\ntitle: ${JSON.stringify(page.markdownTitle)}\ndescription: ${JSON.stringify(page.description)}\ncanonical_url: ${JSON.stringify(canonical)}\n---\n`;
    if (!markdown.startsWith(frontmatter))
      throw new Error(`${page.path}: unexpected Markdown frontmatter`);
    page.source = `apps/docs/content/docs/${slug}.mdx`;
    page.mdxSha256 = hash(`# ${page.markdownTitle}\n${body}`);
    page.markdownBodySha256 = hash(markdown.slice(frontmatter.length));
    page.headings = headingsOf(body, page.markdownTitle);
    process.stdout.write(`updated ${page.path}\n`);
  }
  // Format with the repo's Prettier config so `format:check` passes on the result.
  const path = fileURLToPath(fixture);
  const options = (await resolveConfig(path)) ?? {};
  await writeFile(fixture, await format(JSON.stringify(data), { ...options, filepath: path }));
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  code = 1;
} finally {
  server.kill("SIGTERM");
}
process.exit(code);
