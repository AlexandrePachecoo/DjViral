"use client";

import { theme, font, scoreColor } from "./theme";
import { COMPOSE, type Platform } from "./data";
import type { ModalState } from "./types";

type Props = {
  state: ModalState;
  onClose: () => void;
  onPlatform: (p: Platform) => void;
  onMode: (m: "agora" | "programar") => void;
};

const PLATFORMS: Platform[] = ["TikTok", "Reels", "Shorts"];

export function PublishModal({ state, onClose, onPlatform, onMode }: Props) {
  if (!state.open || !state.cut) return null;

  const cut = state.cut;
  const isProgramar = state.mode === "programar";
  const compose = COMPOSE[state.platform];

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 60,
        background: "rgba(24,24,27,.4)",
        backdropFilter: "blur(4px)",
        WebkitBackdropFilter: "blur(4px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        animation: "dj-fadeIn .2s ease",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 520,
          maxWidth: "100%",
          maxHeight: "92vh",
          overflow: "auto",
          borderRadius: 16,
          background: theme.surface,
          border: `1px solid ${theme.border}`,
          boxShadow: "0 24px 70px rgba(0,0,0,.18)",
          animation: "dj-modalIn .24s cubic-bezier(.2,.8,.2,1)",
        }}
      >
        {/* header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "18px 22px",
            borderBottom: `1px solid ${theme.borderHairline}`,
          }}
        >
          <div style={{ font: `500 18px ${font.display}` }}>
            {isProgramar ? "Programar corte" : "Postar corte"}
          </div>
          <div
            onClick={onClose}
            style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              background: theme.surfaceMuted,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              color: theme.textTertiary,
            }}
          >
            ✕
          </div>
        </div>

        {/* body */}
        <div style={{ padding: 22, display: "flex", flexDirection: "column", gap: 20 }}>
          {/* cut summary */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 13,
              padding: 12,
              borderRadius: 12,
              background: theme.surfaceInset,
              border: `1px solid ${theme.borderHairline}`,
            }}
          >
            <video
              src={cut.url}
              muted
              playsInline
              preload="metadata"
              style={{ width: 44, height: 74, borderRadius: 7, objectFit: "cover", background: "#000", flexShrink: 0 }}
            />
            <div style={{ flex: 1 }}>
              <div style={{ font: `500 15px ${font.display}` }}>{cut.title}</div>
              <div style={{ fontSize: 12, color: theme.textMuted }}>
                {[state.setName, cut.dur].filter(Boolean).join(" · ")}
              </div>
            </div>
            <div style={{ font: `600 15px ${font.display}`, color: scoreColor(cut.score) }}>{cut.score}</div>
          </div>

          {/* description per platform */}
          <div>
            <div style={{ fontSize: 13, color: theme.textTertiary, marginBottom: 9 }}>Descrição por plataforma</div>
            <div style={{ display: "flex", gap: 7, marginBottom: 11 }}>
              {PLATFORMS.map((p) => {
                const active = p === state.platform;
                return (
                  <div
                    key={p}
                    onClick={() => onPlatform(p)}
                    style={{
                      padding: "8px 14px",
                      borderRadius: 8,
                      cursor: "pointer",
                      font: `500 13px ${font.body}`,
                      transition: "all .2s",
                      color: active ? theme.accent : theme.textTertiary,
                      background: active ? theme.accentSoft : theme.surface,
                      border: `1px solid ${active ? theme.accentBorder : theme.borderStrong}`,
                    }}
                  >
                    {active ? "✓ " : ""}
                    {p}
                  </div>
                );
              })}
            </div>
            <div
              style={{
                padding: 13,
                borderRadius: 10,
                background: theme.surfaceInset,
                border: `1px solid ${theme.border}`,
                fontSize: 14,
                lineHeight: 1.5,
                color: theme.textSecondary2,
                minHeight: 64,
              }}
            >
              {compose.desc}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
              {compose.tags.map((tag) => (
                <span
                  key={tag}
                  style={{
                    padding: "5px 11px",
                    borderRadius: 20,
                    fontSize: 13,
                    background: theme.accentTint08,
                    color: theme.accent,
                    border: `1px solid ${theme.accentBorder}`,
                  }}
                >
                  {tag} ✕
                </span>
              ))}
              <span
                style={{
                  padding: "5px 11px",
                  borderRadius: 20,
                  fontSize: 13,
                  border: `1.5px dashed ${theme.textFaint2}`,
                  color: theme.textMuted,
                  cursor: "pointer",
                }}
              >
                ＋ adicionar
              </span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 9, flexWrap: "wrap" }}>
              <span style={{ fontSize: 12, color: theme.textMuted }}>sugeridas:</span>
              {["#fyp", "#edm", "#festival"].map((tag) => (
                <span
                  key={tag}
                  style={{
                    padding: "4px 10px",
                    borderRadius: 20,
                    fontSize: 12,
                    border: `1px solid ${theme.borderStrong}`,
                    color: theme.textTertiary,
                    cursor: "pointer",
                  }}
                >
                  ＋ {tag}
                </span>
              ))}
            </div>
          </div>

          {/* when */}
          <div>
            <div style={{ fontSize: 13, color: theme.textTertiary, marginBottom: 9 }}>Quando publicar</div>
            <div style={{ display: "flex", gap: 10 }}>
              <WhenOption label="Agora" active={!isProgramar} onClick={() => onMode("agora")} />
              <WhenOption label="Programar" active={isProgramar} onClick={() => onMode("programar")} />
            </div>
            {isProgramar && (
              <div style={{ marginTop: 11, display: "flex", flexDirection: "column", gap: 9 }}>
                <div style={{ display: "flex", gap: 10 }}>
                  <div style={dateField}>📅 29/06/2026</div>
                  <div style={dateField}>🕕 18:00</div>
                </div>
                <div style={{ fontSize: 12, color: theme.accent }}>
                  ⚡ melhor horário pro seu público: 18h–20h
                </div>
              </div>
            )}
          </div>
        </div>

        {/* footer */}
        <div style={{ display: "flex", gap: 10, padding: "18px 22px", borderTop: `1px solid ${theme.borderHairline}` }}>
          <div
            onClick={onClose}
            style={{
              flex: 1,
              textAlign: "center",
              padding: 12,
              borderRadius: 10,
              cursor: "pointer",
              fontSize: 14,
              color: theme.textSecondary,
              background: theme.surface,
              border: `1px solid ${theme.borderStrong}`,
            }}
          >
            Cancelar
          </div>
          <div
            onClick={onClose}
            style={{
              flex: 2,
              textAlign: "center",
              padding: 12,
              borderRadius: 10,
              cursor: "pointer",
              font: `500 15px ${font.body}`,
              color: "#fff",
              background: theme.accent,
            }}
          >
            {isProgramar ? "Programar" : "Postar agora"}
          </div>
        </div>
      </div>
    </div>
  );
}

function WhenOption({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <div
      onClick={onClick}
      style={{
        flex: 1,
        display: "flex",
        alignItems: "center",
        gap: 9,
        padding: "11px 14px",
        borderRadius: 10,
        cursor: "pointer",
        font: `500 14px ${font.body}`,
        transition: "all .2s",
        color: active ? theme.accent : theme.textTertiary,
        background: active ? theme.accentSoft : theme.surface,
        border: `1px solid ${active ? theme.accentBorder : theme.borderStrong}`,
      }}
    >
      <span
        style={{
          width: 13,
          height: 13,
          borderRadius: "50%",
          border: active ? `4px solid ${theme.accent}` : `2px solid ${theme.textFaint2}`,
        }}
      />
      {label}
    </div>
  );
}

const dateField: React.CSSProperties = {
  flex: 1,
  padding: "11px 13px",
  borderRadius: 10,
  background: theme.surface,
  border: `1px solid ${theme.borderStrong}`,
  fontSize: 14,
  color: theme.textSecondary2,
};
