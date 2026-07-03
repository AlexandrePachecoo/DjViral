import type { Cut } from "./data";

export type Tab = "gerador" | "salvos" | "plano" | "perfil";
export type GeradorView = "grade" | "lista";
export type SalvosView = "galeria" | "tabela";

// Projeto do usuário, como devolvido por GET /api/projects.
export type ProjectSummary = {
  id: string;
  name: string;
  status: string;
  date_create: string;
};

// Um set com seus cortes salvos, como devolvido por GET /api/cuts/saved.
// Vira uma "pasta" na aba Cortes salvos.
export type SavedFolder = {
  projectId: string;
  setName: string;
  cuts: Cut[];
};
