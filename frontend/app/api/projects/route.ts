import { NextRequest, NextResponse } from "next/server";
import { SOURCES_BUCKET, supabaseAdmin } from "@/lib/supabase";

// Lista os projetos (mais recentes primeiro) para o histórico no frontend.
// Sem autenticação ainda, então o histórico é global (todos os projetos).
export async function GET() {
  const { data: projects, error } = await supabaseAdmin
    .from("projects")
    .select("id, name, status, date_create")
    .order("date_create", { ascending: false });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ projects: projects ?? [] });
}

// Cria um projeto + source e devolve uma signed upload URL para o navegador
// enviar o vídeo DIRETO ao Supabase Storage (sem passar pela Vercel).
export async function POST(req: NextRequest) {
  const { name, filename } = await req.json();
  if (!name || !filename) {
    return NextResponse.json(
      { error: "name e filename são obrigatórios" },
      { status: 400 }
    );
  }

  // 1. Cria o projeto
  const { data: project, error: projErr } = await supabaseAdmin
    .from("projects")
    .insert({ name, status: "processing" })
    .select("id")
    .single();
  if (projErr || !project) {
    return NextResponse.json(
      { error: projErr?.message ?? "falha ao criar projeto" },
      { status: 500 }
    );
  }

  // 2. Caminho do vídeo no Storage e registro do source
  const safeName = filename.replace(/[^\w.\-]/g, "_");
  const storagePath = `${project.id}/${safeName}`;

  const { error: srcErr } = await supabaseAdmin.from("sources").insert({
    project_id: project.id,
    name: filename,
    url: storagePath,
    status_processo: "uploading",
  });
  if (srcErr) {
    return NextResponse.json({ error: srcErr.message }, { status: 500 });
  }

  // 3. Signed upload URL no bucket de vídeos originais
  const { data: signed, error: signErr } = await supabaseAdmin.storage
    .from(SOURCES_BUCKET)
    .createSignedUploadUrl(storagePath);
  if (signErr || !signed) {
    return NextResponse.json(
      { error: signErr?.message ?? "falha ao gerar upload URL" },
      { status: 500 }
    );
  }

  return NextResponse.json({
    project_id: project.id,
    signedUrl: signed.signedUrl,
    storagePath,
  });
}
