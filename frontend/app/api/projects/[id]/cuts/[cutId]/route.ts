import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin, CLIPS_BUCKET } from "@/lib/supabase";
import { getSessionUser } from "@/lib/auth";
import { clipPathFromUrl } from "@/lib/storage";

// Detalhe de um corte para o editor visual — inclui `crop_keyframes` (direção
// manual de câmera salva no último re-corte). A coluna é de migração recente:
// se o banco ainda não a tem, o PostgREST devolve 42703 e caímos para o select
// sem ela (o editor abre sem keyframes salvos).
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string; cutId: string } }
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "não autenticado" }, { status: 401 });
  }

  const { data: project } = await supabaseAdmin
    .from("projects")
    .select("id, user_id")
    .eq("id", params.id)
    .single();
  if (!project || project.user_id !== user.id) {
    return NextResponse.json({ error: "projeto não encontrado" }, { status: 404 });
  }

  const base = "id, project_id, titulo, inicio, fim, duracao, score, url, status, saved, bpm";
  let cut: Record<string, unknown> | null = null;

  const withKf = await supabaseAdmin
    .from("cuts")
    .select(`${base}, crop_keyframes`)
    .eq("id", params.cutId)
    .single();
  if (withKf.error?.code === "42703") {
    const plain = await supabaseAdmin
      .from("cuts")
      .select(base)
      .eq("id", params.cutId)
      .single();
    cut = plain.data ? { ...plain.data, crop_keyframes: null } : null;
  } else {
    cut = withKf.data;
  }

  if (!cut || cut.project_id !== params.id) {
    return NextResponse.json({ error: "corte não encontrado" }, { status: 404 });
  }

  return NextResponse.json({ cut });
}

// Renomeia um corte (atualiza cuts.titulo). Não envolve o worker — é só
// metadado. Mesma auth/ownership do process route.
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; cutId: string } }
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "não autenticado" }, { status: 401 });
  }

  // Só o dono do projeto pode editar seus cortes.
  const { data: project } = await supabaseAdmin
    .from("projects")
    .select("id, user_id")
    .eq("id", params.id)
    .single();
  if (!project || project.user_id !== user.id) {
    return NextResponse.json({ error: "projeto não encontrado" }, { status: 404 });
  }

  // O corte precisa pertencer a esse projeto.
  const { data: cut } = await supabaseAdmin
    .from("cuts")
    .select("id, project_id")
    .eq("id", params.cutId)
    .single();
  if (!cut || cut.project_id !== params.id) {
    return NextResponse.json({ error: "corte não encontrado" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const titulo = typeof body.titulo === "string" ? body.titulo.trim() : "";
  if (!titulo) {
    return NextResponse.json({ error: "titulo é obrigatório" }, { status: 400 });
  }

  const { error: updErr } = await supabaseAdmin
    .from("cuts")
    .update({ titulo })
    .eq("id", params.cutId);
  if (updErr) {
    return NextResponse.json({ error: updErr.message }, { status: 500 });
  }

  return NextResponse.json({ cut_id: params.cutId, titulo });
}

// Apaga um corte (arquivo no bucket `clips` + linha em `cuts`). Mesma
// auth/ownership do PATCH acima.
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string; cutId: string } }
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "não autenticado" }, { status: 401 });
  }

  const { data: project } = await supabaseAdmin
    .from("projects")
    .select("id, user_id")
    .eq("id", params.id)
    .single();
  if (!project || project.user_id !== user.id) {
    return NextResponse.json({ error: "projeto não encontrado" }, { status: 404 });
  }

  const { data: cut } = await supabaseAdmin
    .from("cuts")
    .select("id, project_id, url")
    .eq("id", params.cutId)
    .single();
  if (!cut || cut.project_id !== params.id) {
    return NextResponse.json({ error: "corte não encontrado" }, { status: 404 });
  }

  const path = clipPathFromUrl(cut.url);
  if (path) {
    await supabaseAdmin.storage.from(CLIPS_BUCKET).remove([path]);
  }

  const { error: delErr } = await supabaseAdmin
    .from("cuts")
    .delete()
    .eq("id", params.cutId);
  if (delErr) {
    return NextResponse.json({ error: delErr.message }, { status: 500 });
  }

  return NextResponse.json({ cut_id: params.cutId });
}
