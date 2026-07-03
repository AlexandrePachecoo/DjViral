"use client";

import { useEffect, useRef, useState } from "react";
import { theme, font, scoreColor, btnPrimary } from "./theme";
import { type Cut } from "./data";
import { type ApiCut, toStudioCut, downloadUrl } from "./cut";

// Fases do fluxo do Gerador: formulário de upload → envio → processamento →
// cortes prontos (seleção/salvar) ou erro.
type Phase = "form" | "uploading" | "processing" | "done" | "error";

type Props = {
  // Recarrega a aba "Cortes salvos" depois que o usuário salva cortes.
  onSaved: () => void;
};

export function GeneratorView({ onSaved }: Props) {
  const [phase, setPhase] = useState<Phase>("form");
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [message, setMessage] = useState("");
  const [projectId, setProjectId] = useState<string | null>(null);
  const [cuts, setCuts] = useState<Cut[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Polling do status enquanto o worker processa (mesmo padrão do MVP).
  useEffect(() => {
    if (!projectId || phase !== "processing") return;
    pollRef.current = setInterval(async () => {
      const res = await fetch(`/api/projects/${projectId}`);
      if (!res.ok) return;
      const data = await res.json();
      if (data.status === "done") {
        const apiCuts: ApiCut[] = data.cuts ?? [];
        setCuts(apiCuts.map(toStudioCut));
        setPhase("done");
      } else if (data.status === "error") {
        setPhase("error");
        setMessage("O processamento falhou. Confira os logs do worker.");
      }
    }, 5000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [projectId, phase]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name || !file) return;
    try {
      // 1. Cria projeto + signed upload URL.
      setPhase("uploading");
      setMessage("Criando projeto...");
      const createRes = await fetch("/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, filename: file.name }),
      });
      if (!createRes.ok) throw new Error((await createRes.json()).error);
      const { project_id, signedUrl } = await createRes.json();
      setProjectId(project_id);

      // 2. Upload direto pro Supabase Storage (não passa pela Vercel).
      setMessage("Enviando vídeo...");
      const upRes = await fetch(signedUrl, {
        method: "PUT",
        headers: { "content-type": file.type || "video/mp4" },
        body: file,
      });
      if (!upRes.ok) {
        const detail = await upRes.text().catch(() => "");
        throw new Error(
          `Falha no upload do vídeo (HTTP ${upRes.status})${detail ? `: ${detail}` : ""}`
        );
      }

      // 3. Dispara o worker.
      setMessage("Analisando o áudio e gerando cortes...");
      setPhase("processing");
      const procRes = await fetch(`/api/projects/${project_id}/process`, {
        method: "POST",
      });
      if (!procRes.ok) throw new Error((await procRes.json()).error);
    } catch (err) {
      setPhase("error");
      setMessage(err instanceof Error ? err.message : "Erro inesperado");
    }
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Ids ainda salváveis (não salvos).
  const savableIds = cuts.filter((c) => !c.saved).map((c) => c.id);
  const allSelected = savableIds.length > 0 && savableIds.every((id) => selected.has(id));

  function toggleSelectAll() {
    setSelected(allSelected ? new Set() : new Set(savableIds));
  }

  async function handleSave() {
    const ids = [...selected].filter((id) => savableIds.includes(id));
    if (ids.length === 0 || !projectId) return;
    setSaving(true);
    setSaveError("");
    try {
      const res = await fetch(`/api/projects/${projectId}/cuts/save`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cutIds: ids }),
      });
      if (!res.ok) throw new Error();
      setCuts((prev) => prev.map((c) => (ids.includes(c.id) ? { ...c, saved: true } : c)));
      setSelected(new Set());
      onSaved();
    } catch {
      setSaveError("Não foi possível salvar. Tente de novo.");
    } finally {
      setSaving(false);
    }
  }

  // ===== Upload / progresso / erro =====
  if (phase !== "done") {
    return (
      <div style={{ animation: "dj-fadeUp .4s ease" }} data-anim>
        <UploadForm
          phase={phase}
          name={name}
          file={file}
          message={message}
          onName={setName}
          onFile={setFile}
          onSubmit={handleSubmit}
          onRetry={() => {
            setPhase("form");
            setMessage("");
          }}
        />
      </div>
    );
  }

  // ===== Cortes gerados =====
  const savedCount = cuts.filter((c) => c.saved).length;

  return (
    <div style={{ animation: "dj-fadeUp .4s ease" }} data-anim>
      {/* Toolbar */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          marginBottom: 22,
          flexWrap: "wrap",
          gap: 14,
        }}
      >
        <div>
          <div style={{ font: `500 24px ${font.display}`, letterSpacing: "-.01em" }}>
            {cuts.length} cortes gerados
          </div>
          <div style={{ color: theme.textMuted, fontSize: 13, marginTop: 4 }}>
            {savableIds.length > 0
              ? "selecione os que quer salvar — os não salvos somem ao recarregar"
              : "todos os cortes foram salvos"}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={toggleSelectAll}
            disabled={savableIds.length === 0}
            style={{
              ...ghostBtn,
              opacity: savableIds.length === 0 ? 0.5 : 1,
              cursor: savableIds.length === 0 ? "default" : "pointer",
            }}
          >
            {allSelected ? "Limpar seleção" : "Selecionar todos"}
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || selected.size === 0}
            style={{
              ...btnPrimary,
              padding: "9px 18px",
              opacity: saving || selected.size === 0 ? 0.5 : 1,
              cursor: saving || selected.size === 0 ? "default" : "pointer",
            }}
          >
            {saving ? "Salvando..." : `Salvar selecionados${selected.size ? ` (${selected.size})` : ""}`}
          </button>
        </div>
      </div>

      {saveError && (
        <div style={{ fontSize: 13, color: "#dc2626", marginBottom: 18 }}>{saveError}</div>
      )}

      {savedCount > 0 && (
        <div style={{ fontSize: 13, color: "#059669", marginBottom: 18 }}>
          ✓ {savedCount} corte{savedCount > 1 ? "s" : ""} salvo{savedCount > 1 ? "s" : ""} · disponíve{savedCount > 1 ? "is" : "l"} na aba Cortes salvos
        </div>
      )}

      {/* Grade de cortes */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill,minmax(248px,1fr))",
          gap: 22,
        }}
      >
        {cuts.map((c) => {
          const isSelected = selected.has(c.id);
          return (
            <div
              key={c.id}
              style={{
                border: `1px solid ${isSelected ? theme.accentBorder : theme.border}`,
                borderRadius: 14,
                overflow: "hidden",
                background: theme.surface,
                boxShadow: isSelected ? `0 0 0 2px ${theme.accentBorder}` : "none",
              }}
            >
              <div style={{ position: "relative", background: "#000" }}>
                <video
                  src={c.url}
                  controls
                  playsInline
                  preload="metadata"
                  style={{ width: "100%", height: 300, objectFit: "cover", display: "block", background: "#000" }}
                />
                {/* Seleção (canto superior esquerdo) */}
                {c.saved ? (
                  <div
                    style={{
                      position: "absolute",
                      top: 13,
                      left: 13,
                      display: "flex",
                      alignItems: "center",
                      gap: 5,
                      padding: "4px 9px",
                      borderRadius: 20,
                      fontSize: 11,
                      background: "#ecfdf5",
                      color: "#059669",
                      border: "1px solid #a7f3d0",
                    }}
                  >
                    ✓ Salvo
                  </div>
                ) : (
                  <div
                    onClick={() => toggle(c.id)}
                    role="checkbox"
                    aria-checked={isSelected}
                    aria-label={`Selecionar ${c.title}`}
                    style={{
                      position: "absolute",
                      top: 13,
                      left: 13,
                      width: 26,
                      height: 26,
                      borderRadius: 7,
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "#fff",
                      fontSize: 15,
                      background: isSelected ? theme.accent : "rgba(0,0,0,.45)",
                      border: `1.5px solid ${isSelected ? theme.accent : "rgba(255,255,255,.8)"}`,
                    }}
                  >
                    {isSelected ? "✓" : ""}
                  </div>
                )}
                <div
                  style={{
                    position: "absolute",
                    top: 13,
                    right: 14,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "flex-end",
                    lineHeight: 1,
                    padding: "4px 7px",
                    borderRadius: 8,
                    background: "rgba(255,255,255,.85)",
                    pointerEvents: "none",
                  }}
                >
                  <span style={{ font: `600 18px ${font.display}`, color: scoreColor(c.score) }}>{c.score}</span>
                  <span style={{ fontSize: 9, letterSpacing: ".08em", color: theme.textMuted, marginTop: 2 }}>SCORE</span>
                </div>
              </div>
              <div style={{ padding: 15 }}>
                <div style={{ font: `500 15px ${font.display}`, marginBottom: 2 }}>{c.title}</div>
                <div style={{ fontSize: 12, color: theme.textMuted, marginBottom: 14 }}>
                  {c.dur} · no set · {c.moment}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 7 }}>
                  {c.saved ? (
                    <div style={{ ...ghostBtn, textAlign: "center", opacity: 0.6, cursor: "default" }}>Salvo ✓</div>
                  ) : (
                    <div
                      onClick={() => toggle(c.id)}
                      style={{
                        ...ghostBtn,
                        textAlign: "center",
                        cursor: "pointer",
                        color: isSelected ? theme.accent : theme.textSecondary,
                        borderColor: isSelected ? theme.accentBorder : theme.borderStrong,
                        background: isSelected ? theme.accentSoft : theme.surface,
                      }}
                    >
                      {isSelected ? "Selecionado" : "Selecionar"}
                    </div>
                  )}
                  <a href={downloadUrl(c)} target="_blank" rel="noopener" style={{ ...ghostBtn, textAlign: "center", textDecoration: "none" }}>
                    Baixar
                  </a>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const ghostBtn: React.CSSProperties = {
  display: "block",
  padding: 9,
  borderRadius: 8,
  fontSize: 13,
  color: theme.textSecondary,
  background: theme.surface,
  border: `1px solid ${theme.borderStrong}`,
};

// ===== Formulário de upload + progresso =====
function UploadForm({
  phase,
  name,
  file,
  message,
  onName,
  onFile,
  onSubmit,
  onRetry,
}: {
  phase: Phase;
  name: string;
  file: File | null;
  message: string;
  onName: (v: string) => void;
  onFile: (f: File | null) => void;
  onSubmit: (e: React.FormEvent) => void;
  onRetry: () => void;
}) {
  const busy = phase === "uploading" || phase === "processing";

  return (
    <div
      style={{
        maxWidth: 560,
        margin: "0 auto",
        padding: "34px 30px",
        borderRadius: 16,
        background: theme.surface,
        border: `1px solid ${theme.border}`,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 8 }}>
        <div
          style={{
            width: 48,
            height: 48,
            borderRadius: 12,
            background: theme.accentSoft,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 22,
            flexShrink: 0,
          }}
        >
          🎧
        </div>
        <div>
          <div style={{ font: `500 20px ${font.display}` }}>Novo set</div>
          <div style={{ fontSize: 13, color: theme.textMuted, marginTop: 2 }}>
            Envie seu set e receba os cortes mais virais automaticamente.
          </div>
        </div>
      </div>

      <form onSubmit={onSubmit} style={{ display: "grid", gap: 12, marginTop: 20 }}>
        <input
          placeholder="Nome do set"
          value={name}
          onChange={(e) => onName(e.target.value)}
          disabled={busy}
          style={inputStyle}
        />
        <input
          type="file"
          accept="video/mp4,video/*"
          onChange={(e) => onFile(e.target.files?.[0] ?? null)}
          disabled={busy}
          style={inputStyle}
        />
        <button
          type="submit"
          disabled={busy || !name || !file}
          style={{
            ...btnPrimary,
            justifyContent: "center",
            padding: "12px",
            fontSize: 14,
            opacity: busy || !name || !file ? 0.5 : 1,
            cursor: busy || !name || !file ? "default" : "pointer",
          }}
        >
          {busy ? "Processando..." : "Gerar cortes"}
        </button>
      </form>

      {message && (
        <p
          style={{
            marginTop: 16,
            fontSize: 13,
            color: phase === "error" ? "#dc2626" : theme.accent,
          }}
        >
          {message}
        </p>
      )}

      {phase === "error" && (
        <button type="button" onClick={onRetry} style={{ ...ghostBtn, width: "auto", marginTop: 12, cursor: "pointer" }}>
          Tentar de novo
        </button>
      )}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "12px",
  borderRadius: 9,
  border: `1px solid ${theme.borderStrong}`,
  background: theme.surface,
  color: theme.textPrimary,
  // 16px impede o iOS de dar zoom ao focar o campo.
  fontSize: 16,
};
