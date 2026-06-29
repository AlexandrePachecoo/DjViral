// Design tokens for the DJviral studio (post-login area).
// Canonical look = light / minimalist (see design handoff README).
// Single violet accent; dark variant is a reference only.

export const theme = {
  bg: "#fafafa",
  surface: "#ffffff",
  surfaceInset: "#fafafa",
  surfaceMuted: "#f4f4f5",
  surfaceMuted2: "#f1f1f3",
  border: "#ececec",
  borderStrong: "#e4e4e7",
  borderHairline: "#f0f0f0",
  borderHairline2: "#f4f4f5",
  textPrimary: "#18181b",
  textSecondary: "#52525b",
  textSecondary2: "#3f3f46",
  textTertiary: "#71717a",
  textMuted: "#a1a1aa",
  textFaint: "#c4c4c8",
  textFaint2: "#d4d4d8",
  accent: "#7c3aed",
  accentSoft: "rgba(124,58,237,.09)",
  accentBorder: "rgba(124,58,237,.28)",
  accentTint08: "rgba(124,58,237,.08)",
  accentLight: "#a78bfa",
  previewVideo: "linear-gradient(160deg,#1f1f23,#161618)",
} as const;

export const font = {
  display: "'Space Grotesk', system-ui, sans-serif",
  body: "'Sora', system-ui, sans-serif",
  wordmark: "'Outfit', system-ui, sans-serif",
} as const;

export const statusChip = {
  post: {
    bg: "#ecfdf5",
    text: "#059669",
    border: "#a7f3d0",
  },
  prog: {
    bg: "#eff6ff",
    text: "#2563eb",
    border: "#bfdbfe",
  },
  draft: {
    bg: "#f4f4f5",
    text: "#71717a",
    border: "#e4e4e7",
  },
} as const;

// Score >= 85 reads as "alto" and uses the accent color.
export function scoreColor(score: number): string {
  return score >= 85 ? theme.accent : theme.textSecondary;
}

// ----- Reusable button styles -----
export const btnPrimary: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 7,
  padding: "9px 16px",
  borderRadius: 9,
  cursor: "pointer",
  font: `500 13px ${font.body}`,
  color: "#fff",
  background: theme.accent,
  border: "none",
  whiteSpace: "nowrap",
};

export const btnGhost: React.CSSProperties = {
  padding: "9px 16px",
  borderRadius: 9,
  cursor: "pointer",
  font: `500 13px ${font.body}`,
  color: theme.textSecondary,
  background: theme.surface,
  border: `1px solid ${theme.borderStrong}`,
  whiteSpace: "nowrap",
};
