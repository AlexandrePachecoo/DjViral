import { theme, font } from "./theme";

type Option<T extends string> = { key: T; label: string };

export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: Option<T>[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        gap: 3,
        padding: 3,
        borderRadius: 10,
        background: theme.surfaceMuted2,
      }}
    >
      {options.map((o) => {
        const active = o.key === value;
        return (
          <div
            key={o.key}
            onClick={() => onChange(o.key)}
            style={{
              padding: "7px 15px",
              borderRadius: 7,
              cursor: "pointer",
              font: `500 13px ${font.body}`,
              transition: "all .2s",
              color: active ? theme.textPrimary : theme.textTertiary,
              background: active ? theme.surface : "transparent",
              boxShadow: active ? "0 1px 2px rgba(0,0,0,.07)" : "none",
            }}
          >
            {o.label}
          </div>
        );
      })}
    </div>
  );
}
