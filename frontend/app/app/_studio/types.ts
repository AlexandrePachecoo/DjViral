import type { Cut, Platform } from "./data";

export type Tab = "gerador" | "edicao" | "salvos";
export type GeradorView = "grade" | "lista";
export type SalvosView = "galeria" | "tabela";
export type Filter = "todos" | "postados" | "programados" | "rascunhos";
export type ModalMode = "agora" | "programar";

// Projeto do usuário, como devolvido por GET /api/projects.
export type ProjectSummary = {
  id: string;
  name: string;
  status: string;
  date_create: string;
};

export type ModalState = {
  open: boolean;
  mode: ModalMode;
  cut: Cut | null;
  platform: Platform;
  setName: string;
};
