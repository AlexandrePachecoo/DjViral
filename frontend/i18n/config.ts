// Configuração de i18n compartilhada entre server (resolução do locale) e
// client (seletor de idioma). O locale é decidido pelo HOST, não por prefixo
// de URL: o domínio brasileiro serve pt, o resto (Vercel, por enquanto) serve
// en. Ler o host em vez de casar contra uma lista fixa de domínios cobre
// `www.`, o host de produção da Vercel e cada URL única de preview sem 404.

export const locales = ["pt", "en"] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = "pt";

// URL canônica de cada idioma (usada pelo seletor de idioma para trocar de
// host). Trocar o host `en` quando o domínio internacional definitivo existir.
export const localeUrl: Record<Locale, string> = {
  pt: "https://www.djviral.com.br",
  en: "https://dj-viral.vercel.app",
};

// Locale a partir do host. Retorna null quando o host não é reconhecido
// (localhost, previews não-Vercel) — aí o chamador cai no Accept-Language.
export function localeFromHost(host: string | null | undefined): Locale | null {
  const h = (host ?? "").toLowerCase();
  if (!h) return null;
  if (h.includes("djviral.com.br")) return "pt";
  if (h.includes("vercel.app")) return "en";
  return null;
}
