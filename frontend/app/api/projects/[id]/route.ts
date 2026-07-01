import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getSessionUser } from "@/lib/auth";

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
    .select("id, titulo, inicio, fim, duracao, score, url, status")
    .eq("project_id", params.id)
    .order("score", { ascending: false });

  return NextResponse.json({
    project_id: project.id,
    name: project.name,
    status: project.status,
    cuts: cuts ?? [],
  });
}
