import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";

// Usuário autenticado (ou null). Usado pelo frontend para mostrar a sessão.
export async function GET() {
  const user = await getSessionUser();
  return NextResponse.json({ user });
}
