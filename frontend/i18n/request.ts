import { getRequestConfig } from "next-intl/server";
import { defaultLocale } from "./config";

// Locale fixo (pt) em todo host — ver `i18n/config.ts`.
export default getRequestConfig(async () => ({
  locale: defaultLocale,
  messages: (await import(`../messages/${defaultLocale}.json`)).default,
}));
