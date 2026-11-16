import { createHmac, timingSafeEqual } from "crypto";

// Cliente LEGADO da API do Stripe (https://stripe.com). A cobrança internacional
// em USD foi descontinuada: novos checkouts são sempre AbacatePay (BRL). O que
// sobra aqui serve só às assinaturas Stripe antigas que ainda existam — o
// webhook (/api/webhooks/stripe) continua tratando renovação/cancelamento e o
// cancelamento/upgrade (lib/billing.ts) ainda consegue cancelá-las no Stripe.
// Server-side apenas: usa a secret key (STRIPE_SECRET_KEY). Sem SDK — chamadas
// REST form-encoded.

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
