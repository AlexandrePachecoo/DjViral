"use client";

import { useEffect, useRef, useState } from "react";

type Cut = {
  titulo: string;
  inicio: number;
  fim: number;
  duracao: number;
  score: number;
  url: string;
};

type Project = {
  id: string;
  name: string;
  status: string;
  date_create: string;
};

type Status = "idle" | "uploading" | "processing" | "done" | "error";

export default function Home() {
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("");
  const [projectId, setProjectId] = useState<string | null>(null);
  const [cuts, setCuts] = useState<Cut[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Carrega a lista de projetos (histórico).
  async function loadProjects() {
    const res = await fetch("/api/projects");
    if (!res.ok) return;
    const data = await res.json();
    setProjects(data.projects ?? []);
  }

  // Carrega um projeto específico (do histórico) e mostra seus cortes.
  async function carregarProjeto(id: string) {
    const res = await fetch(`/api/projects/${id}`);
    if (!res.ok) return;
    const data = await res.json();
    setProjectId(id);
    setName(data.name ?? "");
    setCuts(data.cuts ?? []);
    setStatus(data.status === "done" ? "done" : data.status === "error" ? "error" : "processing");
    setMessage(
      data.status === "done"
        ? `${data.cuts?.length ?? 0} clipes gerados!`
        : data.status === "error"
          ? "O processamento falhou. Confira os logs do worker."
          : "Processando..."
    );
  }

  // Faz o download de um clipe (fetch → blob para forçar o save, mesmo cross-origin).
  async function baixar(url: string, titulo: string) {
    const res = await fetch(url);
    const blob = await res.blob();
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = href;
    a.download = `${titulo.replace(/[^\w.\-]/g, "_")}.mp4`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(href);
  }

  // Carrega o histórico ao montar.
  useEffect(() => {
    loadProjects();
  }, []);

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
        loadProjects();
      } else if (data.status === "error") {
        setStatus("error");
        setMessage("O processamento falhou. Confira os logs do worker.");
        loadProjects();
      }
    }, 5000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [projectId, status]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file || !name) return;
    setCuts([]);

    try {
      // 1. Cria projeto + signed upload URL
      setStatus("uploading");
      setMessage("Criando projeto...");
      const createRes = await fetch("/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, filename: file.name }),
      });
      if (!createRes.ok) throw new Error((await createRes.json()).error);
      const { project_id, signedUrl } = await createRes.json();
      setProjectId(project_id);

      // 2. Upload direto pro Supabase Storage (não passa pela Vercel)
      setMessage("Enviando vídeo...");
      const upRes = await fetch(signedUrl, {
        method: "PUT",
        headers: { "content-type": file.type || "video/mp4" },
        body: file,
      });
      if (!upRes.ok) throw new Error("Falha no upload do vídeo");

      // 3. Dispara o worker
      setMessage("Analisando o áudio e gerando cortes...");
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
    <main>
      <h1>🎧 DjViral</h1>
      <p style={{ opacity: 0.7 }}>
        Envie seu set e receba os cortes mais virais automaticamente.
      </p>

      <form onSubmit={handleSubmit} style={{ display: "grid", gap: 12, marginTop: 24 }}>
        <input
          placeholder="Nome do set"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={busy}
          style={inputStyle}
        />
        <input
          type="file"
          accept="video/mp4,video/*"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          disabled={busy}
          style={inputStyle}
        />
        <button type="submit" disabled={busy || !file || !name} style={buttonStyle}>
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
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <small style={{ opacity: 0.6 }}>
                  {Math.round(c.inicio)}s – {Math.round(c.fim)}s
                </small>
                <button
                  type="button"
                  onClick={() => baixar(c.url, c.titulo)}
                  style={downloadStyle}
                >
                  ⬇ Baixar
                </button>
              </div>
            </div>
          ))}
        </section>
      )}

      {projects.length > 0 && (
        <section style={{ marginTop: 40 }}>
          <h2 style={{ fontSize: 18 }}>Histórico</h2>
          <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
            {projects.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => carregarProjeto(p.id)}
                disabled={busy}
                style={{
                  ...historyItemStyle,
                  borderColor: p.id === projectId ? "#7c5cff" : "#2a2a35",
                }}
              >
                <span>{p.name}</span>
                <span style={{ opacity: 0.6 }}>{statusLabel(p.status)}</span>
              </button>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}

function statusLabel(status: string): string {
  if (status === "done") return "✅ pronto";
  if (status === "error") return "⚠️ erro";
  return "⏳ processando";
}

const inputStyle: React.CSSProperties = {
  padding: "10px 12px",
  borderRadius: 8,
  border: "1px solid #2a2a35",
  background: "#15151c",
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

const cardStyle: React.CSSProperties = {
  display: "grid",
  gap: 8,
  padding: 16,
  borderRadius: 12,
  background: "#15151c",
  border: "1px solid #2a2a35",
};

const downloadStyle: React.CSSProperties = {
  padding: "6px 12px",
  borderRadius: 8,
  border: "1px solid #2a2a35",
  background: "transparent",
  color: "#9d8cff",
  fontWeight: 600,
  cursor: "pointer",
};

const historyItemStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  padding: "10px 12px",
  borderRadius: 8,
  border: "1px solid #2a2a35",
  background: "#15151c",
  color: "#e9e9f0",
  cursor: "pointer",
  textAlign: "left",
};
