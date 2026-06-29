"use client";

import { useRouter } from "next/navigation";
import { Logo } from "./Logo";
import { theme, font, btnPrimary } from "./theme";
import type { Tab } from "./types";

type Props = {
  tab: Tab;
  onTab: (t: Tab) => void;
  userName: string;
};

const TABS: { key: Tab; label: string }[] = [
  { key: "gerador", label: "Gerador" },
  { key: "edicao", label: "Edição" },
  { key: "salvos", label: "Cortes salvos" },
];

export function Header({ tab, onTab, userName }: Props) {
  const router = useRouter();
  const initial = (userName || "DJ").trim().charAt(0).toUpperCase() || "M";

  return (
    <header
      style={{
        position: "sticky",
        top: 0,
        zIndex: 30,
        display: "flex",
        alignItems: "center",
        gap: 28,
        padding: "15px 32px",
        background: "rgba(250,250,250,.85)",
        backdropFilter: "blur(14px)",
        WebkitBackdropFilter: "blur(14px)",
        borderBottom: `1px solid ${theme.border}`,
      }}
    >
      <Logo />

      <nav style={{ display: "flex", gap: 26, margin: "0 auto" }}>
        {TABS.map((t) => {
          const active = tab === t.key;
          return (
            <div
              key={t.key}
              onClick={() => onTab(t.key)}
              style={{
                padding: "8px 2px",
                cursor: "pointer",
                font: `500 14px ${font.body}`,
                transition: "color .2s",
                borderBottom: `2px solid ${active ? theme.accent : "transparent"}`,
                color: active ? theme.textPrimary : theme.textMuted,
              }}
            >
              {t.label}
            </div>
          );
        })}
      </nav>

      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <div onClick={() => router.push("/app/novo")} style={btnPrimary}>
          ＋ Novo set
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <div
            style={{
              width: 34,
              height: 34,
              borderRadius: "50%",
              background: theme.surfaceMuted,
              border: `1px solid ${theme.borderStrong}`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              font: `600 12px ${font.display}`,
              color: theme.accent,
            }}
          >
            {initial}
          </div>
          <span style={{ fontSize: 13, color: theme.textSecondary }}>{userName}</span>
        </div>
      </div>
    </header>
  );
}
