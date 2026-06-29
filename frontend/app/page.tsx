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

type Status = "idle" | "uploading" | "processing" | "done" | "error";

export default function Home() {
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("");
  const [projectId, setProjectId] = useState<string | null>(null);
  const [cuts, setCuts] = useState<Cut[]>([]);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
      <p className="subtitle">
        Envie seu set e receba os cortes mais virais automaticamente.
      </p>

      <form onSubmit={handleSubmit} className="form">
        <input
          placeholder="Nome do set"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={busy}
          className="input"
        />
        <input
          type="file"
          accept="video/mp4,video/*"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          disabled={busy}
          className="input"
        />
        <button type="submit" disabled={busy || !file || !name} className="button">
          {busy ? "Processando..." : "Gerar cortes"}
        </button>
      </form>

      {message && (
        <p className={status === "error" ? "status status--error" : "status"}>
          {message}
        </p>
      )}

      {cuts.length > 0 && (
        <section className="cuts">
          {cuts.map((c, i) => (
            <div key={i} className="card">
              <div className="card__header">
                <strong className="card__title">{c.titulo}</strong>
                <span className="card__score">score {c.score.toFixed(2)}</span>
              </div>
              <video src={c.url} controls playsInline preload="metadata" />
              <small className="card__meta">
                {Math.round(c.inicio)}s – {Math.round(c.fim)}s
              </small>
            </div>
          ))}
        </section>
      )}
    </main>
  );
}
