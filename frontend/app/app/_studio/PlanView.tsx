"use client";

import { useEffect, useState } from "react";
import { theme, font, btnPrimary, btnGhost } from "./theme";

// Aba "Plano": plano atual + uso do período + upgrade via AbacatePay
// (checkout hospedado com PIX ou cartão em recorrência mensal).

type Billing = {
  plan: "free" | "pro" | "premium" | "admin";
  planLabel: string;
  usage: {
    usedSeconds: number;
    limitSeconds: number;
    remainingSeconds: number;
    maxCutsPerSet: number;
    periodEnd: string | null;
    monthly: boolean;
  };
  subscription: {
    status: string;
    method: string | null;
    currentPeriodEnd: string | null;
  } | null;
};

const CARDS: {
  id: "free" | "pro" | "premium";
  name: string;
  price: string;
  priceNote: string;
  features: string[];
}[] = [
  {
    id: "free",
    name: "Teste grátis",
    price: "R$0",
    priceNote: "para experimentar",
    features: ["1 hora de set no total", "10 cortes por set", "Vídeos verticais 9:16"],
  },
  {
    id: "pro",
    name: "Pro",
    price: "R$39,90",
    priceNote: "/mês · PIX ou cartão",
    features: ["Até 5 horas de set por mês", "Até 30 cortes por set", "Re-corte no minuto exato"],
  },
  {
    id: "premium",
    name: "Premium",
    price: "R$59,90",
    priceNote: "/mês · PIX ou cartão",
    features: ["Até 12 horas de set por mês", "Até 30 cortes por set", "Re-corte no minuto exato"],
  },
];

function fmtHours(seconds: number): string {
  const h = seconds / 3600;
  if (h >= 1) {
    const rounded = Math.round(h * 10) / 10;
    return `${rounded % 1 === 0 ? rounded.toFixed(0) : rounded.toFixed(1)}h`;
  }
  return `${Math.max(0, Math.round(seconds / 60))} min`;
}

export function PlanView() {
  const [billing, setBilling] = useState<Billing | null>(null);
  const [error, setError] = useState("");
  const [loadingPlan, setLoadingPlan] = useState<string | null>(null);
  const [justPaid, setJustPaid] = useState(false);

  useEffect(() => {
    // Voltando do checkout (?billing=success): o webhook pode levar alguns
    // segundos; avisa e recarrega o plano em seguida.
    const params = new URLSearchParams(window.location.search);
    if (params.get("billing") === "success") {
      setJustPaid(true);
      window.history.replaceState(null, "", "/app");
    }
    load();
  }, []);

  async function load() {
    try {
      const res = await fetch("/api/billing");
      if (!res.ok) throw new Error();
      setBilling(await res.json());
    } catch {
      setError("Não foi possível carregar seu plano. Recarregue a página.");
    }
  }

  async function upgrade(plan: "pro" | "premium") {
    setLoadingPlan(plan);
    setError("");
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ plan }),
      });
      const data = await res.json();
      if (!res.ok || !data.url) throw new Error(data.error ?? "falha ao abrir o checkout");
      window.location.href = data.url; // página de pagamento da AbacatePay
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro inesperado");
      setLoadingPlan(null);
    }
  }

  const usage = billing?.usage;
  const pct = usage && usage.limitSeconds > 0
    ? Math.min(100, Math.round((usage.usedSeconds / usage.limitSeconds) * 100))
    : 0;

  return (
    <div style={{ animation: "dj-fadeUp .4s ease", maxWidth: 880, margin: "0 auto" }} data-anim>
      {justPaid && (
        <div
          style={{
            padding: "12px 16px",
            borderRadius: 10,
            marginBottom: 20,
            fontSize: 13,
            background: "#ecfdf5",
            color: "#059669",
            border: "1px solid #a7f3d0",
          }}
        >
          ✓ Pagamento concluído! Seu plano é ativado assim que a confirmação da
          AbacatePay chegar (normalmente em segundos).{" "}
          <span onClick={load} style={{ textDecoration: "underline", cursor: "pointer" }}>
            Atualizar
          </span>
        </div>
      )}

      {/* Uso do período */}
      <div
        style={{
          padding: "26px 28px",
          borderRadius: 16,
          background: theme.surface,
          border: `1px solid ${theme.border}`,
          marginBottom: 26,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
          <div style={{ font: `500 20px ${font.display}` }}>
            Seu plano:{" "}
            <span style={{ color: theme.accent }}>{billing?.planLabel ?? "…"}</span>
          </div>
          {usage && (
            <div style={{ fontSize: 13, color: theme.textMuted }}>
              {fmtHours(usage.usedSeconds)} de {fmtHours(usage.limitSeconds)} usados
              {usage.monthly ? " neste mês" : " no teste"}
            </div>
          )}
        </div>

        {usage && (
          <>
            <div
              style={{
                height: 8,
                borderRadius: 4,
                background: theme.surfaceMuted,
                marginTop: 16,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  width: `${pct}%`,
                  height: "100%",
                  borderRadius: 4,
                  background: pct >= 100 ? "#dc2626" : theme.accent,
                  transition: "width .4s ease",
                }}
              />
            </div>
            <div style={{ fontSize: 12, color: theme.textMuted, marginTop: 8 }}>
              Restam {fmtHours(usage.remainingSeconds)} de set · até {usage.maxCutsPerSet}{" "}
              cortes por set
              {usage.monthly && usage.periodEnd
                ? ` · renova em ${new Date(usage.periodEnd).toLocaleDateString("pt-BR")}`
                : ""}
            </div>
          </>
        )}

        {billing?.subscription?.status === "past_due" && (
          <div style={{ fontSize: 13, color: "#d97706", marginTop: 12 }}>
            ⚠ A última cobrança falhou — a AbacatePay vai tentar de novo. Confira
            seu cartão para não perder o acesso.
          </div>
        )}
      </div>

      {error && (
        <div style={{ fontSize: 13, color: "#dc2626", marginBottom: 18 }}>{error}</div>
      )}

      {billing?.plan === "admin" && (
        <div style={{ fontSize: 13, color: theme.textMuted, marginBottom: 18 }}>
          Conta admin — uso ilimitado, sem cobrança. Os cards abaixo são só os
          planos vendidos publicamente.
        </div>
      )}

      {/* Cards de plano */}
      <div className="dj-plan-grid" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 18 }}>
        {CARDS.map((card) => {
          const isCurrent = billing?.plan === card.id;
          const isUpgrade = card.id !== "free" && !isCurrent;
          return (
            <div
              key={card.id}
              style={{
                padding: "24px 22px",
                borderRadius: 14,
                background: theme.surface,
                border: `1px solid ${isCurrent ? theme.accentBorder : theme.border}`,
                boxShadow: isCurrent ? `0 0 0 2px ${theme.accentBorder}` : "none",
                display: "flex",
                flexDirection: "column",
              }}
            >
              <div style={{ font: `500 15px ${font.display}`, marginBottom: 8 }}>{card.name}</div>
              <div style={{ font: `600 28px ${font.display}` }}>
                {card.price}
                <span style={{ fontSize: 13, fontWeight: 400, color: theme.textMuted }}>
                  {" "}{card.priceNote}
                </span>
              </div>
              <div style={{ display: "grid", gap: 8, fontSize: 13, color: theme.textSecondary, margin: "16px 0 20px" }}>
                {card.features.map((f) => (
                  <span key={f}>✓ {f}</span>
                ))}
              </div>
              <div style={{ marginTop: "auto" }}>
                {isCurrent ? (
                  <div style={{ ...btnGhost, textAlign: "center", cursor: "default", opacity: 0.7 }}>
                    Plano atual
                  </div>
                ) : isUpgrade ? (
                  <button
                    type="button"
                    onClick={() => upgrade(card.id as "pro" | "premium")}
                    disabled={loadingPlan !== null}
                    style={{
                      ...btnPrimary,
                      width: "100%",
                      justifyContent: "center",
                      padding: "11px",
                      opacity: loadingPlan && loadingPlan !== card.id ? 0.5 : 1,
                      cursor: loadingPlan ? "default" : "pointer",
                    }}
                  >
                    {loadingPlan === card.id ? "Abrindo checkout..." : `Assinar ${card.name}`}
                  </button>
                ) : (
                  <div style={{ ...btnGhost, textAlign: "center", cursor: "default", opacity: 0.7 }}>
                    —
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ fontSize: 12, color: theme.textMuted, marginTop: 18 }}>
        Pagamento processado pela AbacatePay. Cartão renova automaticamente todo
        mês; no PIX você recebe a cobrança da renovação a cada ciclo.
      </div>
    </div>
  );
}
