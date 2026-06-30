// Tipos do estúdio + dados que ainda são mock.
//
// Os cortes e o set agora vêm da API (ver `cut.ts` e `page.tsx`). O que continua
// mock são as legendas do editor (CAPTIONS) e as descrições por plataforma
// (COMPOSE) — features de edição/publicação ainda não implementadas no backend.

export type Platform = "TikTok" | "Reels" | "Shorts";

export type Cut = {
  id: string;
  title: string;
  score: number;
  dur: string;
  moment: string;
  // URL pública do clipe gerado pelo worker (player de vídeo real).
  url: string;
  // Não vêm do banco: gênero e cor de thumb são do protótipo. Opcionais pra que
  // os cortes reais possam omiti-los (o gênero some, o thumb usa fallback).
  genre?: string;
  thumb?: string;
};

// Resumo do set ativo exibido no card do Gerador (derivado do projeto + cortes).
export type SetInfo = {
  name: string;
  cutsCount: number;
  bpm: number | null;
};

export type Caption = {
  id: string;
  time: string;
  text: string;
  pos: string;
};

export type Compose = {
  desc: string;
  tags: string[];
};

export const CAPTIONS: Caption[] = [
  { id: "cap1", time: "0:02 – 0:06", text: "quando o beat dropa 🔥", pos: "centro-alto" },
  { id: "cap2", time: "0:18 – 0:21", text: "vem o drop", pos: "centro" },
  { id: "cap3", time: "0:30 – 0:34", text: "set completo no link", pos: "rodapé" },
];

export const COMPOSE: Record<Platform, Compose> = {
  TikTok: {
    desc: "POV: o rooftop inteiro parou quando esse drop entrou 🔥",
    tags: ["#fyp", "#djset", "#house", "#viral"],
  },
  Reels: {
    desc: "Aquele momento que o rooftop parou 🔥 set completo no link da bio",
    tags: ["#reels", "#djset", "#house", "#festival"],
  },
  Shorts: {
    desc: "Drop ao vivo no rooftop 🔥 set completo no canal",
    tags: ["#shorts", "#edm", "#djlife", "#house"],
  },
};
