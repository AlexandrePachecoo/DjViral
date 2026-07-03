import { NextResponse } from "next/server";
import { getPublicShare } from "@/lib/share";

// Leitura PÚBLICA de um set compartilhado. Único endpoint sem gate de sessão:
// resolve o share_token → nome do set + mensagem do dono + cortes salvos/prontos.
// Os vídeos (cuts.url) já são URLs públicas do bucket `clips`.
export async function GET(
  _req: Request,
  { params }: { params: { token: string } }
) {
  const share = await getPublicShare(params.token);
  if (!share) {
    return NextResponse.json({ error: "não encontrado" }, { status: 404 });
  }
  return NextResponse.json(share);
}
