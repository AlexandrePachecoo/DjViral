"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { extractYoutubeId } from "@/lib/youtube";

type SessionUser = { id: string; name: string; email: string; plan: string };

type Cut = {
  titulo: string;
  inicio: number;
  fim: number;
  duracao: number;
  score: number;
  url: string;
};

type Status = "idle" | "uploading" | "processing" | "done" | "error";

type Mode = "file" | "youtube";

// Feature flag: o download do YouTube no worker é bloqueado pelo bot-check em
// IP de datacenter (Railway) sem cookies. Enquanto isso não é resolvido, a aba
// "Link do YouTube" fica escondida — todo o código do fluxo (backend, rota,
// validação) continua no lugar. Para reativar, basta trocar para `true`.
const YOUTUBE_ENABLED = false;

export default function NewSet() {
  const router = useRouter();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [name, setName] = useState("");
  const [mode, setMode] = useState<Mode>("file");
  const [file, setFile] = useState<File | null>(null);
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("");
  const [projectId, setProjectId] = useState<string | null>(null);
  const [cuts, setCuts] = useState<Cut[]>([]);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Carrega o usuário da sessão.
  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((d) => setUser(d.user))
      .catch(() => {});
  }, []);

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  // Polling do status enquanto o worker processa.
  useEffect(() => {
    if (!projectId || (status !== "processing" && status !== "uploading")) return;
    pollRef.current = setInterval(async () => {
      const res = await fetch(`/api/projects/${projectId}`);
      if (!res.ok) return;
      const data = await res.json();
      if (data.status === "done") {
        setCuts(data.cuts ?? []);
        setStatus("done");
        setMessage(`${data.cuts?.length ?? 0} clipes gerados!`);
      } else if (data.status === "error") {
        setStatus("error");
        setMessage("O processamento falhou. Confira os logs do worker.");
      }
    }, 5000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [projectId, status]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name) return;
    if (mode === "file" && !file) return;
    if (mode === "youtube" && !extractYoutubeId(youtubeUrl)) return;
    setCuts([]);

    try {
      // 1. Cria projeto (+ signed upload URL no modo arquivo)
      setStatus("uploading");
      setMessage("Criando projeto...");
      const body =
        mode === "youtube"
          ? { name, youtube_url: youtubeUrl }
          : { name, filename: file!.name };
      const createRes = await fetch("/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!createRes.ok) throw new Error((await createRes.json()).error);
      const { project_id, signedUrl } = await createRes.json();
      setProjectId(project_id);

      // 2. Upload direto pro Supabase Storage (não passa pela Vercel).
      //    No modo YouTube não há upload: o worker baixa o vídeo do link.
      if (mode === "file") {
        setMessage("Enviando vídeo...");
        const upRes = await fetch(signedUrl, {
          method: "PUT",
          headers: { "content-type": file!.type || "video/mp4" },
          body: file,
        });
        if (!upRes.ok) {
          const detail = await upRes.text().catch(() => "");
          throw new Error(
            `Falha no upload do vídeo (HTTP ${upRes.status})${detail ? `: ${detail}` : ""}`
          );
        }
      }

      // 3. Dispara o worker
      setMessage(
        mode === "youtube"
          ? "Baixando do YouTube e gerando cortes..."
          : "Analisando o áudio e gerando cortes..."
      );
      setStatus("processing");
      const procRes = await fetch(`/api/projects/${project_id}/process`, {
        method: "POST",
      });
      if (!procRes.ok) throw new Error((await procRes.json()).error);
    } catch (err) {
      setStatus("error");
      setMessage(err instanceof Error ? err.message : "Erro inesperado");
    }
  }

  const busy = status === "uploading" || status === "processing";

  return (
    <main style={mainStyle}>
      <div style={topBar}>
        <a href="/app" style={backLink}>
          ← Estúdio
        </a>
        {user && (
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ fontSize: 14, opacity: 0.7 }}>
              {user.name} · {user.plan}
            </span>
            <button type="button" onClick={handleLogout} style={logoutButton}>
              Sair
            </button>
          </div>
        )}
      </div>
      <h1>🎧 Novo set</h1>
      <p style={{ opacity: 0.7 }}>
        {YOUTUBE_ENABLED
          ? "Envie seu set — ou cole um link do YouTube — e receba os cortes mais virais automaticamente."
          : "Envie seu set e receba os cortes mais virais automaticamente."}
      </p>

      {YOUTUBE_ENABLED && (
        <div style={tabRow}>
          <button
            type="button"
            onClick={() => setMode("file")}
            disabled={busy}
            style={mode === "file" ? tabActive : tabInactive}
          >
            Enviar arquivo
          </button>
          <button
            type="button"
            onClick={() => setMode("youtube")}
            disabled={busy}
            style={mode === "youtube" ? tabActive : tabInactive}
          >
            Link do YouTube
          </button>
        </div>
      )}

      <form onSubmit={handleSubmit} style={{ display: "grid", gap: 12, marginTop: 16 }}>
        <input
          placeholder="Nome do set"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={busy}
          style={inputStyle}
        />
        {mode === "file" ? (
          <input
            type="file"
            accept="video/mp4,video/*"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            disabled={busy}
            style={inputStyle}
          />
        ) : (
          <input
            type="url"
            placeholder="Cole o link do YouTube (watch, youtu.be ou shorts)"
            value={youtubeUrl}
            onChange={(e) => setYoutubeUrl(e.target.value)}
            disabled={busy}
            style={inputStyle}
          />
        )}
        <button
          type="submit"
          disabled={
            busy ||
            !name ||
            (mode === "file" ? !file : !extractYoutubeId(youtubeUrl))
          }
          style={buttonStyle}
        >
          {busy ? "Processando..." : "Gerar cortes"}
        </button>
      </form>

      {message && (
        <p style={{ marginTop: 16, color: status === "error" ? "#ff6b6b" : "#9d8cff" }}>
          {message}
        </p>
      )}

      {cuts.length > 0 && (
        <section style={{ marginTop: 32, display: "grid", gap: 24 }}>
          {cuts.map((c, i) => (
            <div key={i} style={cardStyle}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <strong>{c.titulo}</strong>
                <span style={{ opacity: 0.6 }}>score {c.score.toFixed(2)}</span>
              </div>
              <video src={c.url} controls style={{ width: "100%", borderRadius: 8 }} />
              <small style={{ opacity: 0.6 }}>
                {Math.round(c.inicio)}s – {Math.round(c.fim)}s
              </small>
            </div>
          ))}
        </section>
      )}
    </main>
  );
}

const mainStyle: React.CSSProperties = {
  maxWidth: 720,
  margin: "0 auto",
  padding: "2rem 1rem",
};

const topBar: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  marginBottom: 16,
};

const backLink: React.CSSProperties = {
  display: "inline-block",
  fontSize: 14,
  color: "#9d8cff",
  textDecoration: "none",
};

const logoutButton: React.CSSProperties = {
  padding: "6px 12px",
  borderRadius: 8,
  border: "1px solid #2a2a35",
  background: "transparent",
  color: "#e9e9f0",
  cursor: "pointer",
  fontSize: 14,
};

const tabRow: React.CSSProperties = {
  display: "flex",
  gap: 8,
  marginTop: 24,
};

const tabBase: React.CSSProperties = {
  flex: 1,
  padding: "10px 12px",
  borderRadius: 8,
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
  minHeight: 44,
};

const tabActive: React.CSSProperties = {
  ...tabBase,
  border: "1px solid #7c5cff",
  background: "rgba(124, 92, 255, 0.15)",
  color: "#e9e9f0",
};

const tabInactive: React.CSSProperties = {
  ...tabBase,
  border: "1px solid #2a2a35",
  background: "transparent",
  color: "#9a9ab0",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "12px",
  borderRadius: 8,
  border: "1px solid #2a2a35",
  background: "#15151c",
  color: "#e9e9f0",
  // 16px impede o iOS de dar zoom ao focar o campo.
  fontSize: 16,
};

const buttonStyle: React.CSSProperties = {
  padding: "12px",
  borderRadius: 8,
  border: "none",
  background: "#7c5cff",
  color: "white",
  fontWeight: 600,
  fontSize: 16,
  minHeight: 48,
  cursor: "pointer",
};

const cardStyle: React.CSSProperties = {
  display: "grid",
  gap: 8,
  padding: 16,
  borderRadius: 12,
  background: "#15151c",
  border: "1px solid #2a2a35",
};
