import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getSessionUser } from "@/lib/auth";

// Re-corta um clipe com novo início/fim. Marca o corte como `processing` e
// dispara o worker (Railway), que regenera o vídeo via FFmpeg. Mesmo padrão de
// segurança do process route (segredo compartilhado X-Worker-Secret).
export async function POST(
  req: NextRequest,
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
    .select("id, project_id")
    .eq("id", params.cutId)
    .single();
  if (!cut || cut.project_id !== params.id) {
    return NextResponse.json({ error: "corte não encontrado" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const inicio = Number(body.inicio);
  const fim = Number(body.fim);
  if (!Number.isFinite(inicio) || !Number.isFinite(fim) || inicio < 0 || fim <= inicio) {
    return NextResponse.json(
      { error: "inicio/fim inválidos (precisa de 0 <= inicio < fim)" },
      { status: 400 }
    );
  }
  if (fim - inicio > 600) {
    return NextResponse.json(
      { error: "o corte pode ter no máximo 10 minutos" },
      { status: 400 }
    );
  }

  // Keyframes de câmera do editor visual (opcionais): `{t, cx, cy, zoom}` com
  // t relativo ao início do corte. Ausente = render automático de sempre;
  // `[]` = usuário limpou a direção manual. Sanitizados aqui (o worker também
  // valida) para nunca repassar lixo ao FFmpeg.
  let keyframes: { t: number; cx: number; cy: number; zoom: number }[] | undefined;
  if (body.keyframes !== undefined) {
    if (!Array.isArray(body.keyframes) || body.keyframes.length > 30) {
      return NextResponse.json(
        { error: "keyframes inválidos (array de até 30 itens)" },
        { status: 400 }
      );
    }
    keyframes = [];
    for (const kf of body.keyframes) {
      const t = Number(kf?.t);
      const cx = Number(kf?.cx);
      const cy = Number(kf?.cy);
      const zoom = Number(kf?.zoom);
      if (![t, cx, cy, zoom].every(Number.isFinite)) {
        return NextResponse.json(
          { error: "keyframe inválido (t/cx/cy/zoom numéricos)" },
          { status: 400 }
        );
      }
      keyframes.push({
        t: Math.min(Math.max(t, 0), fim - inicio),
        cx: Math.min(Math.max(cx, 0), 1),
        cy: Math.min(Math.max(cy, 0), 1),
        zoom: Math.min(Math.max(zoom, 1), 4),
      });
    }
  }

  const workerUrl = process.env.WORKER_URL;
  const secret = process.env.WORKER_SECRET;
  if (!workerUrl || !secret) {
    return NextResponse.json(
      { error: "WORKER_URL/WORKER_SECRET não configurados" },
      { status: 500 }
    );
  }

  // Marca o corte como em processamento antes de disparar o worker (a UI faz
  // polling até voltar a `ready`).
  await supabaseAdmin.from("cuts").update({ status: "processing" }).eq("id", params.cutId);

  const res = await fetch(`${workerUrl}/recut`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-worker-secret": secret,
    },
    body: JSON.stringify({
      project_id: params.id,
      cut_id: params.cutId,
      inicio,
      fim,
      ...(keyframes !== undefined ? { keyframes } : {}),
    }),
  });

  if (!res.ok) {
    // Reverte o estado para não deixar o corte travado em "processing".
    await supabaseAdmin.from("cuts").update({ status: "ready" }).eq("id", params.cutId);
    const text = await res.text();
    return NextResponse.json(
      { error: `worker respondeu ${res.status}: ${text}` },
      { status: 502 }
    );
  }

  return NextResponse.json({ cut_id: params.cutId, status: "processing" });
}
