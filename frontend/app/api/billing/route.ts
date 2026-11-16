import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getPlanUsage, isPaidPlan, PLANS } from "@/lib/plans";
import { supabaseAdmin } from "@/lib/supabase";

// Plano atual + uso do período, para a aba "Plano" do estúdio e para o
// gerador mostrar a cota restante.
export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "não autenticado" }, { status: 401 });
  }

  const usage = await getPlanUsage(user.id, user.plan);

  // Detalhes da assinatura vigente (se houver) para exibir status/renovação.
  let subscription: {
    status: string;
    method: string | null;
    currentPeriodEnd: string | null;
    cycle: "monthly" | "annual";
  } | null = null;
  if (isPaidPlan(user.plan)) {
    const fetchSub = (columns: string) =>
      supabaseAdmin
        .from("subscriptions")
        .select(columns)
        .eq("user_id", user.id)
        .in("status", ["active", "past_due"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
    let { data, error } = await fetchSub("status, method, current_period_end, cycle");
    if (error) {
      // Banco sem a migração de `subscriptions.cycle`: lê sem ela (= mensal).
      ({ data, error } = await fetchSub("status, method, current_period_end"));
    }
    const row = data as {
      status: string;
      method: string | null;
      current_period_end: string | null;
      cycle?: string | null;
    } | null;
    if (row) {
      subscription = {
        status: row.status,
        method: row.method,
        currentPeriodEnd: row.current_period_end,
        cycle: row.cycle === "annual" ? "annual" : "monthly",
      };
    }
  }

  return NextResponse.json({
    plan: usage.plan,
    planLabel: PLANS[usage.plan].label,
    priceCents: PLANS[usage.plan].priceCents,
    usage: {
      usedSeconds: usage.usedSeconds,
      limitSeconds: usage.limitSeconds,
      remainingSeconds: usage.remainingSeconds,
      maxSets: usage.maxSets,
      usedSets: usage.usedSets,
      remainingSets: usage.remainingSets,
      maxCutsPerSet: usage.maxCutsPerSet,
      periodStart: usage.periodStart,
      periodEnd: usage.periodEnd,
      monthly: PLANS[usage.plan].monthly,
    },
    subscription,
  });
}
