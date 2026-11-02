// The one canonical origin for every page, Markdown, sitemap and metadata URL.
// Set NEXT_PUBLIC_SITE_URL to override it; the default is the fork's repository
// until its docs are hosted. Keep this file free of imports so the route tests
// and scripts can load it directly.
const DEFAULT_SITE_URL = "https://github.com/ENK0DED/portless";

export const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL?.trim() || DEFAULT_SITE_URL).replace(
  /\/+$/,
  ""
);
export const siteName = "portless";
export const siteDescription =
  "Replace port numbers with stable, named .localhost URLs. For humans and agents.";

export function canonicalUrlFor(href: string): string {
  return `${siteUrl}${href === "/" ? "" : href}`;
}
