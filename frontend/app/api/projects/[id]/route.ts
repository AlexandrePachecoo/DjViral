import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin, CLIPS_BUCKET, SOURCES_BUCKET } from "@/lib/supabase";
import { getSessionUser } from "@/lib/auth";
import { removeFolder } from "@/lib/storage";

// Status do projeto + clipes já gerados (polling pelo frontend).
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "não autenticado" }, { status: 401 });
  }

  const { data: project, error: projErr } = await supabaseAdmin
    .from("projects")
    .select("id, name, status, user_id")
    .eq("id", params.id)
    .single();
  if (projErr || !project || project.user_id !== user.id) {
    return NextResponse.json(
      { error: "projeto não encontrado" },
      { status: 404 }
    );
  }

  const { data: cuts } = await supabaseAdmin
    .from("cuts")
    .select("id, titulo, inicio, fim, duracao, score, url, status, saved, bpm")
    .eq("project_id", params.id)
    .order("score", { ascending: false });

  return NextResponse.json({
    project_id: project.id,
    name: project.name,
    status: project.status,
    cuts: cuts ?? [],
  });
}

// Apaga o projeto inteiro (clipes + vídeo original no Storage; `cuts` e
// `sources` somem via `on delete cascade` ao apagar a linha em `projects`).
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "não autenticado" }, { status: 401 });
  }

  const { data: project, error: projErr } = await supabaseAdmin
    .from("projects")
    .select("id, user_id")
    .eq("id", params.id)
    .single();
  if (projErr || !project || project.user_id !== user.id) {
    return NextResponse.json({ error: "projeto não encontrado" }, { status: 404 });
  }

  await removeFolder(CLIPS_BUCKET, project.id);
  await removeFolder(SOURCES_BUCKET, project.id);

  const { error: delErr } = await supabaseAdmin
    .from("projects")
    .delete()
    .eq("id", project.id);
  if (delErr) {
    return NextResponse.json({ error: delErr.message }, { status: 500 });
  }

  return NextResponse.json({ project_id: project.id });
}
