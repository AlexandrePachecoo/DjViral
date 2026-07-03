"use client";

import { useEffect, useRef, useState } from "react";
import { Logo } from "./Logo";
import { theme, font, btnPrimary } from "./theme";
import type { Tab } from "./types";

type Props = {
  tab: Tab;
  onTab: (t: Tab) => void;
  userName: string;
  onNewSet: () => void;
};

// Abas do menu central. Perfil e Planos/Uso agora vivem no menu do usuário
// (dropdown no avatar), não aqui.
const TABS: { key: Tab; label: string }[] = [
  { key: "gerador", label: "Gerador" },
  { key: "salvos", label: "Cortes salvos" },
];

export function Header({ tab, onTab, userName, onNewSet }: Props) {
  const initial = (userName || "DJ").trim().charAt(0).toUpperCase() || "M";

  const [menuOpen, setMenuOpen] = useState(false);
  const userRef = useRef<HTMLDivElement>(null);

  // Fecha o menu em clique fora ou tecla Escape.
  useEffect(() => {
    if (!menuOpen) return;
    function onPointer(e: MouseEvent) {
      if (userRef.current && !userRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  function goTo(t: Tab) {
    onTab(t);
    setMenuOpen(false);
  }

  async function logout() {
    setMenuOpen(false);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      // mesmo se falhar, mandamos o usuário para o login.
    }
    window.location.href = "/login";
  }

  return (
    <header
      className="dj-header"
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

      <nav className="dj-header-nav" style={{ display: "flex", gap: 26, margin: "0 auto" }}>
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

      <div className="dj-header-actions" style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <div onClick={onNewSet} style={btnPrimary}>
          ＋ Novo set
        </div>

        {/* Menu do usuário: avatar + nome abrem um dropdown com Perfil,
            Planos/Uso e Sair da conta. */}
        <div ref={userRef} style={{ position: "relative" }}>
          <button
            type="button"
            onClick={() => setMenuOpen((o) => !o)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 9,
              padding: "4px 8px 4px 4px",
              borderRadius: 999,
              cursor: "pointer",
              background: menuOpen ? theme.surfaceMuted : "transparent",
              border: "none",
              font: "inherit",
              transition: "background .15s",
            }}
          >
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
                flexShrink: 0,
              }}
            >
              {initial}
            </div>
            <span className="dj-header-username" style={{ fontSize: 13, color: theme.textSecondary }}>
              {userName}
            </span>
            <span
              className="dj-header-username"
              style={{
                fontSize: 10,
                color: theme.textMuted,
                transform: menuOpen ? "rotate(180deg)" : "none",
                transition: "transform .15s",
              }}
            >
              ▾
            </span>
          </button>

          {menuOpen && (
            <div
              role="menu"
              style={{
                position: "absolute",
                top: "calc(100% + 8px)",
                right: 0,
                zIndex: 40,
                minWidth: 200,
                background: theme.surface,
                border: `1px solid ${theme.border}`,
                borderRadius: 12,
                boxShadow: "0 8px 28px rgba(0,0,0,.12)",
                padding: 6,
                animation: "dj-modalIn .16s ease",
              }}
            >
              <div
                style={{
                  padding: "8px 12px 10px",
                  fontSize: 12,
                  color: theme.textMuted,
                  borderBottom: `1px solid ${theme.border}`,
                  marginBottom: 6,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {userName}
              </div>

              <div
                role="menuitem"
                className="dj-usermenu-item"
                onClick={() => goTo("perfil")}
                style={{
                  padding: "9px 12px",
                  borderRadius: 8,
                  cursor: "pointer",
                  fontSize: 14,
                  color: theme.textSecondary,
                }}
              >
                Perfil
              </div>
              <div
                role="menuitem"
                className="dj-usermenu-item"
                onClick={() => goTo("plano")}
                style={{
                  padding: "9px 12px",
                  borderRadius: 8,
                  cursor: "pointer",
                  fontSize: 14,
                  color: theme.textSecondary,
                }}
              >
                Planos/Uso
              </div>

              <div style={{ height: 1, background: theme.border, margin: "6px 0" }} />

              <div
                role="menuitem"
                className="dj-usermenu-item"
                onClick={logout}
                style={{
                  padding: "9px 12px",
                  borderRadius: 8,
                  cursor: "pointer",
                  fontSize: 14,
                  color: "#dc2626",
                }}
              >
                Sair da conta
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
