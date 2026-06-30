"use client";

import { theme, font, scoreColor, statusChip } from "./theme";
import { Segmented } from "./Segmented";
import { type Cut } from "./data";
import type { Filter, SalvosView } from "./types";

type Props = {
  view: SalvosView;
  onView: (v: SalvosView) => void;
  filter: Filter;
  onFilter: (f: Filter) => void;
  showScore: boolean;
  cuts: Cut[];
};

const FILTERS: { key: Filter; label: string }[] = [
  { key: "todos", label: "Todos" },
  { key: "postados", label: "Postados" },
  { key: "programados", label: "Programados" },
  { key: "rascunhos", label: "Rascunhos" },
];

// Publicação/agendamento ainda não existem no backend, então todo corte gerado
// é um rascunho. Os filtros Postados/Programados ficam vazios até a feature de
// publicação existir.
function draftStyle(): React.CSSProperties {
  const c = statusChip.draft;
  return {
    padding: "4px 10px",
    borderRadius: 20,
    fontSize: 11,
    background: c.bg,
    color: c.text,
    border: `1px solid ${c.border}`,
  };
}

export function SavedView({ view, onView, filter, onFilter, showScore, cuts }: Props) {
  // Só "todos" e "rascunhos" têm itens; os demais ficam vazios por ora.
  const rows = filter === "postados" || filter === "programados" ? [] : cuts;

  return (
    <div style={{ animation: "dj-fadeUp .4s ease" }} data-anim>
      {/* ===== Toolbar ===== */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 24,
          flexWrap: "wrap",
          gap: 14,
        }}
      >
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {FILTERS.map((f) => {
            const active = filter === f.key;
            return (
              <div
                key={f.key}
                onClick={() => onFilter(f.key)}
                style={{
                  padding: "8px 15px",
                  borderRadius: 20,
                  cursor: "pointer",
                  font: `500 13px ${font.body}`,
                  transition: "all .2s",
                  color: active ? theme.accent : theme.textTertiary,
                  background: active ? theme.accentSoft : theme.surface,
                  border: `1px solid ${active ? theme.accentBorder : theme.borderStrong}`,
                }}
              >
                {f.label}
              </div>
            );
          })}
        </div>
        <div className="dj-saved-tools" style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Segmented<SalvosView>
            options={[
              { key: "galeria", label: "Galeria" },
              { key: "tabela", label: "Tabela" },
            ]}
            value={view}
            onChange={onView}
          />
        </div>
      </div>

      {rows.length === 0 ? (
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
          {filter === "postados"
            ? "Nenhum corte postado ainda."
            : filter === "programados"
              ? "Nenhum corte programado ainda."
              : "Nenhum corte salvo."}
        </div>
      ) : view === "galeria" ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(224px,1fr))", gap: 20 }}>
          {rows.map((cut) => (
            <div key={cut.id} style={{ border: `1px solid ${theme.border}`, borderRadius: 14, overflow: "hidden", background: theme.surface }}>
              <div style={{ position: "relative", background: "#000" }}>
                <video
                  src={cut.url}
                  controls
                  playsInline
                  preload="metadata"
                  style={{ width: "100%", height: 270, objectFit: "cover", display: "block", background: "#000" }}
                />
                <div style={{ position: "absolute", top: 13, left: 13, pointerEvents: "none", ...draftStyle() }}>Rascunho</div>
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
                <div style={{ fontSize: 12, color: theme.textMuted }}>
                  {cut.dur} · no set · {cut.moment}
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="dj-table-scroll">
          <div className="dj-table" style={{ borderRadius: 14, overflow: "hidden", background: theme.surface, border: `1px solid ${theme.border}` }}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "2.4fr .8fr 1.2fr 1fr 1.2fr",
                gap: 12,
                padding: "13px 18px",
                fontSize: 12,
                color: theme.textMuted,
                borderBottom: `1px solid ${theme.borderHairline}`,
              }}
            >
              <span>Corte</span>
              <span>Score</span>
              <span>Status</span>
              <span>Duração</span>
              <span>Momento</span>
            </div>
            {rows.map((cut) => (
              <div
                key={cut.id}
                style={{
                  display: "grid",
                  gridTemplateColumns: "2.4fr .8fr 1.2fr 1fr 1.2fr",
                  gap: 12,
                  padding: "13px 18px",
                  alignItems: "center",
                  borderBottom: `1px solid ${theme.borderHairline2}`,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <video
                    src={cut.url}
                    playsInline
                    muted
                    preload="metadata"
                    style={{ width: 34, height: 58, borderRadius: 6, objectFit: "cover", background: "#000", flexShrink: 0 }}
                  />
                  <span style={{ font: `500 14px ${font.display}` }}>{cut.title}</span>
                </div>
                <span style={{ font: `600 14px ${font.display}`, color: scoreColor(cut.score) }}>{cut.score}</span>
                <span style={{ ...draftStyle(), justifySelf: "start" }}>Rascunho</span>
                <span style={{ fontSize: 13, color: theme.textTertiary }}>{cut.dur}</span>
                <span style={{ fontSize: 13, color: theme.textTertiary }}>{cut.moment}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
