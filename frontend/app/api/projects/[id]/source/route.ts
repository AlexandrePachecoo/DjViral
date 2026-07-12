import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin, SOURCES_BUCKET } from "@/lib/supabase";
import { getSessionUser } from "@/lib/auth";

// Vídeo ORIGINAL do set para o editor de cortes: o bucket `sources` é privado,
// então devolvemos uma signed URL temporária (1h) para o <video> do editor
// tocar o set inteiro (a timeline permite estender o corte além do trecho que
// a IA escolheu). Dono only — mesma auth/ownership das outras rotas do projeto.
//
// Origem YouTube não tem arquivo no Storage (o worker baixa com yt-dlp na hora
// de processar): devolvemos `url: null` e o editor degrada para edição de
// trim/keyframes sem o preview do vídeo original.
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
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

  const { data: sources } = await supabaseAdmin
    .from("sources")
    .select("url, source_type, duracao")
    .eq("project_id", params.id)
    .limit(1);
  const source = sources?.[0];
  if (!source) {
    return NextResponse.json({ error: "source não encontrado" }, { status: 404 });
  }

  const duration =
    typeof source.duracao === "number" && source.duracao > 0 ? source.duracao : null;

  if (source.source_type === "youtube" || !source.url) {
    return NextResponse.json({ url: null, sourceType: "youtube", duration });
  }

  const { data: signed, error: signErr } = await supabaseAdmin.storage
    .from(SOURCES_BUCKET)
    .createSignedUrl(source.url, 3600);
  if (signErr || !signed?.signedUrl) {
    // Arquivo pode ter sido limpo do Storage; o editor degrada sem o preview.
    return NextResponse.json({ url: null, sourceType: "upload", duration });
  }

  return NextResponse.json({
    url: signed.signedUrl,
    sourceType: "upload",
    duration,
  });
}
