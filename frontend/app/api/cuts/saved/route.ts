import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getSessionUser } from "@/lib/auth";

// Lista os cortes salvos do usuário, agrupados por set (projeto). Cada "pasta"
// é um projeto com ao menos um corte salvo. Alimenta a aba "Cortes salvos".
export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "não autenticado" }, { status: 401 });
  }

  // Projetos do usuário (mais recentes primeiro) → mantém a ordem das pastas.
  // As colunas de compartilhamento (`share_token`/`share_message`) são de uma
  // migração posterior; se o banco ainda não a aplicou, o PostgREST devolve
  // `42703` (coluna inexistente). Nesse caso caímos para o select sem elas em
  // vez de derrubar toda a aba "Cortes salvos" com um 500.
  let projects: {
    id: string;
    name: string;
    share_token?: string | null;
    share_message?: string | null;
  }[] | null = null;

  const withShare = await supabaseAdmin
    .from("projects")
    .select("id, name, share_token, share_message")
    .eq("user_id", user.id)
    .order("date_create", { ascending: false });

  if (withShare.error?.code === "42703") {
    const base = await supabaseAdmin
      .from("projects")
      .select("id, name")
      .eq("user_id", user.id)
      .order("date_create", { ascending: false });
    if (base.error) {
      return NextResponse.json({ error: base.error.message }, { status: 500 });
    }
    projects = base.data;
  } else if (withShare.error) {
    return NextResponse.json({ error: withShare.error.message }, { status: 500 });
  } else {
    projects = withShare.data;
  }

  const projectList = projects ?? [];
  if (projectList.length === 0) {
    return NextResponse.json({ folders: [] });
  }

  const { data: cuts, error: cutsErr } = await supabaseAdmin
    .from("cuts")
    .select("id, project_id, titulo, inicio, fim, duracao, score, url, status, saved, bpm")
    .in("project_id", projectList.map((p) => p.id))
    .eq("saved", true)
    .order("score", { ascending: false });
  if (cutsErr) {
    return NextResponse.json({ error: cutsErr.message }, { status: 500 });
  }

  const byProject = new Map<string, typeof cuts>();
  for (const cut of cuts ?? []) {
    const arr = byProject.get(cut.project_id) ?? [];
    arr.push(cut);
    byProject.set(cut.project_id, arr);
  }

  // Só pastas com ≥1 corte salvo, na ordem dos projetos.
  const folders = projectList
    .filter((p) => byProject.has(p.id))
    .map((p) => ({
      projectId: p.id,
      setName: p.name,
      cuts: byProject.get(p.id) ?? [],
      shareToken: p.share_token ?? null,
      shareMessage: p.share_message ?? null,
    }));

  return NextResponse.json({ folders });
}
