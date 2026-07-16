import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getSessionUser } from "@/lib/auth";
import { cancelProviderSubscription } from "@/lib/billing";

// Cancela a assinatura ativa do usuário no provedor certo (Stripe ou
// AbacatePay) e rebaixa para o plano free. Espelha o que os webhooks fazem num
// downgrade (frontend/app/api/webhooks/{abacatepay,stripe}/route.ts).
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
