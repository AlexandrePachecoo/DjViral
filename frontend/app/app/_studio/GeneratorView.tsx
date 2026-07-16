"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { theme, font, scoreColor, btnPrimary } from "./theme";
import { type Cut } from "./data";
import { type ApiCut, toStudioCut, downloadUrl } from "./cut";

// Fases do fluxo do Gerador: formulário de upload → envio → processamento →
// cortes prontos (seleção/salvar) ou erro.
type Phase = "form" | "uploading" | "processing" | "done" | "error";

// Estilo de corte: 'basic' = corte seco (enquadramento central fixo);
// 'dynamic' = zooms no DJ/público cortados no ritmo da batida.
type CutStyle = "basic" | "dynamic";

// Intensidade do corte dinâmico: 'subtle' = poucas trocas de shot e zooms
// contidos; 'medium' = equilíbrio (padrão); 'intense' = muita troca dj/público
// e zooms fortes na batida. Só usada quando o estilo é 'dynamic'.
type CutIntensity = "subtle" | "medium" | "intense";

type Props = {
  // Recarrega a aba "Cortes salvos" depois que o usuário salva cortes.
  onSaved: () => void;
  // Abre a aba "Plano" quando o usuário estoura a cota e quer fazer upgrade.
  onUpgrade: () => void;
  // Abre um corte na aba Edição (timeline + zoom manual).
  onEdit: (projectId: string, setName: string, cut: Cut) => void;
};

// Duração do vídeo (em segundos) lida dos metadados no navegador, para o
// backend validar a cota do plano antes do upload. null = não deu pra medir
// (o worker ainda valida com a duração real).
function readVideoDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve(Number.isFinite(video.duration) && video.duration > 0 ? video.duration : null);
    };
    video.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    video.src = url;
  });
}

// Faz o PUT do vídeo na signed URL com progresso real. `fetch` não expõe
// progresso de upload, então usamos XMLHttpRequest (`upload.onprogress`) para
// alimentar a barra. Mantém a mesma URL e o mesmo header de hoje.
function uploadWithProgress(
  url: string,
  file: File,
  onProgress: (percent: number) => void,
  t: (key: string, values?: Record<string, string | number>) => string
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("content-type", file.type || "video/mp4");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        const detail = xhr.responseText;
        reject(
          new Error(
            t("errors.uploadFailedStatus", { status: xhr.status }) + (detail ? `: ${detail}` : "")
          )
        );
      }
    };
    xhr.onerror = () => reject(new Error(t("errors.uploadFailedNetwork")));
    xhr.send(file);
  });
}

export function GeneratorView({ onSaved, onUpgrade, onEdit }: Props) {
  const t = useTranslations("studio.generator");
  const [phase, setPhase] = useState<Phase>("form");
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [cutStyle, setCutStyle] = useState<CutStyle>("basic");
  const [cutIntensity, setCutIntensity] = useState<CutIntensity>("medium");
  // Quantidade de cortes desejada e o teto do plano (free=10, pagos=30).
  // Começa em 10 (teto do free) e sobe quando o /api/billing responder.
  const [numCuts, setNumCuts] = useState(10);
  const [maxCuts, setMaxCuts] = useState(10);
  const [message, setMessage] = useState("");
  // Progresso do upload (0-100), alimenta a barra durante a fase "uploading".
  const [uploadProgress, setUploadProgress] = useState(0);
  const [limitHit, setLimitHit] = useState(false);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [cuts, setCuts] = useState<Cut[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Teto de cortes do plano do usuário (mesma fonte da aba Plano). Enquanto
  // não responde, a UI fica no teto do free (10) — só limita, nunca libera
  // além do plano (o backend re-clampa de qualquer forma).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/billing");
        if (!res.ok) return;
        const data = await res.json();
        const planMax = data?.usage?.maxCutsPerSet;
        if (!cancelled && typeof planMax === "number" && planMax > 0) {
          setMaxCuts(planMax);
          setNumCuts(planMax);
        }
      } catch {
        // segue com o default de 10
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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
        setMessage(t("errors.processingFailed"));
      }
    }, 5000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [projectId, phase]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name || !file) return;
    setLimitHit(false);
    setUploadProgress(0);
    try {
      // 1. Cria projeto + signed upload URL. A duração (metadados do arquivo)
      // vai junto para o backend validar a cota de horas do plano.
      setPhase("uploading");
      setMessage(t("status.creatingProject"));
      const duration = await readVideoDuration(file);
      const createRes = await fetch("/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name,
          filename: file.name,
          duration_seconds: duration,
          size_bytes: file.size,
          cut_style: cutStyle,
          cut_intensity: cutIntensity,
          max_cuts: numCuts,
        }),
      });
      if (!createRes.ok) {
        const data = await createRes.json();
        if (data.code === "plan_limit") setLimitHit(true);
        throw new Error(data.error);
      }
      const { project_id, signedUrl } = await createRes.json();
      setProjectId(project_id);

      // 2. Upload direto pro Supabase Storage (não passa pela Vercel), com
      // progresso real via XMLHttpRequest (alimenta a barra na UI).
      setMessage(t("status.uploadingVideo"));
      await uploadWithProgress(signedUrl, file, setUploadProgress, t);
      setUploadProgress(100);

      // 3. Dispara o worker.
      setMessage(t("status.analyzing"));
      setPhase("processing");
      const procRes = await fetch(`/api/projects/${project_id}/process`, {
        method: "POST",
      });
      if (!procRes.ok) {
        const data = await procRes.json();
        if (data.code === "plan_limit") setLimitHit(true);
        throw new Error(data.error);
      }
    } catch (err) {
      setPhase("error");
      setMessage(err instanceof Error ? err.message : t("errors.unexpected"));
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
      setSaveError(t("errors.saveFailed"));
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
          uploadProgress={uploadProgress}
          limitHit={limitHit}
          cutStyle={cutStyle}
          cutIntensity={cutIntensity}
          numCuts={numCuts}
          maxCuts={maxCuts}
          onName={setName}
          onFile={setFile}
          onCutStyle={setCutStyle}
          onCutIntensity={setCutIntensity}
          onNumCuts={setNumCuts}
          onSubmit={handleSubmit}
          onUpgrade={onUpgrade}
          onRetry={() => {
            setPhase("form");
            setMessage("");
            setLimitHit(false);
            setUploadProgress(0);
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
            {t("cutsGenerated", { count: cuts.length })}
          </div>
          <div style={{ color: theme.textMuted, fontSize: 13, marginTop: 4 }}>
            {savableIds.length > 0 ? t("selectHint") : t("allSaved")}
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
            {allSelected ? t("clearSelection") : t("selectAll")}
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
            {saving ? t("saving") : t("saveSelected", { count: selected.size })}
          </button>
        </div>
      </div>

      {saveError && (
        <div style={{ fontSize: 13, color: "#dc2626", marginBottom: 18 }}>{saveError}</div>
      )}

      {savedCount > 0 && (
        <div style={{ fontSize: 13, color: "#059669", marginBottom: 18 }}>
          {t("savedInTab", { count: savedCount })}
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
                    {t("savedBadge")}
                  </div>
                ) : (
                  <div
                    onClick={() => toggle(c.id)}
                    role="checkbox"
                    aria-checked={isSelected}
                    aria-label={t("selectAria", { title: c.title })}
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
                  {c.dur} · {t("inSet")} · {c.moment}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 7 }}>
                  {c.saved ? (
                    <div style={{ ...ghostBtn, textAlign: "center", opacity: 0.6, cursor: "default" }}>{t("savedCheck")}</div>
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
                      {isSelected ? t("selected") : t("select")}
                    </div>
                  )}
                  <div
                    onClick={() => projectId && onEdit(projectId, name, c)}
                    style={{ ...ghostBtn, textAlign: "center", cursor: "pointer" }}
                  >
                    {t("edit")}
                  </div>
                  <a href={downloadUrl(c)} target="_blank" rel="noopener" style={{ ...ghostBtn, textAlign: "center", textDecoration: "none" }}>
                    {t("download")}
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
  uploadProgress,
  limitHit,
  cutStyle,
  cutIntensity,
  numCuts,
  maxCuts,
  onName,
  onFile,
  onCutStyle,
  onCutIntensity,
  onNumCuts,
  onSubmit,
  onUpgrade,
  onRetry,
}: {
  phase: Phase;
  name: string;
  file: File | null;
  message: string;
  uploadProgress: number;
  limitHit: boolean;
  cutStyle: CutStyle;
  cutIntensity: CutIntensity;
  numCuts: number;
  maxCuts: number;
  onName: (v: string) => void;
  onFile: (f: File | null) => void;
  onCutStyle: (s: CutStyle) => void;
  onCutIntensity: (s: CutIntensity) => void;
  onNumCuts: (n: number) => void;
  onSubmit: (e: React.FormEvent) => void;
  onUpgrade: () => void;
  onRetry: () => void;
}) {
  const t = useTranslations("studio.generator");
  const busy = phase === "uploading" || phase === "processing";

  const styleOptions: { id: CutStyle; title: string; desc: string }[] = [
    {
      id: "basic",
      title: t("form.style.basic.title"),
      desc: t("form.style.basic.desc"),
    },
    {
      id: "dynamic",
      title: t("form.style.dynamic.title"),
      desc: t("form.style.dynamic.desc"),
    },
  ];

  const intensityOptions: { id: CutIntensity; title: string; desc: string }[] = [
    { id: "subtle", title: t("form.intensity.subtle.title"), desc: t("form.intensity.subtle.desc") },
    { id: "medium", title: t("form.intensity.medium.title"), desc: t("form.intensity.medium.desc") },
    { id: "intense", title: t("form.intensity.intense.title"), desc: t("form.intensity.intense.desc") },
  ];

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
          <div style={{ font: `500 20px ${font.display}` }}>{t("form.title")}</div>
          <div style={{ fontSize: 13, color: theme.textMuted, marginTop: 2 }}>
            {t("form.subtitle")}
          </div>
        </div>
      </div>

      <form onSubmit={onSubmit} style={{ display: "grid", gap: 12, marginTop: 20 }}>
        <input
          placeholder={t("form.namePlaceholder")}
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

        {/* Estilo de corte */}
        <div>
          <div style={fieldLabel}>{t("form.styleLabel")}</div>
          <div
            className="dj-style-grid"
            role="radiogroup"
            aria-label={t("form.styleLabel")}
            style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}
          >
            {styleOptions.map((opt) => {
              const active = cutStyle === opt.id;
              return (
                <div
                  key={opt.id}
                  role="radio"
                  aria-checked={active}
                  tabIndex={busy ? -1 : 0}
                  onClick={() => !busy && onCutStyle(opt.id)}
                  onKeyDown={(e) => {
                    if (!busy && (e.key === "Enter" || e.key === " ")) {
                      e.preventDefault();
                      onCutStyle(opt.id);
                    }
                  }}
                  style={{
                    padding: "12px 13px",
                    borderRadius: 10,
                    cursor: busy ? "default" : "pointer",
                    opacity: busy ? 0.6 : 1,
                    background: active ? theme.accentSoft : theme.surface,
                    border: `1px solid ${active ? theme.accentBorder : theme.borderStrong}`,
                    boxShadow: active ? `0 0 0 1px ${theme.accentBorder}` : "none",
                  }}
                >
                  <div
                    style={{
                      font: `500 14px ${font.display}`,
                      color: active ? theme.accent : theme.textPrimary,
                      marginBottom: 3,
                    }}
                  >
                    {opt.title}
                  </div>
                  <div style={{ fontSize: 12, color: theme.textMuted, lineHeight: 1.4 }}>
                    {opt.desc}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Intensidade do corte dinâmico (só quando o estilo é dinâmico) */}
        {cutStyle === "dynamic" && (
          <div>
            <div style={fieldLabel}>{t("form.intensityLabel")}</div>
            <div
              className="dj-style-grid"
              role="radiogroup"
              aria-label={t("form.intensityAria")}
              style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}
            >
              {intensityOptions.map((opt) => {
                const active = cutIntensity === opt.id;
                return (
                  <div
                    key={opt.id}
                    role="radio"
                    aria-checked={active}
                    tabIndex={busy ? -1 : 0}
                    onClick={() => !busy && onCutIntensity(opt.id)}
                    onKeyDown={(e) => {
                      if (!busy && (e.key === "Enter" || e.key === " ")) {
                        e.preventDefault();
                        onCutIntensity(opt.id);
                      }
                    }}
                    style={{
                      padding: "12px 13px",
                      borderRadius: 10,
                      cursor: busy ? "default" : "pointer",
                      opacity: busy ? 0.6 : 1,
                      background: active ? theme.accentSoft : theme.surface,
                      border: `1px solid ${active ? theme.accentBorder : theme.borderStrong}`,
                      boxShadow: active ? `0 0 0 1px ${theme.accentBorder}` : "none",
                    }}
                  >
                    <div
                      style={{
                        font: `500 14px ${font.display}`,
                        color: active ? theme.accent : theme.textPrimary,
                        marginBottom: 3,
                      }}
                    >
                      {opt.title}
                    </div>
                    <div style={{ fontSize: 12, color: theme.textMuted, lineHeight: 1.4 }}>
                      {opt.desc}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Quantidade de cortes */}
        <div>
          <div style={{ ...fieldLabel, display: "flex", justifyContent: "space-between" }}>
            <span>{t("form.numCutsLabel")}</span>
            <span style={{ color: theme.accent, fontWeight: 600 }}>{numCuts}</span>
          </div>
          <input
            type="range"
            min={1}
            max={maxCuts}
            value={Math.min(numCuts, maxCuts)}
            onChange={(e) => onNumCuts(Number(e.target.value))}
            disabled={busy}
            aria-label={t("form.numCutsLabel")}
            style={{ width: "100%", accentColor: theme.accent }}
          />
          <div style={{ fontSize: 12, color: theme.textMuted, marginTop: 4 }}>
            {t("form.planAllows", { max: maxCuts })}{" "}
            {maxCuts < 30 && (
              <span
                onClick={onUpgrade}
                style={{ color: theme.accent, cursor: "pointer", textDecoration: "underline" }}
              >
                {t("form.seePlans")}
              </span>
            )}
          </div>
        </div>

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
          {busy ? t("form.processing") : t("form.generate")}
        </button>
      </form>

      {/* Indicador de carregamento (ondas do equalizador, iguais à logo) +
          barra de progresso do upload. */}
      {busy && (
        <div style={{ marginTop: 18 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <EqWaves />
            <span style={{ fontSize: 13, color: theme.accent }}>{message}</span>
          </div>

          {phase === "uploading" && (
            <div style={{ marginTop: 14 }}>
              <div
                style={{
                  height: 8,
                  borderRadius: 20,
                  background: theme.border,
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    height: "100%",
                    width: `${uploadProgress}%`,
                    background: theme.accent,
                    borderRadius: 20,
                    transition: "width .2s ease",
                  }}
                />
              </div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  marginTop: 7,
                  fontSize: 12,
                  color: theme.textMuted,
                }}
              >
                <span>{t("form.uploadHint")}</span>
                <span style={{ color: theme.accent, fontWeight: 600 }}>{uploadProgress}%</span>
              </div>
            </div>
          )}
        </div>
      )}

      {message && !busy && (
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
        <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
          {limitHit && (
            <button
              type="button"
              onClick={onUpgrade}
              style={{ ...btnPrimary, padding: "9px 16px", cursor: "pointer" }}
            >
              {t("form.seePlans")}
            </button>
          )}
          <button type="button" onClick={onRetry} style={{ ...ghostBtn, width: "auto", cursor: "pointer" }}>
            {t("form.tryAgain")}
          </button>
        </div>
      )}
    </div>
  );
}

// Ondas sonoras animadas (mesmo primitivo `.dj-eqbar`/`dj-eq` da logo) usadas
// como indicador de carregamento — em vez de um spinner.
function EqWaves() {
  const bars = [0.5, 0.7, 1, 0.75, 0.55];
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 22 }}>
      {bars.map((h, i) => (
        <span
          key={i}
          className="dj-eqbar"
          data-anim
          style={{ height: `${h * 22}px`, animationDelay: `${i * 0.15}s` }}
        />
      ))}
    </div>
  );
}

const fieldLabel: React.CSSProperties = {
  fontSize: 13,
  color: theme.textSecondary,
  marginBottom: 7,
};

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
