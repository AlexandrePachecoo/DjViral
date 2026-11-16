import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site";

// /app e /login são área de conta. /api não é página.
// A home, /privacidade e /termos ficam liberadas.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/app", "/app/", "/login", "/api/"],
    },
    sitemap: `${siteUrl()}/sitemap.xml`,
  };
}
