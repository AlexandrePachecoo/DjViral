import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin, CLIPS_BUCKET } from "@/lib/supabase";
import { getSessionUser } from "@/lib/auth";
import { clipPathFromUrl } from "@/lib/storage";

// Apaga um corte (arquivo no bucket `clips` + linha em `cuts`). Só o dono
// do projeto pode apagar.
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
