"use client";

import type { ReactNode } from "react";
import { theme, font } from "./theme";

// Estados de carregamento / vazio do estúdio. Substituem a antiga maquete que
// sempre mostrava um set fixo, mesmo sem dados reais.

export function LoadingState() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }} data-anim>
      {/* card do set */}
      <Skeleton height={88} radius={14} />
      {/* grade de cortes */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill,minmax(248px,1fr))",
          gap: 22,
          marginTop: 12,
        }}
      >
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} height={360} radius={14} />
        ))}
      </div>
    </div>
  );
}

function Skeleton({ height, radius }: { height: number; radius: number }) {
  return (
    <div
      data-anim
      className="dj-skeleton"
      style={{
        height,
        borderRadius: radius,
        background: theme.surfaceMuted,
        border: `1px solid ${theme.border}`,
      }}
    />
  );
}

export function EmptyState({
  title = "Você ainda não tem cortes",
  hint = "Envie seu primeiro set e a gente gera os cortes mais virais automaticamente.",
  cta = <NewSetButton />,
}: {
  title?: string;
  hint?: string;
  cta?: ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        gap: 14,
        padding: "64px 24px",
        borderRadius: 16,
        background: theme.surface,
        border: `1px solid ${theme.border}`,
      }}
      data-anim
    >
      <div
        style={{
          width: 56,
          height: 56,
          borderRadius: 14,
          background: theme.accentSoft,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 24,
        }}
      >
        🎧
      </div>
      <div style={{ font: `500 20px ${font.display}`, color: theme.textPrimary }}>{title}</div>
      <div style={{ fontSize: 14, color: theme.textMuted, maxWidth: 380, lineHeight: 1.5 }}>{hint}</div>
      {cta}
    </div>
  );
}

function NewSetButton() {
  return (
    <a
      href="/app/novo"
      style={{
        marginTop: 6,
        padding: "11px 20px",
        borderRadius: 10,
        background: theme.accent,
        color: "#fff",
        font: `500 14px ${font.body}`,
        textDecoration: "none",
      }}
    >
      ＋ Enviar primeiro set
    </a>
  );
}
