import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getSessionUser } from "@/lib/auth";

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
    .select("id, user_id")
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

  const res = await fetch(`${workerUrl}/process`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-worker-secret": secret,
    },
    body: JSON.stringify({ project_id: params.id }),
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
