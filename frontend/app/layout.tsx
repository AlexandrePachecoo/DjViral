import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "DJviral — Seu set vira 30 cortes virais. Sem editar nada.",
  description:
    "Suba um set de até 3 horas. A DJviral encontra os melhores momentos e te entrega 30 vídeos verticais prontos pro TikTok e Reels.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // viewport-fit=cover deixa o conteúdo respeitar a safe-area (notch) do iOS.
  viewportFit: "cover",
  themeColor: "#08080d",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
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
      <body>{children}</body>
    </html>
  );
}
