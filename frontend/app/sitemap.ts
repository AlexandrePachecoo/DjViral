import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteUrl();
  const lastModified = new Date("2026-11-16");
  return [
    { url: `${base}/`, lastModified, changeFrequency: "weekly", priority: 1 },
    { url: `${base}/privacidade`, lastModified, changeFrequency: "yearly", priority: 0.3 },
    { url: `${base}/termos`, lastModified, changeFrequency: "yearly", priority: 0.3 },
  ];
}
