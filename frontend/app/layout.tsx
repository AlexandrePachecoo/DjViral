import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "DjViral",
  description: "Gera cortes virais a partir de sets de DJ",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <body
        style={{
          fontFamily: "system-ui, sans-serif",
          maxWidth: 720,
          margin: "0 auto",
          padding: "2rem 1rem",
          background: "#0b0b10",
          color: "#e9e9f0",
        }}
      >
        {children}
      </body>
    </html>
  );
}
