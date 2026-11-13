import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getSessionUser } from "@/lib/auth";

// Apaga um estilo personalizado do usuário. Projetos já criados guardam uma
// CÓPIA do estilo (`projects.edit_style`), então nada mais é afetado.
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "não autenticado" }, { status: 401 });
  }
  const { error } = await supabaseAdmin
    .from("edit_styles")
    .delete()
    .eq("id", params.id)
    .eq("user_id", user.id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
