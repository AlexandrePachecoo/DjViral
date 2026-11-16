import type { Metadata } from "next";
import { getLocale } from "next-intl/server";
import { LegalDocument } from "../_legal/LegalDocument";
import { terms } from "../_legal/copy";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  const doc = terms[locale === "en" ? "en" : "pt"];
  return {
    title: doc.metaTitle,
    description: doc.metaDescription,
    alternates: { canonical: "/termos" },
    openGraph: {
      title: doc.metaTitle,
      description: doc.metaDescription,
      url: "/termos",
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

export default async function TermsPage() {
  const locale = await getLocale();
  return <LegalDocument doc={terms[locale === "en" ? "en" : "pt"]} />;
}
