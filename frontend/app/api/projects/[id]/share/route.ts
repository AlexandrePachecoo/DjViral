import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getSessionUser } from "@/lib/auth";
import { generateShareToken } from "@/lib/share";

// Compartilhamento público de um set. Só o dono do projeto gera/revoga o link e
// define a mensagem exibida no topo da página pública (/s/<token>). A leitura
// pública (sem login) fica em /api/public/[token]. Mesma auth/ownership dos
// outros routes de corte (ver cuts/save/route.ts).

const MESSAGE_MAX = 500;

// Origem pública das URLs de compartilhamento. Prefere APP_URL (env já usada
// pelo checkout); cai para o header origin/host da própria request.
function publicOrigin(req: NextRequest): string {
  const appUrl = process.env.APP_URL?.replace(/\/+$/, "");
  if (appUrl) return appUrl;
  const origin = req.headers.get("origin");
  if (origin) return origin.replace(/\/+$/, "");
  const host = req.headers.get("host");
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  return host ? `${proto}://${host}` : "";
}

function shareUrlFor(req: NextRequest, token: string): string {
  const origin = publicOrigin(req);
  return origin ? `${origin}/s/${token}` : `/s/${token}`;
}

// GET → estado atual do compartilhamento do projeto (para a UI abrir sincronizada).
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "não autenticado" }, { status: 401 });
  }

  const { data: project } = await supabaseAdmin
    .from("projects")
    .select("id, user_id, share_token, share_message")
    .eq("id", params.id)
    .single();
  if (!project || project.user_id !== user.id) {
    return NextResponse.json({ error: "projeto não encontrado" }, { status: 404 });
  }

  return NextResponse.json({
    enabled: !!project.share_token,
    shareToken: project.share_token ?? null,
    shareUrl: project.share_token ? shareUrlFor(req, project.share_token) : null,
    message: project.share_message ?? "",
  });
}

// POST { enabled?: boolean, message?: string } → ativa/revoga o link e/ou salva
// a mensagem. Ativar gera um token (se ainda não existir); desativar zera o token.
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "não autenticado" }, { status: 401 });
  }

  const { data: project } = await supabaseAdmin
    .from("projects")
    .select("id, user_id, name, share_token")
    .eq("id", params.id)
    .single();
  if (!project || project.user_id !== user.id) {
    return NextResponse.json({ error: "projeto não encontrado" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const update: { share_token?: string | null; share_message?: string } = {};

  if (typeof body.enabled === "boolean") {
    if (body.enabled) {
      // Mantém o token existente (link estável) ou gera um novo a partir do
      // nome da pasta ao ativar.
      update.share_token =
        project.share_token ?? (await generateShareToken(project.name));
    } else {
      update.share_token = null;
    }
  }

  if (typeof body.message === "string") {
    update.share_message = body.message.slice(0, MESSAGE_MAX);
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json(
      { error: "nada para atualizar (envie enabled e/ou message)" },
      { status: 400 }
    );
  }

  const { data: updated, error: updErr } = await supabaseAdmin
    .from("projects")
    .update(update)
    .eq("id", params.id)
    .eq("user_id", user.id)
    .select("share_token, share_message")
    .single();
  if (updErr || !updated) {
    return NextResponse.json(
      { error: updErr?.message ?? "falha ao atualizar" },
      { status: 500 }
    );
  }

  return NextResponse.json({
    enabled: !!updated.share_token,
    shareToken: updated.share_token ?? null,
    shareUrl: updated.share_token ? shareUrlFor(req, updated.share_token) : null,
    message: updated.share_message ?? "",
  });
}
