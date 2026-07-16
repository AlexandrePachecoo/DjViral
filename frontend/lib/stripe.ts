import { createHmac, timingSafeEqual } from "crypto";
import { PLANS, type PlanDef } from "@/lib/plans";

// Cliente da API do Stripe (https://stripe.com), usado no locale en para
// cobrança internacional em USD. Server-side apenas: usa a secret key
// (STRIPE_SECRET_KEY). Sem SDK — chamadas REST form-encoded, no mesmo estilo
// leve do cliente da AbacatePay (lib/abacatepay.ts).
//
// Fluxo de assinatura (espelha o da AbacatePay):
//   1. garantimos que existe um Price recorrente mensal para o plano
//      (identificado pelo lookup_key fixo, ex.: djviral-pro-monthly);
//   2. criamos uma Checkout Session em modo `subscription` (cartão + carteiras
//      que o Stripe habilitar) e redirecionamos para a `url` hospedada;
//   3. os webhooks (checkout.session.completed / invoice.paid / ...) ativam o
//      plano e espelham em users.plan.

const BASE_URL = "https://api.stripe.com/v1";

function getApiKey(): string {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error("STRIPE_SECRET_KEY precisa estar definido no ambiente");
  }
  return key;
}

// Serializa um objeto aninhado no formato form-encoded que a API do Stripe
// espera (ex.: line_items[0][price]=..., metadata[plan]=...).
function toForm(obj: Record<string, unknown>, prefix = ""): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined || value === null) continue;
    const field = prefix ? `${prefix}[${key}]` : key;
    if (Array.isArray(value)) {
      value.forEach((item, i) => {
        if (item !== null && typeof item === "object") {
          parts.push(toForm(item as Record<string, unknown>, `${field}[${i}]`));
        } else {
          parts.push(`${encodeURIComponent(`${field}[${i}]`)}=${encodeURIComponent(String(item))}`);
        }
      });
    } else if (typeof value === "object") {
      parts.push(toForm(value as Record<string, unknown>, field));
    } else {
      parts.push(`${encodeURIComponent(field)}=${encodeURIComponent(String(value))}`);
    }
  }
  return parts.filter(Boolean).join("&");
}

type StripeError = { error?: { message?: string; type?: string } };

async function stripeFetch<T>(
  path: string,
  init?: { method?: "GET" | "POST" | "DELETE"; body?: Record<string, unknown> }
): Promise<T> {
  const method = init?.method ?? "GET";
  const hasBody = init?.body !== undefined && method !== "GET";
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${getApiKey()}`,
      ...(hasBody ? { "content-type": "application/x-www-form-urlencoded" } : {}),
    },
    body: hasBody ? toForm(init!.body!) : undefined,
    cache: "no-store",
  });

  const json = (await res.json().catch(() => ({}))) as T & StripeError;
  if (!res.ok || (json as StripeError).error) {
    const msg = (json as StripeError).error?.message ?? "erro desconhecido";
    throw new Error(`Stripe ${path} falhou (HTTP ${res.status}): ${msg}`);
  }
  return json as T;
}

type Price = { id: string; active: boolean; lookup_key: string | null };
type PriceList = { data: Price[] };
type Product = { id: string };
type Session = { id: string; url: string | null };

// Garante que existe um Price recorrente (USD, mensal) para o plano e retorna
// o id (price_...). É identificado pelo lookup_key fixo do plano; na primeira
// vez cria o Product + Price. `transfer_lookup_key` move a chave caso já
// esteja num Price antigo (ex.: mudança de valor).
async function ensurePrice(plan: PlanDef): Promise<string> {
  if (!plan.productExternalId || plan.priceCentsUsd <= 0) {
    throw new Error(`plano ${plan.id} não é assinável`);
  }
  const lookupKey = plan.productExternalId;

  const existing = await stripeFetch<PriceList>(
    `/prices?lookup_keys[]=${encodeURIComponent(lookupKey)}&active=true&limit=1`
  );
  const found = existing.data.find((p) => p.lookup_key === lookupKey);
  if (found) return found.id;

  const product = await stripeFetch<Product>("/products", {
    method: "POST",
    body: {
      name: `DJviral ${plan.label}`,
      description: `DJviral ${plan.label} plan — up to ${plan.hours}h of sets per month`,
      metadata: { plan: plan.id },
    },
  });

  const price = await stripeFetch<Price>("/prices", {
    method: "POST",
    body: {
      product: product.id,
      unit_amount: plan.priceCentsUsd,
      currency: "usd",
      recurring: { interval: "month" },
      lookup_key: lookupKey,
      transfer_lookup_key: true,
    },
  });
  return price.id;
}

// Cria uma Checkout Session de assinatura e retorna a URL hospedada + o id da
// sessão (cs_...). O `client_reference_id` e a metadata carregam o nosso
// external_id para o webhook casar com a linha de subscriptions.
export async function createStripeCheckout(opts: {
  planId: "pro" | "premium";
  externalId: string;
  userId: string;
  userEmail: string;
  appUrl: string;
}): Promise<{ checkoutId: string; url: string }> {
  const plan = PLANS[opts.planId];
  const priceId = await ensurePrice(plan);

  const session = await stripeFetch<Session>("/checkout/sessions", {
    method: "POST",
    body: {
      mode: "subscription",
      // Explícito: sem isto o Stripe usa os "automatic payment methods" do
      // dashboard e rejeita a sessão (HTTP 400) se a conta não tiver método
      // ativado para USD. `card` cobre USD em qualquer conta ativada e ainda
      // oferece Apple/Google Pay por baixo do mesmo tipo no Checkout.
      payment_method_types: ["card"],
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${opts.appUrl}/app?billing=success`,
      cancel_url: `${opts.appUrl}/app?billing=cancelled`,
      client_reference_id: opts.externalId,
      customer_email: opts.userEmail,
      metadata: {
        user_id: opts.userId,
        user_email: opts.userEmail,
        plan: plan.id,
        external_id: opts.externalId,
      },
      subscription_data: {
        metadata: {
          user_id: opts.userId,
          plan: plan.id,
          external_id: opts.externalId,
        },
      },
    },
  });

  if (!session.url) {
    throw new Error("Stripe não retornou a URL do checkout");
  }
  return { checkoutId: session.id, url: session.url };
}

// Cancela imediatamente uma assinatura do Stripe (sub_...).
export async function cancelStripeSubscription(subscriptionId: string): Promise<void> {
  await stripeFetch(`/subscriptions/${encodeURIComponent(subscriptionId)}`, {
    method: "DELETE",
  });
}

// Valida o header Stripe-Signature (formato "t=<ts>,v1=<hmac>"). O payload
// assinado é `${t}.${rawBody}` com HMAC-SHA256 em hex sobre a
// STRIPE_WEBHOOK_SECRET (whsec_...). Rejeita eventos com mais de `toleranceSec`
// de idade (proteção contra replay). Ver Stripe → "Verify signatures manually".
export function verifyStripeSignature(
  rawBody: string,
  sigHeader: string | null,
  toleranceSec = 300
): boolean {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret || !sigHeader) return false;

  let timestamp = "";
  const signatures: string[] = [];
  for (const part of sigHeader.split(",")) {
    const [k, v] = part.split("=");
    if (k === "t") timestamp = v;
    else if (k === "v1") signatures.push(v);
  }
  if (!timestamp || signatures.length === 0) return false;

  const age = Math.floor(Date.now() / 1000) - Number(timestamp);
  if (!Number.isFinite(age) || Math.abs(age) > toleranceSec) return false;

  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`, "utf8")
    .digest("hex");
  const a = Buffer.from(expected);
  return signatures.some((sig) => {
    const b = Buffer.from(sig);
    return a.length === b.length && timingSafeEqual(a, b);
  });
}
