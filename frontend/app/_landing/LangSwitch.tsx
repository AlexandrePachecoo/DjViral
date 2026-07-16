"use client";

import { useLocale } from "next-intl";
import { localeUrl } from "@/i18n/config";

export default function LangSwitch({ className }: { className?: string }) {
  const locale = useLocale();
  const otherLocale = locale === "pt" ? "en" : "pt";

  // Preserva o caminho/query atual ao trocar de host quando possível.
  const base = localeUrl[otherLocale];
  const href =
    typeof window !== "undefined"
      ? `${base}${window.location.pathname}${window.location.search}`
      : base;

  return (
    <a className={className} href={href}>
      {otherLocale === "en" ? "EN" : "PT"}
    </a>
  );
}
