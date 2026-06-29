"use client";

import { theme, font, btnPrimary, btnGhost } from "./theme";
import { CAPTIONS, type Cut } from "./data";

type Props = {
  cut: Cut;
  selectedCaptionId: string;
  onSelectCaption: (id: string) => void;
  onBack: () => void;
};

export function EditorView({ cut, selectedCaptionId, onSelectCaption, onBack }: Props) {
  const selectedCaption = CAPTIONS.find((c) => c.id === selectedCaptionId) ?? CAPTIONS[0];

  return (
    <div style={{ animation: "dj-fadeUp .4s ease" }} data-anim>
      {/* ===== Topbar ===== */}
      <div className="dj-editor-topbar" style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 26 }}>
        <div
          onClick={onBack}
          style={{
            width: 40,
            height: 40,
            borderRadius: 10,
            background: theme.surface,
            border: `1px solid ${theme.borderStrong}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            color: theme.textSecondary,
          }}
        >
          ←
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12, color: theme.textMuted }}>Editando corte</div>
          <div style={{ font: `500 20px ${font.display}` }}>{cut.title}</div>
        </div>
        <div style={btnGhost}>Pré-visualizar</div>
        <div style={btnPrimary}>Salvar corte</div>
      </div>

      {/* ===== Grid: preview + panel ===== */}
      <div style={{ display: "grid", gridTemplateColumns: "340px 1fr", gap: 26 }} className="dj-editor-grid">
        {/* preview */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div
            style={{
              position: "relative",
              aspectRatio: "9 / 16",
              borderRadius: 18,
              overflow: "hidden",
              background: theme.previewVideo,
            }}
          >
            <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <div
                style={{
                  width: 54,
                  height: 54,
                  borderRadius: "50%",
                  background: "rgba(255,255,255,.12)",
                  border: "1px solid rgba(255,255,255,.25)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#fff",
                  paddingLeft: 3,
                }}
              >
                ▶
              </div>
            </div>
            <div
              style={{
                position: "absolute",
                left: 26,
                right: 26,
                top: "40%",
                textAlign: "center",
                font: `600 18px ${font.body}`,
                color: "#fff",
                textShadow: "0 2px 8px rgba(0,0,0,.4)",
                background: "rgba(0,0,0,.25)",
                border: `1.5px dashed ${theme.accentLight}`,
                borderRadius: 8,
                padding: 9,
              }}
            >
              {selectedCaption.text}
              <div
                style={{
                  position: "absolute",
                  top: -11,
                  left: "50%",
                  transform: "translateX(-50%)",
                  width: 20,
                  height: 20,
                  borderRadius: "50%",
                  background: theme.accent,
                  color: "#fff",
                  fontSize: 11,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                ✥
              </div>
            </div>
            <div style={{ position: "absolute", left: 18, right: 18, bottom: 18 }}>
              <div style={{ height: 3, borderRadius: 3, background: "rgba(255,255,255,.25)" }}>
                <div style={{ width: "42%", height: "100%", borderRadius: 3, background: theme.accentLight }} />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "rgba(255,255,255,.65)", marginTop: 6 }}>
                <span>0:16</span>
                <span>0:38</span>
              </div>
            </div>
          </div>
          <div style={{ fontSize: 11, color: theme.textMuted, textAlign: "center" }}>
            arraste a legenda no preview pra posicionar onde quiser
          </div>
        </div>

        {/* panel */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div>
            <div style={{ fontSize: 12, color: theme.textMuted, marginBottom: 7 }}>Título do corte</div>
            <div
              style={{
                padding: "12px 14px",
                borderRadius: 10,
                background: theme.surface,
                border: `1px solid ${theme.borderStrong}`,
                fontSize: 15,
                color: theme.textPrimary,
              }}
            >
              {cut.title} 🔥
            </div>
          </div>

          {/* Tempo */}
          <div style={{ borderRadius: 13, background: theme.surface, border: `1px solid ${theme.border}`, overflow: "hidden" }}>
            <div style={{ padding: "13px 16px", font: `500 14px ${font.display}`, borderBottom: `1px solid ${theme.borderHairline}` }}>
              Tempo
            </div>
            <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 16 }}>
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: theme.textTertiary, marginBottom: 10 }}>
                  <span>Trecho selecionado</span>
                  <span style={{ color: theme.accent }}>0:16.2 → 0:54.6</span>
                </div>
                <div style={{ position: "relative", height: 6, borderRadius: 5, background: theme.surfaceMuted2 }}>
                  <div style={{ position: "absolute", left: "22%", right: "24%", top: 0, bottom: 0, borderRadius: 5, background: theme.accent }} />
                  {["22%", "76%"].map((left) => (
                    <div
                      key={left}
                      style={{
                        position: "absolute",
                        left,
                        top: -5,
                        width: 16,
                        height: 16,
                        borderRadius: "50%",
                        background: "#fff",
                        border: `2px solid ${theme.accent}`,
                        boxShadow: "0 1px 3px rgba(0,0,0,.15)",
                      }}
                    />
                  ))}
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <span style={{ fontSize: 13, color: theme.textTertiary }}>Ajuste fino</span>
                <span style={fineBtn}>◀ 0.5s início</span>
                <span style={fineBtn}>fim 0.5s ▶</span>
                <span style={{ marginLeft: "auto", fontSize: 13, color: theme.textMuted }}>duração 0:38.4</span>
              </div>
            </div>
          </div>

          {/* Legendas */}
          <div style={{ borderRadius: 13, background: theme.surface, border: `1px solid ${theme.border}`, overflow: "hidden" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "13px 16px",
                borderBottom: `1px solid ${theme.borderHairline}`,
              }}
            >
              <span style={{ font: `500 14px ${font.display}` }}>Legendas</span>
              <span style={{ fontSize: 12, color: theme.textMuted }}>toque pra editar · arraste no preview</span>
            </div>
            <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
              {CAPTIONS.map((cap) => {
                const active = cap.id === selectedCaptionId;
                return (
                  <div
                    key={cap.id}
                    onClick={() => onSelectCaption(cap.id)}
                    style={{
                      cursor: "pointer",
                      padding: "11px 13px",
                      borderRadius: 10,
                      transition: "all .2s",
                      background: active ? theme.accentSoft : theme.surfaceInset,
                      border: `1px solid ${active ? theme.accentBorder : theme.borderHairline}`,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                      <span style={{ fontSize: 12, color: theme.accent }}>{cap.time}</span>
                      <span style={{ fontSize: 12, color: theme.textMuted }}>✥ {cap.pos}</span>
                    </div>
                    <div style={{ fontSize: 14, color: theme.textSecondary2 }}>{cap.text}</div>
                  </div>
                );
              })}
              <div style={{ display: "flex", gap: 7, marginTop: 2 }}>
                <span style={{ padding: "5px 12px", borderRadius: 20, fontSize: 12, background: theme.accentTint08, color: theme.accent, border: `1px solid ${theme.accentBorder}` }}>
                  Bold
                </span>
                <span style={styleChip}>Karaokê</span>
                <span style={styleChip}>Neon</span>
              </div>
              <div
                style={{
                  border: `1.5px dashed ${theme.accentBorder}`,
                  borderRadius: 10,
                  padding: 10,
                  textAlign: "center",
                  fontSize: 13,
                  color: theme.accent,
                  cursor: "pointer",
                }}
              >
                ＋ adicionar legenda
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ===== Timeline ===== */}
      <div style={{ marginTop: 22, padding: "18px 20px", borderRadius: 14, background: theme.surface, border: `1px solid ${theme.border}` }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: theme.textMuted, marginBottom: 12 }}>
          <span>Timeline do set</span>
          <span>− zoom +</span>
        </div>
        <div style={{ position: "relative", height: 74, borderRadius: 9, background: "#f6f6f7", overflow: "hidden" }}>
          <div style={{ position: "absolute", left: "22%", right: "24%", top: 0, bottom: 0, background: theme.accentTint08, borderLeft: `2px solid ${theme.accent}`, borderRight: `2px solid ${theme.accent}` }} />
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", padding: "0 8px", opacity: 0.6 }}>
            <svg viewBox="0 0 240 40" preserveAspectRatio="none" style={{ width: "100%", height: 52, display: "block" }}>
              <polyline
                points="0,20 6,12 12,28 18,6 24,32 30,16 36,24 42,8 48,30 54,14 60,26 66,10 72,30 78,18 84,9 90,31 96,15 102,25 108,7 114,29 120,17 126,23 132,11 138,31 144,16 150,26 156,12 162,28 168,15 174,23 180,9 186,30 192,17 198,25 204,11 210,29 216,16 222,24 228,13 234,21 240,20"
                fill="none"
                stroke="#c4c4c8"
                strokeWidth="1.5"
              />
            </svg>
          </div>
          {["36%", "52%", "64%"].map((left) => (
            <div
              key={left}
              style={{
                position: "absolute",
                left,
                top: -9,
                background: theme.accent,
                color: "#fff",
                font: `600 9px ${font.display}`,
                padding: "2px 6px",
                borderRadius: 4,
              }}
            >
              T
            </div>
          ))}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: theme.textMuted, marginTop: 12 }}>
          <span style={{ background: theme.accent, color: "#fff", font: `600 9px ${font.display}`, padding: "2px 6px", borderRadius: 4 }}>T</span>
          legendas posicionadas no tempo · arraste as bordas pra cortar início/fim
        </div>
      </div>
    </div>
  );
}

const fineBtn: React.CSSProperties = {
  padding: "6px 13px",
  borderRadius: 8,
  background: theme.surface,
  border: `1px solid ${theme.borderStrong}`,
  fontSize: 13,
  color: theme.textSecondary,
  cursor: "pointer",
};

const styleChip: React.CSSProperties = {
  padding: "5px 12px",
  borderRadius: 20,
  fontSize: 12,
  background: theme.surface,
  color: theme.textTertiary,
  border: `1px solid ${theme.borderStrong}`,
};
