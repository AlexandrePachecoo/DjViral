import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages, getTranslations } from "next-intl/server";
import { siteUrl } from "@/lib/site";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("metadata");
  const title = t("title");
  const description = t("description");
  return {
    metadataBase: new URL(siteUrl()),
    title,
    description,
    applicationName: "DJviral",
    icons: { icon: "/favicon.ico" },
    openGraph: {
      type: "website",
      locale: "pt_BR",
      siteName: "DJviral",
      title,
      description,
      images: [{ url: "/images/dj-preview.webp", alt: "DJ tocando um set ao pôr do sol" }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: ["/images/dj-preview.webp"],
    },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // viewport-fit=cover deixa o conteúdo respeitar a safe-area (notch) do iOS.
  viewportFit: "cover",
  themeColor: "#08080d",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale();
  const messages = await getMessages();
  // O locale interno continua "pt"; o HTML anuncia pt-BR para busca e leitores.
  const htmlLang = locale === "pt" ? "pt-BR" : locale;

  return (
    <html lang={htmlLang}>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin=""
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Sora:wght@300;400;500;600&family=Outfit:wght@200;300;400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <NextIntlClientProvider locale={locale} messages={messages}>
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
