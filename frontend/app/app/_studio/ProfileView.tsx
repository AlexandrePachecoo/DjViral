"use client";

import { useEffect, useState } from "react";
import { theme, font, btnPrimary, btnGhost } from "./theme";

// Aba "Perfil": dados da conta, editar nome, alterar senha, atalho para o
// plano, cancelar assinatura e sair da conta. Auto-suficiente (fetch próprio,
// como o PlanView).

type Props = {
  userName: string;
  onNameChange: (name: string) => void;
  onManagePlan: () => void;
};

type Me = { id: string; name: string; email: string; plan: string };

const PLAN_LABEL: Record<string, string> = {
  free: "Teste grátis",
  pro: "Pro",
  premium: "Premium",
  admin: "Admin",
};

const danger = "#dc2626";
const okBg = "#ecfdf5";
const okText = "#059669";
const okBorder = "#a7f3d0";

// Card com título de seção, reutilizado em todas as áreas.
function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        padding: "24px 26px",
        borderRadius: 16,
        background: theme.surface,
        border: `1px solid ${theme.border}`,
        marginBottom: 20,
      }}
    >
      <div style={{ font: `500 15px ${font.display}`, marginBottom: 18 }}>{title}</div>
      {children}
    </div>
  );
}

// Estilo base dos inputs (fontSize 16 evita zoom no iOS).
const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 10,
  border: `1px solid ${theme.borderStrong}`,
  background: theme.surface,
  color: theme.textPrimary,
  fontSize: 16,
  fontFamily: font.body,
  outline: "none",
  boxSizing: "border-box",
};

const labelStyle: React.CSSProperties = {
  fontSize: 12,
  color: theme.textMuted,
  marginBottom: 6,
  display: "block",
};

export function ProfileView({ userName, onNameChange, onManagePlan }: Props) {
  const [me, setMe] = useState<Me | null>(null);

  // --- editar nome ---
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [nameSaving, setNameSaving] = useState(false);
  const [nameError, setNameError] = useState("");

  // --- alterar senha ---
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pwSaving, setPwSaving] = useState(false);
  const [pwError, setPwError] = useState("");
  const [pwOk, setPwOk] = useState(false);

  // --- cancelar assinatura ---
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [canceling, setCanceling] = useState(false);
  const [cancelError, setCancelError] = useState("");
  const [canceledOk, setCanceledOk] = useState(false);

  async function loadMe() {
    try {
      const res = await fetch("/api/auth/me");
      const data = await res.json();
      if (data?.user) setMe(data.user);
    } catch {
      // silencioso: se falhar, a UI mostra "…" nos campos.
    }
  }

  useEffect(() => {
    loadMe();
  }, []);

  function startEditName() {
    setNameDraft(me?.name ?? userName);
    setNameError("");
    setEditingName(true);
  }

  async function saveName() {
    const trimmed = nameDraft.trim();
    if (!trimmed) {
      setNameError("O nome não pode ficar vazio.");
      return;
    }
    setNameSaving(true);
    setNameError("");
    try {
      const res = await fetch("/api/auth/me", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "falha ao salvar");
      setMe(data.user);
      onNameChange(data.user.name);
      setEditingName(false);
    } catch (err) {
      setNameError(err instanceof Error ? err.message : "Erro inesperado");
    } finally {
      setNameSaving(false);
    }
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    setPwError("");
    setPwOk(false);
    if (next.length < 6) {
      setPwError("A nova senha deve ter ao menos 6 caracteres.");
      return;
    }
    if (next !== confirm) {
      setPwError("A confirmação não confere com a nova senha.");
      return;
    }
    setPwSaving(true);
    try {
      const res = await fetch("/api/auth/password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "falha ao alterar a senha");
      setPwOk(true);
      setCurrent("");
      setNext("");
      setConfirm("");
    } catch (err) {
      setPwError(err instanceof Error ? err.message : "Erro inesperado");
    } finally {
      setPwSaving(false);
    }
  }

  async function cancelPlan() {
    setCanceling(true);
    setCancelError("");
    try {
      const res = await fetch("/api/billing/cancel", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "falha ao cancelar");
      setCanceledOk(true);
      setConfirmingCancel(false);
      await loadMe();
    } catch (err) {
      setCancelError(err instanceof Error ? err.message : "Erro inesperado");
    } finally {
      setCanceling(false);
    }
  }

  const planLabel = me ? PLAN_LABEL[me.plan] ?? me.plan : "…";
  const isPaid = me?.plan === "pro" || me?.plan === "premium";

  return (
    <div style={{ animation: "dj-fadeUp .4s ease", maxWidth: 720, margin: "0 auto" }} data-anim>
      <h1 style={{ font: `600 24px ${font.display}`, margin: "0 0 24px" }}>Perfil</h1>

      {/* Conta: email + nome editável */}
      <Card title="Conta">
        <div style={{ marginBottom: 18 }}>
          <span style={labelStyle}>Email</span>
          <div style={{ fontSize: 14, color: theme.textSecondary }}>{me?.email ?? "…"}</div>
        </div>

        <span style={labelStyle}>Nome</span>
        {editingName ? (
          <div>
            <input
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              maxLength={60}
              autoFocus
              style={inputStyle}
            />
            {nameError && (
              <div style={{ fontSize: 12, color: danger, marginTop: 8 }}>{nameError}</div>
            )}
            <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
              <button
                type="button"
                onClick={saveName}
                disabled={nameSaving}
                style={{ ...btnPrimary, opacity: nameSaving ? 0.6 : 1 }}
              >
                {nameSaving ? "Salvando..." : "Salvar"}
              </button>
              <button
                type="button"
                onClick={() => setEditingName(false)}
                disabled={nameSaving}
                style={btnGhost}
              >
                Cancelar
              </button>
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <div style={{ fontSize: 14, color: theme.textSecondary }}>{me?.name ?? userName}</div>
            <button type="button" onClick={startEditName} style={btnGhost}>
              Editar
            </button>
          </div>
        )}
      </Card>

      {/* Plano: label + atalho para a aba Plano */}
      <Card title="Plano">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div style={{ fontSize: 14, color: theme.textSecondary }}>
            Plano atual: <span style={{ color: theme.accent, fontWeight: 500 }}>{planLabel}</span>
          </div>
          <button type="button" onClick={onManagePlan} style={btnGhost}>
            Gerenciar plano
          </button>
        </div>
      </Card>

      {/* Assinatura: cancelar (só planos pagos) */}
      {isPaid && (
        <Card title="Assinatura">
          {canceledOk ? (
            <div style={{ fontSize: 13, color: okText }}>
              ✓ Assinatura cancelada. Você voltou ao plano gratuito.
            </div>
          ) : confirmingCancel ? (
            <div>
              <div style={{ fontSize: 13, color: theme.textSecondary, marginBottom: 14 }}>
                Tem certeza? Você volta ao plano free e perde o acesso aos limites
                do plano pago.
              </div>
              {cancelError && (
                <div style={{ fontSize: 12, color: danger, marginBottom: 10 }}>{cancelError}</div>
              )}
              <div style={{ display: "flex", gap: 10 }}>
                <button
                  type="button"
                  onClick={cancelPlan}
                  disabled={canceling}
                  style={{ ...btnGhost, color: danger, borderColor: danger, opacity: canceling ? 0.6 : 1 }}
                >
                  {canceling ? "Cancelando..." : "Sim, cancelar"}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingCancel(false)}
                  disabled={canceling}
                  style={btnGhost}
                >
                  Manter plano
                </button>
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <div style={{ fontSize: 13, color: theme.textSecondary }}>
                Cancela a renovação e volta ao plano gratuito.
              </div>
              <button
                type="button"
                onClick={() => setConfirmingCancel(true)}
                style={{ ...btnGhost, color: danger, borderColor: danger }}
              >
                Cancelar assinatura
              </button>
            </div>
          )}
        </Card>
      )}

      {/* Segurança: trocar senha */}
      <Card title="Segurança">
        <form onSubmit={changePassword}>
          <div style={{ marginBottom: 14 }}>
            <span style={labelStyle}>Senha atual</span>
            <input
              type="password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              style={inputStyle}
            />
          </div>
          <div style={{ marginBottom: 14 }}>
            <span style={labelStyle}>Nova senha</span>
            <input
              type="password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              style={inputStyle}
            />
          </div>
          <div style={{ marginBottom: 16 }}>
            <span style={labelStyle}>Confirmar nova senha</span>
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              style={inputStyle}
            />
          </div>

          {pwError && <div style={{ fontSize: 12, color: danger, marginBottom: 12 }}>{pwError}</div>}
          {pwOk && (
            <div
              style={{
                fontSize: 13,
                color: okText,
                background: okBg,
                border: `1px solid ${okBorder}`,
                borderRadius: 10,
                padding: "10px 12px",
                marginBottom: 12,
              }}
            >
              ✓ Senha alterada com sucesso.
            </div>
          )}

          <button
            type="submit"
            disabled={pwSaving || !current || !next || !confirm}
            style={{
              ...btnPrimary,
              opacity: pwSaving || !current || !next || !confirm ? 0.55 : 1,
              cursor: pwSaving || !current || !next || !confirm ? "default" : "pointer",
            }}
          >
            {pwSaving ? "Salvando..." : "Alterar senha"}
          </button>
        </form>
      </Card>
    </div>
  );
}
