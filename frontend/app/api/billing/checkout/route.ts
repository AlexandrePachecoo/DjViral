import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getSessionUser } from "@/lib/auth";
import { createSubscriptionCheckout } from "@/lib/abacatepay";
import { isBillingCycle } from "@/lib/plans";
import { supabaseAdmin } from "@/lib/supabase";

// Cria um checkout de assinatura para o plano+ciclo pedidos e devolve a URL da
// página de pagamento hospedada da AbacatePay (BRL, PIX ou cartão — a única
// cobrança do produto; o Stripe/USD foi descontinuado). Uma linha
// `subscriptions` nasce com status 'pending' e o `cycle` gravado; o webhook a
// ativa e espelha o plano em users.plan.
//
// Body: { plan: "pro" | "premium", cycle?: "monthly" | "annual" } (default
// mensal). Trocar só o ciclo do mesmo plano (mensal → anual) é permitido: o
// webhook cancela a assinatura antiga quando a nova é paga.
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "não autenticado" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const plan = body?.plan;
  const cycle = body?.cycle ?? "monthly";
  if (plan !== "pro" && plan !== "premium") {
    return NextResponse.json(
      { error: "plan deve ser 'pro' ou 'premium'" },
      { status: 400 }
    );
  }
  if (!isBillingCycle(cycle)) {
    return NextResponse.json(
      { error: "cycle deve ser 'monthly' ou 'annual'" },
      { status: 400 }
    );
  }

  if (user.plan === plan) {
    const { data: current } = await supabaseAdmin
      .from("subscriptions")
      .select("cycle")
      .eq("user_id", user.id)
      .in("status", ["active", "past_due"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    // Sem assinatura (plano setado à mão) ou mesmo ciclo → nada a fazer.
    if (!current || (current.cycle ?? "monthly") === cycle) {
      return NextResponse.json(
        { error: "você já está neste plano" },
        { status: 400 }
      );
    }
  }

  const externalId = `djviral-sub-${randomUUID()}`;
  const appUrl = process.env.APP_URL ?? req.nextUrl.origin;

  let checkout: { checkoutId: string; url: string };
  try {
    checkout = await createSubscriptionCheckout({
      planId: plan,
      cycle,
      externalId,
      userId: user.id,
      userEmail: user.email,
      appUrl,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "falha ao criar checkout" },
      { status: 502 }
    );
  }

  const row = {
    user_id: user.id,
    plan,
    cycle,
    status: "pending",
    provider: "abacatepay",
    external_id: externalId,
    provider_checkout_id: checkout.checkoutId,
  };
  let { error } = await supabaseAdmin.from("subscriptions").insert(row);
  if (error && (error.code === "42703" || error.code === "PGRST204")) {
    // Banco sem a migração de `subscriptions.cycle`: grava sem a coluna (o
    // webhook não depende dela) em vez de perder um checkout já criado.
    const { cycle: _omit, ...legacy } = row;
    ({ error } = await supabaseAdmin.from("subscriptions").insert(legacy));
  }
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ url: checkout.url });
}
