import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
  locales: ["pt", "en"],
  defaultLocale: "pt",
  localePrefix: "never",
  domains: [
    { domain: "djviral.com.br", defaultLocale: "pt", locales: ["pt", "en"] },
    // Domínio provisório da versão em inglês (trocar quando o domínio
    // internacional definitivo estiver pronto).
    { domain: "djviral.vercel.app", defaultLocale: "en", locales: ["pt", "en"] },
  ],
});
