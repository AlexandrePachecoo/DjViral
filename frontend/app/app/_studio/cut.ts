// Mapeia os cortes reais vindos da API (shape do banco) para o `Cut` que as
// views do estúdio consomem. Mantém as views presentacionais e desacopladas do
// formato do backend.

import type { Cut, CutStatus } from "./data";

// Shape de um corte como devolvido por GET /api/projects/[id].
export type ApiCut = {
  id: string;
  titulo: string | null;
  inicio: number | null;
  fim: number | null;
  duracao: number | null;
  score: number | null;
  url: string | null;
  status: string | null;
  saved?: boolean | null;
  // BPM do set no corte. Coluna nova; cortes antigos trazem NULL e o BPM é
  // extraído do título ("Drop N · 120 BPM") por `parseBpm`.
  bpm?: number | null;
};

// Segundos → "h:mm:ss" (sets longos) ou "m:ss".
export function formatTimecode(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return hours > 0
    ? `${hours}:${pad(minutes)}:${pad(seconds)}`
    : `${minutes}:${pad(seconds)}`;
}

// O worker grava `score` como fração 0–1 (analyzer.py); o estúdio mostra um
// inteiro 0–100.
export function toDisplayScore(score: number | null | undefined): number {
  const v = Math.round((score ?? 0) * 100);
  return Math.min(100, Math.max(0, v));
}

// BPM de um corte para o card do set. Prefere a coluna `bpm` (cortes novos, cujo
// título agora é um hook viral gerado por IA e não contém mais o BPM) e cai no
// regex do título antigo ("Drop N · 120 BPM") para cortes anteriores.
export function cutBpm(cut: Pick<ApiCut, "bpm" | "titulo">): number | null {
  if (typeof cut.bpm === "number" && Number.isFinite(cut.bpm)) return cut.bpm;
  return parseBpm(cut.titulo);
}

// Fallback legado: extrai o BPM embutido no título ("Drop N · 120 BPM").
export function parseBpm(titulo: string | null | undefined): number | null {
  const match = (titulo ?? "").match(/(\d+)\s*BPM/i);
  return match ? Number(match[1]) : null;
}

// Monta a URL de download do clipe. Como `cut.url` é uma URL pública do Supabase
// (outra origem), o atributo HTML `download` seria ignorado pelo browser; o
// Supabase Storage aceita o query param `?download=<nome>`, que devolve
// `Content-Disposition: attachment` e força o download com um nome amigável
// derivado do título do corte.
export function downloadUrl(cut: Cut): string {
  const name = (cut.title || "corte").replace(/[^\w.-]+/g, "_").slice(0, 60);
  const sep = cut.url.includes("?") ? "&" : "?";
  return `${cut.url}${sep}download=${encodeURIComponent(name)}.mp4`;
}

const CUT_STATUSES: CutStatus[] = ["ready", "processing", "error"];

export function toStudioCut(api: ApiCut): Cut {
  const startSec = api.inicio ?? 0;
  const endSec = api.fim ?? startSec;
  return {
    id: api.id,
    title: api.titulo?.trim() || "Corte sem título",
    score: toDisplayScore(api.score),
    dur: formatTimecode(api.duracao ?? Math.max(0, endSec - startSec)),
    moment: formatTimecode(startSec),
    startSec,
    endSec,
    url: api.url ?? "",
    status: CUT_STATUSES.includes(api.status as CutStatus)
      ? (api.status as CutStatus)
      : "ready",
    saved: api.saved ?? false,
    bpm: cutBpm(api),
  };
}
