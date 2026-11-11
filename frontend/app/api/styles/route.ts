import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getSessionUser } from "@/lib/auth";
import {
  MAX_CUSTOM_STYLES,
  MAX_STYLE_DESCRIPTION,
  MAX_STYLE_NAME,
  sanitizeEditStyle,
} from "@/lib/editStyles";

// Estilos de edição personalizados do usuário (tabela `edit_styles`).

export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "não autenticado" }, { status: 401 });
  }
  const { data, error } = await supabaseAdmin
    .from("edit_styles")
    .select("id, name, description, style, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });
  if (error) {
    // Banco sem a migração (42P01 / PGRST205 = tabela inexistente): a UI
    // segue só com os estilos prontos.
    if (error.code === "42P01" || error.code === "PGRST205") {
      return NextResponse.json({ styles: [] });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ styles: data ?? [] });
}

// Cria um estilo. Dois modos:
//   - `{ description }`: a IA do worker traduz a descrição em texto do usuário
//     para a configuração do editor (e sugere o nome);
//   - `{ name, style }`: estilo montado à mão (ou a edição de um gerado).
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "não autenticado" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));

  const { count } = await supabaseAdmin
    .from("edit_styles")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id);
  if ((count ?? 0) >= MAX_CUSTOM_STYLES) {
    return NextResponse.json(
      { error: `limite de ${MAX_CUSTOM_STYLES} estilos atingido`, code: "style_limit" },
      { status: 409 }
    );
  }

  let name: string;
  let description: string | null = null;
  let style = null;

  if (typeof body.description === "string" && body.description.trim()) {
    description = body.description.trim().slice(0, MAX_STYLE_DESCRIPTION);
    const workerUrl = process.env.WORKER_URL;
    const secret = process.env.WORKER_SECRET;
    if (!workerUrl || !secret) {
      return NextResponse.json(
        { error: "WORKER_URL/WORKER_SECRET não configurados" },
        { status: 500 }
      );
    }
    const res = await fetch(`${workerUrl}/styles/generate`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-worker-secret": secret },
      body: JSON.stringify({ description }),
    });
    if (!res.ok) {
      return NextResponse.json(
        { error: "IA indisponível no momento", code: "ai_unavailable" },
        { status: 502 }
      );
    }
    const generated = await res.json();
    style = sanitizeEditStyle(generated.style);
    name = String(generated.name ?? "");
  } else {
    style = sanitizeEditStyle(body.style);
    name = String(body.name ?? "");
  }

  name = name.replace(/\s+/g, " ").trim().slice(0, MAX_STYLE_NAME);
  if (!style || !name) {
    return NextResponse.json({ error: "name e style são obrigatórios" }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from("edit_styles")
    .insert({ user_id: user.id, name, description, style })
    .select("id, name, description, style, created_at")
    .single();
  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? "falha ao salvar o estilo" },
      { status: 500 }
    );
  }
  return NextResponse.json({ style: data });
}
