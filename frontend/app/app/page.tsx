"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Header } from "./_studio/Header";
import { GeneratorView } from "./_studio/GeneratorView";
import { SavedView } from "./_studio/SavedView";
import { EditorView } from "./_studio/EditorView";
import { PlanView } from "./_studio/PlanView";
import { ProfileView } from "./_studio/ProfileView";
import { theme, font } from "./_studio/theme";
import { type ApiCut, toStudioCut } from "./_studio/cut";
import type { Cut } from "./_studio/data";
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

  // Corte aberto na aba Edição (via botão "Editar" de um card ou pelo picker
  // da própria aba). null = a aba mostra o seletor de cortes.
  const [editing, setEditing] = useState<{
    projectId: string;
    setName: string;
    cut: Cut;
  } | null>(null);

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

  function handleEdit(projectId: string, setName: string, cut: Cut) {
    setEditing({ projectId, setName, cut });
    setTab("edicao");
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
        {/* O Gerador fica MONTADO (só escondido) fora da aba: trocar para a
            Edição/Cortes salvos e voltar não perde os cortes recém-gerados
            nem interrompe o polling de um set em processamento. */}
        <div style={{ display: tab === "gerador" ? "block" : "none" }}>
          <GeneratorView
            key={generatorKey}
            onSaved={loadSaved}
            onUpgrade={() => setTab("plano")}
            onEdit={handleEdit}
          />
        </div>
        {tab === "edicao" &&
          (editing ? (
            <EditorView
              cut={editing.cut}
              setName={editing.setName}
              projectId={editing.projectId}
              onBack={() => setEditing(null)}
              onSaved={(updated) => {
                setEditing((e) => (e ? { ...e, cut: updated } : e));
                loadSaved();
              }}
            />
          ) : (
            <EditPicker folders={savedFolders} onEdit={handleEdit} />
          ))}
        {tab === "salvos" && (
          <SavedView
            folders={savedFolders}
            showScore={showScore}
            onDeleteCut={handleDeleteCut}
            onDeleteFolder={handleDeleteFolder}
            onEdit={handleEdit}
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

// Seletor da aba Edição quando nenhum corte está aberto: lista os cortes
// salvos para escolher qual editar (os recém-gerados têm o botão "Editar"
// direto no card do Gerador).
function EditPicker({
  folders,
  onEdit,
}: {
  folders: SavedFolder[];
  onEdit: (projectId: string, setName: string, cut: Cut) => void;
}) {
  const t = useTranslations("studio.editPicker");
  const hasCuts = folders.some((f) => f.cuts.length > 0);
  if (!hasCuts) {
    return (
      <div style={{ animation: "dj-fadeUp .4s ease" }} data-anim>
        <div
          style={{
            padding: "48px 24px",
            textAlign: "center",
            borderRadius: 14,
            background: theme.surface,
            border: `1px solid ${theme.border}`,
            color: theme.textMuted,
            fontSize: 14,
          }}
        >
          {t("empty")}
        </div>
      </div>
    );
  }

  return (
    <div
      style={{ animation: "dj-fadeUp .4s ease", display: "flex", flexDirection: "column", gap: 28 }}
      data-anim
    >
      <div>
        <div style={{ font: `500 24px ${font.display}`, letterSpacing: "-.01em" }}>
          {t("title")}
        </div>
        <div style={{ color: theme.textMuted, fontSize: 13, marginTop: 4 }}>{t("subtitle")}</div>
      </div>
      {folders.map((folder) => (
        <section key={folder.projectId}>
          <div style={{ font: `500 16px ${font.display}`, marginBottom: 12 }}>
            📁 {folder.setName}
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill,minmax(200px,1fr))",
              gap: 16,
            }}
          >
            {folder.cuts.map((cut) => (
              <div
                key={cut.id}
                onClick={() => onEdit(folder.projectId, folder.setName, cut)}
                style={{
                  border: `1px solid ${theme.border}`,
                  borderRadius: 12,
                  overflow: "hidden",
                  background: theme.surface,
                  cursor: "pointer",
                }}
              >
                <video
                  src={cut.url}
                  muted
                  playsInline
                  preload="metadata"
                  style={{
                    width: "100%",
                    height: 200,
                    objectFit: "cover",
                    display: "block",
                    background: "#000",
                    pointerEvents: "none",
                  }}
                />
                <div style={{ padding: 12 }}>
                  <div
                    style={{
                      font: `500 13px ${font.display}`,
                      marginBottom: 4,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {cut.title}
                  </div>
                  <div style={{ fontSize: 11, color: theme.textMuted, marginBottom: 10 }}>
                    {cut.dur} · {t("inSet")} · {cut.moment}
                  </div>
                  <div
                    style={{
                      textAlign: "center",
                      padding: 8,
                      borderRadius: 8,
                      fontSize: 12,
                      color: theme.accent,
                      background: theme.accentSoft,
                      border: `1px solid ${theme.accentBorder}`,
                    }}
                  >
                    {t("edit")}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
