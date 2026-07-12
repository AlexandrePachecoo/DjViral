"use client";

import { useState } from "react";
import { theme, font, scoreColor, btnPrimary, btnGhost } from "./theme";
import { type Cut } from "./data";
import { downloadUrl } from "./cut";
import type { SavedFolder } from "./types";

type Props = {
  folders: SavedFolder[];
  showScore: boolean;
  onDeleteCut: (projectId: string, cutId: string) => Promise<boolean>;
  onDeleteFolder: (projectId: string) => Promise<boolean>;
  // Abre um corte na aba Edição (timeline + zoom manual).
  onEdit: (projectId: string, setName: string, cut: Cut) => void;
};

// Botão de download (âncora real; o `?download=` do Supabase força o attachment).
function DownloadLink({ cut }: { cut: Cut }) {
  return (
    <a
      href={downloadUrl(cut)}
      target="_blank"
      rel="noopener"
      style={{
        display: "block",
        textAlign: "center",
        padding: 9,
        borderRadius: 8,
        fontSize: 13,
        color: theme.textSecondary,
        background: theme.surface,
        border: `1px solid ${theme.borderStrong}`,
        textDecoration: "none",
        whiteSpace: "nowrap",
      }}
    >
      Baixar
    </a>
  );
}

// Botão de apagar um corte, com confirmação em duas etapas (sem window.confirm).
function CutDeleteButton({
  projectId,
  cutId,
  onDeleteCut,
}: {
  projectId: string;
  cutId: string;
  onDeleteCut: (projectId: string, cutId: string) => Promise<boolean>;
}) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  if (confirm) {
    return (
      <div style={{ display: "flex", gap: 6 }}>
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            const ok = await onDeleteCut(projectId, cutId);
            if (!ok) {
              setBusy(false);
              setConfirm(false);
            }
          }}
          style={{
            padding: "9px 12px",
            borderRadius: 8,
            fontSize: 13,
            color: "#fff",
            background: "#dc2626",
            border: "none",
            cursor: busy ? "default" : "pointer",
            opacity: busy ? 0.6 : 1,
            whiteSpace: "nowrap",
          }}
        >
          {busy ? "..." : "Confirmar"}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => setConfirm(false)}
          style={{
            padding: "9px 12px",
            borderRadius: 8,
            fontSize: 13,
            color: theme.textSecondary,
            background: theme.surface,
            border: `1px solid ${theme.borderStrong}`,
            cursor: "pointer",
            whiteSpace: "nowrap",
          }}
        >
          Cancelar
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setConfirm(true)}
      title="Apagar corte"
      style={{
        padding: "9px 12px",
        borderRadius: 8,
        fontSize: 13,
        color: "#dc2626",
        background: theme.surface,
        border: `1px solid ${theme.borderStrong}`,
        cursor: "pointer",
      }}
    >
      🗑
    </button>
  );
}

// Painel de compartilhamento público de um set. Gera/revoga o link (/s/<token>)
// e salva a mensagem do dono via POST /api/projects/[id]/share.
function SharePanel({ folder }: { folder: SavedFolder }) {
  const [token, setToken] = useState<string | null>(folder.shareToken ?? null);
  const [message, setMessage] = useState(folder.shareMessage ?? "");
  const [savedMessage, setSavedMessage] = useState(folder.shareMessage ?? "");
  const [busy, setBusy] = useState(false);
  const [savingMsg, setSavingMsg] = useState(false);
  const [copied, setCopied] = useState(false);

  const enabled = !!token;
  const publicUrl =
    token && typeof window !== "undefined" ? `${window.location.origin}/s/${token}` : "";

  async function post(body: Record<string, unknown>) {
    const res = await fetch(`/api/projects/${folder.projectId}/share`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error("falha");
    return res.json() as Promise<{ shareToken: string | null; message: string }>;
  }

  async function toggleShare() {
    setBusy(true);
    try {
      const data = await post({ enabled: !enabled });
      setToken(data.shareToken);
    } catch {
      // silencioso; o estado permanece o anterior.
    } finally {
      setBusy(false);
    }
  }

  async function saveMessage() {
    setSavingMsg(true);
    try {
      const data = await post({ message });
      setSavedMessage(data.message);
    } catch {
      // silencioso.
    } finally {
      setSavingMsg(false);
    }
  }

  async function copyLink() {
    if (!publicUrl) return;
    try {
      await navigator.clipboard.writeText(publicUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // clipboard indisponível; ignora.
    }
  }

  const messageDirty = message !== savedMessage;

  return (
    <div
      style={{
        marginBottom: 16,
        padding: 18,
        borderRadius: 14,
        background: theme.surface,
        border: `1px solid ${theme.border}`,
        display: "flex",
        flexDirection: "column",
        gap: 16,
      }}
    >
      {/* Ativar / desativar o link */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ font: `500 14px ${font.display}` }}>Link público</div>
          <div style={{ fontSize: 12, color: theme.textMuted, marginTop: 2 }}>
            {enabled
              ? "Qualquer pessoa com o link vê e baixa os cortes salvos."
              : "Gere um link para qualquer pessoa ver e baixar os cortes salvos."}
          </div>
        </div>
        <button
          type="button"
          onClick={toggleShare}
          disabled={busy}
          style={{
            ...(enabled ? btnGhost : btnPrimary),
            opacity: busy ? 0.6 : 1,
            cursor: busy ? "default" : "pointer",
          }}
        >
          {busy ? "..." : enabled ? "Desativar link" : "Ativar link"}
        </button>
      </div>

      {/* URL + copiar (só quando ativo) */}
      {enabled && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input
            readOnly
            value={publicUrl}
            onFocus={(e) => e.currentTarget.select()}
            style={{
              flex: 1,
              minWidth: 200,
              padding: "9px 12px",
              borderRadius: 9,
              border: `1px solid ${theme.borderStrong}`,
              background: theme.surfaceInset,
              color: theme.textSecondary,
              fontSize: 13,
              fontFamily: font.body,
            }}
          />
          <button type="button" onClick={copyLink} style={btnGhost}>
            {copied ? "Copiado!" : "Copiar link"}
          </button>
        </div>
      )}

      {/* Mensagem do dono */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <label style={{ fontSize: 12, color: theme.textSecondary, fontWeight: 500 }}>
          Mensagem exibida no topo do link (opcional)
        </label>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          maxLength={500}
          rows={3}
          placeholder="Ex.: Valeu por curtir o set! Baixa os cortes e marca @seuperfil 🔥"
          style={{
            padding: "10px 12px",
            borderRadius: 9,
            border: `1px solid ${theme.borderStrong}`,
            background: theme.surface,
            color: theme.textPrimary,
            fontSize: 14,
            fontFamily: font.body,
            resize: "vertical",
          }}
        />
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button
            type="button"
            onClick={saveMessage}
            disabled={savingMsg || !messageDirty}
            style={{
              ...btnPrimary,
              opacity: savingMsg || !messageDirty ? 0.5 : 1,
              cursor: savingMsg || !messageDirty ? "default" : "pointer",
            }}
          >
            {savingMsg ? "Salvando..." : "Salvar mensagem"}
          </button>
          <span style={{ fontSize: 12, color: theme.textMuted }}>{message.length}/500</span>
        </div>
      </div>
    </div>
  );
}

function FolderSection({
  folder,
  showScore,
  onDeleteCut,
  onDeleteFolder,
  onEdit,
}: {
  folder: SavedFolder;
  showScore: boolean;
  onDeleteCut: (projectId: string, cutId: string) => Promise<boolean>;
  onDeleteFolder: (projectId: string) => Promise<boolean>;
  onEdit: (projectId: string, setName: string, cut: Cut) => void;
}) {
  const [shareOpen, setShareOpen] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const shared = !!folder.shareToken;

  return (
    <section>
      {/* Cabeçalho da pasta */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-label={expanded ? "Recolher pasta" : "Expandir pasta"}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            padding: 4,
            color: theme.textMuted,
            display: "flex",
            flexShrink: 0,
          }}
        >
          <span
            style={{
              display: "inline-block",
              fontSize: 14,
              transition: "transform .15s",
              transform: expanded ? "rotate(90deg)" : "none",
            }}
          >
            ▸
          </span>
        </button>
        <div
          style={{
            width: 38,
            height: 38,
            borderRadius: 10,
            background: theme.accentSoft,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 18,
            flexShrink: 0,
          }}
        >
          📁
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ font: `500 18px ${font.display}`, letterSpacing: "-.01em" }}>{folder.setName}</div>
          <div style={{ fontSize: 12, color: theme.textMuted, marginTop: 2 }}>
            {folder.cuts.length} corte{folder.cuts.length > 1 ? "s" : ""} salvo{folder.cuts.length > 1 ? "s" : ""}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
          <button
            type="button"
            onClick={() => setShareOpen((v) => !v)}
            style={{ ...btnGhost, padding: "7px 13px", fontSize: 12 }}
          >
            {shared ? "🔗 Compartilhado" : "🔗 Compartilhar"}
          </button>
          {!confirmDelete ? (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              style={{ ...btnGhost, padding: "7px 13px", fontSize: 12, color: "#dc2626" }}
            >
              🗑 Apagar set
            </button>
          ) : (
            <>
              <button
                type="button"
                disabled={deleting}
                onClick={async () => {
                  setDeleting(true);
                  const ok = await onDeleteFolder(folder.projectId);
                  if (!ok) {
                    setDeleting(false);
                    setConfirmDelete(false);
                  }
                }}
                style={{
                  padding: "7px 13px",
                  borderRadius: 9,
                  fontSize: 12,
                  color: "#fff",
                  background: "#dc2626",
                  border: "none",
                  cursor: deleting ? "default" : "pointer",
                  opacity: deleting ? 0.6 : 1,
                }}
              >
                {deleting ? "..." : "Confirmar"}
              </button>
              <button
                type="button"
                disabled={deleting}
                onClick={() => setConfirmDelete(false)}
                style={{ ...btnGhost, padding: "7px 13px", fontSize: 12 }}
              >
                Cancelar
              </button>
            </>
          )}
        </div>
      </div>

      {shareOpen && <SharePanel folder={folder} />}

      {/* Cortes da pasta */}
      {expanded && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(224px,1fr))", gap: 20 }}>
          {folder.cuts.map((cut) => (
            <div key={cut.id} style={{ border: `1px solid ${theme.border}`, borderRadius: 14, overflow: "hidden", background: theme.surface }}>
              <div style={{ position: "relative", background: "#000" }}>
                <video
                  src={cut.url}
                  controls
                  playsInline
                  preload="metadata"
                  style={{ width: "100%", height: 270, objectFit: "cover", display: "block", background: "#000" }}
                />
                {showScore && (
                  <div
                    style={{
                      position: "absolute",
                      top: 13,
                      right: 14,
                      font: `600 15px ${font.display}`,
                      color: scoreColor(cut.score),
                      background: "rgba(255,255,255,.85)",
                      padding: "2px 7px",
                      borderRadius: 7,
                      pointerEvents: "none",
                    }}
                  >
                    {cut.score}
                  </div>
                )}
              </div>
              <div style={{ padding: 14 }}>
                <div style={{ font: `500 14px ${font.display}`, marginBottom: 6 }}>{cut.title}</div>
                <div style={{ fontSize: 12, color: theme.textMuted, marginBottom: 12 }}>
                  {cut.dur} · no set · {cut.moment}
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    type="button"
                    onClick={() => onEdit(folder.projectId, folder.setName, cut)}
                    style={{
                      flex: 1,
                      padding: 9,
                      borderRadius: 8,
                      fontSize: 13,
                      color: theme.textSecondary,
                      background: theme.surface,
                      border: `1px solid ${theme.borderStrong}`,
                      cursor: "pointer",
                      whiteSpace: "nowrap",
                      fontFamily: font.body,
                    }}
                  >
                    ✎ Editar
                  </button>
                  <div style={{ flex: 1 }}>
                    <DownloadLink cut={cut} />
                  </div>
                  <CutDeleteButton projectId={folder.projectId} cutId={cut.id} onDeleteCut={onDeleteCut} />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export function SavedView({ folders, showScore, onDeleteCut, onDeleteFolder, onEdit }: Props) {
  if (folders.length === 0) {
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
          Nenhum corte salvo ainda. Gere um set e salve seus cortes favoritos.
        </div>
      </div>
    );
  }

  return (
    <div style={{ animation: "dj-fadeUp .4s ease", display: "flex", flexDirection: "column", gap: 34 }} data-anim>
      {folders.map((folder) => (
        <FolderSection
          key={folder.projectId}
          folder={folder}
          showScore={showScore}
          onDeleteCut={onDeleteCut}
          onDeleteFolder={onDeleteFolder}
          onEdit={onEdit}
        />
      ))}
    </div>
  );
}
