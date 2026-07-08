"use client";

import { useCallback, useEffect, useState } from "react";
import { Header } from "./_studio/Header";
import { GeneratorView } from "./_studio/GeneratorView";
import { SavedView } from "./_studio/SavedView";
import { PlanView } from "./_studio/PlanView";
import { ProfileView } from "./_studio/ProfileView";
import { theme, font } from "./_studio/theme";
import { type ApiCut, toStudioCut } from "./_studio/cut";
import type { SavedFolder, Tab } from "./_studio/types";

// Shape de uma pasta como devolvida por GET /api/cuts/saved.
type ApiFolder = {
  projectId: string;
  setName: string;
  cuts: ApiCut[];
  shareToken?: string | null;
  shareMessage?: string | null;
};

export default function Studio() {
  const [userName, setUserName] = useState("DJ");
  const [tab, setTab] = useState<Tab>("gerador");

  // Chave para resetar o Gerador (o botão "Novo set" a incrementa, remontando
  // o componente com estado limpo).
  const [generatorKey, setGeneratorKey] = useState(0);

  // Cortes salvos, agrupados por set.
  const [savedFolders, setSavedFolders] = useState<SavedFolder[]>([]);

  // Score é sempre visível no protótipo.
  const showScore = true;

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((d) => {
        if (d?.user?.name) setUserName(d.user.name);
      })
      .catch(() => {});

    // Voltando do checkout da AbacatePay (?billing=...): abre a aba Plano,
    // que mostra o status do pagamento.
    if (new URLSearchParams(window.location.search).has("billing")) {
      setTab("plano");
    }
  }, []);

  const loadSaved = useCallback(async () => {
    try {
      const res = await fetch("/api/cuts/saved");
      if (!res.ok) return;
      const data = await res.json();
      const folders: ApiFolder[] = data.folders ?? [];
      setSavedFolders(
        folders.map((f) => ({
          projectId: f.projectId,
          setName: f.setName,
          cuts: f.cuts.map(toStudioCut),
          shareToken: f.shareToken ?? null,
          shareMessage: f.shareMessage ?? null,
        }))
      );
    } catch {
      // silencioso: mantém a lista atual em caso de falha de rede.
    }
  }, []);

  // No mount: descarta os cortes não salvos (e sets sem nada salvo) da sessão
  // anterior e então carrega os cortes salvos.
  useEffect(() => {
    (async () => {
      try {
        await fetch("/api/cleanup", { method: "POST" });
      } catch {
        // se a limpeza falhar, ainda tentamos carregar o que existe.
      }
      await loadSaved();
    })();
  }, [loadSaved]);

  function handleNewSet() {
    setGeneratorKey((k) => k + 1);
    setTab("gerador");
  }

  async function handleDeleteCut(projectId: string, cutId: string) {
    const res = await fetch(`/api/projects/${projectId}/cuts/${cutId}`, { method: "DELETE" });
    if (!res.ok) return false;
    setSavedFolders((prev) =>
      prev
        .map((f) =>
          f.projectId === projectId ? { ...f, cuts: f.cuts.filter((c) => c.id !== cutId) } : f
        )
        .filter((f) => f.cuts.length > 0)
    );
    return true;
  }

  async function handleDeleteFolder(projectId: string) {
    const res = await fetch(`/api/projects/${projectId}`, { method: "DELETE" });
    if (!res.ok) return false;
    setSavedFolders((prev) => prev.filter((f) => f.projectId !== projectId));
    return true;
  }

  return (
    <div
      style={{
        position: "relative",
        minHeight: "100vh",
        background: theme.bg,
        color: theme.textPrimary,
        fontFamily: font.body,
      }}
    >
      <Header tab={tab} onTab={setTab} userName={userName} onNewSet={handleNewSet} />

      <main
        className="dj-studio-main"
        style={{
          position: "relative",
          zIndex: 1,
          maxWidth: 1200,
          margin: "0 auto",
          padding: "38px 32px 80px",
        }}
      >
        {tab === "gerador" && (
          <GeneratorView
            key={generatorKey}
            onSaved={loadSaved}
            onUpgrade={() => setTab("plano")}
          />
        )}
        {tab === "salvos" && (
          <SavedView
            folders={savedFolders}
            showScore={showScore}
            onDeleteCut={handleDeleteCut}
            onDeleteFolder={handleDeleteFolder}
          />
        )}
        {tab === "plano" && <PlanView />}
        {tab === "perfil" && (
          <ProfileView
            userName={userName}
            onNameChange={setUserName}
            onManagePlan={() => setTab("plano")}
          />
        )}
      </main>
    </div>
  );
}
