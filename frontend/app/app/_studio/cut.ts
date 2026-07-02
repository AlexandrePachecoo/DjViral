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

// O título do corte vem como "Drop N · 120 BPM" (pipeline.py). Extrai o BPM pro
// card do set, quando presente.
export function parseBpm(titulo: string | null | undefined): number | null {
  const match = (titulo ?? "").match(/(\d+)\s*BPM/i);
  return match ? Number(match[1]) : null;
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
  };
}
