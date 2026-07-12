"use client";

// Editor visual de um corte, no estilo CapCut/edits: workspace ESCURO com o
// preview 9:16 no centro (o canvas É o resultado final — o usuário arrasta o
// PRÓPRIO VÍDEO dentro do quadro e controla o zoom com slider/scroll, como no
// CapCut), minimap com o frame original no canto, painel de propriedades à
// direita e uma timeline embaixo com régua de timecodes, filmstrip de
// miniaturas do set, alças de trim e keyframes como losangos na trilha.
//
// O usuário pode encurtar/estender o trecho além do que a IA escolheu (o
// trecho original fica marcado na régua). Keyframes de câmera ({t, cx, cy,
// zoom}) interpolam com o MESMO smoothstep do worker (backend/app/clipper.py),
// então o preview bate com o render. Salvar dispara POST /recut
// {inicio, fim, keyframes}; o worker regenera o vídeo e persiste os keyframes
// em `cuts.crop_keyframes`.

import { useEffect, useMemo, useRef, useState } from "react";
import { theme, font } from "./theme";
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
const THUMB_COUNT = 14; // miniaturas do filmstrip por janela visível

// Paleta do workspace do editor (escuro, estilo CapCut) — o resto do estúdio
// continua claro; só o editor vive neste contexto.
const dk = {
  bg: "#101013",
  panel: "#18181c",
  panel2: "#1f1f24",
  border: "#2a2a30",
  borderSoft: "#232329",
  text: "#f4f4f5",
  sub: "#9d9da6",
  faint: "#6b6b74",
  track: "#26262c",
  accent: theme.accent,
  accentSoft: "rgba(124,58,237,.18)",
} as const;

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

// Passo "redondo" da régua de timecodes para ~8 marcações na janela visível.
function rulerStep(span: number): number {
  const target = span / 8;
  const steps = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1200, 1800, 3600];
  return steps.find((s) => s >= target) ?? 3600;
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
  const [thumbs, setThumbs] = useState<string[]>([]); // filmstrip da janela visível
  const [thumbReady, setThumbReady] = useState(false); // vídeo gerador carregou
  const [draggingCanvas, setDraggingCanvas] = useState(false);
  const [canvasW, setCanvasW] = useState(0);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [msg, setMsg] = useState("");

  const videoRef = useRef<HTMLVideoElement>(null); // vídeo do canvas (com áudio)
  const mapRef = useRef<HTMLVideoElement>(null); // minimap (frame original, mudo)
  const thumbVidRef = useRef<HTMLVideoElement>(null); // gerador do filmstrip (oculto)
  const canvasRef = useRef<HTMLDivElement>(null);
  const tlRef = useRef<HTMLDivElement>(null);
  const canvasDrag = useRef<{
    px: number;
    py: number;
    cx: number;
    cy: number;
  } | null>(null);
  const tlDrag = useRef<"start" | "end" | "scrub" | null>(null);
  const thumbGen = useRef(0); // invalida gerações concorrentes do filmstrip

  const saving = saveState === "saving";

  // ===== Carrega o vídeo original (signed URL) + keyframes salvos =====
  useEffect(() => {
    let cancelled = false;
    setSource(null);
    setVidDims(null);
    setKfs([]);
    setInitialKfs([]);
    setView(null);
    setThumbs([]);
    setThumbReady(false);
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

  // Janela visível inicial da timeline: o corte ± 45 s.
  useEffect(() => {
    if (source && !view) {
      setView({
        v0: Math.max(0, cut.startSec - 45),
        v1: Math.min(maxT, cut.endSec + 45),
      });
    }
  }, [source, view, cut.startSec, cut.endSec, maxT]);

  const hasSource = !!source?.url;

  // Largura real do canvas 9:16 (para converter arrasto em px da fonte).
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setCanvasW(el.clientWidth));
    ro.observe(el);
    setCanvasW(el.clientWidth);
    return () => ro.disconnect();
  }, [source]);

  // ===== Loop de sincronização (playhead + minimap + loop do trecho) =====
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
        const m = mapRef.current;
        if (m) {
          if (Math.abs(m.currentTime - v.currentTime) > 0.3) {
            m.currentTime = v.currentTime;
          }
          if (v.paused && !m.paused) m.pause();
          if (!v.paused && m.paused) m.play().catch(() => {});
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

  // Botão ◆ estilo CapCut: adiciona keyframe no playhead, ou remove o que já
  // está sob o playhead.
  function toggleKfAtPlayhead() {
    if (activeKf !== -1) setKfs((prev) => prev.filter((_, i) => i !== activeKf));
    else updateKfAtPlayhead({});
  }

  // ===== Canvas: arrastar o VÍDEO dentro do quadro 9:16 (estilo CapCut) =====
  const rect = vidDims ? cropRect(crop, vidDims.w, vidDims.h) : null;

  function onCanvasDown(e: React.PointerEvent<HTMLDivElement>) {
    if (!vidDims || !rect || saving) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    videoRef.current?.pause();
    canvasDrag.current = { px: e.clientX, py: e.clientY, cx: crop.cx, cy: crop.cy };
    setDraggingCanvas(true);
  }

  function onCanvasMove(e: React.PointerEvent<HTMLDivElement>) {
    const d = canvasDrag.current;
    if (!d || !vidDims || !rect || canvasW <= 0) return;
    // px do canvas → px da fonte (a janela do crop preenche o canvas).
    const f = rect.w / canvasW;
    // Arrastar o vídeo para a direita move a janela para a ESQUERDA.
    const ncx = d.cx - ((e.clientX - d.px) * f) / vidDims.w;
    const ncy = d.cy - ((e.clientY - d.py) * f) / vidDims.h;
    updateKfAtPlayhead({ cx: clamp(ncx, 0, 1), cy: clamp(ncy, 0, 1) });
  }

  function onCanvasUp(e: React.PointerEvent<HTMLDivElement>) {
    canvasDrag.current = null;
    setDraggingCanvas(false);
    e.currentTarget.releasePointerCapture(e.pointerId);
  }

  // Scroll no canvas = zoom. Listener manual (React marca wheel como passive,
  // e precisamos de preventDefault); o handler real vive num ref para o efeito
  // não ser recriado a cada frame de playback.
  const wheelRef = useRef<(dy: number) => void>(() => {});
  wheelRef.current = (dy: number) => {
    if (saving) return;
    const z = clamp(cropAt(kfs, curT).zoom * (1 - dy * 0.0012), 1, ZOOM_MAX);
    updateKfAtPlayhead({ zoom: z });
  };
  useEffect(() => {
    const el = canvasRef.current;
    if (!el || !hasSource) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      wheelRef.current(e.deltaY);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [hasSource, source]);

  // Minimap: clicar/arrastar reposiciona a janela direto no frame original.
  function onMapPoint(e: React.PointerEvent<HTMLDivElement>) {
    if (!vidDims || saving) return;
    if (e.type === "pointerdown") {
      e.currentTarget.setPointerCapture(e.pointerId);
      videoRef.current?.pause();
    } else if (e.buttons === 0) {
      return;
    }
    const r = e.currentTarget.getBoundingClientRect();
    updateKfAtPlayhead({
      cx: clamp((e.clientX - r.left) / r.width, 0, 1),
      cy: clamp((e.clientY - r.top) / r.height, 0, 1),
    });
  }

  // ===== Timeline =====
  const v = view ?? { v0: Math.max(0, start - 45), v1: Math.min(maxT, end + 45) };
  const span = Math.max(1e-6, v.v1 - v.v0);
  const toPct = (t: number) => `${clamp(((t - v.v0) / span) * 100, 0, 100)}%`;

  function tlTime(e: React.PointerEvent): number {
    const r = tlRef.current!.getBoundingClientRect();
    const f = clamp((e.clientX - r.left) / r.width, 0, 1);
    return v.v0 + f * span;
  }

  function onTlDown(e: React.PointerEvent<HTMLDivElement>) {
    if (saving) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    videoRef.current?.pause();
    tlDrag.current = "scrub";
    seek(tlTime(e));
  }

  function onHandleDown(which: "start" | "end") {
    return (e: React.PointerEvent<HTMLDivElement>) => {
      if (saving) return;
      e.preventDefault();
      e.stopPropagation();
      // Captura no CONTAINER da timeline (a alça se move sob o ponteiro).
      tlRef.current?.setPointerCapture(e.pointerId);
      videoRef.current?.pause();
      tlDrag.current = which;
    };
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
    setView((prev) => {
      const cur = prev ?? v;
      const center = clamp(curT, start, end);
      let s = clamp((cur.v1 - cur.v0) * factor, Math.max(12, end - start + 4), maxT);
      let v0 = center - s / 2;
      let v1 = center + s / 2;
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

  // ===== Filmstrip: miniaturas do set na janela visível da timeline =====
  useEffect(() => {
    if (!hasSource || !thumbReady) return;
    const gen = ++thumbGen.current;
    const timer = setTimeout(async () => {
      const vid = thumbVidRef.current;
      if (!vid || vid.readyState === 0) return;
      const vw = vid.videoWidth;
      const vh = vid.videoHeight;
      if (!vw || !vh) return;
      const cv = document.createElement("canvas");
      const th = 54;
      const tw = Math.max(24, Math.round((th * vw) / vh));
      cv.width = tw;
      cv.height = th;
      const ctx = cv.getContext("2d");
      if (!ctx) return;
      const list: string[] = [];
      try {
        for (let i = 0; i < THUMB_COUNT; i++) {
          if (thumbGen.current !== gen) return; // janela mudou — aborta
          const t = v.v0 + ((i + 0.5) / THUMB_COUNT) * span;
          await new Promise<void>((resolve) => {
            const done = () => {
              vid.removeEventListener("seeked", done);
              resolve();
            };
            vid.addEventListener("seeked", done);
            vid.currentTime = clamp(t, 0, Math.max(0, maxT - 0.1));
            setTimeout(done, 1500); // não trava o strip se o seek engasgar
          });
          if (thumbGen.current !== gen) return;
          ctx.drawImage(vid, 0, 0, tw, th);
          list.push(cv.toDataURL("image/jpeg", 0.55));
        }
        if (thumbGen.current === gen) setThumbs(list);
      } catch {
        // canvas "tainted" (CORS) ou seek falhou → trilha lisa, sem thumbs.
        if (thumbGen.current === gen) setThumbs([]);
      }
    }, 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasSource, thumbReady, v.v0, v.v1, maxT]);

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

  // Transform do vídeo dentro do canvas 9:16 (a janela do crop preenche o
  // canvas — arrastar o vídeo reposiciona a janela).
  const videoStyle: React.CSSProperties | null =
    vidDims && rect && canvasW > 0
      ? (() => {
          const k = canvasW / rect.w;
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

  const step = rulerStep(span);
  const rulerMarks: number[] = [];
  for (let t = Math.ceil(v.v0 / step) * step; t <= v.v1 + 1e-6; t += step) {
    rulerMarks.push(t);
  }

  return (
    <div
      data-anim
      style={{
        animation: "dj-fadeUp .4s ease",
        background: dk.bg,
        border: `1px solid ${dk.border}`,
        borderRadius: 18,
        overflow: "hidden",
        color: dk.text,
      }}
    >
      {/* ===== Topbar ===== */}
      <div
        className="dj-editor-topbar"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "12px 16px",
          borderBottom: `1px solid ${dk.borderSoft}`,
          background: dk.panel,
        }}
      >
        <button
          type="button"
          onClick={saving ? undefined : onBack}
          aria-label="Voltar"
          style={{
            width: 34,
            height: 34,
            borderRadius: 9,
            background: dk.panel2,
            border: `1px solid ${dk.border}`,
            color: dk.sub,
            cursor: saving ? "default" : "pointer",
            opacity: saving ? 0.5 : 1,
            flexShrink: 0,
          }}
        >
          ←
        </button>
        <div style={{ minWidth: 0, flex: 1 }}>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={saving}
            maxLength={120}
            placeholder="Nome do corte"
            aria-label="Título do corte"
            style={{
              width: "100%",
              background: "transparent",
              border: "none",
              outline: "none",
              color: dk.text,
              font: `500 16px ${font.display}`,
              padding: 0,
            }}
          />
          <div
            style={{
              fontSize: 11,
              color: dk.faint,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {setName || "Editor"} · {formatTimecode(start)} → {formatTimecode(end)} ·{" "}
            {(end - start).toFixed(1)}s
          </div>
        </div>
        <button
          type="button"
          onClick={handleSave}
          style={{
            padding: "9px 18px",
            borderRadius: 9,
            border: "none",
            background: dk.accent,
            color: "#fff",
            font: `500 13px ${font.body}`,
            cursor: saving || !dirty ? "default" : "pointer",
            opacity: saving || !dirty ? 0.5 : 1,
            whiteSpace: "nowrap",
          }}
        >
          {saving ? "Exportando..." : "Salvar corte"}
        </button>
      </div>

      {msg && (
        <div
          style={{
            margin: "12px 16px 0",
            padding: "9px 13px",
            borderRadius: 9,
            fontSize: 13,
            background: saveState === "error" ? "rgba(220,38,38,.12)" : dk.accentSoft,
            color: saveState === "error" ? "#f87171" : "#c4b5fd",
            border: `1px solid ${saveState === "error" ? "rgba(220,38,38,.35)" : "rgba(124,58,237,.4)"}`,
          }}
        >
          {msg}
        </div>
      )}

      {source === null ? (
        <div style={{ padding: "80px 24px", textAlign: "center", color: dk.sub, fontSize: 14 }}>
          Carregando o set original...
        </div>
      ) : (
        <>
          {!hasSource && (
            <div
              style={{
                margin: "12px 16px 0",
                padding: "9px 13px",
                borderRadius: 9,
                fontSize: 13,
                background: "rgba(217,119,6,.12)",
                color: "#fbbf24",
                border: "1px solid rgba(217,119,6,.35)",
              }}
            >
              O vídeo original deste set não está disponível para pré-visualização
              (set do YouTube ou arquivo removido). Dá para ajustar o início/fim na
              timeline — o zoom manual precisa do vídeo original.
            </div>
          )}

          {/* ===== Workspace: canvas central + painel de propriedades ===== */}
          <div
            className="dj-editor-grid"
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0,1fr) 252px",
              gap: 0,
              alignItems: "stretch",
            }}
          >
            {/* ---- Canvas 9:16 (o preview É o resultado) ---- */}
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 10,
                padding: "18px 16px",
                minWidth: 0,
              }}
            >
              {hasSource ? (
                <div
                  ref={canvasRef}
                  onPointerDown={onCanvasDown}
                  onPointerMove={onCanvasMove}
                  onPointerUp={onCanvasUp}
                  style={{
                    position: "relative",
                    height: "min(48vh, 520px)",
                    aspectRatio: "9 / 16",
                    maxWidth: "100%",
                    background: "#000",
                    borderRadius: 12,
                    overflow: "hidden",
                    cursor: draggingCanvas ? "grabbing" : "grab",
                    touchAction: "none",
                    boxShadow: "0 12px 40px rgba(0,0,0,.5)",
                    border: `1px solid ${dk.border}`,
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
                    style={videoStyle ?? { width: "100%", height: "100%", objectFit: "cover" }}
                  />
                  {/* Grade de terços enquanto arrasta (guia, estilo CapCut) */}
                  {draggingCanvas && (
                    <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
                      {[1, 2].map((i) => (
                        <div
                          key={`v${i}`}
                          style={{
                            position: "absolute",
                            left: `${(i * 100) / 3}%`,
                            top: 0,
                            bottom: 0,
                            width: 1,
                            background: "rgba(255,255,255,.35)",
                          }}
                        />
                      ))}
                      {[1, 2].map((i) => (
                        <div
                          key={`h${i}`}
                          style={{
                            position: "absolute",
                            top: `${(i * 100) / 3}%`,
                            left: 0,
                            right: 0,
                            height: 1,
                            background: "rgba(255,255,255,.35)",
                          }}
                        />
                      ))}
                    </div>
                  )}
                  {/* Minimap: frame original com a janela atual (clique move) */}
                  {vidDims && rect && (
                    <div
                      onPointerDown={onMapPoint}
                      onPointerMove={onMapPoint}
                      style={{
                        position: "absolute",
                        right: 8,
                        bottom: 8,
                        width: 104,
                        aspectRatio: `${vidDims.w} / ${vidDims.h}`,
                        borderRadius: 6,
                        overflow: "hidden",
                        border: "1px solid rgba(255,255,255,.35)",
                        background: "#000",
                        cursor: "crosshair",
                        touchAction: "none",
                        opacity: crop.zoom > 1.01 || draggingCanvas ? 1 : 0.45,
                        transition: "opacity .2s",
                      }}
                    >
                      <video
                        ref={mapRef}
                        src={source.url ?? undefined}
                        muted
                        playsInline
                        preload="metadata"
                        style={{
                          position: "absolute",
                          inset: 0,
                          width: "100%",
                          height: "100%",
                          pointerEvents: "none",
                        }}
                      />
                      <div
                        style={{
                          position: "absolute",
                          left: `${(rect.x / vidDims.w) * 100}%`,
                          top: `${(rect.y / vidDims.h) * 100}%`,
                          width: `${(rect.w / vidDims.w) * 100}%`,
                          height: `${(rect.h / vidDims.h) * 100}%`,
                          border: `1.5px solid ${dk.accent}`,
                          borderRadius: 2,
                          boxShadow: "0 0 0 999px rgba(0,0,0,.5)",
                          pointerEvents: "none",
                        }}
                      />
                    </div>
                  )}
                  {saving && (trimChanged || kfChanged) && (
                    <div
                      style={{
                        position: "absolute",
                        inset: 0,
                        background: "rgba(0,0,0,.6)",
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
              ) : (
                <div
                  style={{
                    position: "relative",
                    height: "min(48vh, 520px)",
                    aspectRatio: "9 / 16",
                    maxWidth: "100%",
                    background: "#000",
                    borderRadius: 12,
                    overflow: "hidden",
                    border: `1px solid ${dk.border}`,
                  }}
                >
                  <video
                    src={cut.url}
                    controls
                    playsInline
                    preload="metadata"
                    style={{
                      position: "absolute",
                      inset: 0,
                      width: "100%",
                      height: "100%",
                      objectFit: "cover",
                    }}
                  />
                </div>
              )}

              {/* ---- Transporte ---- */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  flexWrap: "wrap",
                  justifyContent: "center",
                }}
              >
                <button
                  type="button"
                  onClick={togglePlay}
                  disabled={saving || !hasSource}
                  aria-label={playing ? "Pausar" : "Tocar"}
                  style={{
                    width: 42,
                    height: 42,
                    borderRadius: "50%",
                    border: "none",
                    background: dk.text,
                    color: dk.bg,
                    fontSize: 14,
                    cursor: saving || !hasSource ? "default" : "pointer",
                    opacity: saving || !hasSource ? 0.4 : 1,
                  }}
                >
                  {playing ? "❚❚" : "▶"}
                </button>
                <span
                  style={{
                    font: `500 13px ${font.display}`,
                    color: dk.text,
                    minWidth: 110,
                    textAlign: "center",
                  }}
                >
                  {formatTimecode(curT)}{" "}
                  <span style={{ color: dk.faint }}>/ {formatTimecode(maxT)}</span>
                </span>
                <DarkBtn disabled={saving} onClick={() => nudge("start", curT - start)}>
                  ⇤ Início aqui
                </DarkBtn>
                <DarkBtn disabled={saving} onClick={() => nudge("end", curT - end)}>
                  Fim aqui ⇥
                </DarkBtn>
                {hasSource && (
                  <button
                    type="button"
                    onClick={toggleKfAtPlayhead}
                    disabled={saving}
                    title={activeKf !== -1 ? "Remover keyframe" : "Adicionar keyframe"}
                    style={{
                      width: 34,
                      height: 34,
                      borderRadius: 9,
                      border: `1px solid ${activeKf !== -1 ? dk.accent : dk.border}`,
                      background: activeKf !== -1 ? dk.accentSoft : dk.panel2,
                      color: activeKf !== -1 ? "#c4b5fd" : dk.sub,
                      fontSize: 13,
                      cursor: saving ? "default" : "pointer",
                    }}
                  >
                    ◆
                  </button>
                )}
              </div>
            </div>

            {/* ---- Painel de propriedades ---- */}
            <div
              style={{
                borderLeft: `1px solid ${dk.borderSoft}`,
                background: dk.panel,
                padding: 14,
                display: "flex",
                flexDirection: "column",
                gap: 14,
                minWidth: 0,
              }}
            >
              {hasSource && (
                <div>
                  <PanelLabel>Enquadramento</PanelLabel>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      fontSize: 12,
                      color: dk.sub,
                      marginBottom: 5,
                    }}
                  >
                    <span>Zoom</span>
                    <span style={{ color: "#c4b5fd", fontWeight: 600 }}>
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
                    aria-label="Zoom da câmera"
                    style={{ width: "100%", accentColor: dk.accent }}
                  />
                  <div style={{ fontSize: 11, color: dk.faint, marginTop: 6, lineHeight: 1.5 }}>
                    Arraste o vídeo no preview (ou role o scroll) para enquadrar.
                    Cada ajuste vira um keyframe ◆ no ponto atual.
                  </div>
                </div>
              )}

              {hasSource && (
                <div>
                  <PanelLabel>
                    Keyframes{" "}
                    <span style={{ color: dk.faint, fontWeight: 400 }}>({kfs.length})</span>
                  </PanelLabel>
                  {kfs.length === 0 ? (
                    <div style={{ fontSize: 12, color: dk.faint }}>
                      Nenhum keyframe ainda — a câmera fica parada no centro.
                    </div>
                  ) : (
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 5,
                        maxHeight: 170,
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
                            background: i === activeKf ? dk.accentSoft : dk.panel2,
                            border: `1px solid ${i === activeKf ? "rgba(124,58,237,.5)" : dk.borderSoft}`,
                            color: dk.sub,
                          }}
                        >
                          <span style={{ color: "#c4b5fd" }}>◆</span>
                          <span style={{ color: dk.text }}>{formatTimecode(k.t)}</span>
                          <span>{k.zoom.toFixed(1)}×</span>
                          <span
                            onClick={(e) => {
                              e.stopPropagation();
                              if (!saving) setKfs((prev) => prev.filter((_, j) => j !== i));
                            }}
                            aria-label="Remover keyframe"
                            style={{ marginLeft: "auto", color: dk.faint, padding: "0 4px" }}
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
                        marginTop: 8,
                        background: "none",
                        border: "none",
                        fontSize: 12,
                        color: "#f87171",
                        cursor: saving ? "default" : "pointer",
                        padding: 0,
                        fontFamily: font.body,
                      }}
                    >
                      Limpar todos os keyframes
                    </button>
                  )}
                </div>
              )}

              <div>
                <PanelLabel>Trecho</PanelLabel>
                <FineRow label="Início" value={formatTimecode(start)} disabled={saving} onNudge={(d) => nudge("start", d)} />
                <div style={{ height: 8 }} />
                <FineRow label="Fim" value={formatTimecode(end)} disabled={saving} onNudge={(d) => nudge("end", d)} />
                <div style={{ fontSize: 11, color: dk.faint, marginTop: 8 }}>
                  Duração: {(end - start).toFixed(1)}s (mín. {MIN_DUR}s · máx. {MAX_DUR}s)
                </div>
              </div>
            </div>
          </div>

          {/* ===== Timeline (dock inferior, estilo CapCut) ===== */}
          <div
            style={{
              borderTop: `1px solid ${dk.borderSoft}`,
              background: dk.panel,
              padding: "10px 16px 14px",
            }}
          >
            <div
              ref={tlRef}
              onPointerDown={onTlDown}
              onPointerMove={onTlMove}
              onPointerUp={onTlUp}
              style={{
                position: "relative",
                userSelect: "none",
                touchAction: "none",
                cursor: "crosshair",
              }}
            >
              {/* --- Régua de timecodes --- */}
              <div
                style={{
                  position: "relative",
                  height: 22,
                  borderBottom: `1px solid ${dk.borderSoft}`,
                  overflow: "hidden",
                }}
              >
                {rulerMarks.map((t) => (
                  <div
                    key={t}
                    style={{
                      position: "absolute",
                      left: toPct(t),
                      top: 0,
                      bottom: 0,
                      pointerEvents: "none",
                    }}
                  >
                    <div style={{ width: 1, height: 5, background: dk.faint }} />
                    <div
                      style={{
                        fontSize: 9,
                        color: dk.faint,
                        transform: "translateX(3px)",
                        whiteSpace: "nowrap",
                        fontFamily: font.body,
                      }}
                    >
                      {formatTimecode(t)}
                    </div>
                  </div>
                ))}
              </div>

              {/* --- Trilha com filmstrip --- */}
              <div
                style={{
                  position: "relative",
                  height: 58,
                  marginTop: 8,
                  borderRadius: 8,
                  background: dk.track,
                  overflow: "hidden",
                }}
              >
                {/* Miniaturas do set (janela visível inteira) */}
                {thumbs.length > 0 && (
                  <div style={{ position: "absolute", inset: 0, display: "flex", pointerEvents: "none" }}>
                    {thumbs.map((src, i) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        key={i}
                        src={src}
                        alt=""
                        draggable={false}
                        style={{ height: "100%", flex: 1, objectFit: "cover", minWidth: 0, opacity: 0.85 }}
                      />
                    ))}
                  </div>
                )}
                {/* Escurece fora da seleção */}
                <div
                  style={{
                    position: "absolute",
                    left: 0,
                    width: toPct(start),
                    top: 0,
                    bottom: 0,
                    background: "rgba(0,0,0,.62)",
                    pointerEvents: "none",
                  }}
                />
                <div
                  style={{
                    position: "absolute",
                    left: toPct(end),
                    right: 0,
                    top: 0,
                    bottom: 0,
                    background: "rgba(0,0,0,.62)",
                    pointerEvents: "none",
                  }}
                />
                {/* Trecho original da IA (referência sutil) */}
                <div
                  style={{
                    position: "absolute",
                    left: toPct(cut.startSec),
                    width: `calc(${toPct(cut.endSec)} - ${toPct(cut.startSec)})`,
                    bottom: 0,
                    height: 3,
                    background: "rgba(255,255,255,.28)",
                    pointerEvents: "none",
                  }}
                />
                {/* Borda da seleção (clip ativo) */}
                <div
                  style={{
                    position: "absolute",
                    left: toPct(start),
                    width: `calc(${toPct(end)} - ${toPct(start)})`,
                    top: 0,
                    bottom: 0,
                    border: `2px solid ${dk.accent}`,
                    borderRadius: 8,
                    pointerEvents: "none",
                    boxSizing: "border-box",
                  }}
                />
                {/* Alças de trim (estilo CapCut) */}
                <div
                  onPointerDown={onHandleDown("start")}
                  style={{
                    position: "absolute",
                    left: toPct(start),
                    top: 0,
                    bottom: 0,
                    width: 14,
                    marginLeft: -7,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    cursor: "ew-resize",
                    zIndex: 2,
                  }}
                >
                  <div
                    style={{
                      width: 12,
                      height: 34,
                      borderRadius: 6,
                      background: dk.accent,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "#fff",
                      fontSize: 9,
                    }}
                  >
                    ❮
                  </div>
                </div>
                <div
                  onPointerDown={onHandleDown("end")}
                  style={{
                    position: "absolute",
                    left: toPct(end),
                    top: 0,
                    bottom: 0,
                    width: 14,
                    marginLeft: -7,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    cursor: "ew-resize",
                    zIndex: 2,
                  }}
                >
                  <div
                    style={{
                      width: 12,
                      height: 34,
                      borderRadius: 6,
                      background: dk.accent,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "#fff",
                      fontSize: 9,
                    }}
                  >
                    ❯
                  </div>
                </div>
                {/* Keyframes (losangos) */}
                {kfs.map((k, i) => (
                  <div
                    key={`${k.t}-${i}`}
                    style={{
                      position: "absolute",
                      left: toPct(k.t),
                      top: 5,
                      width: 8,
                      height: 8,
                      transform: "translateX(-50%) rotate(45deg)",
                      background: i === activeKf ? "#fff" : "#c4b5fd",
                      border: `1px solid ${dk.accent}`,
                      borderRadius: 1.5,
                      pointerEvents: "none",
                    }}
                  />
                ))}
              </div>

              {/* --- Playhead (atravessa régua + trilha) --- */}
              <div
                style={{
                  position: "absolute",
                  left: toPct(curT),
                  top: 0,
                  bottom: 0,
                  width: 2,
                  background: "#fff",
                  transform: "translateX(-50%)",
                  pointerEvents: "none",
                  zIndex: 3,
                }}
              >
                <div
                  style={{
                    position: "absolute",
                    top: -1,
                    left: "50%",
                    transform: "translateX(-50%)",
                    width: 10,
                    height: 10,
                    borderRadius: "50% 50% 50% 0",
                    background: "#fff",
                    rotate: "-45deg",
                  }}
                />
              </div>
            </div>

            {/* --- Controles da timeline --- */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                marginTop: 10,
                flexWrap: "wrap",
              }}
            >
              <span style={{ fontSize: 10, color: dk.faint }}>{formatTimecode(v.v0)}</span>
              <div style={{ display: "flex", gap: 6, margin: "0 auto" }}>
                <DarkBtn disabled={saving} onClick={() => zoomView(0.55)}>
                  ＋
                </DarkBtn>
                <DarkBtn disabled={saving} onClick={() => zoomView(1.8)}>
                  −
                </DarkBtn>
                <DarkBtn
                  disabled={saving}
                  onClick={() =>
                    setView({
                      v0: Math.max(0, start - (end - start)),
                      v1: Math.min(maxT, end + (end - start)),
                    })
                  }
                >
                  Ajustar ao corte
                </DarkBtn>
                <DarkBtn disabled={saving} onClick={() => setView({ v0: 0, v1: maxT })}>
                  Set inteiro
                </DarkBtn>
              </div>
              <span style={{ fontSize: 10, color: dk.faint }}>{formatTimecode(v.v1)}</span>
            </div>
            <div style={{ fontSize: 11, color: dk.faint, marginTop: 6 }}>
              arraste as alças roxas para encurtar ou estender o corte — pode ir além
              do trecho que a IA escolheu (a linha branca embaixo marca a escolha
              original)
            </div>
          </div>

          {/* Vídeo oculto que gera as miniaturas do filmstrip (CORS p/ canvas) */}
          {hasSource && (
            <video
              ref={thumbVidRef}
              src={source.url ?? undefined}
              muted
              playsInline
              preload="auto"
              crossOrigin="anonymous"
              style={{ display: "none" }}
              onLoadedData={() => setThumbReady(true)}
            />
          )}
        </>
      )}
    </div>
  );
}

function PanelLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 11,
        letterSpacing: ".08em",
        textTransform: "uppercase",
        color: dk.sub,
        marginBottom: 8,
        fontFamily: font.display,
      }}
    >
      {children}
    </div>
  );
}

function DarkBtn({
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
        background: dk.panel2,
        border: `1px solid ${dk.border}`,
        fontSize: 12,
        color: dk.sub,
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
    <div style={{ display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
      <span style={{ fontSize: 12, color: dk.sub, width: 38 }}>{label}</span>
      <DarkBtn disabled={disabled} onClick={() => onNudge(-0.5)}>
        −0.5
      </DarkBtn>
      <span
        style={{
          minWidth: 52,
          textAlign: "center",
          font: `500 13px ${font.display}`,
          color: dk.text,
        }}
      >
        {value}
      </span>
      <DarkBtn disabled={disabled} onClick={() => onNudge(0.5)}>
        +0.5
      </DarkBtn>
    </div>
  );
}
