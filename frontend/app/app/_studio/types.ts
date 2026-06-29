import type { Cut, Platform } from "./data";

export type Tab = "gerador" | "edicao" | "salvos";
export type GeradorView = "grade" | "lista";
export type SalvosView = "galeria" | "tabela";
export type Filter = "todos" | "postados" | "programados" | "rascunhos";
export type ModalMode = "agora" | "programar";

export type ModalState = {
  open: boolean;
  mode: ModalMode;
  cut: Cut | null;
  platform: Platform;
};
