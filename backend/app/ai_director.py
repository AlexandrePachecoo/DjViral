"""Diretor de cena por IA (visão) — camada opcional sobre a análise local.

Dois estágios, orquestrados pelo `pipeline._score_candidates`:

1. :func:`triage_group` — TRIAGEM barata (1-2 keyframes pequenos por janela,
   várias janelas por chamada): cobre TODOS os candidatos, não só um top-K
   pré-filtrado pelo score local. Devolve só ``hype``/``worthy`` por janela
   (:class:`Triage`), suficiente para reordenar os candidatos ANTES de
   truncar para a direção profunda.
2. :func:`direct` — DIREÇÃO PROFUNDA (mais keyframes, resolução maior): roda
   só nas melhores janelas pelo score já ajustado pela triagem, e devolve o
   enquadramento completo (:class:`AIDirection` — boxes, roteiro de câmera,
   momentos de auge) que alimenta o corte dinâmico.

Como o :mod:`analyzer` e o :mod:`visual`, é um módulo puro (sem FastAPI/Supabase)
e **nunca derruba um job**: sem chave, sem o pacote ``anthropic``, sem ``cv2``,
timeout ou JSON inválido → cada função devolve o "vazio" (``None``/``{}``) e o
pipeline segue apenas na heurística local (áudio + YOLO).
"""
import base64
import json
import logging
import math
import re
from dataclasses import dataclass, field

from . import visual
from .config import settings
from .visual import Box

logger = logging.getLogger("djviral.ai_director")

try:  # opencv encoda os frames em JPEG; sem ele o diretor fica desligado
    import cv2
except Exception:  # noqa: BLE001 - qualquer falha de import conta como "sem cv2"
    cv2 = None

# Enquadramentos válidos que o modelo pode escolher como protagonista da janela.
VALID_SUBJECTS = {"dj", "crowd", "wide"}
# Alvos válidos de um passo da story (roteiro de câmera): os subjects mais o
# "dancer" (pessoa do público dançando em destaque, quando o modelo a viu).
STORY_SUBJECTS = VALID_SUBJECTS | {"dancer"}
# Máximo de passos aproveitados da story.
MAX_STORY_STEPS = 6
# Lado mínimo (fração do frame) de um box de enquadramento vindo do modelo;
# menor que isso é degenerado (ponto/linha) e não serve para enquadrar.
MIN_BOX_SIDE = 0.02
# Confiança atribuída aos boxes da IA (estimativa de cena, não detecção por
# frame como o YOLO). Só informativa: o crop não usa a confiança.
AI_BOX_CONF = 0.5
# Qualidade JPEG dos frames enviados (equilíbrio tamanho/nitidez).
JPEG_QUALITY = 80

# Preço por milhão de tokens (entrada, saída) em USD, só para o log de custo
# estimado por job — nenhuma cobrança real depende disso. Modelo fora da
# tabela cai no preço do Sonnet (estimativa conservadora, não subestima).
_PRICING_USD_PER_MTOK: dict[str, tuple[float, float]] = {
    "claude-haiku-4-5": (1.0, 5.0),
    "claude-sonnet-5": (3.0, 15.0),
    "claude-opus-4-8": (5.0, 25.0),
}
_DEFAULT_PRICE = (3.0, 15.0)

# Acumulador de custo/chamadas da IA no job corrente (resetado pelo pipeline
# no início de cada `_score_candidates`). Só para observabilidade nos logs.
_usage = {"usd": 0.0, "calls": 0}


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
    - ``story``: roteiro de câmera — lista ordenada de ``(t, subject)`` dizendo
      para onde a câmera olha a partir de cada instante (``subject`` em
      :data:`STORY_SUBJECTS`); comanda a sequência de shots do corte dinâmico
      no lugar da rotação heurística. Vazia = sem roteiro (alternância local).
    - ``dj_box`` / ``crowd_box`` / ``dancer_box``: enquadramento do DJ, do
      público e da pessoa dançando em destaque vistos pelo modelo
      (:class:`app.visual.Box`, coordenadas normalizadas 0-1). Usados pelo
      shot plan quando o YOLO não achou ninguém (balada escura, laser,
      contraluz) — a IA "vê" a cena semanticamente onde a detecção falha.
      ``None`` = o modelo não localizou (ou não devolveu um box válido).
    """

    hype_score: float = 0.0
    subject: str = "wide"
    moments: list[float] = field(default_factory=list)
    worthy: bool = True
    story: list[tuple[float, str]] = field(default_factory=list)
    dj_box: Box | None = None
    crowd_box: Box | None = None
    dancer_box: Box | None = None


@dataclass
class Triage:
    """Avaliação RÁPIDA de uma janela (estágio 1, barato, cobre TODAS elas).

    Bem mais simples que :class:`AIDirection` (sem boxes/story) — o objetivo
    é só decidir se vale investir a direção profunda (estágio 2) nessa janela,
    não já dirigir o corte. ``hype``/``worthy`` têm o mesmo significado dos
    campos homônimos de ``AIDirection``.
    """

    hype: float = 0.0
    worthy: bool = True


_TRIAGE_PROMPT = (
    "Estas imagens são keyframes de {n} janelas DIFERENTES de um SET DE DJ "
    "(balada/festival). Cada frame vem rotulado \"Janela {{id}}, t={{t}}s\" "
    "(t relativo ao início DAQUELA janela).\n\n"
    "Para CADA janela, avalie rapidamente o potencial de corte viral (TikTok/"
    "Reels) e responda APENAS com um ARRAY JSON (sem texto ao redor, sem "
    "markdown), um objeto por janela, com exatamente estas chaves:\n"
    '- "window": o id da janela (inteiro, use o mesmo número do rótulo).\n'
    '- "hype": número de 0.0 a 1.0 = energia/vibe do PÚBLICO (mãos pra cima, '
    "pulos, aglomeração, delírio = alto; pista vazia ou parada = baixo).\n"
    '- "worthy": true se a cena tem movimento/energia que justifique virar '
    "corte; false se é estática/vazia demais.\n"
    "Responda para TODAS as janelas listadas, uma entrada cada.\n"
    'Exemplo: [{{"window": 0, "hype": 0.8, "worthy": true}}, '
    '{{"window": 1, "hype": 0.15, "worthy": false}}]'
)


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
    '- "dj_box": onde o DJ/artista está no quadro, como [cx, cy, w, h] em '
    "frações 0.0-1.0 do frame (centro x, centro y, largura, altura do retângulo "
    "que o enquadra com a cabine); use a posição típica ao longo dos frames, e "
    "null se não estiver visível.\n"
    '- "crowd_box": idem para a massa do público (o retângulo que cobre a '
    "aglomeração), ou null se não houver público visível.\n"
    '- "dancer_box": idem para UMA pessoa do público dançando em destaque (a '
    "que mais renderia um zoom), ou null se ninguém se destacar.\n"
    '- "story": roteiro de câmera para o corte dinâmico — lista ordenada de '
    'até 6 passos {{"t": segundos, "subject": "dj"|"crowd"|"dancer"|"wide"}} '
    "dizendo para onde a câmera olha a partir do instante t. Monte uma "
    "narrativa com intenção: abrir a cena, focar o artista no auge, mostrar "
    'quem está dançando, voltar ao DJ. Use "dancer" só se dancer_box existir; '
    "lista vazia se preferir a alternância automática.\n"
    'Exemplo: {{"hype": 0.8, "subject": "crowd", "moments": [12.5], '
    '"worthy": true, "dj_box": [0.5, 0.35, 0.22, 0.4], "crowd_box": '
    '[0.5, 0.78, 0.85, 0.4], "dancer_box": [0.3, 0.7, 0.1, 0.25], '
    '"story": [{{"t": 0, "subject": "wide"}}, {{"t": 5, "subject": "dj"}}, '
    '{{"t": 14, "subject": "dancer"}}, {{"t": 22, "subject": "dj"}}]}}'
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
    video_path: str, start_sec: float, duration: float, n: int, width: int | None = None
) -> list[tuple[float, str]]:
    """Amostra ``n`` keyframes espalhados na janela → ``[(t_rel, jpeg_b64)]``.

    Reaproveita ``visual.iter_frames`` (pipe FFmpeg, sem a janela inteira em RAM),
    lendo só até o último alvo (~90% da janela) e parando. Cada alvo é a fração
    (i+0.5)/n da duração, evitando as bordas. ``width`` (px) escala o custo de
    tokens da chamada — a triagem usa frames bem menores que a direção profunda.
    """
    if cv2 is None:
        return []
    n = max(1, n)
    frame_width = width or settings.ai_director_frame_width
    targets = [duration * (i + 0.5) / n for i in range(n)]
    frames: list[tuple[float, str]] = []
    ti = 0
    try:
        for t, frame in visual.iter_frames(
            video_path, start_sec, duration, fps=2.0, width=frame_width
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
    low_light = " Cena de baixa luz — a detecção local tem confiança reduzida." if getattr(
        wv, "low_light", False
    ) else ""
    parts = []
    if wv.dj_box is not None:
        parts.append("um artista/DJ em destaque foi detectado")
    if wv.crowd_box is not None:
        parts.append("há um cluster de público na cena")
    if not parts:
        # YOLO rodou e não achou ninguém (cena escura/laser/contraluz): o
        # enquadramento do corte vai depender só dos boxes da IA.
        return (
            "\nContexto: a detecção local de pessoas não localizou ninguém "
            "(cena escura?); capriche em dj_box/crowd_box se conseguir vê-los."
            + low_light
        )
    return "\nContexto da detecção local: " + "; ".join(parts) + "." + low_light


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


def _parse_json_array(text: str) -> list | None:
    """Extrai o array JSON da resposta da triagem (tolerante a cercas/ruído)."""
    if not text:
        return None
    try:
        val = json.loads(text)
        if isinstance(val, list):
            return val
    except (ValueError, TypeError):
        pass
    match = re.search(r"\[.*\]", text, re.DOTALL)
    if match:
        try:
            val = json.loads(match.group(0))
            if isinstance(val, list):
                return val
        except (ValueError, TypeError):
            return None
    return None


def reset_usage() -> None:
    """Zera o acumulador de custo/chamadas — chamado pelo pipeline a cada job."""
    _usage["usd"] = 0.0
    _usage["calls"] = 0


def get_usage() -> dict:
    """Custo estimado (USD) e nº de chamadas à IA acumulados desde o último reset."""
    return dict(_usage)


def _track_usage(model: str, resp) -> None:
    """Acumula o custo estimado de uma resposta bem-sucedida da API."""
    usage = getattr(resp, "usage", None)
    if usage is None:
        return
    in_price, out_price = _PRICING_USD_PER_MTOK.get(model, _DEFAULT_PRICE)
    input_tokens = int(getattr(usage, "input_tokens", 0) or 0)
    output_tokens = int(getattr(usage, "output_tokens", 0) or 0)
    _usage["usd"] += (input_tokens * in_price + output_tokens * out_price) / 1_000_000
    _usage["calls"] += 1


def _coerce_box(value) -> Box | None:
    """Sanea um box ``[cx, cy, w, h]`` (frações 0-1) vindo do modelo.

    Aceita lista/tupla de 4 números ou dict ``{cx, cy, w, h}``. Devolve ``None``
    para qualquer coisa fora do contrato (null, não-numérico, NaN/inf, centro
    fora do frame, lado degenerado) — o chamador trata como "não localizado".
    """
    if isinstance(value, dict):
        value = [value.get(k) for k in ("cx", "cy", "w", "h")]
    if not isinstance(value, (list, tuple)) or len(value) != 4:
        return None
    try:
        cx, cy, w, h = (float(v) for v in value)
    except (TypeError, ValueError):
        return None
    if not all(math.isfinite(v) for v in (cx, cy, w, h)):
        return None
    if not (0.0 <= cx <= 1.0 and 0.0 <= cy <= 1.0):
        return None
    w, h = min(w, 1.0), min(h, 1.0)
    if w < MIN_BOX_SIDE or h < MIN_BOX_SIDE:
        return None
    return Box(cx=cx, cy=cy, w=w, h=h, conf=AI_BOX_CONF)


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
        story=_coerce_story(out.get("story"), duration),
        dj_box=_coerce_box(out.get("dj_box")),
        crowd_box=_coerce_box(out.get("crowd_box")),
        dancer_box=_coerce_box(out.get("dancer_box")),
    )


def _coerce_story(value, duration: float) -> list[tuple[float, str]]:
    """Sanea a story ``[{t, subject}]`` (ou pares ``[t, subject]``) do modelo.

    Passos com t fora de ``[0, duration)`` ou subject fora de
    :data:`STORY_SUBJECTS` são descartados; o resto é ordenado por t e
    espaçado em pelo menos ``dynamic_shot_min`` (passos colados não viram
    shots). Lista vazia = sem roteiro.
    """
    steps: list[tuple[float, str]] = []
    for step in value or []:
        if isinstance(step, dict):
            raw_t, raw_subj = step.get("t"), step.get("subject")
        elif isinstance(step, (list, tuple)) and len(step) == 2:
            raw_t, raw_subj = step
        else:
            continue
        try:
            t = float(raw_t)
        except (TypeError, ValueError):
            continue
        subj = str(raw_subj or "").strip().lower()
        if not math.isfinite(t) or not 0.0 <= t < duration or subj not in STORY_SUBJECTS:
            continue
        steps.append((round(t, 3), subj))
    steps.sort(key=lambda s: s[0])
    spaced: list[tuple[float, str]] = []
    for t, subj in steps:
        if not spaced or t - spaced[-1][0] >= settings.dynamic_shot_min:
            spaced.append((t, subj))
    return spaced[:MAX_STORY_STEPS]


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
        _track_usage(settings.ai_director_model, resp)
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


def triage_group(
    video_path: str, windows: list[tuple[int, float, float]]
) -> dict[int, Triage]:
    """Triagem BARATA de várias janelas numa única chamada (estágio 1).

    ``windows`` é ``[(chave, start_sec, duration), ...]`` — a chave é opaca
    (o chamador usa o que quiser para casar o resultado de volta, ex.
    ``id(peak)``). Cada janela contribui poucos keyframes pequenos
    (``ai_triage_frames_per_window`` @ ``ai_triage_frame_width``px); o modelo
    devolve um array com uma avaliação por janela.

    Diferente de :func:`direct` (que sempre roda janela por janela), isto é o
    que permite cobrir TODOS os candidatos de um job com poucas chamadas —
    janelas sem resultado no dict de saída (falha de amostragem, resposta sem
    aquele ``window`` id) ficam de fora e o chamador trata como "sem triagem"
    (mantém só o score local). Nunca levanta exceção.
    """
    client = _get_client()
    if client is None or not windows:
        return {}

    content: list[dict] = []
    valid_keys: set[int] = set()
    for key, start_sec, duration in windows:
        frames = _sample_frames(
            video_path,
            start_sec,
            duration,
            settings.ai_triage_frames_per_window,
            width=settings.ai_triage_frame_width,
        )
        if not frames:
            continue
        valid_keys.add(key)
        for t, b64 in frames:
            content.append({"type": "text", "text": f"Janela {key}, frame t={t:.1f}s:"})
            content.append(
                {
                    "type": "image",
                    "source": {"type": "base64", "media_type": "image/jpeg", "data": b64},
                }
            )
    if not valid_keys:
        return {}
    content.append(
        {"type": "text", "text": _TRIAGE_PROMPT.format(n=len(windows))}
    )

    try:
        resp = client.messages.create(
            model=settings.ai_triage_model,
            max_tokens=1024,
            messages=[{"role": "user", "content": content}],
        )
        _track_usage(settings.ai_triage_model, resp)
        text = "".join(
            block.text for block in resp.content if getattr(block, "type", None) == "text"
        )
    except Exception:  # noqa: BLE001 - a triagem nunca é fatal para o job
        logger.exception("Triagem de IA falhou (%d janelas)", len(windows))
        return {}

    items = _parse_json_array(text)
    if items is None:
        logger.warning("Triagem de IA: resposta sem array JSON válido")
        return {}

    out: dict[int, Triage] = {}
    for item in items:
        if not isinstance(item, dict):
            continue
        try:
            key = int(item.get("window"))
        except (TypeError, ValueError):
            continue
        if key not in valid_keys:
            continue
        try:
            hype = float(item.get("hype", 0.0))
        except (TypeError, ValueError):
            hype = 0.0
        if hype != hype:  # NaN
            hype = 0.0
        hype = min(1.0, max(0.0, hype))
        out[key] = Triage(hype=hype, worthy=bool(item.get("worthy", True)))
    return out
