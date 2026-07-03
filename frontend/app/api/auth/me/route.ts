import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getSessionUser } from "@/lib/auth";

// Usuário autenticado (ou null). Usado pelo frontend para mostrar a sessão.
export async function GET() {
  const user = await getSessionUser();
  return NextResponse.json({ user });
}

// Atualiza o perfil do usuário logado (por enquanto, só o nome de exibição).
export async function PATCH(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "não autenticado" }, { status: 401 });
  }

  const { name } = await req.json();
  const trimmed = typeof name === "string" ? name.trim() : "";
  if (!trimmed) {
    return NextResponse.json({ error: "nome é obrigatório" }, { status: 400 });
  }
  if (trimmed.length > 60) {
    return NextResponse.json(
      { error: "nome deve ter no máximo 60 caracteres" },
      { status: 400 }
    );
  }

  const { data, error } = await supabaseAdmin
    .from("users")
    .update({ name: trimmed })
    .eq("id", user.id)
    .select("id, name, email, plan")
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: "não foi possível atualizar o nome" },
      { status: 500 }
    );
  }

  return NextResponse.json({ user: data });
}
