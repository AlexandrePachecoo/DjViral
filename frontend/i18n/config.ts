// Configuração de i18n. Por enquanto o site é servido SÓ em português, em
// qualquer host. A infraestrutura do next-intl (e `messages/en.json`) foi
// mantida para o inglês voltar depois: basta readicionar o locale aqui e
// resolver o idioma em `i18n/request.ts`.

export const locales = ["pt"] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = "pt";
