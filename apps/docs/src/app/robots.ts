import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
  return {
    rules:
      process.env.VERCEL_ENV && process.env.VERCEL_ENV !== "production"
        ? { userAgent: "*", disallow: "/" }
        : { userAgent: "*", allow: "/" },
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}
