"use client";

import { useEffect, useState } from "react";
import { theme, font, btnPrimary, btnGhost } from "./theme";
import { CAPTIONS, type Cut } from "./data";
import { type ApiCut, formatTimecode, toStudioCut } from "./cut";

type Props = {
  cut: Cut;
  setName: string;
  projectId: string;
  selectedCaptionId: string;
  onSelectCaption: (id: string) => void;
  onBack: () => void;
  onSaved: (cut: Cut) => void;
};

type SaveState = "idle" | "saving" | "error";

export function EditorView({
  cut,
  setName,
  projectId,
  selectedCaptionId,
  onSelectCaption,
  onBack,
  onSaved,
}: Props) {
  const selectedCaption = CAPTIONS.find((c) => c.id === selectedCaptionId) ?? CAPTIONS[0];

  const [title, setTitle] = useState(cut.title);
  const [start, setStart] = useState(cut.startSec);
  const [end, setEnd] = useState(cut.endSec);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [msg, setMsg] = useState("");
  const [videoReload, setVideoReload] = useState(0);

  // Reseta o formulário ao abrir outro corte.
  useEffect(() => {
    setTitle(cut.title);
    setStart(cut.startSec);
    setEnd(cut.endSec);
    setSaveState("idle");
    setMsg("");
  }, [cut.id, cut.title, cut.startSec, cut.endSec]);

  const saving = saveState === "saving";
  const titleChanged = title.trim() !== cut.title && title.trim() !== "";
  const trimChanged =
    Math.abs(start - cut.startSec) > 0.01 || Math.abs(end - cut.endSec) > 0.01;
  const dirty = titleChanged || trimChanged;

  function nudgeStart(delta: number) {
    setStart((s) => {
      const ns = Math.max(0, +(s + delta).toFixed(2));
      return ns < end - 0.5 ? ns : s;
    });
  }
  function nudgeEnd(delta: number) {
    setEnd((e) => {
      const ne = +(e + delta).toFixed(2);
      return ne > start + 0.5 ? ne : e;
    });
  }

  async function pollUntilReady(): Promise<Cut> {
    for (let i = 0; i < 30; i++) {
      await new Promise((res) => setTimeout(res, 3000));
      const r = await fetch(`/api/projects/${projectId}`);
      if (!r.ok) continue;
      const data = await r.json();
      const api: ApiCut | undefined = (data.cuts ?? []).find(
        (c: ApiCut) => c.id === cut.id
      );
      if (!api) continue;
      if (api.status === "ready") return toStudioCut(api);
      if (api.status === "error") throw new Error("O re-corte falhou. Tente de novo.");
    }
    throw new Error("O re-corte está demorando. Tente novamente em instantes.");
  }

  async function handleSave() {
    if (saving) return;
    const newTitle = title.trim();
    if (!newTitle) {
      setSaveState("error");
      setMsg("O título não pode ficar vazio.");
      return;
    }
    if (!dirty) {
      setMsg("Nada para salvar.");
      return;
    }

    setSaveState("saving");
    setMsg(trimChanged ? "Regenerando o vídeo do corte..." : "Salvando...");
    try {
      if (titleChanged) {
        const r = await fetch(`/api/projects/${projectId}/cuts/${cut.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ titulo: newTitle }),
        });
        if (!r.ok) {
          throw new Error((await r.json().catch(() => ({})))?.error ?? "Falha ao renomear");
        }
      }

      if (trimChanged) {
        const r = await fetch(`/api/projects/${projectId}/cuts/${cut.id}/recut`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ inicio: start, fim: end }),
        });
        if (!r.ok) {
          throw new Error((await r.json().catch(() => ({})))?.error ?? "Falha ao re-cortar");
        }
        const updated = await pollUntilReady();
        setSaveState("idle");
        setMsg("");
        onSaved(updated);
        return;
      }

      // Só o título mudou — atualiza localmente.
      setSaveState("idle");
      setMsg("");
      onSaved({ ...cut, title: newTitle });
    } catch (e) {
      setSaveState("error");
      setMsg(e instanceof Error ? e.message : "Erro ao salvar");
    }
  }

  return (
    <div style={{ animation: "dj-fadeUp .4s ease" }} data-anim>
      {/* ===== Topbar ===== */}
      <div className="dj-editor-topbar" style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 26 }}>
        <div
          onClick={saving ? undefined : onBack}
          style={{
            width: 40,
            height: 40,
            borderRadius: 10,
            background: theme.surface,
            border: `1px solid ${theme.borderStrong}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: saving ? "default" : "pointer",
            opacity: saving ? 0.5 : 1,
            color: theme.textSecondary,
          }}
        >
          ←
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12, color: theme.textMuted }}>
            Editando corte{setName ? ` · ${setName}` : ""}
          </div>
          <div style={{ font: `500 20px ${font.display}` }}>{cut.title}</div>
        </div>
        <div style={{ ...btnGhost, opacity: saving ? 0.5 : 1 }} onClick={() => setVideoReload((n) => n + 1)}>
          Pré-visualizar
        </div>
        <div
          onClick={handleSave}
          style={{
            ...btnPrimary,
            opacity: saving || !dirty ? 0.55 : 1,
            cursor: saving || !dirty ? "default" : "pointer",
          }}
        >
          {saving ? "Salvando..." : "Salvar corte"}
        </div>
      </div>

      {msg && (
        <div
          style={{
            marginBottom: 18,
            padding: "10px 14px",
            borderRadius: 10,
            fontSize: 13,
            background: saveState === "error" ? "#fef2f2" : theme.accentSoft,
            color: saveState === "error" ? "#dc2626" : theme.accent,
            border: `1px solid ${saveState === "error" ? "#fecaca" : theme.accentBorder}`,
          }}
        >
          {msg}
        </div>
      )}

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
              background: "#000",
            }}
          >
            <video
              key={`${cut.url}-${videoReload}`}
              src={cut.url}
              controls
              playsInline
              preload="metadata"
              style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", background: "#000" }}
            />
            {/* Sobreposição da legenda (ainda mock; edição de legenda fora de escopo). */}
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
                pointerEvents: "none",
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
            {saving && trimChanged && (
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  background: "rgba(0,0,0,.55)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#fff",
                  fontSize: 14,
                  textAlign: "center",
                  padding: 20,
                }}
              >
                Regenerando o vídeo com o novo trecho...
              </div>
            )}
          </div>
          <div style={{ fontSize: 11, color: theme.textMuted, textAlign: "center" }}>
            ajuste início e fim ao lado · o vídeo é recortado ao salvar
          </div>
        </div>

        {/* panel */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div>
            <div style={{ fontSize: 12, color: theme.textMuted, marginBottom: 7 }}>Título do corte</div>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={saving}
              maxLength={120}
              placeholder="Nome do corte"
              style={{
                width: "100%",
                padding: "12px 14px",
                borderRadius: 10,
                background: theme.surface,
                border: `1px solid ${theme.borderStrong}`,
                // 16px evita zoom no iOS ao focar.
                fontSize: 16,
                color: theme.textPrimary,
                fontFamily: font.body,
              }}
            />
          </div>

          {/* Tempo */}
          <div style={{ borderRadius: 13, background: theme.surface, border: `1px solid ${theme.border}`, overflow: "hidden" }}>
            <div style={{ padding: "13px 16px", font: `500 14px ${font.display}`, borderBottom: `1px solid ${theme.borderHairline}` }}>
              Tempo
            </div>
            <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: theme.textTertiary }}>
                <span>Trecho selecionado</span>
                <span style={{ color: theme.accent }}>
                  {formatTimecode(start)} → {formatTimecode(end)}
                </span>
              </div>

              <TrimRow
                label="Início"
                value={formatTimecode(start)}
                disabled={saving}
                onNudge={nudgeStart}
              />
              <TrimRow
                label="Fim"
                value={formatTimecode(end)}
                disabled={saving}
                onNudge={nudgeEnd}
              />

              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 13, color: theme.textTertiary }}>Duração</span>
                <span style={{ marginLeft: "auto", fontSize: 13, color: theme.textMuted }}>
                  {(end - start).toFixed(1)}s
                </span>
              </div>
            </div>
          </div>

          {/* Legendas (visual; edição de legenda fora de escopo) */}
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
              <span style={{ fontSize: 12, color: theme.textMuted }}>em breve</span>
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
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function TrimRow({
  label,
  value,
  disabled,
  onNudge,
}: {
  label: string;
  value: string;
  disabled: boolean;
  onNudge: (delta: number) => void;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <span style={{ fontSize: 13, color: theme.textTertiary, width: 50 }}>{label}</span>
      <NudgeBtn disabled={disabled} onClick={() => onNudge(-5)}>−5s</NudgeBtn>
      <NudgeBtn disabled={disabled} onClick={() => onNudge(-0.5)}>−0.5s</NudgeBtn>
      <span style={{ minWidth: 64, textAlign: "center", font: `500 14px ${font.display}`, color: theme.textPrimary }}>
        {value}
      </span>
      <NudgeBtn disabled={disabled} onClick={() => onNudge(0.5)}>+0.5s</NudgeBtn>
      <NudgeBtn disabled={disabled} onClick={() => onNudge(5)}>+5s</NudgeBtn>
    </div>
  );
}

function NudgeBtn({
  children,
  disabled,
  onClick,
}: {
  children: React.ReactNode;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      style={{
        padding: "6px 11px",
        borderRadius: 8,
        background: theme.surface,
        border: `1px solid ${theme.borderStrong}`,
        fontSize: 13,
        color: theme.textSecondary,
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.5 : 1,
        fontFamily: font.body,
      }}
    >
      {children}
    </button>
  );
}
