// Mock data + types for the studio prototype.
// The design prototype has no real fetch; in a real implementation these come
// from the analysis job (cuts), the editor (trims/captions) and the publish
// integrations (status/platforms). Kept here so views stay presentational.

export type Platform = "TikTok" | "Reels" | "Shorts";
export type StatusKind = "post" | "prog" | "draft";

export type Cut = {
  id: string;
  title: string;
  score: number;
  dur: string;
  moment: string;
  genre: string;
  thumb: string;
};

export type StatusInfo = {
  label: string;
  kind: StatusKind;
  date: string;
  plats: string[];
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

export const SET_INFO = {
  name: "Sunset Rooftop Set",
  duration: "1h 42m",
  genre: "house",
  bpm: "120 BPM",
  cutsCount: 12,
} as const;

export const CUTS: Cut[] = [
  { id: "c1", title: "Drop principal", score: 92, dur: "0:38", moment: "1:12:40", genre: "house", thumb: "#f1eef9" },
  { id: "c2", title: "Vocal break", score: 88, dur: "0:45", moment: "0:54:10", genre: "vocal", thumb: "#eef3f6" },
  { id: "c3", title: "Build-up", score: 81, dur: "0:31", moment: "1:38:05", genre: "drop", thumb: "#f6eef2" },
  { id: "c4", title: "Transição", score: 74, dur: "0:52", moment: "0:22:30", genre: "tech house", thumb: "#f1f1f3" },
  { id: "c5", title: "Sirene + clap", score: 79, dur: "0:28", moment: "1:50:12", genre: "rave", thumb: "#f6f2ea" },
  { id: "c6", title: "Outro melódico", score: 71, dur: "0:40", moment: "1:58:44", genre: "melodic", thumb: "#eef5f1" },
];

export const STATUS_BY_ID: Record<string, StatusInfo> = {
  c1: { label: "✓ Postado", kind: "post", date: "27/06", plats: ["TT", "IG"] },
  c2: { label: "⏱ 29/06 18h", kind: "prog", date: "29/06", plats: ["YT"] },
  c3: { label: "Rascunho", kind: "draft", date: "26/06", plats: ["—"] },
  c4: { label: "✓ Postado", kind: "post", date: "24/06", plats: ["TT", "IG", "YT"] },
  c5: { label: "⏱ 30/06 20h", kind: "prog", date: "30/06", plats: ["IG"] },
  c6: { label: "Rascunho", kind: "draft", date: "25/06", plats: ["—"] },
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
