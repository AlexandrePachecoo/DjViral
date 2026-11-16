import { supabaseAdmin } from "@/lib/supabase";

// Planos do DjViral. O plano efetivo do usuário vive em `users.plan`
// (espelhado pelos webhooks da AbacatePay — ver /api/webhooks/abacatepay).
// Só existe cobrança no Brasil (BRL, AbacatePay); o preço em USD/Stripe foi
// descontinuado.
//
//   free    → teste grátis: 1 hora de set no TOTAL e 10 cortes por geração
//   pro     → R$49,90/mês (ou R$499/ano): 5h de set e até 8 sets por mês
//   premium → R$79,90/mês (ou R$799/ano): 12h de set e até 20 sets por mês
//   admin   → uso interno, sem cobrança: cota efetivamente ilimitada. Não é
//             vendido nem aparece nos cards de upgrade — setado direto no
//             banco (`update users set plan = 'admin' where email = '...'`).
//
// A cota (horas E nº de sets) conta os projetos enviados no período: o mês
// vigente da assinatura nos pagos (no anual, a janela MENSAL ancorada no
// início da assinatura — a cota continua sendo por mês), desde sempre no
// free/admin. O limite de sets existe porque o custo da IA é por SET (teto
// fixo de chamadas por job), não por hora: 5 sets de 1h custam ~5× mais que
// 1 set de 5h.

export type PlanId = "free" | "pro" | "premium" | "admin";
export type BillingCycle = "monthly" | "annual";

export type PlanDef = {
  id: PlanId;
  label: string;
  priceCents: number; // preço mensal em BRL (centavos), cobrado pela AbacatePay
  annualPriceCents: number; // preço do ciclo anual em BRL (centavos); 0 = sem anual
  hours: number; // horas de set incluídas (por mês nos pagos, total no free)
  maxSets: number | null; // sets por mês nos pagos; null = sem limite de sets
  monthly: boolean; // true = cota renova por mês; false = cota total (trial)
  maxCutsPerSet: number; // máximo de cortes gerados por set
};

export const PLANS: Record<PlanId, PlanDef> = {
  free: {
    id: "free",
    label: "Teste grátis",
    priceCents: 0,
    annualPriceCents: 0,
    hours: 1,
    maxSets: null, // a cota de 1h no total já limita
    monthly: false,
    maxCutsPerSet: 10,
  },
  pro: {
    id: "pro",
    label: "Pro",
    priceCents: 4990,
    annualPriceCents: 49900, // ~2 meses grátis
    hours: 5,
    maxSets: 8,
    monthly: true,
    maxCutsPerSet: 30,
  },
  premium: {
    id: "premium",
    label: "Premium",
    priceCents: 7990,
    annualPriceCents: 79900, // ~2 meses grátis
    hours: 12,
    maxSets: 20,
    monthly: true,
    maxCutsPerSet: 30,
  },
  admin: {
    id: "admin",
    label: "Admin",
    priceCents: 0,
    annualPriceCents: 0,
    // Sentinela grande (não Infinity: quebraria a serialização JSON das
    // rotas de API, que vira `null`) — na prática nunca é atingido.
    hours: 100000,
    maxSets: null,
    monthly: false,
    maxCutsPerSet: 30,
  },
};

export function isBillingCycle(value: unknown): value is BillingCycle {
  return value === "monthly" || value === "annual";
}

export function cyclePriceCents(plan: PlanDef, cycle: BillingCycle): number {
  return cycle === "annual" ? plan.annualPriceCents : plan.priceCents;
}

// externalId do produto na loja AbacatePay. Leva o PREÇO no id porque a
// AbacatePay não deixa alterar o preço de um produto já criado (nem recriar
// com o mesmo externalId): mudar o preço aqui cria um produto novo sob
// demanda, e quem já assinava continua no produto antigo, com o preço antigo.
export function productExternalId(plan: PlanDef, cycle: BillingCycle): string {
  return `djviral-${plan.id}-${cycle}-${cyclePriceCents(plan, cycle)}`;
}

// Preço formatado em BRL: "R$49,90", "R$499". Só existe cobrança em reais.
export function formatBRL(cents: number): string {
  const value = (cents / 100).toFixed(2).replace(".", ",");
  return `R$${value.endsWith(",00") ? value.slice(0, -3) : value}`;
}

export function priceLabel(plan: PlanDef, cycle: BillingCycle = "monthly"): string {
  return formatBRL(cyclePriceCents(plan, cycle));
}

export function isPaidPlan(plan: string): plan is "pro" | "premium" {
  return plan === "pro" || plan === "premium";
}

export function planOf(id: string | null | undefined): PlanDef {
  if (id && id in PLANS) return PLANS[id as PlanId];
  return PLANS.free;
}

export type PlanUsage = {
  plan: PlanId;
  limitSeconds: number; // cota do período
  usedSeconds: number; // consumido no período
  remainingSeconds: number;
  maxSets: number | null; // sets por período; null = sem limite de sets
  usedSets: number; // sets enviados no período
  remainingSets: number | null; // null = sem limite de sets
  maxCutsPerSet: number;
  periodStart: string | null; // ISO; null = desde sempre (free)
  periodEnd: string | null; // ISO; null = sem renovação (free)
};

// Soma `months` meses a uma data-âncora em UTC, sem estourar o fim do mês
// (31/jan + 1 mês = 28 ou 29/fev, não 3/mar).
function addMonthsClamped(anchor: Date, months: number): Date {
  const y = anchor.getUTCFullYear();
  const m = anchor.getUTCMonth() + months;
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const d = new Date(anchor);
  d.setUTCFullYear(y, m, Math.min(anchor.getUTCDate(), lastDay));
  return d;
}

// Janela MENSAL que contém `now`, ancorada em `anchor` (início da
// assinatura). No mensal é o próprio período cobrado; no anual quebra o ano
// em 12 janelas, para a cota continuar renovando todo mês.
function monthlyWindow(anchor: Date, now: Date): { start: Date; end: Date } {
  let k = 0;
  while (addMonthsClamped(anchor, k + 1) <= now) k += 1;
  return { start: addMonthsClamped(anchor, k), end: addMonthsClamped(anchor, k + 1) };
}

// Período de cota vigente do usuário. Nos planos pagos usa a janela mensal
// ancorada no `current_period_start` da assinatura ativa; sem assinatura
// (ex.: plano setado manualmente) cai no mês-calendário corrente.
async function getPeriod(
  userId: string,
  plan: PlanDef
): Promise<{ start: string | null; end: string | null }> {
  if (!plan.monthly) return { start: null, end: null };

  const { data } = await supabaseAdmin
    .from("subscriptions")
    .select("current_period_start, current_period_end")
    .eq("user_id", userId)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const now = new Date();
  if (data?.current_period_start) {
    const anchor = new Date(data.current_period_start);
    if (anchor <= now) {
      const w = monthlyWindow(anchor, now);
      return { start: w.start.toISOString(), end: w.end.toISOString() };
    }
    return {
      start: data.current_period_start,
      end: data.current_period_end ?? null,
    };
  }

  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { start: monthStart.toISOString(), end: monthEnd.toISOString() };
}

// Uso do período: soma a duração (segundos) dos sources e conta os sets
// (projetos) enviados. Projetos com status 'error' não contam (inclui os
// barrados por cota no worker). Sources sem duração conhecida contam 0 — o
// worker grava a duração real em `sources.duracao` assim que baixa o vídeo.
async function getUsed(
  userId: string,
  since: string | null
): Promise<{ seconds: number; sets: number }> {
  let query = supabaseAdmin
    .from("projects")
    .select("id, status, date_create, sources(duracao)")
    .eq("user_id", userId)
    .neq("status", "error");
  if (since) query = query.gte("date_create", since);

  const { data, error } = await query;
  if (error) throw new Error(`falha ao calcular uso do plano: ${error.message}`);

  let total = 0;
  for (const project of data ?? []) {
    const sources = (project as { sources?: { duracao: number | null }[] }).sources ?? [];
    for (const s of sources) total += s.duracao ?? 0;
  }
  return { seconds: Math.round(total), sets: (data ?? []).length };
}

export async function getPlanUsage(userId: string, planId: string): Promise<PlanUsage> {
  const plan = planOf(planId);
  const period = await getPeriod(userId, plan);
  const used = await getUsed(userId, period.start);
  const limitSeconds = plan.hours * 3600;
  return {
    plan: plan.id,
    limitSeconds,
    usedSeconds: used.seconds,
    remainingSeconds: Math.max(0, limitSeconds - used.seconds),
    maxSets: plan.maxSets,
    usedSets: used.sets,
    remainingSets: plan.maxSets === null ? null : Math.max(0, plan.maxSets - used.sets),
    maxCutsPerSet: plan.maxCutsPerSet,
    periodStart: period.start,
    periodEnd: period.end,
  };
}
