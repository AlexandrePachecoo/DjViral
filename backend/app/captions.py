"""Renderização das legendas do estilo de edição em imagens transparentes.

Cada legenda vira um PNG RGBA do tamanho do clipe (1080×1920), sobreposto pelo
FFmpeg (``overlay`` com ``enable`` no intervalo). Desenhar com Pillow em vez
do ``drawtext`` do FFmpeg evita o escaping frágil de texto vindo do usuário/IA
dentro do filtergraph e dá quebra de linha, contorno e caixa de fundo de graça.
"""
import logging
import os

from .config import settings
from .style import Caption, CaptionStyle

logger = logging.getLogger("djviral.captions")

try:  # sem Pillow as legendas ficam desligadas (o resto do estilo continua)
    from PIL import Image, ImageDraw, ImageFont
except Exception:  # noqa: BLE001
    Image = None

# Fontes tentadas em ordem quando `CAPTION_FONT_PATH` não está definido: uma
# sans pesada lê bem em tela de celular. A imagem Docker instala a DejaVu.
_FONT_CANDIDATES = (
    "/usr/share/fonts/opentype/inter/InterDisplay-Black.otf",
    "/usr/share/fonts/opentype/inter/Inter-Black.otf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
    "/usr/share/fonts/truetype/freefont/FreeSansBold.ttf",
)
# Altura da fonte como fração da LARGURA do quadro.
_SIZES = {"s": 0.058, "m": 0.076, "l": 0.098}
_SMALL_SIZE = 0.040
# Centro vertical de cada posição (fração da altura). Topo/base ficam dentro
# da área segura do TikTok/Reels (a UI do app cobre as bordas).
_POS_Y = {"top": 0.17, "center": 0.50, "bottom": 0.74}
_SMALL_POS_Y = {"top": 0.09, "center": 0.50, "bottom": 0.83}
_MAX_TEXT_WIDTH = 0.86
_MAX_LINES = 3


def available() -> bool:
    return Image is not None and _font_path() is not None


def _font_path() -> str | None:
    candidates = (settings.caption_font_path, *_FONT_CANDIDATES)
    return next((p for p in candidates if p and os.path.exists(p)), None)


def _wrap(draw, text: str, font, max_width: float) -> list[str]:
    """Quebra ``text`` em linhas que cabem em ``max_width`` (px)."""
    lines: list[str] = []
    line = ""
    for word in text.split():
        trial = f"{line} {word}".strip()
        if line and draw.textlength(trial, font=font) > max_width:
            lines.append(line)
            line = word
        else:
            line = trial
    if line:
        lines.append(line)
    return lines


def _hex_rgb(color: str) -> tuple[int, int, int]:
    return tuple(int(color[i : i + 2], 16) for i in (1, 3, 5))  # type: ignore[return-value]


def render(caption: Caption, look: CaptionStyle, out_path: str) -> bool:
    """Desenha ``caption`` num PNG transparente em ``out_path``.

    Devolve ``False`` (sem levantar) quando não dá para desenhar — sem Pillow,
    sem fonte, texto vazio — e o chamador simplesmente pula essa legenda.
    """
    font_path = _font_path()
    if Image is None or font_path is None or not caption.text:
        return False
    w, h = settings.output_width, settings.output_height
    try:
        frac = _SMALL_SIZE if caption.small else _SIZES.get(look.size, _SIZES["m"])
        size = max(12, round(w * frac))
        img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        draw = ImageDraw.Draw(img)
        # Texto longo demais para _MAX_LINES encolhe até caber.
        while True:
            font = ImageFont.truetype(font_path, size)
            lines = _wrap(draw, caption.text, font, w * _MAX_TEXT_WIDTH)
            if len(lines) <= _MAX_LINES or size <= 24:
                break
            size = round(size * 0.88)
        lines = lines[:_MAX_LINES]

        line_h = round(size * 1.18)
        block_h = line_h * len(lines)
        pos_y = (_SMALL_POS_Y if caption.small else _POS_Y)[caption.position]
        top = round(h * pos_y - block_h / 2)
        color = (255, 255, 255) if caption.small else _hex_rgb(look.color)
        widths = [draw.textlength(ln, font=font) for ln in lines]
        style = "plain" if caption.small else look.look

        if style == "box":
            pad_x, pad_y = round(size * 0.45), round(size * 0.28)
            bw = max(widths) + 2 * pad_x
            draw.rounded_rectangle(
                [(w - bw) / 2, top - pad_y, (w + bw) / 2, top + block_h + pad_y],
                radius=round(size * 0.3),
                fill=(0, 0, 0, 190),
            )
        for i, (ln, lw) in enumerate(zip(lines, widths)):
            x, y = (w - lw) / 2, top + i * line_h
            if style == "outline":
                draw.text(
                    (x, y), ln, font=font, fill=color + (255,),
                    stroke_width=max(2, round(size * 0.09)), stroke_fill=(0, 0, 0, 255),
                )
            else:
                if style == "plain":  # sombra dura para ler em fundo claro
                    off = max(2, round(size * 0.06))
                    draw.text((x + off, y + off), ln, font=font, fill=(0, 0, 0, 170))
                draw.text((x, y), ln, font=font, fill=color + (255,))
        img.save(out_path)
        return True
    except Exception:  # noqa: BLE001 - legenda nunca derruba o render
        logger.exception("Falha ao desenhar a legenda %r", caption.text)
        return False
