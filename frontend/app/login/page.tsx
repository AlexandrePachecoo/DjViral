"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Mode = "login" | "register";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const endpoint = mode === "login" ? "/api/auth/login" : "/api/auth/register";
      const body =
        mode === "login" ? { email, password } : { name, email, password };
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Algo deu errado");
      }
      router.push("/app");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro inesperado");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={mainStyle}>
      <a href="/" style={backLink}>
        ← DJviral
      </a>

      <div style={cardStyle}>
        <h1 style={{ margin: 0, fontSize: 26 }}>
          {mode === "login" ? "Entrar" : "Criar conta"}
        </h1>
        <p style={{ opacity: 0.7, marginTop: 4 }}>
          {mode === "login"
            ? "Acesse sua conta para gerar cortes."
            : "É grátis — sem cartão de crédito."}
        </p>

        <form onSubmit={handleSubmit} style={{ display: "grid", gap: 12, marginTop: 20 }}>
          {mode === "register" && (
            <input
              placeholder="Seu nome"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={busy}
              required
              style={inputStyle}
            />
          )}
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={busy}
            required
            autoComplete="email"
            style={inputStyle}
          />
          <input
            type="password"
            placeholder="Senha"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={busy}
            required
            minLength={6}
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            style={inputStyle}
          />
          <button type="submit" disabled={busy} style={buttonStyle}>
            {busy
              ? "Aguarde..."
              : mode === "login"
                ? "Entrar"
                : "Criar conta grátis"}
          </button>
        </form>

        {error && <p style={{ marginTop: 14, color: "#ff6b6b" }}>{error}</p>}

        <p style={{ marginTop: 18, opacity: 0.8, fontSize: 14 }}>
          {mode === "login" ? "Ainda não tem conta? " : "Já tem conta? "}
          <button
            type="button"
            onClick={() => {
              setMode(mode === "login" ? "register" : "login");
              setError("");
            }}
            style={linkButton}
          >
            {mode === "login" ? "Criar conta" : "Entrar"}
          </button>
        </p>
      </div>
    </main>
  );
}

const mainStyle: React.CSSProperties = {
  maxWidth: 420,
  margin: "0 auto",
  padding: "2rem 1rem",
};

const backLink: React.CSSProperties = {
  display: "inline-block",
  marginBottom: 16,
  fontSize: 14,
  color: "#9d8cff",
  textDecoration: "none",
};

const cardStyle: React.CSSProperties = {
  padding: 24,
  borderRadius: 16,
  background: "#15151c",
  border: "1px solid #2a2a35",
};

const inputStyle: React.CSSProperties = {
  padding: "10px 12px",
  borderRadius: 8,
  border: "1px solid #2a2a35",
  background: "#0f0f15",
  color: "#e9e9f0",
};

const buttonStyle: React.CSSProperties = {
  padding: "12px",
  borderRadius: 8,
  border: "none",
  background: "#7c5cff",
  color: "white",
  fontWeight: 600,
  cursor: "pointer",
};

const linkButton: React.CSSProperties = {
  background: "none",
  border: "none",
  color: "#9d8cff",
  cursor: "pointer",
  fontSize: 14,
  padding: 0,
  textDecoration: "underline",
};
