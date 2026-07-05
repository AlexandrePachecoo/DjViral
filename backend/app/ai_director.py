"""Diretor de cena por IA (visão) — camada opcional sobre a análise local.

Para cada janela candidata, amostra alguns keyframes (reaproveitando
``visual.iter_frames``) e pergunta a um modelo de visão da Claude: qual a energia
do público, quem é o protagonista visual do trecho e em que instantes está o
auge. O resultado (:class:`AIDirection`) alimenta o re-rank dos cortes (hype) e o
corte dinâmico (enquadramento + punch-in nos momentos de auge).

Como o :mod:`analyzer` e o :mod:`visual`, é um módulo puro (sem FastAPI/Supabase)
e **nunca derruba um job**: sem chave, sem o pacote ``anthropic``, sem ``cv2``,
timeout ou JSON inválido → ``direct`` devolve ``None`` e o pipeline segue apenas
na heurística local (áudio + YOLO).
"""
import base64
import json
import logging
import re
from dataclasses import dataclass, field

from . import visual
from .config import settings

logger = logging.getLogger("djviral.ai_director")

try:  # opencv encoda os frames em JPEG; sem ele o diretor fica desligado
    import cv2
except Exception:  # noqa: BLE001 - qualquer falha de import conta como "sem cv2"
    cv2 = None

# Enquadramentos válidos que o modelo pode escolher como protagonista da janela.
VALID_SUBJECTS = {"dj", "crowd", "wide"}
# Largura dos frames enviados ao modelo (menor que a detecção; a IA julga a cena,
# não precisa de resolução alta).
FRAME_WIDTH = 512
# Qualidade JPEG dos frames enviados (equilíbrio tamanho/nitidez).
JPEG_QUALITY = 80


@dataclass
class AIDirection:
    """Direção de cena de uma janela, vinda do modelo de visão.

    - ``hype_score``: energia/vibe do público (0-1), somada ao score do corte.
    - ``subject``: protagonista visual do trecho (``dj`` | ``crowd`` | ``wide``);
      enviesa a alternância de enquadramento do corte dinâmico.
    - ``moments``: instantes de auge (s relativos ao início da janela), viram
      fronteiras extras de punch-in no shot plan.
    - ``worthy``: se a cena tem energia suficiente para justificar zooms (senão
      reforça a decisão de corte seco).
    """

    hype_score: float = 0.0
    subject: str = "wide"
    moments: list[float] = field(default_factory=list)
    worthy: bool = True


_PROMPT = (
    "Estas imagens são keyframes de uma janela de ~{duration:.0f}s de um SET DE DJ "
    "(balada/festival), em ordem cronológica; cada frame vem rotulado com seu "
    "instante t em segundos relativos ao INÍCIO da janela.\n\n"
    "Avalie pensando em CORTE VIRAL para TikTok/Reels e responda APENAS com um "
    "objeto JSON (sem texto ao redor, sem markdown), com exatamente estas chaves:\n"
    '- "hype": número de 0.0 a 1.0 = energia/vibe do PÚBLICO (mãos pra cima, '
    "pulos, aglomeração, delírio, luzes/pyro = alto; pista vazia ou parada = "
    "baixo).\n"
    '- "subject": "dj" (cabine/artista em destaque), "crowd" (o público é o show) '
    'ou "wide" (plano aberto sem foco claro).\n'
    '- "moments": lista de até 3 instantes (segundos, entre 0 e {duration:.0f}) de '
    "maior auge visual — o drop das mãos, o jato de CO2, a explosão; lista vazia se "
    "não houver pico claro.\n"
    '- "worthy": true se a cena tem movimento/energia que justifique zooms '
    "dinâmicos; false se é estática/vazia demais (corte seco é melhor).\n"
    'Exemplo: {{"hype": 0.8, "subject": "crowd", "moments": [12.5], "worthy": true}}'
    "{hint}"
)


_client = None
_client_failed = False


def _get_client():
    """Cliente Anthropic com cache por processo. ``None`` desliga o diretor.

    ``None`` (sem chave, sem o pacote, ou falha de init) é o gatilho do fallback:
    o pipeline ignora a IA e usa só o score local. Nunca levanta exceção.
    """
    global _client, _client_failed
    if _client is not None:
        return _client
    if _client_failed:
        return None
    if not settings.anthropic_api_key:
        _client_failed = True
        return None
    if cv2 is None:
        logger.warning("cv2 indisponível — diretor de IA desligado")
        _client_failed = True
        return None
    try:
        import anthropic
    except Exception:  # noqa: BLE001 - sem o pacote → diretor desligado
        logger.warning("pacote 'anthropic' indisponível — diretor de IA desligado")
        _client_failed = True
        return None
    try:
        _client = anthropic.Anthropic(
            api_key=settings.anthropic_api_key,
            timeout=settings.ai_director_timeout,
        )
    except Exception:  # noqa: BLE001 - init do cliente nunca é fatal
        logger.exception("Falha ao criar o cliente Anthropic")
        _client_failed = True
        return None
    return _client


def _sample_frames(
    video_path: str, start_sec: float, duration: float, n: int
) -> list[tuple[float, str]]:
    """Amostra ``n`` keyframes espalhados na janela → ``[(t_rel, jpeg_b64)]``.

    Reaproveita ``visual.iter_frames`` (pipe FFmpeg, sem a janela inteira em RAM),
    lendo só até o último alvo (~90% da janela) e parando. Cada alvo é a fração
    (i+0.5)/n da duração, evitando as bordas.
    """
    if cv2 is None:
        return []
    n = max(1, n)
    targets = [duration * (i + 0.5) / n for i in range(n)]
    frames: list[tuple[float, str]] = []
    ti = 0
    try:
        for t, frame in visual.iter_frames(
            video_path, start_sec, duration, fps=2.0, width=FRAME_WIDTH
        ):
            if ti >= len(targets):
                break
            if t + 1e-6 >= targets[ti]:
                ok, buf = cv2.imencode(
                    ".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, JPEG_QUALITY]
                )
                if ok:
                    b64 = base64.b64encode(buf.tobytes()).decode("ascii")
                    frames.append((round(float(t), 2), b64))
                ti += 1
    except Exception:  # noqa: BLE001 - amostragem nunca derruba o job (ex.: ffmpeg)
        logger.exception("Falha ao amostrar keyframes (%.1fs)", start_sec)
        return []
    return frames


def _hint(wv) -> str:
    """Dica curta ancorada na detecção local (YOLO), quando disponível."""
    if wv is None or not getattr(wv, "detected", False):
        return ""
    parts = []
    if wv.dj_box is not None:
        parts.append("um artista/DJ em destaque foi detectado")
    if wv.crowd_box is not None:
        parts.append("há um cluster de público na cena")
    if not parts:
        return ""
    return "\nContexto da detecção local: " + "; ".join(parts) + "."


def _parse_json(text: str) -> dict | None:
    """Extrai o objeto JSON da resposta do modelo (tolerante a cercas/ruído)."""
    if not text:
        return None
    try:
        return json.loads(text)
    except (ValueError, TypeError):
        pass
    # Tenta o primeiro bloco {...} balanceado no texto (ex.: veio com ```json).
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if match:
        try:
            return json.loads(match.group(0))
        except (ValueError, TypeError):
            return None
    return None


def _coerce(out: dict, duration: float) -> AIDirection:
    """Sanea a saída do modelo → :class:`AIDirection` (clamp/normaliza/filtra)."""
    try:
        hype = float(out.get("hype", 0.0))
    except (TypeError, ValueError):
        hype = 0.0
    if hype != hype:  # NaN
        hype = 0.0
    hype = min(1.0, max(0.0, hype))

    subject = str(out.get("subject", "wide") or "wide").strip().lower()
    if subject not in VALID_SUBJECTS:
        subject = "wide"

    moments: list[float] = []
    for m in out.get("moments") or []:
        try:
            mv = float(m)
        except (TypeError, ValueError):
            continue
        if mv == mv and 0.0 <= mv <= duration:
            moments.append(round(mv, 3))
    # Ordena e remove quase-duplicados (dentro de 0.5s um do outro).
    moments.sort()
    deduped: list[float] = []
    for mv in moments:
        if not deduped or mv - deduped[-1] > 0.5:
            deduped.append(mv)

    return AIDirection(
        hype_score=hype,
        subject=subject,
        moments=deduped[:3],
        worthy=bool(out.get("worthy", True)),
    )


def direct(
    video_path: str, start_sec: float, duration: float, wv=None
) -> AIDirection | None:
    """Direção de cena de uma janela via modelo de visão. ``None`` = sem IA.

    ``wv`` é o :class:`app.visual.WindowVisual` já calculado (opcional), usado só
    para dar contexto ao prompt. Qualquer falha (sem cliente, sem frames,
    timeout, resposta inválida) devolve ``None`` — o chamador cai na heurística.
    """
    client = _get_client()
    if client is None:
        return None

    frames = _sample_frames(video_path, start_sec, duration, settings.ai_director_frames)
    if not frames:
        return None

    content: list[dict] = []
    for t, b64 in frames:
        content.append({"type": "text", "text": f"Frame em t={t:.1f}s:"})
        content.append(
            {
                "type": "image",
                "source": {"type": "base64", "media_type": "image/jpeg", "data": b64},
            }
        )
    content.append(
        {
            "type": "text",
            "text": _PROMPT.format(duration=duration, hint=_hint(wv)),
        }
    )

    try:
        resp = client.messages.create(
            model=settings.ai_director_model,
            max_tokens=512,
            messages=[{"role": "user", "content": content}],
        )
        text = "".join(
            block.text for block in resp.content if getattr(block, "type", None) == "text"
        )
    except Exception:  # noqa: BLE001 - a IA nunca é fatal para o job
        logger.exception("Diretor de IA falhou na janela %.1fs", start_sec)
        return None

    out = _parse_json(text)
    if out is None:
        logger.warning("Diretor de IA: resposta sem JSON válido (janela %.1fs)", start_sec)
        return None
    return _coerce(out, duration)
