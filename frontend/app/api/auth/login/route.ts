import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { verifyPassword, sessionCookie } from "@/lib/auth";

// Login: valida email + senha e grava o cookie de sessão.
export async function POST(req: NextRequest) {
  const { email, password } = await req.json();
  if (!email || !password) {
    return NextResponse.json(
      { error: "email e password são obrigatórios" },
      { status: 400 }
    );
  }

  const normalizedEmail = String(email).trim().toLowerCase();
  const { data: user } = await supabaseAdmin
    .from("users")
    .select("id, name, email, plan, password")
    .eq("email", normalizedEmail)
    .maybeSingle();

  // Mensagem genérica para não revelar se o email existe.
  if (!user || !verifyPassword(String(password), user.password)) {
    return NextResponse.json(
      { error: "email ou senha incorretos" },
      { status: 401 }
    );
  }

  const res = NextResponse.json({
    user: { id: user.id, name: user.name, email: user.email, plan: user.plan },
  });
  res.cookies.set(sessionCookie(user.id));
  return res;
}
