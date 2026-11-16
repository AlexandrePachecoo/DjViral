import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getSessionUser } from "@/lib/auth";
import { cancelProviderSubscription } from "@/lib/billing";

// Cancela a assinatura ativa do usuário na AbacatePay e rebaixa para o plano
// free. Espelha o que o webhook faz num downgrade
// (frontend/app/api/webhooks/abacatepay/route.ts).
export async function POST() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "não autenticado" }, { status: 401 });
  }

  const { data: sub } = await supabaseAdmin
    .from("subscriptions")
    .select("id, provider, provider_subscription_id")
    .eq("user_id", user.id)
    .in("status", ["active", "past_due"])
    .order("updated_at", { ascending: false })
    .maybeSingle();

  if (!sub) {
    return NextResponse.json(
      { error: "nenhuma assinatura ativa" },
      { status: 400 }
    );
  }

  // Assinatura antiga do Stripe: a integração foi removida, então não dá para
  // cancelar a cobrança daqui. Rebaixar só no nosso banco deixaria o cartão
  // sendo cobrado — recusa e manda para o suporte.
  if (sub.provider === "stripe") {
    return NextResponse.json(
      {
        error:
          "Esta assinatura foi feita pelo Stripe e precisa ser cancelada pelo suporte.",
      },
      { status: 409 }
    );
  }

  // Best effort: pode já estar cancelada no provedor; segue o downgrade.
  if (sub.provider_subscription_id) {
    try {
      await cancelProviderSubscription(sub.provider, sub.provider_subscription_id);
    } catch {
      // ignora — a assinatura pode já não existir do lado do provedor.
    }
  }

  const now = new Date().toISOString();
  await supabaseAdmin
    .from("subscriptions")
    .update({ status: "cancelled", updated_at: now })
    .eq("id", sub.id);
  await supabaseAdmin.from("users").update({ plan: "free" }).eq("id", user.id);

  return NextResponse.json({ ok: true });
}
