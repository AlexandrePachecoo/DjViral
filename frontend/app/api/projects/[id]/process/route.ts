import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getSessionUser } from "@/lib/auth";
import { getPlanUsage, planOf } from "@/lib/plans";

// Dispara o worker (Railway) para processar o projeto. O vídeo já foi enviado
// ao Supabase Storage pelo navegador. Autentica com o segredo compartilhado.
export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "não autenticado" }, { status: 401 });
  }

  // Só o dono do projeto pode dispará-lo.
  const { data: project } = await supabaseAdmin
    .from("projects")
    .select("id, user_id, cut_style, max_cuts")
    .eq("id", params.id)
    .single();
  if (!project || project.user_id !== user.id) {
    return NextResponse.json({ error: "projeto não encontrado" }, { status: 404 });
  }

  const workerUrl = process.env.WORKER_URL;
  const secret = process.env.WORKER_SECRET;
  if (!workerUrl || !secret) {
    return NextResponse.json(
      { error: "WORKER_URL/WORKER_SECRET não configurados" },
      { status: 500 }
    );
  }

  // Limites do plano para este processamento. A duração deste próprio projeto
  // já entrou na conta de uso (foi gravada na criação), então ela é devolvida
  // ao teto: o worker compara a duração REAL do vídeo contra `limit_seconds`
  // e barra sets maiores que a cota (ex.: duração enviada pelo navegador
  // errada, ou vídeo do YouTube mais longo que o esperado).
  const usage = await getPlanUsage(user.id, user.plan);
  const { data: source } = await supabaseAdmin
    .from("sources")
    .select("duracao")
    .eq("project_id", params.id)
    .limit(1)
    .maybeSingle();
  const ownSeconds = source?.duracao ?? 0;
  const limitSeconds = Math.floor(usage.remainingSeconds + ownSeconds);
  if (limitSeconds <= 0) {
    return NextResponse.json(
      {
        error: "Limite de horas do plano atingido. Faça upgrade para continuar.",
        code: "plan_limit",
      },
      { status: 402 }
    );
  }

  // Quantidade de cortes: a escolha feita na criação do projeto, re-clampada
  // ao máximo do plano ATUAL (protege contra downgrade entre criação e
  // process). Sem escolha (NULL), usa o teto do plano.
  const planMax = planOf(user.plan).maxCutsPerSet;
  const maxCuts = Math.min(Math.max(1, project.max_cuts ?? planMax), planMax);

  // Diretor de IA de visão (vibe do público → re-rank + zooms dirigidos): só
  // para planos pagos (pro/premium/admin). No worker ainda depende da flag
  // VISUAL/AI habilitada e da ANTHROPIC_API_KEY — sem chave, degrada sozinho.
  const aiDirector = user.plan !== "free";

  const res = await fetch(`${workerUrl}/process`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-worker-secret": secret,
    },
    body: JSON.stringify({
      project_id: params.id,
      limit_seconds: limitSeconds,
      max_cuts: maxCuts,
      cut_style: project.cut_style ?? "basic",
      ai_director: aiDirector,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    return NextResponse.json(
      { error: `worker respondeu ${res.status}: ${text}` },
      { status: 502 }
    );
  }

  return NextResponse.json({ project_id: params.id, status: "processing" });
}
