import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getSessionUser } from "@/lib/auth";

// Salva um lote de cortes (marca cuts.saved = true). Cortes salvos vão para a
// aba "Cortes salvos"; os não salvos são descartados no próximo reload do
// estúdio (ver /api/cleanup). Mesma auth/ownership dos outros routes de corte.
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "não autenticado" }, { status: 401 });
  }

  // Só o dono do projeto pode salvar seus cortes.
  const { data: project } = await supabaseAdmin
    .from("projects")
    .select("id, user_id")
    .eq("id", params.id)
    .single();
  if (!project || project.user_id !== user.id) {
    return NextResponse.json({ error: "projeto não encontrado" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const cutIds: unknown = body.cutIds;
  if (!Array.isArray(cutIds) || cutIds.some((c) => typeof c !== "string") || cutIds.length === 0) {
    return NextResponse.json(
      { error: "cutIds (array de ids) é obrigatório" },
      { status: 400 }
    );
  }

  // O `.eq("project_id", id)` garante que só cortes deste projeto são afetados.
  const { error: updErr } = await supabaseAdmin
    .from("cuts")
    .update({ saved: true })
    .in("id", cutIds as string[])
    .eq("project_id", params.id);
  if (updErr) {
    return NextResponse.json({ error: updErr.message }, { status: 500 });
  }

  return NextResponse.json({ saved: cutIds });
}
