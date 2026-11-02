import { defineConfig } from "@vercel/geistdocs/config";
import { siteUrl } from "@/lib/site";

export const config = defineConfig({
  title: "portless",
  siteUrl,
  defaultLanguage: "en",
  logo: <span className="font-medium">portless</span>,
  github: {
    owner: "ENK0DED",
    repo: "portless",
    branch: "main",
    editPath: "apps/docs/content/docs",
  },
  content: [{ id: "docs", label: "Documentation", dir: "content/docs", route: "/" }],
  nav: [
    { label: "Docs", href: "/" },
    { label: "GitHub", href: "https://github.com/ENK0DED/portless", external: true },
    { label: "npm", href: "https://www.npmjs.com/package/@enk0ded/portless", external: true },
  ],
  ai: { enabled: false },
  feedback: { enabled: false },
  language: { enabled: false },
  pageActions: { askAI: false, openInChat: false },
  webmcp: { enabled: true },
});
