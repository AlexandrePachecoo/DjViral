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
  const { data: projects, error: projErr } = await supabaseAdmin
    .from("projects")
    .select("id, name, share_token, share_message")
    .eq("user_id", user.id)
    .order("date_create", { ascending: false });
  if (projErr) {
    return NextResponse.json({ error: projErr.message }, { status: 500 });
  }

  const projectList = projects ?? [];
  if (projectList.length === 0) {
    return NextResponse.json({ folders: [] });
  }

  const { data: cuts, error: cutsErr } = await supabaseAdmin
    .from("cuts")
    .select("id, project_id, titulo, inicio, fim, duracao, score, url, status, saved")
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
