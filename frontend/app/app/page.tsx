"use client";

import { useEffect, useState } from "react";
import { Header } from "./_studio/Header";
import { GeneratorView } from "./_studio/GeneratorView";
import { EditorView } from "./_studio/EditorView";
import { SavedView } from "./_studio/SavedView";
import { PublishModal } from "./_studio/PublishModal";
import { theme, font } from "./_studio/theme";
import { CUTS, type Cut, type Platform } from "./_studio/data";
import type {
  Filter,
  GeradorView,
  ModalMode,
  ModalState,
  SalvosView,
  Tab,
} from "./_studio/types";

export default function Studio() {
  const [userName, setUserName] = useState("DJ");

  const [tab, setTab] = useState<Tab>("gerador");
  const [geradorView, setGeradorView] = useState<GeradorView>("grade");
  const [salvosView, setSalvosView] = useState<SalvosView>("galeria");
  const [filter, setFilter] = useState<Filter>("todos");
  const [editorCut, setEditorCut] = useState<Cut>(CUTS[0]);
  const [selectedCaptionId, setSelectedCaptionId] = useState("cap1");
  const [modal, setModal] = useState<ModalState>({
    open: false,
    mode: "agora",
    cut: null,
    platform: "TikTok",
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

  function goTab(next: Tab) {
    setTab(next);
  }

  function openEditor(cut: Cut) {
    setEditorCut(cut);
    setSelectedCaptionId("cap1");
    setTab("edicao");
  }

  function openModal(cut: Cut, mode: ModalMode) {
    setModal({ open: true, mode, cut, platform: "TikTok" });
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
      <Header tab={tab} onTab={goTab} userName={userName} />

      <main
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
            view={geradorView}
            onView={setGeradorView}
            showScore={showScore}
            onEdit={openEditor}
            onPost={(c) => openModal(c, "agora")}
            onProgram={(c) => openModal(c, "programar")}
          />
        )}

        {tab === "edicao" && (
          <EditorView
            cut={editorCut}
            selectedCaptionId={selectedCaptionId}
            onSelectCaption={setSelectedCaptionId}
            onBack={() => setTab("gerador")}
          />
        )}

        {tab === "salvos" && (
          <SavedView
            view={salvosView}
            onView={setSalvosView}
            filter={filter}
            onFilter={setFilter}
            showScore={showScore}
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
