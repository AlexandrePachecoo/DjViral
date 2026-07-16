import { getRequestConfig } from "next-intl/server";
import { headers } from "next/headers";
import { defaultLocale, localeFromHost, type Locale } from "./config";

// Resolve o locale por requisição a partir do host (djviral.com.br → pt,
// Vercel → en). Sem host reconhecido (localhost, previews não-Vercel), cai no
// Accept-Language do navegador, com pt como padrão. Sem middleware/prefixo de
// URL — só o host decide, então nenhum host desconhecido gera 404.
export default getRequestConfig(async () => {
  const h = headers();
  let locale: Locale | null = localeFromHost(h.get("host"));

  if (!locale) {
    const accept = (h.get("accept-language") ?? "").toLowerCase();
    locale = accept.startsWith("pt") ? "pt" : accept ? "en" : defaultLocale;
  }

  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
  };
});
