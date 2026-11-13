"""Estilo de edição ("look") aplicado sobre um corte já renderizado.

O corte (seco, dinâmico ou com keyframes manuais) resolve ONDE a câmera olha;
o estilo resolve a FINALIZAÇÃO: cor, transições entre shots, efeitos na batida
e no drop, e legendas queimadas no vídeo. É um documento JSON pequeno
(:class:`EditStyle`) que pode vir de três lugares — um preset do produto, um
estilo que o usuário montou à mão, ou um estilo que a IA escreveu a partir de
uma descrição em texto (``ai_director.style_from_description``) — e é
persistido em ``projects.edit_style``.

Módulo puro (sem FastAPI/Supabase/FFmpeg): só o schema, o saneamento e a
montagem do filtergraph. Quem roda o FFmpeg é ``clipper.apply_style``.

Tudo aqui é desenhado para ser aplicado num SEGUNDO passe sobre o clipe 9:16
pronto, com filtros que NÃO mudam a duração nem o áudio (as transições são
pulsos de brilho/RGB em cima dos cortes que já existem, não sobreposições que
encurtariam a timeline) — por isso vale para qualquer caminho de render e, se
falhar, o clipe sem estilo continua válido.
"""
import re
from dataclasses import dataclass, field
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

Transition = Literal["cut", "flash", "dip", "glitch"]
ColorGrade = Literal["none", "vivid", "cinematic", "warm", "cold", "neon", "bw"]
DropFx = Literal["none", "flash", "glitch", "shake"]
CaptionPosition = Literal["top", "center", "bottom"]
CaptionLook = Literal["outline", "box", "plain"]
CaptionSize = Literal["s", "m", "l"]
Intensity = Literal["subtle", "medium", "intense"]

_HEX_RE = re.compile(r"^#[0-9a-fA-F]{6}$")
MAX_CAPTION_TEXT = 60


class CaptionStyle(BaseModel):
    """Legendas queimadas no vídeo."""

    model_config = ConfigDict(extra="ignore")

    # Mostra o título/gancho do corte nos primeiros segundos.
    hook: bool = False
    # Texto curto exibido logo ANTES do drop ("espera o drop"); vazio = sem.
    teaser_text: str = ""
    # Marca fixa durante o clipe inteiro (ex.: "@djfulano"); vazio = sem.
    handle: str = ""
    position: CaptionPosition = "top"
    look: CaptionLook = "outline"
    size: CaptionSize = "m"
    color: str = "#FFFFFF"
    uppercase: bool = True

    @field_validator("teaser_text", "handle", mode="before")
    @classmethod
    def _clean_text(cls, v):
        if not isinstance(v, str):
            return ""
        return " ".join(v.split())[:MAX_CAPTION_TEXT]

    @field_validator("color", mode="before")
    @classmethod
    def _clean_color(cls, v):
        return v.upper() if isinstance(v, str) and _HEX_RE.match(v) else "#FFFFFF"


class EditStyle(BaseModel):
    """Estilo de edição de um projeto. Todo campo tem default "desligado"."""

    model_config = ConfigDict(extra="ignore")

    # Intensidade da câmera do corte dinâmico; None = usa a do projeto.
    intensity: Intensity | None = None
    # Efeito em cada troca de shot do corte dinâmico.
    transition: Transition = "cut"
    color: ColorGrade = "none"
    vignette: bool = False
    grain: bool = False
    # Pulso de brilho em cada batida (0 = desligado, 1 = forte).
    beat_pulse: float = Field(default=0.0)
    # Efeito no instante do drop.
    drop_fx: DropFx = "none"
    captions: CaptionStyle = Field(default_factory=CaptionStyle)

    @field_validator("beat_pulse", mode="before")
    @classmethod
    def _clamp_pulse(cls, v):
        try:
            v = float(v)
        except (TypeError, ValueError):
            return 0.0
        return min(1.0, max(0.0, v)) if v == v else 0.0

    def is_noop(self) -> bool:
        """True quando o estilo não muda nada no vídeo (dispensa o 2º passe)."""
        c = self.captions
        return (
            self.transition == "cut"
            and self.color == "none"
            and not self.vignette
            and not self.grain
            and self.beat_pulse <= 0
            and self.drop_fx == "none"
            and not c.hook
            and not c.teaser_text
            and not c.handle
        )


def coerce_style(value) -> EditStyle | None:
    """Sanea um estilo vindo de fora (banco, request, IA) → :class:`EditStyle`.

    ``None``/vazio/inválido → ``None`` (sem estilo). Campos desconhecidos são
    ignorados; um campo com valor fora do contrato invalida SÓ aquele campo
    (volta ao default) em vez de descartar o estilo inteiro — um estilo salvo
    por uma versão mais nova do frontend continua funcionando no que der.
    """
    if not isinstance(value, dict) or not value:
        return None
    data = dict(value)
    captions = data.get("captions")
    data["captions"] = _keep_valid(CaptionStyle, captions if isinstance(captions, dict) else {})
    return EditStyle(**_keep_valid(EditStyle, data))


def _keep_valid(model: type[BaseModel], data: dict) -> dict:
    """Devolve só as chaves de ``data`` que validam sozinhas em ``model``."""
    out: dict = {}
    for key, val in data.items():
        if key not in model.model_fields:
            continue
        try:
            model(**{key: val})
        except Exception:  # noqa: BLE001 - campo inválido → default
            continue
        out[key] = val
    return out


# ---------------------------------------------------------------------------
# Filtergraph
# ---------------------------------------------------------------------------

# Filtros de cor por grade (aplicados em sequência, na ordem da lista).
_GRADES: dict[str, list[str]] = {
    "vivid": ["eq=contrast=1.12:saturation=1.35"],
    "cinematic": [
        "eq=contrast=1.10:saturation=0.90:gamma=0.96",
        "colorbalance=rs=-0.06:bs=0.07:rh=0.06:bh=-0.05",
    ],
    "warm": ["eq=saturation=1.12", "colorbalance=rm=0.07:bm=-0.06:rh=0.04"],
    "cold": ["eq=saturation=1.05", "colorbalance=bm=0.08:rm=-0.05:bh=0.04"],
    "neon": [
        "eq=contrast=1.18:saturation=1.55",
        "colorbalance=rs=0.05:bs=0.10:gm=-0.04",
    ],
    "bw": ["hue=s=0", "eq=contrast=1.20"],
}

# Meia-largura (s) dos pulsos de brilho.
_FLASH_HALF = 0.10
_DIP_HALF = 0.14
_GLITCH_SPAN = 0.14
_SHAKE_SPAN = 0.7
# Duração (s) do decaimento do pulso de batida.
_BEAT_DECAY = 0.16


@dataclass
class StyleContext:
    """O que o estilo precisa saber sobre UM clipe para virar filtros.

    Tempos em segundos relativos ao início do clipe. ``cuts`` são as trocas de
    shot (vazio no corte seco); ``drop`` é o instante do pico; ``beat_period``/
    ``beat_phase`` descrevem a grade de batidas (período 0 = desconhecida).
    """

    duration: float
    cuts: list[float] = field(default_factory=list)
    drop: float | None = None
    beat_period: float = 0.0
    beat_phase: float = 0.0


def _tri(t0: float, half: float) -> str:
    """Pulso triangular 0→1→0 centrado em ``t0`` (expressão FFmpeg em ``t``)."""
    return f"max(0,1-abs(t-{t0:.3f})/{half:.3f})"


def _window(times: list[float], before: float, after: float) -> str:
    """Expressão ``enable``: verdadeira perto de qualquer instante de ``times``."""
    return "+".join(
        f"between(t,{max(0.0, t - before):.3f},{t + after:.3f})" for t in times
    )


def build_video_filters(style: EditStyle, ctx: StyleContext) -> list[str]:
    """Cadeia de filtros de vídeo (cor + efeitos temporais) do estilo.

    Lista vazia = nada a aplicar. Não inclui as legendas (são overlays de
    imagem, montados em ``clipper.apply_style``). Nenhum filtro muda a duração
    ou o tamanho do quadro.
    """
    filters: list[str] = list(_GRADES.get(style.color, []))
    cuts = [t for t in ctx.cuts if 0.05 < t < ctx.duration - 0.05]
    drop = ctx.drop if ctx.drop is not None and 0 <= ctx.drop < ctx.duration else None

    # ---- brilho ao longo do tempo: transição flash/dip + batida + drop ----
    terms: list[str] = []
    if style.transition == "flash":
        terms += [f"0.55*{_tri(t, _FLASH_HALF)}" for t in cuts]
    elif style.transition == "dip":
        terms += [f"-0.85*{_tri(t, _DIP_HALF)}" for t in cuts]
    if style.beat_pulse > 0 and ctx.beat_period > 0.2:
        amp = 0.16 * style.beat_pulse
        # Grade periódica: uma expressão só, em vez de um termo por batida.
        # O +período antes do mod mantém o argumento positivo antes da fase.
        terms.append(
            f"{amp:.3f}*max(0,1-mod(t-{ctx.beat_phase:.3f}+{ctx.beat_period * 64:.3f},"
            f"{ctx.beat_period:.4f})/{_BEAT_DECAY:.3f})"
        )
    if style.drop_fx == "flash" and drop is not None:
        terms.append(f"0.75*max(0,1-abs(t-{drop:.3f})/0.22)")
    if terms:
        expr = "+".join(terms).replace("+-", "-")
        filters.append(f"eq=brightness='{expr}':eval=frame")

    # ---- separação RGB (glitch) nos cortes e/ou no drop ----
    glitch_times: list[float] = list(cuts) if style.transition == "glitch" else []
    if style.drop_fx == "glitch" and drop is not None:
        glitch_times.append(drop)
    if glitch_times:
        enable = _window(sorted(glitch_times), 0.03, _GLITCH_SPAN)
        filters.append(f"rgbashift=rh=-14:bh=14:gv=6:enable='{enable}'")

    # ---- tremor de câmera no drop ----
    if style.drop_fx == "shake" and drop is not None:
        env = f"max(0,1-abs(t-{drop + _SHAKE_SPAN / 2:.3f})/{_SHAKE_SPAN / 2:.3f})"
        filters.append(
            "crop=iw-48:ih-84"
            f":x='24+22*sin(t*83)*{env}':y='42+38*sin(t*67+1)*{env}'"
        )
        filters.append("scale=iw+48:ih+84")

    if style.vignette:
        filters.append("vignette=PI/4.5")
    if style.grain:
        filters.append("noise=alls=11:allf=t")
    return filters


@dataclass
class Caption:
    """Uma legenda a queimar: texto, intervalo e a posição vertical."""

    text: str
    t0: float
    t1: float
    position: CaptionPosition
    # Legenda "pequena" (handle/marca): fonte menor e mais discreta.
    small: bool = False


# Emojis e símbolos fora do que uma fonte de texto comum desenha — removidos
# do texto queimado (o título no banco continua com eles).
_NON_TEXT_RE = re.compile(
    "[\U0001F000-\U0001FAFF\U00002600-\U000027BF\U0001F1E6-\U0001F1FF"
    "\U00002190-\U000021FF\U00002B00-\U00002BFF️‍]"
)


def clean_caption_text(text: str, uppercase: bool) -> str:
    text = " ".join(_NON_TEXT_RE.sub("", text or "").split())[:MAX_CAPTION_TEXT]
    return text.upper() if uppercase else text


def build_captions(style: EditStyle, ctx: StyleContext, title: str | None) -> list[Caption]:
    """Legendas do clipe segundo o estilo.

    - **hook**: o título do corte nos primeiros segundos (só quando há um
      título de verdade — ``title=None`` pula).
    - **teaser**: texto curto nos segundos que antecedem o drop, no centro
      (ou no topo quando o hook já ocupa o centro).
    - **handle**: marca pequena durante o clipe todo, na base (ou no topo
      quando as legendas principais ficam embaixo).
    """
    c = style.captions
    out: list[Caption] = []
    drop = ctx.drop if ctx.drop is not None and 0 < ctx.drop < ctx.duration else None

    hook_end = 0.0
    if c.hook and title:
        text = clean_caption_text(title, c.uppercase)
        if text:
            hook_end = min(3.5, ctx.duration)
            out.append(Caption(text, 0.0, hook_end, c.position))

    if c.teaser_text and drop is not None and drop >= 1.5:
        text = clean_caption_text(c.teaser_text, c.uppercase)
        if text:
            t0 = max(0.0, drop - 3.0)
            pos: CaptionPosition = "center" if c.position != "center" else "top"
            # Não sobrepõe o hook quando os dois cairiam no mesmo lugar/tempo.
            if pos == c.position and t0 < hook_end:
                t0 = hook_end
            if drop - t0 >= 0.8:
                out.append(Caption(text, t0, drop, pos))

    if c.handle:
        text = clean_caption_text(c.handle, False)
        if text:
            pos = "bottom" if c.position != "bottom" else "top"
            out.append(Caption(text, 0.0, ctx.duration, pos, small=True))
    return out
