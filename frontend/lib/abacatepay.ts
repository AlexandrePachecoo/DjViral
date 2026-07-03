import { createHmac, timingSafeEqual } from "crypto";
import { PLANS, type PlanDef } from "@/lib/plans";

// Cliente da API v2 da AbacatePay (https://docs.abacatepay.com).
// Server-side apenas: usa a API key secreta (ABACATEPAY_API_KEY).
//
// Fluxo de assinatura:
//   1. garantimos que o produto do plano existe na loja (ciclo MONTHLY);
//   2. criamos um checkout de assinatura (POST /subscriptions/create) com
//      methods ["PIX", "CARD"] — o cliente escolhe na página hospedada;
//   3. redirecionamos o usuário para a `url` retornada;
//   4. os webhooks (subscription.completed/renewed/...) ativam o plano.

const BASE_URL = "https://api.abacatepay.com/v2";

// Chave pública fixa da AbacatePay usada na assinatura HMAC-SHA256 dos
// webhooks (header X-Webhook-Signature). Ver docs: Webhooks → Segurança.
const ABACATEPAY_WEBHOOK_PUBLIC_KEY =
  "t9dXRhHHo3yDEj5pVDYz0frf7q6bMKyMRmxxCPIPp3RCplBfXRxqlC6ZpiWmOqj4L63qEaeUOtrCI8P0VMUgo6iIga2ri9ogaHFs0WIIywSMg0q7RmBfybe1E5XJcfC4IW3alNqym0tXoAKkzvfEjZxV6bE0oG2zJrNNYmUCKZyV0KZ3JS8Votf9EAWWYdiDkMkpbMdPggfh1EqHlVkMiTady6jOR3hyzGEHrIz2Ret0xHKMbiqkr9HS1JhNHDX9";

function getApiKey(): string {
  const key = process.env.ABACATEPAY_API_KEY;
  if (!key) {
    throw new Error("ABACATEPAY_API_KEY precisa estar definido no ambiente");
  }
  return key;
}

type AbacateResponse<T> = { data?: T; error?: string | null };

async function abacateFetch<T>(
  path: string,
  init?: { method?: "GET" | "POST"; body?: unknown }
): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: init?.method ?? "GET",
    headers: {
      authorization: `Bearer ${getApiKey()}`,
      "content-type": "application/json",
    },
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
  });

  const json = (await res.json().catch(() => ({}))) as AbacateResponse<T>;
  if (!res.ok || json.error) {
    throw new Error(
      `AbacatePay ${path} falhou (HTTP ${res.status}): ${json.error ?? "erro desconhecido"}`
    );
  }
  if (json.data === undefined) {
    throw new Error(`AbacatePay ${path}: resposta sem campo data`);
  }
  return json.data;
}

type Product = {
  id: string;
  externalId: string;
  price: number;
  status: "ACTIVE" | "INACTIVE";
  cycle: string | null;
};

type Billing = {
  id: string; // bill_...
  url: string; // página de pagamento hospedada
  amount: number;
  status: string;
};

// Garante que o produto de assinatura do plano existe na loja AbacatePay e
// retorna o id público (prod_...). Produtos são identificados pelo
// `externalId` fixo do plano (ex.: djviral-pro-monthly) e criados com ciclo
// MONTHLY na primeira vez.
async function ensureProduct(plan: PlanDef): Promise<string> {
  if (!plan.productExternalId || plan.priceCents <= 0) {
    throw new Error(`plano ${plan.id} não é assinável`);
  }

  const existing = await abacateFetch<Product[]>(
    `/products/list?externalId=${encodeURIComponent(plan.productExternalId)}&limit=1`
  );
  const found = existing.find((p) => p.externalId === plan.productExternalId);
  if (found) return found.id;

  const created = await abacateFetch<Product>("/products/create", {
    method: "POST",
    body: {
      externalId: plan.productExternalId,
      name: `DJviral ${plan.label}`,
      description: `Plano ${plan.label} do DJviral — até ${plan.hours}h de set por mês`,
      price: plan.priceCents,
      currency: "BRL",
      cycle: "MONTHLY",
    },
  });
  return created.id;
}

// Cria um checkout de assinatura (PIX ou cartão com recorrência mensal) e
// retorna a URL da página de pagamento + o id do checkout (bill_...).
export async function createSubscriptionCheckout(opts: {
  planId: "pro" | "premium";
  externalId: string; // nosso id da assinatura (subscriptions.external_id)
  userId: string;
  userEmail: string;
  appUrl: string; // origem pública do site (para returnUrl/completionUrl)
}): Promise<{ checkoutId: string; url: string }> {
  const plan = PLANS[opts.planId];
  const productId = await ensureProduct(plan);

  const billing = await abacateFetch<Billing>("/subscriptions/create", {
    method: "POST",
    body: {
      items: [{ id: productId, quantity: 1 }],
      methods: ["PIX", "CARD"],
      externalId: opts.externalId,
      returnUrl: `${opts.appUrl}/app?billing=cancelled`,
      completionUrl: `${opts.appUrl}/app?billing=success`,
      metadata: {
        user_id: opts.userId,
        user_email: opts.userEmail,
        plan: plan.id,
      },
    },
  });

  return { checkoutId: billing.id, url: billing.url };
}

export async function cancelSubscription(providerSubscriptionId: string): Promise<void> {
  await abacateFetch("/subscriptions/cancel", {
    method: "POST",
    body: { id: providerSubscriptionId },
  });
}

// Valida o header X-Webhook-Signature (HMAC-SHA256 em base64 sobre o corpo
// raw, com a chave pública da AbacatePay).
export function verifyWebhookSignature(rawBody: string, signature: string | null): boolean {
  if (!signature) return false;
  const expected = createHmac("sha256", ABACATEPAY_WEBHOOK_PUBLIC_KEY)
    .update(Buffer.from(rawBody, "utf8"))
    .digest("base64");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}
