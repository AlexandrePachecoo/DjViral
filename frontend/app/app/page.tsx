"use client";

import { useCallback, useEffect, useState } from "react";
import { Header } from "./_studio/Header";
import { GeneratorView } from "./_studio/GeneratorView";
import { EditorView } from "./_studio/EditorView";
import { SavedView } from "./_studio/SavedView";
import { PublishModal } from "./_studio/PublishModal";
import { EmptyState, LoadingState } from "./_studio/StudioStates";
import { theme, font } from "./_studio/theme";
import { type Cut, type Platform, type SetInfo } from "./_studio/data";
import { type ApiCut, parseBpm, toStudioCut } from "./_studio/cut";
import type {
  Filter,
  GeradorView,
  ModalMode,
  ModalState,
  ProjectSummary,
  SalvosView,
  Tab,
} from "./_studio/types";

type LoadState = "loading" | "ready" | "empty" | "error";

export default function Studio() {
  const [userName, setUserName] = useState("DJ");

  const [tab, setTab] = useState<Tab>("gerador");
  const [geradorView, setGeradorView] = useState<GeradorView>("grade");
  const [salvosView, setSalvosView] = useState<SalvosView>("galeria");
  const [filter, setFilter] = useState<Filter>("todos");
  const [selectedCaptionId, setSelectedCaptionId] = useState("cap1");

  // Dados reais do estúdio.
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [cuts, setCuts] = useState<Cut[]>([]);
  const [setInfo, setSetInfo] = useState<SetInfo | null>(null);
  const [editorCut, setEditorCut] = useState<Cut | null>(null);

  const [modal, setModal] = useState<ModalState>({
    open: false,
    mode: "agora",
    cut: null,
    platform: "TikTok",
    setName: "",
  });

  // Score visibility is a tweak in the prototype; kept on by default.
  const showScore = true;

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((d) => {
        if (d?.user?.name) setUserName(d.user.name);
      })
      .catch(() => {});
  }, []);

  // Carrega os cortes de um projeto e monta o resumo do set.
  const loadCuts = useCallback(async (projectId: string, name: string) => {
    setLoadState("loading");
    try {
      const res = await fetch(`/api/projects/${projectId}`);
      if (!res.ok) throw new Error("falha ao carregar cortes");
      const data = await res.json();
      const apiCuts: ApiCut[] = data.cuts ?? [];
      const mapped = apiCuts.map(toStudioCut);
      setCuts(mapped);
      setSetInfo({
        name: data.name ?? name,
        cutsCount: mapped.length,
        bpm: apiCuts.map((c) => parseBpm(c.titulo)).find((b) => b != null) ?? null,
      });
      setLoadState("ready");
    } catch {
      setCuts([]);
      setSetInfo(null);
      setLoadState("error");
    }
  }, []);

  // Carrega os projetos do usuário e escolhe o set concluído mais recente.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/projects");
        if (!res.ok) throw new Error("falha ao listar projetos");
        const data = await res.json();
        if (cancelled) return;
        const all: ProjectSummary[] = data.projects ?? [];
        const done = all.filter((p) => p.status === "done");
        setProjects(done);
        if (done.length === 0) {
          setLoadState("empty");
          return;
        }
        setSelectedProjectId(done[0].id);
        await loadCuts(done[0].id, done[0].name);
      } catch {
        if (!cancelled) setLoadState("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadCuts]);

  function goTab(next: Tab) {
    setTab(next);
  }

  function selectProject(id: string) {
    const proj = projects.find((p) => p.id === id);
    if (!proj) return;
    setSelectedProjectId(id);
    loadCuts(id, proj.name);
  }

  function openEditor(cut: Cut) {
    setEditorCut(cut);
    setSelectedCaptionId("cap1");
    setTab("edicao");
  }

  function openModal(cut: Cut, mode: ModalMode) {
    setModal({ open: true, mode, cut, platform: "TikTok", setName: setInfo?.name ?? "" });
  }

  const hasData = loadState === "ready" && setInfo !== null;

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
      <Header tab={tab} onTab={goTab} userName={userName} />

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
        {loadState === "loading" && <LoadingState />}
        {loadState === "empty" && <EmptyState />}
        {loadState === "error" && (
          <EmptyState
            title="Não foi possível carregar seus cortes"
            hint="Tente recarregar a página. Se acabou de enviar um set, aguarde o processamento terminar."
            cta={null}
          />
        )}

        {hasData && tab === "gerador" && setInfo && (
          <GeneratorView
            view={geradorView}
            onView={setGeradorView}
            showScore={showScore}
            cuts={cuts}
            setInfo={setInfo}
            projects={projects}
            selectedProjectId={selectedProjectId}
            onSelectProject={selectProject}
            onEdit={openEditor}
            onPost={(c) => openModal(c, "agora")}
            onProgram={(c) => openModal(c, "programar")}
          />
        )}

        {hasData && tab === "edicao" && editorCut && (
          <EditorView
            cut={editorCut}
            setName={setInfo?.name ?? ""}
            selectedCaptionId={selectedCaptionId}
            onSelectCaption={setSelectedCaptionId}
            onBack={() => setTab("gerador")}
          />
        )}

        {hasData && tab === "edicao" && !editorCut && (
          <EmptyState
            title="Nenhum corte aberto"
            hint="Volte ao Gerador e toque em Editar num corte."
            cta={null}
          />
        )}

        {hasData && tab === "salvos" && (
          <SavedView
            view={salvosView}
            onView={setSalvosView}
            filter={filter}
            onFilter={setFilter}
            showScore={showScore}
            cuts={cuts}
          />
        )}
      </main>

      <PublishModal
        state={modal}
        onClose={() => setModal((m) => ({ ...m, open: false }))}
        onPlatform={(p: Platform) => setModal((m) => ({ ...m, platform: p }))}
        onMode={(mode) => setModal((m) => ({ ...m, mode }))}
      />
    </div>
  );
}
