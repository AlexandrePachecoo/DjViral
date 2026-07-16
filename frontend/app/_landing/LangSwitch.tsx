"use client";

import { useLocale } from "next-intl";

const OTHER_HOST: Record<string, string> = {
  pt: "djviral.vercel.app",
  en: "djviral.com.br",
};

export default function LangSwitch({ className }: { className?: string }) {
  const locale = useLocale();
  const otherLocale = locale === "pt" ? "en" : "pt";
  const otherHost = OTHER_HOST[locale];

  const href =
    typeof window !== "undefined"
      ? `${window.location.protocol}//${otherHost}${window.location.pathname}${window.location.search}`
      : `https://${otherHost}`;

  return (
    <a className={className} href={href}>
      {otherLocale === "en" ? "EN" : "PT"}
    </a>
  );
}
