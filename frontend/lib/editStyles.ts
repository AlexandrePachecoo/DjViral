// Estilo de edição ("look") de um projeto: cor, transições, efeitos de
// batida/drop e legendas, aplicados pelo worker sobre cada corte pronto.
// Espelha `backend/app/style.py` (o worker re-saneia tudo o que recebe; este
// saneamento é o da borda da API e o que a UI usa para montar/mostrar estilos).

export type Intensity = "subtle" | "medium" | "intense";
export type Transition = "cut" | "flash" | "dip" | "glitch";
export type ColorGrade = "none" | "vivid" | "cinematic" | "warm" | "cold" | "neon" | "bw";
export type DropFx = "none" | "flash" | "glitch" | "shake";
export type CaptionPosition = "top" | "center" | "bottom";
export type CaptionLook = "outline" | "box" | "plain";
export type CaptionSize = "s" | "m" | "l";

export type CaptionStyle = {
  hook: boolean;
  teaser_text: string;
  handle: string;
  position: CaptionPosition;
  look: CaptionLook;
  size: CaptionSize;
  color: string;
  uppercase: boolean;
};

export type EditStyle = {
  intensity: Intensity | null;
  transition: Transition;
  color: ColorGrade;
  vignette: boolean;
  grain: boolean;
  beat_pulse: number;
  drop_fx: DropFx;
  captions: CaptionStyle;
};

export const TRANSITIONS: Transition[] = ["cut", "flash", "dip", "glitch"];
export const COLOR_GRADES: ColorGrade[] = ["none", "vivid", "cinematic", "warm", "cold", "neon", "bw"];
export const DROP_FX: DropFx[] = ["none", "flash", "glitch", "shake"];
const INTENSITIES: Intensity[] = ["subtle", "medium", "intense"];
const POSITIONS: CaptionPosition[] = ["top", "center", "bottom"];
const LOOKS: CaptionLook[] = ["outline", "box", "plain"];
const SIZES: CaptionSize[] = ["s", "m", "l"];

export const MAX_CAPTION_TEXT = 60;
export const MAX_STYLE_NAME = 30;
export const MAX_STYLE_DESCRIPTION = 1500;
// Teto de estilos personalizados por usuário.
export const MAX_CUSTOM_STYLES = 20;

const pick = <T extends string>(value: unknown, allowed: T[], fallback: T): T =>
  allowed.includes(value as T) ? (value as T) : fallback;

const text = (value: unknown): string =>
  typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, MAX_CAPTION_TEXT) : "";

/** Sanea um estilo vindo de fora. `null` = sem estilo (objeto vazio/inválido). */
export function sanitizeEditStyle(input: unknown): EditStyle | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const src = input as Record<string, unknown>;
  const cap = (src.captions && typeof src.captions === "object" ? src.captions : {}) as Record<
    string,
    unknown
  >;
  const pulse = Number(src.beat_pulse);
  const color = typeof cap.color === "string" && /^#[0-9a-fA-F]{6}$/.test(cap.color)
    ? cap.color.toUpperCase()
    : "#FFFFFF";
  return {
    intensity: INTENSITIES.includes(src.intensity as Intensity) ? (src.intensity as Intensity) : null,
    transition: pick(src.transition, TRANSITIONS, "cut"),
    color: pick(src.color, COLOR_GRADES, "none"),
    vignette: src.vignette === true,
    grain: src.grain === true,
    beat_pulse: Number.isFinite(pulse) ? Math.min(1, Math.max(0, pulse)) : 0,
    drop_fx: pick(src.drop_fx, DROP_FX, "none"),
    captions: {
      hook: cap.hook === true,
      teaser_text: text(cap.teaser_text),
      handle: text(cap.handle),
      position: pick(cap.position, POSITIONS, "top"),
      look: pick(cap.look, LOOKS, "outline"),
      size: pick(cap.size, SIZES, "m"),
      color,
      uppercase: cap.uppercase !== false,
    },
  };
}

const captions = (over: Partial<CaptionStyle> = {}): CaptionStyle => ({
  hook: false,
  teaser_text: "",
  handle: "",
  position: "top",
  look: "outline",
  size: "m",
  color: "#FFFFFF",
  uppercase: true,
  ...over,
});

export type PresetId = "hype" | "aftermovie" | "neon" | "clean";

// Estilos prontos do produto. O texto do teaser é resolvido pela UI no idioma
// do usuário (chave `teaserKey`) na hora de enviar.
export const STYLE_PRESETS: { id: PresetId; teaser: boolean; style: EditStyle }[] = [
  {
    id: "hype",
    teaser: true,
    style: {
      intensity: "intense",
      transition: "flash",
      color: "vivid",
      vignette: false,
      grain: false,
      beat_pulse: 0.7,
      drop_fx: "shake",
      captions: captions({ hook: true, size: "l", color: "#FFE600" }),
    },
  },
  {
    id: "aftermovie",
    teaser: false,
    style: {
      intensity: "subtle",
      transition: "dip",
      color: "cinematic",
      vignette: true,
      grain: true,
      beat_pulse: 0,
      drop_fx: "flash",
      captions: captions({ hook: true, position: "bottom", look: "box", uppercase: false }),
    },
  },
  {
    id: "neon",
    teaser: true,
    style: {
      intensity: "intense",
      transition: "glitch",
      color: "neon",
      vignette: true,
      grain: false,
      beat_pulse: 0.4,
      drop_fx: "glitch",
      captions: captions({ hook: true, color: "#00F0FF" }),
    },
  },
  {
    id: "clean",
    teaser: false,
    style: {
      intensity: "medium",
      transition: "cut",
      color: "vivid",
      vignette: false,
      grain: false,
      beat_pulse: 0,
      drop_fx: "none",
      captions: captions({ hook: true, look: "box", uppercase: false }),
    },
  },
];
