import { NextRequest, NextResponse } from "next/server";
import { SOURCES_BUCKET, supabaseAdmin } from "@/lib/supabase";
import { getSessionUser } from "@/lib/auth";
import { getPlanUsage, planOf } from "@/lib/plans";
import { canonicalYoutubeUrl, extractYoutubeId } from "@/lib/youtube";

// Lista os projetos do usuário autenticado (mais recentes primeiro). O estúdio
// usa isso pra escolher o set ativo e popular o seletor de sets.
export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "não autenticado" }, { status: 401 });
  }

  const { data: projects, error } = await supabaseAdmin
    .from("projects")
    .select("id, name, status, date_create")
    .eq("user_id", user.id)
    .order("date_create", { ascending: false });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ projects: projects ?? [] });
}

// Cria um projeto + source. Duas origens de vídeo:
//   - upload (`filename`): devolve uma signed upload URL para o navegador
//     enviar o vídeo DIRETO ao Supabase Storage (sem passar pela Vercel);
//   - YouTube (`youtube_url`): guarda o link no source e o worker baixa o
//     vídeo com yt-dlp na hora de processar (sem upload).
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "não autenticado" }, { status: 401 });
  }

  const { name, filename, youtube_url, duration_seconds, size_bytes, cut_style, max_cuts } =
    await req.json();
  if (!name || (!filename && !youtube_url)) {
    return NextResponse.json(
      { error: "name e (filename ou youtube_url) são obrigatórios" },
      { status: 400 }
    );
  }

  // Preferências de geração (opcionais). O estilo é validado estrito; a
  // quantidade aceita 1..30 e é clampada ao máximo do plano — a UI já limita,
  // o clamp cobre chamadas diretas à API (e é reaplicado no /process).
  const cutStyle = cut_style ?? "basic";
  if (cutStyle !== "basic" && cutStyle !== "dynamic") {
    return NextResponse.json(
      { error: "cut_style deve ser 'basic' ou 'dynamic'" },
      { status: 400 }
    );
  }
  let maxCuts: number | null = null;
  if (max_cuts !== undefined && max_cuts !== null) {
    if (!Number.isInteger(max_cuts) || max_cuts < 1 || max_cuts > 30) {
      return NextResponse.json(
        { error: "max_cuts deve ser um inteiro entre 1 e 30" },
        { status: 400 }
      );
    }
    maxCuts = Math.min(max_cuts, planOf(user.plan).maxCutsPerSet);
  }

  // Valida o link antes de criar qualquer linha no banco.
  const youtubeId = youtube_url ? extractYoutubeId(youtube_url) : null;
  if (youtube_url && !youtubeId) {
    return NextResponse.json(
      { error: "URL do YouTube inválida" },
      { status: 400 }
    );
  }

  // Cota do plano: horas de set no período (total no free, por mês nos
  // pagos). A duração vem do navegador (metadata do arquivo) quando
  // disponível; o worker revalida com a duração real antes de processar.
  const usage = await getPlanUsage(user.id, user.plan);
  const duration =
    typeof duration_seconds === "number" && duration_seconds > 0
      ? Math.round(duration_seconds)
      : null;
  if (usage.remainingSeconds <= 0 || (duration && duration > usage.remainingSeconds)) {
    const restanteMin = Math.floor(usage.remainingSeconds / 60);
    return NextResponse.json(
      {
        error:
          usage.plan === "free"
            ? `Seu teste grátis inclui ${usage.limitSeconds / 3600}h de set. ` +
              `Restam ${restanteMin} min — faça upgrade para continuar gerando cortes.`
            : `Você atingiu o limite de ${usage.limitSeconds / 3600}h de set do plano ` +
              `neste mês (restam ${restanteMin} min). Faça upgrade ou aguarde a renovação.`,
        code: "plan_limit",
        plan: usage.plan,
        remaining_seconds: usage.remainingSeconds,
      },
      { status: 402 }
    );
  }

  // 1. Cria o projeto (vinculado ao usuário autenticado)
  const { data: project, error: projErr } = await supabaseAdmin
    .from("projects")
    .insert({
      name,
      status: "processing",
      user_id: user.id,
      cut_style: cutStyle,
      max_cuts: maxCuts,
    })
    .select("id")
    .single();
  if (projErr || !project) {
    return NextResponse.json(
      { error: projErr?.message ?? "falha ao criar projeto" },
      { status: 500 }
    );
  }

  // Origem YouTube: só registra o link; o download acontece no worker.
  if (youtubeId) {
    const url = canonicalYoutubeUrl(youtubeId);
    const { error: srcErr } = await supabaseAdmin.from("sources").insert({
      project_id: project.id,
      name: url,
      url,
      duracao: duration,
      source_type: "youtube",
      status_processo: "ready",
    });
    if (srcErr) {
      return NextResponse.json({ error: srcErr.message }, { status: 500 });
    }
    return NextResponse.json({ project_id: project.id, source_type: "youtube" });
  }

  // 2. Caminho do vídeo no Storage e registro do source
  const safeName = filename.replace(/[^\w.\-]/g, "_");
  const storagePath = `${project.id}/${safeName}`;

  const { error: srcErr } = await supabaseAdmin.from("sources").insert({
    project_id: project.id,
    name: filename,
    url: storagePath,
    duracao: duration,
    tamanho: typeof size_bytes === "number" && size_bytes > 0 ? Math.round(size_bytes) : null,
    source_type: "upload",
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
