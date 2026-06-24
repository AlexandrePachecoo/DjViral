import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

// Status do projeto + clipes já gerados (polling pelo frontend).
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { data: project, error: projErr } = await supabaseAdmin
    .from("projects")
    .select("id, name, status")
    .eq("id", params.id)
    .single();
  if (projErr || !project) {
    return NextResponse.json(
      { error: "projeto não encontrado" },
      { status: 404 }
    );
  }

  const { data: cuts } = await supabaseAdmin
    .from("cuts")
    .select("titulo, inicio, fim, duracao, score, url")
    .eq("project_id", params.id)
    .order("score", { ascending: false });

  return NextResponse.json({
    project_id: project.id,
    name: project.name,
    status: project.status,
    cuts: cuts ?? [],
  });
}
