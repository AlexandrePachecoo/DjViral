import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getSessionUser } from "@/lib/auth";

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
