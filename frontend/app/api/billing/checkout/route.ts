import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getSessionUser } from "@/lib/auth";
import { createSubscriptionCheckout } from "@/lib/abacatepay";
import { createStripeCheckout } from "@/lib/stripe";
import { providerForLocale } from "@/lib/plans";
import { localeFromHost, defaultLocale } from "@/i18n/config";
import { supabaseAdmin } from "@/lib/supabase";

// Cria um checkout de assinatura para o plano pedido e devolve a URL da página
// de pagamento hospedada. O provedor é escolhido pelo locale (host): Stripe
// (USD, cartão) no internacional (en), AbacatePay (BRL, PIX ou cartão) no
// Brasil (pt). Uma linha `subscriptions` nasce com status 'pending' e o
// `provider` gravado; o webhook correspondente a ativa e espelha o plano em
// users.plan.
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "não autenticado" }, { status: 401 });
  }

  const { plan } = await req.json().catch(() => ({}));
  if (plan !== "pro" && plan !== "premium") {
    return NextResponse.json(
      { error: "plan deve ser 'pro' ou 'premium'" },
      { status: 400 }
    );
  }
  if (user.plan === plan) {
    return NextResponse.json(
      { error: "você já está neste plano" },
      { status: 400 }
    );
  }

  const externalId = `djviral-sub-${randomUUID()}`;
  const appUrl = process.env.APP_URL ?? req.nextUrl.origin;

  // Locale (e provedor) pelo host: djviral.com.br → pt/abacatepay,
  // Vercel/internacional → en/stripe. Sem host reconhecido cai no default (pt).
  const locale = localeFromHost(req.headers.get("host")) ?? defaultLocale;
  const provider = providerForLocale(locale);

  let checkout: { checkoutId: string; url: string };
  try {
    checkout =
      provider === "stripe"
        ? await createStripeCheckout({
            planId: plan,
            externalId,
            userId: user.id,
            userEmail: user.email,
            appUrl,
          })
        : await createSubscriptionCheckout({
            planId: plan,
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

  const { error } = await supabaseAdmin.from("subscriptions").insert({
    user_id: user.id,
    plan,
    status: "pending",
    provider,
    external_id: externalId,
    provider_checkout_id: checkout.checkoutId,
  });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ url: checkout.url });
}
