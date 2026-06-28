import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { hashPassword, sessionCookie } from "@/lib/auth";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Cadastro de usuário. Sem pagamento: todo mundo entra no plano "free".
export async function POST(req: NextRequest) {
  const { name, email, password } = await req.json();

  if (!name || !email || !password) {
    return NextResponse.json(
      { error: "name, email e password são obrigatórios" },
      { status: 400 }
    );
  }
  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ error: "email inválido" }, { status: 400 });
  }
  if (String(password).length < 6) {
    return NextResponse.json(
      { error: "a senha precisa ter ao menos 6 caracteres" },
      { status: 400 }
    );
  }

  const normalizedEmail = String(email).trim().toLowerCase();

  // Email já cadastrado?
  const { data: existing } = await supabaseAdmin
    .from("users")
    .select("id")
    .eq("email", normalizedEmail)
    .maybeSingle();
  if (existing) {
    return NextResponse.json(
      { error: "já existe uma conta com esse email" },
      { status: 409 }
    );
  }

  const { data: user, error } = await supabaseAdmin
    .from("users")
    .insert({
      name: String(name).trim(),
      email: normalizedEmail,
      password: hashPassword(String(password)),
      plan: "free",
    })
    .select("id, name, email, plan")
    .single();
  if (error || !user) {
    return NextResponse.json(
      { error: error?.message ?? "falha ao criar conta" },
      { status: 500 }
    );
  }

  const res = NextResponse.json({
    user: { id: user.id, name: user.name, email: user.email, plan: user.plan },
  });
  res.cookies.set(sessionCookie(user.id));
  return res;
}
