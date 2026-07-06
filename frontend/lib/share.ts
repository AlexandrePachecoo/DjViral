import { supabaseAdmin } from "@/lib/supabase";
import type { ApiCut } from "@/app/app/_studio/cut";

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
