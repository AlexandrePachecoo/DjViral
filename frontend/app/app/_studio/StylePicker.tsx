"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  EditStyle,
  MAX_STYLE_DESCRIPTION,
  STYLE_PRESETS,
  sanitizeEditStyle,
} from "@/lib/editStyles";
import { font, theme } from "./theme";

// Seletor do estilo de edição (efeitos, transições, legendas) do novo set:
// "sem efeitos", os estilos prontos do produto, os estilos personalizados do
// usuário e um criador que pede à IA um estilo a partir de uma descrição em
// texto. O valor escolhido sobe como o JSON do estilo (ou null).

type CustomStyle = { id: string; name: string; description: string | null; style: unknown };

type Props = {
  selectedKey: string;
  busy: boolean;
  onChange: (key: string, style: EditStyle | null) => void;
};

export function StylePicker({ selectedKey, busy, onChange }: Props) {
  const t = useTranslations("studio.generator.form.look");
  const [custom, setCustom] = useState<CustomStyle[]>([]);
  const [creating, setCreating] = useState(false);
  const [description, setDescription] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/styles");
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && Array.isArray(data.styles)) setCustom(data.styles);
      } catch {
        // sem estilos personalizados: a lista fica só com os prontos
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const presetStyle = (id: string): EditStyle | null => {
    const preset = STYLE_PRESETS.find((p) => p.id === id);
    if (!preset) return null;
    return preset.teaser
      ? {
          ...preset.style,
          captions: { ...preset.style.captions, teaser_text: t("teaserDefault") },
        }
      : preset.style;
  };

  const options: { key: string; title: string; desc: string; style: EditStyle | null; customId?: string }[] = [
    { key: "none", title: t("none.title"), desc: t("none.desc"), style: null },
    ...STYLE_PRESETS.map((p) => ({
      key: `preset:${p.id}`,
      title: t(`presets.${p.id}.title`),
      desc: t(`presets.${p.id}.desc`),
      style: presetStyle(p.id),
    })),
    ...custom.map((c) => {
      const style = sanitizeEditStyle(c.style);
      return {
        key: `custom:${c.id}`,
        title: c.name,
        desc: style ? summarize(style, t) : "",
        style,
        customId: c.id,
      };
    }),
  ];

  async function createFromDescription() {
    if (!description.trim() || working) return;
    setWorking(true);
    setError("");
    try {
      const res = await fetch("/api/styles", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ description }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.style) {
        setError(
          data.code === "style_limit"
            ? t("create.errorLimit")
            : data.code === "ai_unavailable"
              ? t("create.errorAi")
              : t("create.errorGeneric")
        );
        return;
      }
      setCustom((prev) => [data.style, ...prev]);
      onChange(`custom:${data.style.id}`, sanitizeEditStyle(data.style.style));
      setDescription("");
      setCreating(false);
    } catch {
      setError(t("create.errorGeneric"));
    } finally {
      setWorking(false);
    }
  }

  async function remove(id: string) {
    setCustom((prev) => prev.filter((c) => c.id !== id));
    if (selectedKey === `custom:${id}`) onChange("none", null);
    try {
      await fetch(`/api/styles/${id}`, { method: "DELETE" });
    } catch {
      // some da lista de qualquer forma; reaparece no próximo carregamento
    }
  }

  const labelStyle = {
    font: `500 13px ${font.display}`,
    color: theme.textSecondary,
    marginBottom: 8,
  } as const;

  return (
    <div>
      <div style={labelStyle}>{t("label")}</div>
      <div
        className="dj-style-grid"
        role="radiogroup"
        aria-label={t("label")}
        style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}
      >
        {options.map((opt) => {
          const active = selectedKey === opt.key;
          const select = () => !busy && onChange(opt.key, opt.style);
          return (
            <div
              key={opt.key}
              role="radio"
              aria-checked={active}
              tabIndex={busy ? -1 : 0}
              onClick={select}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  select();
                }
              }}
              style={{
                position: "relative",
                padding: "12px 13px",
                borderRadius: 10,
                cursor: busy ? "default" : "pointer",
                opacity: busy ? 0.6 : 1,
                background: active ? theme.accentSoft : theme.surface,
                border: `1px solid ${active ? theme.accentBorder : theme.borderStrong}`,
                boxShadow: active ? `0 0 0 1px ${theme.accentBorder}` : "none",
              }}
            >
              <div
                style={{
                  font: `500 14px ${font.display}`,
                  color: active ? theme.accent : theme.textPrimary,
                  marginBottom: 3,
                  paddingRight: opt.customId ? 22 : 0,
                  overflowWrap: "anywhere",
                }}
              >
                {opt.title}
              </div>
              <div style={{ fontSize: 12, color: theme.textMuted, lineHeight: 1.4 }}>{opt.desc}</div>
              {opt.customId && !busy && (
                <button
                  type="button"
                  aria-label={t("deleteAria", { name: opt.title })}
                  onClick={(e) => {
                    e.stopPropagation();
                    remove(opt.customId!);
                  }}
                  style={{
                    position: "absolute",
                    top: 6,
                    right: 6,
                    width: 24,
                    height: 24,
                    border: "none",
                    borderRadius: 6,
                    background: "transparent",
                    color: theme.textMuted,
                    cursor: "pointer",
                    fontSize: 16,
                    lineHeight: 1,
                  }}
                >
                  ×
                </button>
              )}
            </div>
          );
        })}
      </div>

      {!creating ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => setCreating(true)}
          style={{
            marginTop: 10,
            padding: 0,
            border: "none",
            background: "none",
            color: theme.accent,
            font: `500 13px ${font.body}`,
            cursor: busy ? "default" : "pointer",
          }}
        >
          {t("create.open")}
        </button>
      ) : (
        <div
          style={{
            marginTop: 10,
            padding: 12,
            borderRadius: 10,
            background: theme.surfaceInset,
            border: `1px solid ${theme.border}`,
          }}
        >
          <div style={{ fontSize: 12, color: theme.textTertiary, lineHeight: 1.5, marginBottom: 8 }}>
            {t("create.hint")}
          </div>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value.slice(0, MAX_STYLE_DESCRIPTION))}
            placeholder={t("create.placeholder")}
            rows={3}
            disabled={working}
            style={{
              width: "100%",
              padding: "10px 12px",
              borderRadius: 8,
              border: `1px solid ${theme.borderStrong}`,
              background: theme.surface,
              color: theme.textPrimary,
              font: `400 16px ${font.body}`,
              resize: "vertical",
            }}
          />
          {error && (
            <div role="alert" style={{ fontSize: 12, color: "#dc2626", marginTop: 6 }}>
              {error}
            </div>
          )}
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button
              type="button"
              onClick={createFromDescription}
              disabled={working || !description.trim()}
              style={{
                padding: "8px 14px",
                borderRadius: 8,
                border: "none",
                background: theme.accent,
                color: "#fff",
                font: `500 13px ${font.body}`,
                cursor: working || !description.trim() ? "default" : "pointer",
                opacity: working || !description.trim() ? 0.6 : 1,
              }}
            >
              {working ? t("create.working") : t("create.submit")}
            </button>
            <button
              type="button"
              onClick={() => {
                setCreating(false);
                setError("");
              }}
              disabled={working}
              style={{
                padding: "8px 14px",
                borderRadius: 8,
                border: `1px solid ${theme.borderStrong}`,
                background: theme.surface,
                color: theme.textSecondary,
                font: `500 13px ${font.body}`,
                cursor: "pointer",
              }}
            >
              {t("create.cancel")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// Resumo curto do que um estilo personalizado faz (o card não tem descrição
// própria): transição · cor · efeito do drop · legendas.
function summarize(style: EditStyle, t: ReturnType<typeof useTranslations>): string {
  const parts: string[] = [];
  if (style.transition !== "cut") parts.push(t(`summary.transition.${style.transition}`));
  if (style.color !== "none") parts.push(t(`summary.color.${style.color}`));
  if (style.drop_fx !== "none") parts.push(t(`summary.drop.${style.drop_fx}`));
  if (style.beat_pulse > 0) parts.push(t("summary.beat"));
  if (style.captions.hook || style.captions.teaser_text || style.captions.handle) {
    parts.push(t("summary.captions"));
  }
  return parts.length ? parts.join(" · ") : t("summary.plain");
}
