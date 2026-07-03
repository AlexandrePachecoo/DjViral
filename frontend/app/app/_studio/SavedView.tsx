"use client";

import { theme, font, scoreColor } from "./theme";
import { type Cut } from "./data";
import { downloadUrl } from "./cut";
import type { SavedFolder } from "./types";

type Props = {
  folders: SavedFolder[];
  showScore: boolean;
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

export function SavedView({ folders, showScore }: Props) {
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
        <section key={folder.projectId}>
          {/* Cabeçalho da pasta */}
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
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
            <div>
              <div style={{ font: `500 18px ${font.display}`, letterSpacing: "-.01em" }}>{folder.setName}</div>
              <div style={{ fontSize: 12, color: theme.textMuted, marginTop: 2 }}>
                {folder.cuts.length} corte{folder.cuts.length > 1 ? "s" : ""} salvo{folder.cuts.length > 1 ? "s" : ""}
              </div>
            </div>
          </div>

          {/* Cortes da pasta */}
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
                  <DownloadLink cut={cut} />
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
