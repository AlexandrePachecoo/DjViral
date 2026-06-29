"use client";

import { theme, font, scoreColor, statusChip } from "./theme";
import { Segmented } from "./Segmented";
import { CUTS, STATUS_BY_ID } from "./data";
import type { Filter, SalvosView } from "./types";

type Props = {
  view: SalvosView;
  onView: (v: SalvosView) => void;
  filter: Filter;
  onFilter: (f: Filter) => void;
  showScore: boolean;
};

const FILTERS: { key: Filter; label: string }[] = [
  { key: "todos", label: "Todos" },
  { key: "postados", label: "Postados" },
  { key: "programados", label: "Programados" },
  { key: "rascunhos", label: "Rascunhos" },
];

const FILTER_KIND: Record<Filter, string | null> = {
  todos: null,
  postados: "post",
  programados: "prog",
  rascunhos: "draft",
};

function platBadge(): React.CSSProperties {
  return {
    width: 24,
    height: 24,
    borderRadius: 6,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    font: `600 9px ${font.display}`,
    background: theme.surfaceMuted,
    color: theme.textSecondary,
    border: `1px solid ${theme.borderStrong}`,
  };
}

function statusStyle(kind: keyof typeof statusChip): React.CSSProperties {
  const c = statusChip[kind];
  return {
    padding: "4px 10px",
    borderRadius: 20,
    fontSize: 11,
    background: c.bg,
    color: c.text,
    border: `1px solid ${c.border}`,
  };
}

export function SavedView({ view, onView, filter, onFilter, showScore }: Props) {
  const kind = FILTER_KIND[filter];
  const rows = CUTS.map((c) => ({ cut: c, info: STATUS_BY_ID[c.id] })).filter(
    ({ info }) => !kind || info.kind === kind
  );

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
          <div
            className="dj-saved-search"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "8px 14px",
              borderRadius: 9,
              background: theme.surface,
              border: `1px solid ${theme.borderStrong}`,
              fontSize: 13,
              color: theme.textMuted,
              width: 220,
            }}
          >
            ⌕ buscar corte
          </div>
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

      {view === "galeria" ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(224px,1fr))", gap: 20 }}>
          {rows.map(({ cut, info }) => (
            <div key={cut.id} style={{ border: `1px solid ${theme.border}`, borderRadius: 14, overflow: "hidden", background: theme.surface }}>
              <div style={{ position: "relative", height: 270, background: cut.thumb }}>
                <div style={{ position: "absolute", top: 13, left: 13, ...statusStyle(info.kind) }}>{info.label}</div>
                {showScore && (
                  <div style={{ position: "absolute", top: 13, right: 14, font: `600 15px ${font.display}`, color: scoreColor(cut.score) }}>
                    {cut.score}
                  </div>
                )}
                <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <div
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: "50%",
                      background: "rgba(255,255,255,.7)",
                      border: `1px solid ${theme.borderStrong}`,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: theme.textSecondary,
                      paddingLeft: 2,
                    }}
                  >
                    ▶
                  </div>
                </div>
              </div>
              <div style={{ padding: 14 }}>
                <div style={{ font: `500 14px ${font.display}`, marginBottom: 10 }}>{cut.title}</div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div style={{ display: "flex", gap: 5 }}>
                    {info.plats.map((p, i) => (
                      <span key={i} style={platBadge()}>{p}</span>
                    ))}
                  </div>
                  <span style={{ color: theme.textFaint, cursor: "pointer" }}>⋯</span>
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
              gridTemplateColumns: "2.4fr .8fr 1.2fr 1.3fr 1fr .7fr",
              gap: 12,
              padding: "13px 18px",
              fontSize: 12,
              color: theme.textMuted,
              borderBottom: `1px solid ${theme.borderHairline}`,
            }}
          >
            <span>Corte</span>
            <span>Score</span>
            <span>Plataformas</span>
            <span>Status</span>
            <span>Data</span>
            <span>Ações</span>
          </div>
          {rows.map(({ cut, info }) => (
            <div
              key={cut.id}
              style={{
                display: "grid",
                gridTemplateColumns: "2.4fr .8fr 1.2fr 1.3fr 1fr .7fr",
                gap: 12,
                padding: "13px 18px",
                alignItems: "center",
                borderBottom: `1px solid ${theme.borderHairline2}`,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ width: 34, height: 58, borderRadius: 6, background: cut.thumb, flexShrink: 0 }} />
                <span style={{ font: `500 14px ${font.display}` }}>{cut.title}</span>
              </div>
              <span style={{ font: `600 14px ${font.display}`, color: scoreColor(cut.score) }}>{cut.score}</span>
              <div style={{ display: "flex", gap: 5 }}>
                {info.plats.map((p, i) => (
                  <span key={i} style={platBadge()}>{p}</span>
                ))}
              </div>
              <span style={{ ...statusStyle(info.kind), justifySelf: "start" }}>{info.label}</span>
              <span style={{ fontSize: 13, color: theme.textTertiary }}>{info.date}</span>
              <span style={{ color: theme.textFaint, cursor: "pointer" }}>✎ ⋯</span>
            </div>
          ))}
        </div>
        </div>
      )}
    </div>
  );
}
