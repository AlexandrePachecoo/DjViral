import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getSessionUser, hashPassword, verifyPassword } from "@/lib/auth";

// Troca a senha do usuário logado: confere a senha atual e grava a nova (hash
// scrypt). Mesma regra de tamanho mínimo do cadastro (>= 6).
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "não autenticado" }, { status: 401 });
  }

  const { currentPassword, newPassword } = await req.json();
  if (!currentPassword || !newPassword) {
    return NextResponse.json(
      { error: "senha atual e nova senha são obrigatórias" },
      { status: 400 }
    );
  }
  if (String(newPassword).length < 6) {
    return NextResponse.json(
      { error: "a nova senha deve ter ao menos 6 caracteres" },
      { status: 400 }
    );
  }

  const { data: row } = await supabaseAdmin
    .from("users")
    .select("password")
    .eq("id", user.id)
    .maybeSingle();

  if (!row || !verifyPassword(String(currentPassword), row.password)) {
    return NextResponse.json({ error: "senha atual incorreta" }, { status: 401 });
  }

  const { error } = await supabaseAdmin
    .from("users")
    .update({ password: hashPassword(String(newPassword)) })
    .eq("id", user.id);

  if (error) {
    return NextResponse.json(
      { error: "não foi possível alterar a senha" },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
