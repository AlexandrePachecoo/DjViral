import { supabaseAdmin } from "@/lib/supabase";
import type { ApiCut } from "@/app/app/_studio/cut";

// Slug legível a partir do nome da pasta/projeto (usado como share_token) —
// preserva letras/números/acentos comuns, troca o resto por hífen.
function slugify(name: string): string {
  const slug = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "set";
}

// Gera um share_token único baseado no nome da pasta: tenta o slug puro e,
// em caso de colisão com outro projeto, sufixa -2, -3, etc.
export async function generateShareToken(
  name: string,
  currentToken?: string | null
): Promise<string> {
  const base = slugify(name);
  let candidate = base;
  let suffix = 2;
  for (;;) {
    if (candidate === currentToken) return candidate;
    const { data: existing } = await supabaseAdmin
      .from("projects")
      .select("id")
      .eq("share_token", candidate)
      .maybeSingle();
    if (!existing) return candidate;
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
}

// Resolve um link público (share_token) para o conteúdo exibido em /s/<token>:
// nome do set, mensagem do dono e os cortes SALVOS e prontos. Sem checagem de
// sessão — é a leitura pública. Retorna null se o token não existir (ou o link
// foi revogado, i.e. share_token = NULL não bate com nada).
export type PublicShare = {
  setName: string;
  message: string;
  cuts: ApiCut[];
};

export async function getPublicShare(token: string): Promise<PublicShare | null> {
  if (!token) return null;

  const { data: project } = await supabaseAdmin
    .from("projects")
    .select("id, name, share_token, share_message")
    .eq("share_token", token)
    .single();
  if (!project) return null;

  const { data: cuts } = await supabaseAdmin
    .from("cuts")
    .select("id, project_id, titulo, inicio, fim, duracao, score, url, status, saved, bpm")
    .eq("project_id", project.id)
    .eq("saved", true)
    .eq("status", "ready")
    .order("score", { ascending: false });

  return {
    setName: project.name,
    message: project.share_message ?? "",
    cuts: (cuts ?? []) as ApiCut[],
  };
}
