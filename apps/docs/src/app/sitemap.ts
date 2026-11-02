import type { MetadataRoute } from "next";
import { allDocsPages } from "@/lib/docs-navigation";
import { siteUrl } from "@/lib/site";

export default function sitemap(): MetadataRoute.Sitemap {
  return allDocsPages.map((page) => ({
    url: `${siteUrl}${page.href}`,
  }));
}
