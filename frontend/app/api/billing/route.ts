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
  } | null = null;
  if (isPaidPlan(user.plan)) {
    const { data } = await supabaseAdmin
      .from("subscriptions")
      .select("status, method, current_period_end")
      .eq("user_id", user.id)
      .in("status", ["active", "past_due"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data) {
      subscription = {
        status: data.status,
        method: data.method,
        currentPeriodEnd: data.current_period_end,
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
      maxCutsPerSet: usage.maxCutsPerSet,
      periodStart: usage.periodStart,
      periodEnd: usage.periodEnd,
      monthly: PLANS[usage.plan].monthly,
    },
    subscription,
  });
}
