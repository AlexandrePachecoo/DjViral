"use client";

import { theme, font, scoreColor } from "./theme";
import { Segmented } from "./Segmented";
import { type Cut, type SetInfo } from "./data";
import type { GeradorView, ProjectSummary } from "./types";

type Props = {
  view: GeradorView;
  onView: (v: GeradorView) => void;
  showScore: boolean;
  cuts: Cut[];
  setInfo: SetInfo;
  projects: ProjectSummary[];
  selectedProjectId: string | null;
  onSelectProject: (id: string) => void;
  onEdit: (cut: Cut) => void;
  onPost: (cut: Cut) => void;
  onProgram: (cut: Cut) => void;
};

export function GeneratorView({
  view,
  onView,
  showScore,
  cuts,
  setInfo,
  projects,
  selectedProjectId,
  onSelectProject,
  onEdit,
  onPost,
  onProgram,
}: Props) {
  return (
    <div style={{ animation: "dj-fadeUp .4s ease" }} data-anim>
      {/* ===== Set card ===== */}
      <div
        className="dj-genset"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 20,
          padding: "18px 22px",
          borderRadius: 14,
          background: theme.surface,
          border: `1px solid ${theme.border}`,
          marginBottom: 30,
        }}
      >
        <div
          style={{
            width: 52,
            height: 52,
            borderRadius: 12,
            background: theme.accentSoft,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 22 }}>
            {[55, 100, 38, 78].map((h, i) => (
              <span
                key={i}
                className="dj-eqbar"
                data-anim
                style={{ height: `${h}%`, animationDelay: `${i * 0.15}s` }}
              />
            ))}
          </div>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          {projects.length > 1 ? (
            <select
              value={selectedProjectId ?? ""}
              onChange={(e) => onSelectProject(e.target.value)}
              aria-label="Selecionar set"
              style={{
                font: `500 18px ${font.display}`,
                color: theme.textPrimary,
                background: theme.surface,
                border: `1px solid ${theme.borderStrong}`,
                borderRadius: 8,
                padding: "4px 8px",
                marginBottom: 5,
                maxWidth: "100%",
              }}
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          ) : (
            <div style={{ font: `500 18px ${font.display}`, marginBottom: 5 }}>{setInfo.name}</div>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 10, color: theme.textMuted, fontSize: 13 }}>
            <span>{setInfo.cutsCount} cortes</span>
            {setInfo.bpm != null && (
              <>
                <span style={{ width: 3, height: 3, borderRadius: "50%", background: theme.textFaint2 }} />
                <span style={{ padding: "2px 9px", borderRadius: 20, background: theme.surfaceMuted, color: theme.textTertiary }}>
                  {setInfo.bpm} BPM
                </span>
              </>
            )}
          </div>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "8px 14px",
            borderRadius: 10,
            background: theme.surfaceMuted,
            border: `1px solid ${theme.border}`,
          }}
        >
          <span style={{ color: "#059669" }}>✓</span>
          <span style={{ fontSize: 13, color: theme.textSecondary }}>
            Análise concluída · {setInfo.cutsCount} cortes
          </span>
        </div>
      </div>

      {/* ===== Toolbar ===== */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          marginBottom: 22,
          flexWrap: "wrap",
          gap: 14,
        }}
      >
        <div>
          <div style={{ font: `500 24px ${font.display}`, letterSpacing: "-.01em" }}>
            {setInfo.cutsCount} cortes gerados
          </div>
          <div style={{ color: theme.textMuted, fontSize: 13, marginTop: 4 }}>
            ordenados por potencial de viralizar
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Segmented<GeradorView>
            options={[
              { key: "grade", label: "Grade" },
              { key: "lista", label: "Lista" },
            ]}
            value={view}
            onChange={onView}
          />
        </div>
      </div>

      {view === "grade" ? (
        <GradeView cuts={cuts} showScore={showScore} onEdit={onEdit} onPost={onPost} onProgram={onProgram} />
      ) : (
        <ListaView cuts={cuts} showScore={showScore} onEdit={onEdit} onPost={onPost} onProgram={onProgram} />
      )}
    </div>
  );
}

type CardActions = {
  cuts: Cut[];
  showScore: boolean;
  onEdit: (cut: Cut) => void;
  onPost: (cut: Cut) => void;
  onProgram: (cut: Cut) => void;
};

function GradeView({ cuts, showScore, onEdit, onPost, onProgram }: CardActions) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill,minmax(248px,1fr))",
        gap: 22,
      }}
    >
      {cuts.map((c) => (
        <div
          key={c.id}
          style={{
            border: `1px solid ${theme.border}`,
            borderRadius: 14,
            overflow: "hidden",
            background: theme.surface,
          }}
        >
          <div style={{ position: "relative", background: "#000" }}>
            <video
              src={c.url}
              controls
              playsInline
              preload="metadata"
              style={{ width: "100%", height: 300, objectFit: "cover", display: "block", background: "#000" }}
            />
            {showScore && (
              <div
                style={{
                  position: "absolute",
                  top: 13,
                  right: 14,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "flex-end",
                  lineHeight: 1,
                  padding: "4px 7px",
                  borderRadius: 8,
                  background: "rgba(255,255,255,.85)",
                  pointerEvents: "none",
                }}
              >
                <span style={{ font: `600 18px ${font.display}`, color: scoreColor(c.score) }}>{c.score}</span>
                <span style={{ fontSize: 9, letterSpacing: ".08em", color: theme.textMuted, marginTop: 2 }}>SCORE</span>
              </div>
            )}
          </div>
          <div style={{ padding: 15 }}>
            <div style={{ font: `500 15px ${font.display}`, marginBottom: 2 }}>{c.title}</div>
            <div style={{ fontSize: 12, color: theme.textMuted, marginBottom: 14 }}>
              {c.dur} · no set · {c.moment}
            </div>
            <div
              onClick={() => onPost(c)}
              style={{
                display: "block",
                textAlign: "center",
                padding: 9,
                borderRadius: 8,
                cursor: "pointer",
                font: `500 13px ${font.body}`,
                color: "#fff",
                background: theme.accent,
              }}
            >
              Postar
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 7, marginTop: 8 }}>
              <SmallGhost onClick={() => onEdit(c)}>Editar</SmallGhost>
              <SmallGhost onClick={() => onProgram(c)}>Agendar</SmallGhost>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function SmallGhost({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) {
  return (
    <div
      onClick={onClick}
      style={{
        textAlign: "center",
        padding: 8,
        borderRadius: 8,
        cursor: "pointer",
        fontSize: 12,
        color: theme.textSecondary,
        background: theme.surface,
        border: `1px solid ${theme.borderStrong}`,
      }}
    >
      {children}
    </div>
  );
}

function ListaView({ cuts, showScore, onEdit, onPost, onProgram }: CardActions) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {cuts.map((c) => (
        <div
          key={c.id}
          className="dj-list-row"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 18,
            padding: "14px 18px",
            borderRadius: 13,
            background: theme.surface,
            border: `1px solid ${theme.border}`,
          }}
        >
          <video
            src={c.url}
            playsInline
            muted
            preload="metadata"
            style={{
              width: 56,
              height: 98,
              borderRadius: 8,
              objectFit: "cover",
              background: "#000",
              flexShrink: 0,
            }}
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ font: `500 16px ${font.display}` }}>{c.title}</div>
            <div style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 12, color: theme.textMuted, marginTop: 4 }}>
              <span>{c.dur}</span>
              <span style={{ width: 3, height: 3, borderRadius: "50%", background: theme.textFaint2 }} />
              <span>no set · {c.moment}</span>
            </div>
          </div>
          {showScore && (
            <div className="dj-list-score" style={{ display: "flex", alignItems: "center", gap: 10, width: 180 }}>
              <div style={{ flex: 1, height: 6, borderRadius: 5, background: theme.surfaceMuted2, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${c.score}%`, background: scoreColor(c.score) }} />
              </div>
              <span style={{ font: `600 14px ${font.display}`, color: scoreColor(c.score) }}>{c.score}</span>
            </div>
          )}
          <div className="dj-list-actions" style={{ display: "flex", gap: 8 }}>
            <div
              onClick={() => onPost(c)}
              style={{
                padding: "8px 16px",
                borderRadius: 8,
                cursor: "pointer",
                font: `500 13px ${font.body}`,
                color: "#fff",
                background: theme.accent,
              }}
            >
              Postar
            </div>
            <SmallGhostInline onClick={() => onEdit(c)}>Editar</SmallGhostInline>
            <SmallGhostInline onClick={() => onProgram(c)}>⏱</SmallGhostInline>
          </div>
        </div>
      ))}
    </div>
  );
}

function SmallGhostInline({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) {
  return (
    <div
      onClick={onClick}
      style={{
        padding: "8px 13px",
        borderRadius: 8,
        cursor: "pointer",
        fontSize: 13,
        color: theme.textSecondary,
        background: theme.surface,
        border: `1px solid ${theme.borderStrong}`,
      }}
    >
      {children}
    </div>
  );
}
