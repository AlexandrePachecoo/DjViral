import type { Metadata } from "next";
import { getLocale } from "next-intl/server";
import { LegalDocument } from "../_legal/LegalDocument";
import { privacy } from "../_legal/copy";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  const doc = privacy[locale === "en" ? "en" : "pt"];
  return {
    title: doc.metaTitle,
    description: doc.metaDescription,
    alternates: { canonical: "/privacidade" },
    openGraph: {
      title: doc.metaTitle,
      description: doc.metaDescription,
      url: "/privacidade",
      type: "article",
      locale: "pt_BR",
      images: [{ url: "/images/dj-preview.webp", alt: "DJviral" }],
    },
    twitter: {
      card: "summary_large_image",
      title: doc.metaTitle,
      description: doc.metaDescription,
      images: ["/images/dj-preview.webp"],
    },
  };
}

export default async function PrivacyPage() {
  const locale = await getLocale();
  return <LegalDocument doc={privacy[locale === "en" ? "en" : "pt"]} />;
}
