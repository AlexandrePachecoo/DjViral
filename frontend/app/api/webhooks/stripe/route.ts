import { NextRequest, NextResponse } from "next/server";
import { verifyStripeSignature } from "@/lib/stripe";
import { cancelProviderSubscription } from "@/lib/billing";
import { supabaseAdmin } from "@/lib/supabase";

// Webhook do Stripe (cobrança internacional em USD do locale en). Cadastre no
// dashboard do Stripe (Developers → Webhooks) apontando para:
//   https://SEU_SITE/api/webhooks/stripe
// com o signing secret (whsec_...) em STRIPE_WEBHOOK_SECRET.
//
// Segurança: o header Stripe-Signature (HMAC-SHA256 do `${timestamp}.${body}`)
// é validado contra STRIPE_WEBHOOK_SECRET, com janela de tolerância anti-replay.
//
// Eventos tratados (assinaturas dos planos pro/premium):
//   checkout.session.completed  → ativa a assinatura e o plano do usuário
//   invoice.paid                → renovação: avança o período vigente
//   invoice.payment_failed      → marca past_due (Stripe ainda retenta)
//   customer.subscription.deleted → cancela e rebaixa o usuário para 'free'
//
// Idempotência: o id do evento (evt_...) é gravado em `webhook_events`;
// retentativas do mesmo evento respondem 200 sem reprocessar.

// O corpo precisa ser lido cru (sem parse) para a verificação da assinatura.
export const runtime = "nodejs";

type StripeEvent = {
  id?: string;
  type?: string;
  data?: { object?: Record<string, unknown> };
};

function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d;
}

// Fim do período: usa o `current_period_end` (epoch em segundos) que o Stripe
// manda quando disponível; senão, agora + 1 mês.
function periodEnd(fromEpochSec: unknown, now: Date): string {
  if (typeof fromEpochSec === "number" && fromEpochSec > 0) {
    return new Date(fromEpochSec * 1000).toISOString();
  }
  return addMonths(now, 1).toISOString();
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const signature = req.headers.get("stripe-signature");
  if (!verifyStripeSignature(rawBody, signature)) {
    return NextResponse.json({ error: "assinatura inválida" }, { status: 401 });
  }

  let body: StripeEvent;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const event = body.type ?? "";
  const obj = body.data?.object ?? {};

  const HANDLED = new Set([
    "checkout.session.completed",
    "invoice.paid",
    "invoice.payment_failed",
    "customer.subscription.deleted",
  ]);
  if (!HANDLED.has(event)) {
    // Evento que não usamos — confirma o recebimento para o Stripe não retentar.
    return NextResponse.json({ received: true, ignored: event });
  }

  // Idempotência: cada evento (evt_...) só é processado uma vez.
  const eventId = body.id ?? `stripe:${event}:${(obj.id as string) ?? "?"}`;
  const { error: dupErr } = await supabaseAdmin
    .from("webhook_events")
    .insert({ id: eventId, event });
  if (dupErr) {
    if (dupErr.code === "23505") {
      return NextResponse.json({ received: true, duplicate: true });
    }
    return NextResponse.json({ error: dupErr.message }, { status: 500 });
  }

  const now = new Date();

  if (event === "checkout.session.completed") {
    if (obj.mode !== "subscription") {
      return NextResponse.json({ received: true, ignored: "non-subscription session" });
    }
    const externalId =
      (obj.client_reference_id as string | null) ??
      ((obj.metadata as Record<string, string> | undefined)?.external_id ?? null);
    const subscriptionId = (obj.subscription as string | null) ?? null;

    // Localiza a linha criada no checkout pelo externalId; senão, pelo id da
    // sessão (cs_...) que gravamos em provider_checkout_id.
    let row: { id: string; user_id: string; plan: string } | null = null;
    if (externalId) {
      const { data } = await supabaseAdmin
        .from("subscriptions")
        .select("id, user_id, plan")
        .eq("external_id", externalId)
        .maybeSingle();
      row = data;
    }
    if (!row && obj.id) {
      const { data } = await supabaseAdmin
        .from("subscriptions")
        .select("id, user_id, plan")
        .eq("provider_checkout_id", obj.id as string)
        .maybeSingle();
      row = data;
    }
    if (!row) {
      return NextResponse.json({ received: true, warning: "assinatura não encontrada" });
    }

    await supabaseAdmin
      .from("subscriptions")
      .update({
        status: "active",
        method: "CARD",
        provider_subscription_id: subscriptionId,
        current_period_start: now.toISOString(),
        current_period_end: addMonths(now, 1).toISOString(),
        updated_at: now.toISOString(),
      })
      .eq("id", row.id);

    await supabaseAdmin.from("users").update({ plan: row.plan }).eq("id", row.user_id);

    // Upgrade/downgrade: cancela outras assinaturas ativas do usuário (em
    // qualquer provedor) para não cobrar duas vezes. Best effort.
    const { data: others } = await supabaseAdmin
      .from("subscriptions")
      .select("id, provider, provider_subscription_id")
      .eq("user_id", row.user_id)
      .in("status", ["active", "past_due"])
      .neq("id", row.id);
    for (const other of others ?? []) {
      if (other.provider_subscription_id) {
        try {
          await cancelProviderSubscription(other.provider, other.provider_subscription_id);
        } catch {
          // pode já estar cancelada no provedor; segue o baile
        }
      }
      await supabaseAdmin
        .from("subscriptions")
        .update({ status: "cancelled", updated_at: now.toISOString() })
        .eq("id", other.id);
    }

    return NextResponse.json({ received: true });
  }

  // Os demais eventos referenciam a assinatura ativa (sub_...).
  const subscriptionId =
    event === "customer.subscription.deleted"
      ? (obj.id as string | null)
      : (obj.subscription as string | null); // invoice.subscription

  if (!subscriptionId) {
    return NextResponse.json({ received: true, warning: "evento sem subscription id" });
  }
  const { data: row } = await supabaseAdmin
    .from("subscriptions")
    .select("id, user_id, plan")
    .eq("provider_subscription_id", subscriptionId)
    .maybeSingle();
  if (!row) {
    return NextResponse.json({ received: true, warning: "assinatura não encontrada" });
  }

  if (event === "invoice.paid") {
    // A primeira fatura (billing_reason=subscription_create) já é coberta pelo
    // checkout.session.completed; só a renovação avança o período.
    if (obj.billing_reason && obj.billing_reason !== "subscription_cycle") {
      return NextResponse.json({ received: true, ignored: "first invoice" });
    }
    await supabaseAdmin
      .from("subscriptions")
      .update({
        status: "active",
        current_period_start: now.toISOString(),
        current_period_end: periodEnd(obj.period_end, now),
        updated_at: now.toISOString(),
      })
      .eq("id", row.id);
    await supabaseAdmin.from("users").update({ plan: row.plan }).eq("id", row.user_id);
  } else if (event === "invoice.payment_failed") {
    await supabaseAdmin
      .from("subscriptions")
      .update({ status: "past_due", updated_at: now.toISOString() })
      .eq("id", row.id);
  } else if (event === "customer.subscription.deleted") {
    await supabaseAdmin
      .from("subscriptions")
      .update({ status: "cancelled", updated_at: now.toISOString() })
      .eq("id", row.id);
    await supabaseAdmin.from("users").update({ plan: "free" }).eq("id", row.user_id);
  }

  return NextResponse.json({ received: true });
}
