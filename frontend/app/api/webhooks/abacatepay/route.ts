import { NextRequest, NextResponse } from "next/server";
import { cancelSubscription, verifyWebhookSignature } from "@/lib/abacatepay";
import { supabaseAdmin } from "@/lib/supabase";

// Webhook da AbacatePay. Cadastre no dashboard apontando para:
//   https://SEU_SITE/api/webhooks/abacatepay?webhookSecret=ABACATEPAY_WEBHOOK_SECRET
//
// Duas camadas de segurança (ver docs "Webhooks → Verificação e Segurança"):
//   1. o secret na query string precisa bater com ABACATEPAY_WEBHOOK_SECRET;
//   2. o header X-Webhook-Signature (HMAC-SHA256 do corpo raw) é validado.
//
// Eventos tratados (assinaturas dos planos pro/premium):
//   subscription.completed      → ativa a assinatura e o plano do usuário
//   subscription.renewed        → avança o período vigente
//   subscription.payment_failed → marca past_due (AbacatePay ainda retenta)
//   subscription.cancelled      → cancela e rebaixa o usuário para 'free'
//
// Retentativas reenviam o mesmo evento: o id é gravado em `webhook_events` e
// eventos repetidos respondem 200 sem reprocessar.

type WebhookSubscription = {
  id: string; // subs_...
  method?: string | null;
  status?: string;
};

type WebhookBody = {
  id?: string; // log_...
  event?: string;
  devMode?: boolean;
  data?: {
    subscription?: WebhookSubscription;
    checkout?: { id?: string; externalId?: string | null };
    payment?: { id?: string };
  };
};

function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d;
}

export async function POST(req: NextRequest) {
  // 1. Secret na URL.
  const expectedSecret = process.env.ABACATEPAY_WEBHOOK_SECRET;
  const gotSecret = req.nextUrl.searchParams.get("webhookSecret");
  if (!expectedSecret || gotSecret !== expectedSecret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // 2. Assinatura HMAC sobre o corpo raw.
  const rawBody = await req.text();
  const signature = req.headers.get("x-webhook-signature");
  if (!verifyWebhookSignature(rawBody, signature)) {
    return NextResponse.json({ error: "assinatura inválida" }, { status: 401 });
  }

  let body: WebhookBody;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const event = body.event ?? "";
  if (!event.startsWith("subscription.")) {
    // Outros eventos (checkout avulso etc.) não são usados — confirma o
    // recebimento para a AbacatePay não retentar.
    return NextResponse.json({ received: true, ignored: event });
  }

  const sub = body.data?.subscription;
  const checkout = body.data?.checkout;

  // 3. Idempotência: cada evento só é processado uma vez.
  const eventId =
    body.id ?? `${event}:${sub?.id ?? checkout?.id ?? "?"}:${body.data?.payment?.id ?? ""}`;
  const { error: dupErr } = await supabaseAdmin
    .from("webhook_events")
    .insert({ id: eventId, event });
  if (dupErr) {
    if (dupErr.code === "23505") {
      // chave duplicada = evento já processado
      return NextResponse.json({ received: true, duplicate: true });
    }
    return NextResponse.json({ error: dupErr.message }, { status: 500 });
  }

  const now = new Date();

  if (event === "subscription.completed") {
    // Localiza a linha criada no checkout: primeiro pelo externalId que
    // enviamos, senão pelo id do checkout (bill_...).
    let row = null;
    if (checkout?.externalId) {
      const { data } = await supabaseAdmin
        .from("subscriptions")
        .select("id, user_id, plan")
        .eq("external_id", checkout.externalId)
        .maybeSingle();
      row = data;
    }
    if (!row && checkout?.id) {
      const { data } = await supabaseAdmin
        .from("subscriptions")
        .select("id, user_id, plan")
        .eq("provider_checkout_id", checkout.id)
        .maybeSingle();
      row = data;
    }
    if (!row) {
      // Sem correspondência — responde 200 para não ficar em retentativa
      // eterna, mas registra no corpo para diagnóstico.
      return NextResponse.json({ received: true, warning: "assinatura não encontrada" });
    }

    await supabaseAdmin
      .from("subscriptions")
      .update({
        status: "active",
        method: sub?.method ?? null,
        provider_subscription_id: sub?.id ?? null,
        current_period_start: now.toISOString(),
        current_period_end: addMonths(now, 1).toISOString(),
        updated_at: now.toISOString(),
      })
      .eq("id", row.id);

    await supabaseAdmin.from("users").update({ plan: row.plan }).eq("id", row.user_id);

    // Upgrade/downgrade: cancela outras assinaturas ativas do usuário na
    // AbacatePay para não cobrar duas vezes. Best effort — falha aqui não
    // derruba a ativação.
    const { data: others } = await supabaseAdmin
      .from("subscriptions")
      .select("id, provider_subscription_id")
      .eq("user_id", row.user_id)
      .in("status", ["active", "past_due"])
      .neq("id", row.id);
    for (const other of others ?? []) {
      if (other.provider_subscription_id) {
        try {
          await cancelSubscription(other.provider_subscription_id);
        } catch {
          // já pode estar cancelada na AbacatePay; segue o baile
        }
      }
      await supabaseAdmin
        .from("subscriptions")
        .update({ status: "cancelled", updated_at: now.toISOString() })
        .eq("id", other.id);
    }

    return NextResponse.json({ received: true });
  }

  // Demais eventos referenciam a assinatura ativa (subs_...).
  if (!sub?.id) {
    return NextResponse.json({ received: true, warning: "evento sem subscription.id" });
  }
  const { data: row } = await supabaseAdmin
    .from("subscriptions")
    .select("id, user_id, plan")
    .eq("provider_subscription_id", sub.id)
    .maybeSingle();
  if (!row) {
    return NextResponse.json({ received: true, warning: "assinatura não encontrada" });
  }

  if (event === "subscription.renewed") {
    await supabaseAdmin
      .from("subscriptions")
      .update({
        status: "active",
        current_period_start: now.toISOString(),
        current_period_end: addMonths(now, 1).toISOString(),
        updated_at: now.toISOString(),
      })
      .eq("id", row.id);
    await supabaseAdmin.from("users").update({ plan: row.plan }).eq("id", row.user_id);
  } else if (event === "subscription.payment_failed") {
    // A AbacatePay retenta a cobrança (retryPolicy); o acesso só cai quando
    // vier subscription.cancelled.
    await supabaseAdmin
      .from("subscriptions")
      .update({ status: "past_due", updated_at: now.toISOString() })
      .eq("id", row.id);
  } else if (event === "subscription.cancelled") {
    await supabaseAdmin
      .from("subscriptions")
      .update({ status: "cancelled", updated_at: now.toISOString() })
      .eq("id", row.id);
    await supabaseAdmin.from("users").update({ plan: "free" }).eq("id", row.user_id);
  }

  return NextResponse.json({ received: true });
}
