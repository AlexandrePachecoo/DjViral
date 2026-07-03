import { supabaseAdmin } from "@/lib/supabase";

// Planos do DjViral. O plano efetivo do usuário vive em `users.plan`
// (espelhado pelos webhooks da AbacatePay — ver /api/webhooks/abacatepay).
//
//   free    → teste grátis: 1 hora de set no TOTAL e 10 cortes por geração
//   pro     → R$39,90/mês: até 5 horas de set por mês
//   premium → R$59,90/mês: até 12 horas de set por mês
//
// A cota de horas é contada pela duração dos sources enviados no período
// (mês vigente da assinatura para pagos; desde sempre para o free).

export type PlanId = "free" | "pro" | "premium";

export type PlanDef = {
  id: PlanId;
  label: string;
  priceCents: number; // 0 para o free
  hours: number; // horas de set incluídas
  monthly: boolean; // true = cota renova por mês; false = cota total (trial)
  maxCutsPerSet: number; // máximo de cortes gerados por set
  // Identificador do produto na loja AbacatePay (externalId). Só planos pagos.
  productExternalId?: string;
};

export const PLANS: Record<PlanId, PlanDef> = {
  free: {
    id: "free",
    label: "Teste grátis",
    priceCents: 0,
    hours: 1,
    monthly: false,
    maxCutsPerSet: 10,
  },
  pro: {
    id: "pro",
    label: "Pro",
    priceCents: 3990,
    hours: 5,
    monthly: true,
    maxCutsPerSet: 30,
    productExternalId: "djviral-pro-monthly",
  },
  premium: {
    id: "premium",
    label: "Premium",
    priceCents: 5990,
    hours: 12,
    monthly: true,
    maxCutsPerSet: 30,
    productExternalId: "djviral-premium-monthly",
  },
};

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
  maxCutsPerSet: number;
  periodStart: string | null; // ISO; null = desde sempre (free)
  periodEnd: string | null; // ISO; null = sem renovação (free)
};

// Início do período de cobrança vigente do usuário. Para planos pagos usa o
// `current_period_start` da assinatura ativa; se não houver (ex.: plano setado
// manualmente), cai no início do mês corrente.
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

  if (data?.current_period_start) {
    return {
      start: data.current_period_start,
      end: data.current_period_end ?? null,
    };
  }

  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { start: monthStart.toISOString(), end: monthEnd.toISOString() };
}

// Soma a duração (segundos) dos sources enviados pelo usuário no período.
// Projetos com status 'error' não contam (inclui os barrados por cota no
// worker). Sources sem duração conhecida contam 0 — o worker grava a duração
// real em `sources.duracao` assim que baixa o vídeo.
async function getUsedSeconds(userId: string, since: string | null): Promise<number> {
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
  return total;
}

export async function getPlanUsage(userId: string, planId: string): Promise<PlanUsage> {
  const plan = planOf(planId);
  const period = await getPeriod(userId, plan);
  const usedSeconds = await getUsedSeconds(userId, period.start);
  const limitSeconds = plan.hours * 3600;
  return {
    plan: plan.id,
    limitSeconds,
    usedSeconds,
    remainingSeconds: Math.max(0, limitSeconds - usedSeconds),
    maxCutsPerSet: plan.maxCutsPerSet,
    periodStart: period.start,
    periodEnd: period.end,
  };
}
