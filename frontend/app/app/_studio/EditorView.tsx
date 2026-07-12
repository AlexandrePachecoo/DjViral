"use client";

// Editor visual de um corte: timeline sobre o SET ORIGINAL (o usuário pode
// encurtar/estender o trecho além do que a IA escolheu), preview do vídeo no
// tamanho original com a janela 9:16 (TikTok) sobreposta e arrastável, zoom
// livre e keyframes de câmera (pan + zoom interpolados com easing — o mesmo
// smoothstep que o worker usa no render, ver backend/app/clipper.py).
//
// Salvar dispara POST /recut com {inicio, fim, keyframes}; o worker regenera o
// vídeo com a direção manual e persiste os keyframes em `cuts.crop_keyframes`.

import { useEffect, useMemo, useRef, useState } from "react";
import { theme, font, btnPrimary, btnGhost } from "./theme";
import { type Cut } from "./data";
import {
  type ApiCut,
  type CropKeyframe,
  formatTimecode,
  toStudioCut,
} from "./cut";

type Props = {
  cut: Cut;
  setName: string;
  projectId: string;
  onBack: () => void;
  onSaved: (cut: Cut) => void;
};

type SaveState = "idle" | "saving" | "error";

type SourceInfo = {
  url: string | null; // signed URL do vídeo original (null = YouTube/indisponível)
  duration: number | null;
};

const MIN_DUR = 3; // duração mínima do corte (s)
const MAX_DUR = 180; // duração máxima do corte (s)
const ZOOM_MAX = 4;
const KF_EPS = 0.2; // keyframe "no playhead" dentro desta tolerância (s)

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

// Mesmo easing do worker (clipper._smoothstep): a pré-visualização da câmera
// no editor bate com o render final.
function smoothstep(f: number): number {
  return f * f * (3 - 2 * f);
}

type CropState = { cx: number; cy: number; zoom: number };

// Interpola a câmera nos keyframes (t ABSOLUTO no set), segurando as pontas.
function cropAt(kfs: CropKeyframe[], t: number): CropState {
  if (kfs.length === 0) return { cx: 0.5, cy: 0.5, zoom: 1 };
  if (t <= kfs[0].t) return { cx: kfs[0].cx, cy: kfs[0].cy, zoom: kfs[0].zoom };
  const last = kfs[kfs.length - 1];
  if (t >= last.t) return { cx: last.cx, cy: last.cy, zoom: last.zoom };
  for (let i = 1; i < kfs.length; i++) {
    if (t <= kfs[i].t) {
      const a = kfs[i - 1];
      const b = kfs[i];
      const span = Math.max(1e-6, b.t - a.t);
      const e = smoothstep(clamp((t - a.t) / span, 0, 1));
      return {
        cx: a.cx + (b.cx - a.cx) * e,
        cy: a.cy + (b.cy - a.cy) * e,
        zoom: a.zoom + (b.zoom - a.zoom) * e,
      };
    }
  }
  return { cx: last.cx, cy: last.cy, zoom: last.zoom };
}

// Retângulo da janela 9:16 em PIXELS da fonte, com o centro clampado para a
// janela caber no frame (mesma regra do worker).
function cropRect(crop: CropState, vw: number, vh: number) {
  const baseW = Math.min(vw, (vh * 9) / 16);
  const w = baseW / crop.zoom;
  const h = (w * 16) / 9;
  const cx = clamp(crop.cx * vw, w / 2, vw - w / 2);
  const cy = clamp(crop.cy * vh, h / 2, vh - h / 2);
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

function sameKfs(a: CropKeyframe[], b: CropKeyframe[]): boolean {
  if (a.length !== b.length) return false;
  return a.every(
    (k, i) =>
      Math.abs(k.t - b[i].t) < 0.01 &&
      Math.abs(k.cx - b[i].cx) < 0.001 &&
      Math.abs(k.cy - b[i].cy) < 0.001 &&
      Math.abs(k.zoom - b[i].zoom) < 0.001
  );
}

export function EditorView({ cut, setName, projectId, onBack, onSaved }: Props) {
  const [title, setTitle] = useState(cut.title);
  const [start, setStart] = useState(cut.startSec);
  const [end, setEnd] = useState(cut.endSec);
  // Keyframes com t ABSOLUTO (segundos no set) — convertidos para relativo ao
  // salvar. Assim mudar o início do corte não "desloca" a câmera do conteúdo.
  const [kfs, setKfs] = useState<CropKeyframe[]>([]);
  const [initialKfs, setInitialKfs] = useState<CropKeyframe[]>([]);
  const [source, setSource] = useState<SourceInfo | null>(null); // null = carregando
  const [vidDims, setVidDims] = useState<{ w: number; h: number } | null>(null);
  const [curT, setCurT] = useState(cut.startSec);
  const [playing, setPlaying] = useState(false);
  const [view, setView] = useState<{ v0: number; v1: number } | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [msg, setMsg] = useState("");

  const videoRef = useRef<HTMLVideoElement>(null);
  const pvRef = useRef<HTMLVideoElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const tlRef = useRef<HTMLDivElement>(null);
  // Drag em andamento: offset do agarre da janela 9:16 (frações da fonte) ou
  // o alvo do drag na timeline.
  const boxDrag = useRef<{ dx: number; dy: number } | null>(null);
  const tlDrag = useRef<"start" | "end" | "scrub" | null>(null);

  const saving = saveState === "saving";

  // ===== Carrega o vídeo original (signed URL) + keyframes salvos =====
  useEffect(() => {
    let cancelled = false;
    setSource(null);
    setVidDims(null);
    setKfs([]);
    setInitialKfs([]);
    setView(null);
    setTitle(cut.title);
    setStart(cut.startSec);
    setEnd(cut.endSec);
    setCurT(cut.startSec);
    setSaveState("idle");
    setMsg("");
    (async () => {
      let src: SourceInfo = { url: null, duration: null };
      let loaded: CropKeyframe[] = [];
      try {
        const [srcRes, cutRes] = await Promise.all([
          fetch(`/api/projects/${projectId}/source`),
          fetch(`/api/projects/${projectId}/cuts/${cut.id}`),
        ]);
        if (srcRes.ok) {
          const d = await srcRes.json();
          src = { url: d.url ?? null, duration: d.duration ?? null };
        }
        if (cutRes.ok) {
          const d = await cutRes.json();
          const raw = d?.cut?.crop_keyframes;
          if (Array.isArray(raw)) {
            loaded = raw
              .filter(
                (k: Record<string, unknown>) =>
                  [k?.t, k?.cx, k?.cy, k?.zoom].every(
                    (v) => typeof v === "number" && Number.isFinite(v)
                  )
              )
              // Persistido relativo ao início do corte → absoluto no set.
              .map((k: CropKeyframe) => ({
                t: k.t + cut.startSec,
                cx: clamp(k.cx, 0, 1),
                cy: clamp(k.cy, 0, 1),
                zoom: clamp(k.zoom, 1, ZOOM_MAX),
              }))
              .sort((a: CropKeyframe, b: CropKeyframe) => a.t - b.t);
          }
        }
      } catch {
        // sem source → o editor degrada para trim-only (aviso na UI).
      }
      if (!cancelled) {
        setSource(src);
        setKfs(loaded);
        setInitialKfs(loaded);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [cut.id, cut.title, cut.startSec, cut.endSec, projectId]);

  // Fim da linha do tempo: duração real do set quando conhecida; senão uma
  // folga generosa após o fim do corte (o worker valida de qualquer forma).
  const maxT = useMemo(() => {
    const d = source?.duration ?? 0;
    return d > 0 ? d : Math.max(end + 300, cut.endSec + 300);
  }, [source, end, cut.endSec]);

  // Janela visível inicial da timeline: o corte ± 1 min.
  useEffect(() => {
    if (source && !view) {
      setView({
        v0: Math.max(0, cut.startSec - 60),
        v1: Math.min(maxT, cut.endSec + 60),
      });
    }
  }, [source, view, cut.startSec, cut.endSec, maxT]);

  const hasSource = !!source?.url;

  // ===== Loop de sincronização (playhead + preview TikTok + loop do trecho) =====
  useEffect(() => {
    if (!hasSource) return;
    let raf = 0;
    const tick = () => {
      const v = videoRef.current;
      if (v) {
        const t = v.currentTime;
        // Reproduz em loop dentro do trecho selecionado.
        if (!v.paused && t >= end - 0.02) v.currentTime = start;
        setCurT(v.currentTime);
        setPlaying(!v.paused);
        const pv = pvRef.current;
        if (pv) {
          if (Math.abs(pv.currentTime - v.currentTime) > 0.25) {
            pv.currentTime = v.currentTime;
          }
          if (v.paused && !pv.paused) pv.pause();
          if (!v.paused && pv.paused) pv.play().catch(() => {});
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [hasSource, start, end]);

  function seek(t: number) {
    const v = videoRef.current;
    const nt = clamp(t, 0, Math.max(0, maxT - 0.05));
    if (v) v.currentTime = nt;
    setCurT(nt);
  }

  function togglePlay() {
    const v = videoRef.current;
    if (!v || saving) return;
    if (v.paused) {
      if (v.currentTime < start - 0.05 || v.currentTime > end - 0.1) {
        v.currentTime = start;
      }
      v.play().catch(() => {});
    } else {
      v.pause();
    }
  }

  // ===== Keyframes =====
  const crop = useMemo(() => cropAt(kfs, curT), [kfs, curT]);
  const activeKf = useMemo(
    () => kfs.findIndex((k) => Math.abs(k.t - curT) < KF_EPS),
    [kfs, curT]
  );

  // Edita (ou cria) o keyframe no playhead com os valores atuais da câmera.
  function updateKfAtPlayhead(patch: Partial<CropState>) {
    setKfs((prev) => {
      const i = prev.findIndex((k) => Math.abs(k.t - curT) < KF_EPS);
      if (i !== -1) {
        return prev.map((k, j) =>
          j === i
            ? {
                ...k,
                ...patch,
                cx: clamp(patch.cx ?? k.cx, 0, 1),
                cy: clamp(patch.cy ?? k.cy, 0, 1),
                zoom: clamp(patch.zoom ?? k.zoom, 1, ZOOM_MAX),
              }
            : k
        );
      }
      const c = cropAt(prev, curT);
      const nk: CropKeyframe = {
        t: Math.round(curT * 100) / 100,
        cx: clamp(patch.cx ?? c.cx, 0, 1),
        cy: clamp(patch.cy ?? c.cy, 0, 1),
        zoom: clamp(patch.zoom ?? c.zoom, 1, ZOOM_MAX),
      };
      return [...prev, nk].sort((a, b) => a.t - b.t);
    });
  }

  function removeKf(idx: number) {
    setKfs((prev) => prev.filter((_, i) => i !== idx));
  }

  // ===== Drag da janela 9:16 sobre o vídeo original =====
  function stageFrac(e: React.PointerEvent): { px: number; py: number } {
    const rect = stageRef.current!.getBoundingClientRect();
    return {
      px: clamp((e.clientX - rect.left) / rect.width, 0, 1),
      py: clamp((e.clientY - rect.top) / rect.height, 0, 1),
    };
  }

  function onBoxDown(e: React.PointerEvent<HTMLDivElement>) {
    if (!vidDims || saving) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    videoRef.current?.pause();
    const { px, py } = stageFrac(e);
    const r = cropRect(crop, vidDims.w, vidDims.h);
    boxDrag.current = {
      dx: px - (r.x + r.w / 2) / vidDims.w,
      dy: py - (r.y + r.h / 2) / vidDims.h,
    };
  }

  function onBoxMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!boxDrag.current || !vidDims) return;
    const { px, py } = stageFrac(e);
    updateKfAtPlayhead({
      cx: clamp(px - boxDrag.current.dx, 0, 1),
      cy: clamp(py - boxDrag.current.dy, 0, 1),
    });
  }

  function onBoxUp(e: React.PointerEvent<HTMLDivElement>) {
    boxDrag.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
  }

  // ===== Timeline =====
  function tlTime(e: React.PointerEvent): number {
    const rect = tlRef.current!.getBoundingClientRect();
    const f = clamp((e.clientX - rect.left) / rect.width, 0, 1);
    const v = view ?? { v0: 0, v1: maxT };
    return v.v0 + f * (v.v1 - v.v0);
  }

  function onTlDown(e: React.PointerEvent<HTMLDivElement>) {
    if (saving || !view) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    videoRef.current?.pause();
    const t = tlTime(e);
    // Perto de um handle (em px) pega o handle; senão faz scrub do playhead.
    const rect = tlRef.current!.getBoundingClientRect();
    const pxPerSec = rect.width / (view.v1 - view.v0);
    const dStart = Math.abs(t - start) * pxPerSec;
    const dEnd = Math.abs(t - end) * pxPerSec;
    if (dStart < 12 && dStart <= dEnd) tlDrag.current = "start";
    else if (dEnd < 12) tlDrag.current = "end";
    else {
      tlDrag.current = "scrub";
      seek(t);
    }
    onTlMove(e);
  }

  function onTlMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!tlDrag.current) return;
    const t = tlTime(e);
    if (tlDrag.current === "scrub") {
      seek(t);
    } else if (tlDrag.current === "start") {
      const ns = clamp(t, Math.max(0, end - MAX_DUR), end - MIN_DUR);
      setStart(ns);
      seek(ns); // mostra o frame onde o corte vai começar
    } else {
      const ne = clamp(t, start + MIN_DUR, Math.min(maxT, start + MAX_DUR));
      setEnd(ne);
      seek(ne); // mostra o frame onde o corte vai terminar
    }
  }

  function onTlUp(e: React.PointerEvent<HTMLDivElement>) {
    tlDrag.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
  }

  function zoomView(factor: number) {
    setView((v) => {
      if (!v) return v;
      const center = clamp(curT, start, end);
      let span = clamp((v.v1 - v.v0) * factor, Math.max(20, end - start + 6), maxT);
      let v0 = center - span / 2;
      let v1 = center + span / 2;
      if (v0 < 0) {
        v1 = Math.min(maxT, v1 - v0);
        v0 = 0;
      }
      if (v1 > maxT) {
        v0 = Math.max(0, v0 - (v1 - maxT));
        v1 = maxT;
      }
      return { v0, v1 };
    });
  }

  function nudge(which: "start" | "end", delta: number) {
    if (which === "start") {
      setStart((s) => clamp(s + delta, Math.max(0, end - MAX_DUR), end - MIN_DUR));
    } else {
      setEnd((e) => clamp(e + delta, start + MIN_DUR, Math.min(maxT, start + MAX_DUR)));
    }
  }

  // ===== Salvar =====
  const titleChanged = title.trim() !== cut.title && title.trim() !== "";
  const trimChanged =
    Math.abs(start - cut.startSec) > 0.01 || Math.abs(end - cut.endSec) > 0.01;
  const kfChanged = !sameKfs(kfs, initialKfs);
  const dirty = titleChanged || trimChanged || kfChanged;

  async function pollUntilReady(): Promise<Cut> {
    for (let i = 0; i < 60; i++) {
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
    setMsg(trimChanged || kfChanged ? "Regenerando o vídeo do corte..." : "Salvando...");
    videoRef.current?.pause();
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

      if (trimChanged || kfChanged) {
        // Keyframes viram relativos ao novo início; os fora do trecho caem.
        const rel = kfs
          .filter((k) => k.t >= start - 0.01 && k.t <= end + 0.01)
          .map((k) => ({
            t: Math.round(clamp(k.t - start, 0, end - start) * 100) / 100,
            cx: Math.round(k.cx * 1000) / 1000,
            cy: Math.round(k.cy * 1000) / 1000,
            zoom: Math.round(k.zoom * 100) / 100,
          }));
        const r = await fetch(`/api/projects/${projectId}/cuts/${cut.id}/recut`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ inicio: start, fim: end, keyframes: rel }),
        });
        if (!r.ok) {
          throw new Error((await r.json().catch(() => ({})))?.error ?? "Falha ao re-cortar");
        }
        const updated = await pollUntilReady();
        setSaveState("idle");
        setMsg("");
        setInitialKfs(kfs);
        onSaved({ ...updated, title: titleChanged ? newTitle : updated.title });
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

  // ===== Geometrias derivadas para o render =====
  const rect = vidDims ? cropRect(crop, vidDims.w, vidDims.h) : null;
  const PW = 232; // largura do preview TikTok (px)
  const PH = (PW * 16) / 9;
  const pvStyle: React.CSSProperties | null =
    vidDims && rect
      ? (() => {
          const k = PW / rect.w;
          return {
            position: "absolute",
            width: vidDims.w * k,
            height: vidDims.h * k,
            left: -rect.x * k,
            top: -rect.y * k,
            maxWidth: "none",
            pointerEvents: "none",
          };
        })()
      : null;

  const v = view ?? { v0: Math.max(0, start - 60), v1: Math.min(maxT, end + 60) };
  const span = Math.max(1e-6, v.v1 - v.v0);
  const toPct = (t: number) => `${clamp(((t - v.v0) / span) * 100, 0, 100)}%`;

  return (
    <div style={{ animation: "dj-fadeUp .4s ease" }} data-anim>
      {/* ===== Topbar ===== */}
      <div
        className="dj-editor-topbar"
        style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 20 }}
      >
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
            flexShrink: 0,
          }}
        >
          ←
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, color: theme.textMuted }}>
            Editando corte{setName ? ` · ${setName}` : ""}
          </div>
          <div
            style={{
              font: `500 20px ${font.display}`,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {cut.title}
          </div>
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
            marginBottom: 16,
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

      {source === null ? (
        <div
          style={{
            padding: "60px 24px",
            textAlign: "center",
            borderRadius: 14,
            background: theme.surface,
            border: `1px solid ${theme.border}`,
            color: theme.textMuted,
            fontSize: 14,
          }}
        >
          Carregando o set original...
        </div>
      ) : (
        <>
          {!hasSource && (
            <div
              style={{
                marginBottom: 16,
                padding: "10px 14px",
                borderRadius: 10,
                fontSize: 13,
                background: "#fffbeb",
                color: "#b45309",
                border: "1px solid #fde68a",
              }}
            >
              O vídeo original deste set não está disponível para pré-visualização
              (set do YouTube ou arquivo removido). Dá para ajustar o início/fim na
              timeline — o zoom manual precisa do vídeo original.
            </div>
          )}

          {/* ===== Grid: palco + painel lateral ===== */}
          <div
            className="dj-editor-grid"
            style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 264px", gap: 24 }}
          >
            {/* ---- Palco: vídeo original + janela 9:16 ---- */}
            <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
              {hasSource ? (
                <div
                  ref={stageRef}
                  style={{
                    position: "relative",
                    width: "100%",
                    aspectRatio: vidDims ? `${vidDims.w} / ${vidDims.h}` : "16 / 9",
                    background: "#000",
                    borderRadius: 14,
                    overflow: "hidden",
                  }}
                >
                  <video
                    ref={videoRef}
                    src={source.url ?? undefined}
                    playsInline
                    preload="metadata"
                    onLoadedMetadata={(e) => {
                      const el = e.currentTarget;
                      if (el.videoWidth && el.videoHeight) {
                        setVidDims({ w: el.videoWidth, h: el.videoHeight });
                      }
                      if (Math.abs(el.currentTime - cut.startSec) > 0.5) {
                        el.currentTime = cut.startSec;
                      }
                    }}
                    onClick={togglePlay}
                    style={{
                      position: "absolute",
                      inset: 0,
                      width: "100%",
                      height: "100%",
                      background: "#000",
                    }}
                  />
                  {/* Janela 9:16 arrastável; o resto do frame fica escurecido */}
                  {vidDims && rect && (
                    <div
                      onPointerDown={onBoxDown}
                      onPointerMove={onBoxMove}
                      onPointerUp={onBoxUp}
                      style={{
                        position: "absolute",
                        left: `${(rect.x / vidDims.w) * 100}%`,
                        top: `${(rect.y / vidDims.h) * 100}%`,
                        width: `${(rect.w / vidDims.w) * 100}%`,
                        height: `${(rect.h / vidDims.h) * 100}%`,
                        border: `2px solid ${theme.accentLight}`,
                        borderRadius: 6,
                        boxShadow: "0 0 0 9999px rgba(0,0,0,.45)",
                        cursor: "move",
                        touchAction: "none",
                      }}
                    >
                      <div
                        style={{
                          position: "absolute",
                          left: "50%",
                          bottom: 6,
                          transform: "translateX(-50%)",
                          padding: "2px 8px",
                          borderRadius: 20,
                          background: "rgba(0,0,0,.6)",
                          color: "#fff",
                          fontSize: 10,
                          whiteSpace: "nowrap",
                          pointerEvents: "none",
                        }}
                      >
                        ✥ arraste · {crop.zoom.toFixed(1)}×
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                // Sem o original: mostra o corte atual só como referência.
                <div
                  style={{
                    position: "relative",
                    width: "100%",
                    aspectRatio: "16 / 9",
                    background: "#000",
                    borderRadius: 14,
                    overflow: "hidden",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <video
                    src={cut.url}
                    controls
                    playsInline
                    preload="metadata"
                    style={{ height: "100%", background: "#000" }}
                  />
                </div>
              )}

              {/* ---- Transporte ---- */}
              {hasSource && (
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    onClick={togglePlay}
                    disabled={saving}
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: "50%",
                      border: "none",
                      background: theme.accent,
                      color: "#fff",
                      fontSize: 14,
                      cursor: saving ? "default" : "pointer",
                      flexShrink: 0,
                    }}
                    aria-label={playing ? "Pausar" : "Tocar"}
                  >
                    {playing ? "❚❚" : "▶"}
                  </button>
                  <span style={{ font: `500 14px ${font.display}`, color: theme.textPrimary }}>
                    {formatTimecode(curT)}
                  </span>
                  <span style={{ fontSize: 12, color: theme.textMuted }}>
                    trecho {formatTimecode(start)} → {formatTimecode(end)} ·{" "}
                    {(end - start).toFixed(1)}s
                  </span>
                  <div style={{ marginLeft: "auto", display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <MiniBtn disabled={saving} onClick={() => nudge("start", curT - start)}>
                      ⇤ Início aqui
                    </MiniBtn>
                    <MiniBtn disabled={saving} onClick={() => nudge("end", curT - end)}>
                      Fim aqui ⇥
                    </MiniBtn>
                  </div>
                </div>
              )}

              {/* ---- Timeline ---- */}
              <div>
                <div
                  ref={tlRef}
                  className="dj-tl"
                  onPointerDown={onTlDown}
                  onPointerMove={onTlMove}
                  onPointerUp={onTlUp}
                  style={{
                    position: "relative",
                    height: 72,
                    borderRadius: 12,
                    background: theme.surface,
                    border: `1px solid ${theme.borderStrong}`,
                    overflow: "hidden",
                    cursor: "crosshair",
                    touchAction: "none",
                  }}
                >
                  {/* Trecho que a IA selecionou originalmente (referência) */}
                  <div
                    style={{
                      position: "absolute",
                      left: toPct(cut.startSec),
                      width: `calc(${toPct(cut.endSec)} - ${toPct(cut.startSec)})`,
                      top: 0,
                      bottom: 0,
                      background: theme.surfaceMuted2,
                      pointerEvents: "none",
                    }}
                  />
                  {/* Seleção atual */}
                  <div
                    style={{
                      position: "absolute",
                      left: toPct(start),
                      width: `calc(${toPct(end)} - ${toPct(start)})`,
                      top: 0,
                      bottom: 0,
                      background: theme.accentSoft,
                      borderLeft: `3px solid ${theme.accent}`,
                      borderRight: `3px solid ${theme.accent}`,
                      pointerEvents: "none",
                    }}
                  />
                  {/* Keyframes */}
                  {kfs.map((k, i) => (
                    <div
                      key={`${k.t}-${i}`}
                      style={{
                        position: "absolute",
                        left: toPct(k.t),
                        bottom: 6,
                        width: 9,
                        height: 9,
                        transform: "translateX(-50%) rotate(45deg)",
                        background: i === activeKf ? theme.accent : theme.accentLight,
                        borderRadius: 2,
                        pointerEvents: "none",
                      }}
                    />
                  ))}
                  {/* Playhead */}
                  <div
                    style={{
                      position: "absolute",
                      left: toPct(curT),
                      top: 0,
                      bottom: 0,
                      width: 2,
                      background: theme.textPrimary,
                      transform: "translateX(-50%)",
                      pointerEvents: "none",
                    }}
                  />
                </div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    marginTop: 8,
                    fontSize: 11,
                    color: theme.textMuted,
                    flexWrap: "wrap",
                  }}
                >
                  <span>{formatTimecode(v.v0)}</span>
                  <div style={{ display: "flex", gap: 6, margin: "0 auto" }}>
                    <MiniBtn disabled={saving} onClick={() => zoomView(0.55)}>
                      🔍 +
                    </MiniBtn>
                    <MiniBtn disabled={saving} onClick={() => zoomView(1.8)}>
                      🔍 −
                    </MiniBtn>
                    <MiniBtn
                      disabled={saving}
                      onClick={() => setView({ v0: 0, v1: maxT })}
                    >
                      Set inteiro
                    </MiniBtn>
                  </div>
                  <span>{formatTimecode(v.v1)}</span>
                </div>
                <div style={{ fontSize: 11, color: theme.textMuted, marginTop: 4 }}>
                  arraste as bordas roxas para mudar início/fim (pode ir além do
                  trecho que a IA escolheu) · clique na régua para navegar
                </div>
              </div>

              {/* ---- Ajuste fino ---- */}
              <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
                <FineRow label="Início" value={formatTimecode(start)} disabled={saving} onNudge={(d) => nudge("start", d)} />
                <FineRow label="Fim" value={formatTimecode(end)} disabled={saving} onNudge={(d) => nudge("end", d)} />
              </div>
            </div>

            {/* ---- Painel lateral: preview TikTok + câmera + título ---- */}
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div>
                <div style={{ fontSize: 12, color: theme.textMuted, marginBottom: 7 }}>
                  Como vai ficar no TikTok
                </div>
                <div
                  style={{
                    position: "relative",
                    width: PW,
                    height: PH,
                    borderRadius: 18,
                    overflow: "hidden",
                    background: "#000",
                  }}
                >
                  {hasSource && pvStyle ? (
                    <video
                      ref={pvRef}
                      src={source.url ?? undefined}
                      muted
                      playsInline
                      preload="auto"
                      style={pvStyle}
                    />
                  ) : (
                    <video
                      src={cut.url}
                      controls={!hasSource}
                      playsInline
                      preload="metadata"
                      style={{
                        position: "absolute",
                        inset: 0,
                        width: "100%",
                        height: "100%",
                        objectFit: "cover",
                        background: "#000",
                      }}
                    />
                  )}
                  {saving && (trimChanged || kfChanged) && (
                    <div
                      style={{
                        position: "absolute",
                        inset: 0,
                        background: "rgba(0,0,0,.55)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: "#fff",
                        fontSize: 13,
                        textAlign: "center",
                        padding: 16,
                      }}
                    >
                      Regenerando o vídeo com a nova edição...
                    </div>
                  )}
                </div>
              </div>

              {/* Câmera / zoom + keyframes */}
              {hasSource && (
                <div
                  style={{
                    borderRadius: 13,
                    background: theme.surface,
                    border: `1px solid ${theme.border}`,
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      padding: "12px 14px",
                      font: `500 14px ${font.display}`,
                      borderBottom: `1px solid ${theme.borderHairline}`,
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <span>Câmera</span>
                    <span style={{ fontSize: 11, color: theme.textMuted }}>
                      {kfs.length} keyframe{kfs.length === 1 ? "" : "s"}
                    </span>
                  </div>
                  <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 12 }}>
                    <div>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          fontSize: 12,
                          color: theme.textTertiary,
                          marginBottom: 5,
                        }}
                      >
                        <span>Zoom</span>
                        <span style={{ color: theme.accent, fontWeight: 600 }}>
                          {crop.zoom.toFixed(2)}×
                        </span>
                      </div>
                      <input
                        type="range"
                        min={1}
                        max={ZOOM_MAX}
                        step={0.05}
                        value={crop.zoom}
                        disabled={saving}
                        onChange={(e) => updateKfAtPlayhead({ zoom: Number(e.target.value) })}
                        aria-label="Zoom da janela"
                        style={{ width: "100%", accentColor: theme.accent }}
                      />
                    </div>

                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => updateKfAtPlayhead({})}
                      style={{
                        ...btnGhost,
                        textAlign: "center",
                        cursor: saving ? "default" : "pointer",
                        opacity: saving ? 0.5 : 1,
                      }}
                    >
                      ◆ Keyframe no playhead
                    </button>

                    {kfs.length > 0 && (
                      <div
                        className="dj-kf-list"
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: 6,
                          maxHeight: 180,
                          overflowY: "auto",
                        }}
                      >
                        {kfs.map((k, i) => (
                          <div
                            key={`${k.t}-${i}`}
                            onClick={() => !saving && seek(k.t)}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 8,
                              padding: "6px 9px",
                              borderRadius: 8,
                              cursor: "pointer",
                              fontSize: 12,
                              background: i === activeKf ? theme.accentSoft : theme.surfaceInset,
                              border: `1px solid ${
                                i === activeKf ? theme.accentBorder : theme.borderHairline
                              }`,
                              color: theme.textSecondary,
                            }}
                          >
                            <span style={{ color: theme.accent }}>◆</span>
                            <span>{formatTimecode(k.t)}</span>
                            <span style={{ color: theme.textMuted }}>
                              {k.zoom.toFixed(1)}×
                            </span>
                            <span
                              onClick={(e) => {
                                e.stopPropagation();
                                if (!saving) removeKf(i);
                              }}
                              aria-label="Remover keyframe"
                              style={{
                                marginLeft: "auto",
                                color: theme.textMuted,
                                padding: "0 4px",
                              }}
                            >
                              ×
                            </span>
                          </div>
                        ))}
                      </div>
                    )}

                    {kfs.length > 0 && (
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => setKfs([])}
                        style={{
                          background: "none",
                          border: "none",
                          fontSize: 12,
                          color: "#dc2626",
                          cursor: saving ? "default" : "pointer",
                          padding: 0,
                          textAlign: "left",
                          fontFamily: font.body,
                        }}
                      >
                        Limpar todos os keyframes
                      </button>
                    )}

                    <div style={{ fontSize: 11, color: theme.textMuted, lineHeight: 1.5 }}>
                      Arraste a janela sobre o vídeo (ou mexa no zoom) para criar um
                      keyframe no ponto atual. Entre keyframes, a câmera se move
                      suavemente de um enquadramento ao outro.
                    </div>
                  </div>
                </div>
              )}

              {/* Título */}
              <div>
                <div style={{ fontSize: 12, color: theme.textMuted, marginBottom: 7 }}>
                  Título do corte
                </div>
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
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function MiniBtn({
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
        padding: "5px 10px",
        borderRadius: 8,
        background: theme.surface,
        border: `1px solid ${theme.borderStrong}`,
        fontSize: 12,
        color: theme.textSecondary,
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.5 : 1,
        fontFamily: font.body,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </button>
  );
}

function FineRow({
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
    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
      <span style={{ fontSize: 13, color: theme.textTertiary, width: 44 }}>{label}</span>
      <MiniBtn disabled={disabled} onClick={() => onNudge(-5)}>
        −5s
      </MiniBtn>
      <MiniBtn disabled={disabled} onClick={() => onNudge(-0.5)}>
        −0.5s
      </MiniBtn>
      <span
        style={{
          minWidth: 58,
          textAlign: "center",
          font: `500 14px ${font.display}`,
          color: theme.textPrimary,
        }}
      >
        {value}
      </span>
      <MiniBtn disabled={disabled} onClick={() => onNudge(0.5)}>
        +0.5s
      </MiniBtn>
      <MiniBtn disabled={disabled} onClick={() => onNudge(5)}>
        +5s
      </MiniBtn>
    </div>
  );
}
