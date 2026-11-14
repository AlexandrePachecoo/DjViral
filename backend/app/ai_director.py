"""Diretor de cena por IA (visão) — camada opcional sobre a análise local.

Dois estágios, orquestrados pelo `pipeline._score_candidates`:

1. :func:`triage_group` — TRIAGEM barata (poucos keyframes pequenos por janela,
   várias janelas por chamada): cobre TODOS os candidatos, não só um top-K
   pré-filtrado pelo score local. Devolve só ``hype``/``worthy`` por janela
   (:class:`Triage`), suficiente para reordenar os candidatos ANTES de
   truncar para a direção profunda.
2. :func:`direct` — DIREÇÃO PROFUNDA (mais keyframes, resolução maior): roda
   só nas melhores janelas pelo score já ajustado pela triagem, e devolve o
   enquadramento completo (:class:`AIDirection` — boxes, roteiro de câmera,
   momentos de auge) que alimenta o corte dinâmico.

Como o :mod:`analyzer` e o :mod:`visual`, é um módulo puro (sem FastAPI/Supabase)
e **nunca derruba um job**: sem chave, sem o pacote ``anthropic``,
timeout ou JSON inválido → cada função devolve o "vazio" (``None``/``{}``) e o
pipeline segue apenas na heurística local (áudio + YOLO).
"""
import base64
import json
import logging
import math
import re
import subprocess
import threading
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field

from .config import settings
from .visual import Box

logger = logging.getLogger("djviral.ai_director")

# Enquadramentos válidos que o modelo pode escolher como protagonista da janela.
VALID_SUBJECTS = {"dj", "crowd", "wide"}
# Alvos válidos de um passo da story (roteiro de câmera): os subjects mais o
# "dancer" (pessoa do público dançando em destaque, quando o modelo a viu).
STORY_SUBJECTS = VALID_SUBJECTS | {"dancer"}
# Máximo de passos aproveitados da story.
MAX_STORY_STEPS = 6
# Comprimento máximo (chars) de um título/hook viral vindo do modelo; acima
# disso truncamos (um hook de TikTok/Reels é curto por natureza).
MAX_TITLE_LEN = 80
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
    "claude-haiku-5-5": (0.1, 0.5),
    "claude-sonnet-5": (2.0, 10.0),
    "claude-sonnet-5-5": (2.0, 10.0),
    "claude-opus-4-8": (5.0, 25.0),
    "claude-opus-5-5": (4.0, 20.0),
}
_DEFAULT_PRICE = (3.0, 15.0)

# Acumulador de custo/chamadas da IA no job corrente (resetado pelo pipeline
# no início de cada `_score_candidates`). Só para observabilidade nos logs.
_usage = {"usd": 0.0, "calls": 0}
# As chamadas à IA rodam em paralelo (threads do pipeline): o lock protege o
# acumulador de custo e a criação preguiçosa do cliente.
_lock = threading.Lock()
# Grabs de frame simultâneos por janela (cada um é um FFmpeg curtinho).
_GRAB_WORKERS = 4


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
    - ``frames``: a direção de câmera propriamente dita — uma entrada
      ``(t, focus, box)`` por keyframe visto pelo modelo: o que a câmera
      enquadra naquele instante (``focus`` em :data:`STORY_SUBJECTS`) e onde
      está (``box`` normalizado, ou ``None``). É o que
      :func:`app.camera.build_ai_shot_plan` consome; ``subject``/``story``/
      ``*_box`` acima são derivados dela (usados só pelo planejador legado).
    """

    hype_score: float = 0.0
    subject: str = "wide"
    moments: list[float] = field(default_factory=list)
    worthy: bool = True
    story: list[tuple[float, str]] = field(default_factory=list)
    dj_box: Box | None = None
    crowd_box: Box | None = None
    dancer_box: Box | None = None
    frames: list[tuple[float, str, Box | None]] = field(default_factory=list)


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
    # Título/hook viral da janela (mesma chamada da triagem — evita uma
    # segunda passada só para títulos). ``""`` = o modelo não deu título.
    title: str = ""


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
    '- "title": TÍTULO/LEGENDA em PORTUGUÊS-BR para postar esse trecho — um '
    "gancho curto e com energia que PARE o scroll, na vibe de quem posta clipe "
    'de balada (ex.: "quando o drop DESTRUIU a pista 🔥"). No máximo ~60 '
    'caracteres; 0 a 2 emojis; SEM hashtags; nada genérico como "Drop 1".\n'
    "Responda para TODAS as janelas listadas, uma entrada cada.\n"
    'Exemplo: [{{"window": 0, "hype": 0.8, "worthy": true, "title": '
    '"a pista inteira foi ao delírio 🔥"}}, {{"window": 1, "hype": 0.15, '
    '"worthy": false, "title": "aquele respiro antes do drop"}}]'
)


_PROMPT = (
    "Você é o DIRETOR DE CÂMERA de um corte VERTICAL (9:16) para TikTok/Reels, "
    "feito de um trecho de ~{duration:.0f}s de um SET DE DJ filmado na "
    "horizontal. As imagens são frames do trecho em ordem cronológica, cada um "
    "rotulado com seu instante t (segundos desde o início do trecho). O corte "
    "vertical mostra só ~1/3 da largura do frame — você decide, frame a frame, "
    "O QUE a câmera enquadra.\n\n"
    "Responda APENAS com um objeto JSON (sem texto ao redor, sem markdown), com "
    "exatamente estas chaves:\n"
    '- "hype": número de 0.0 a 1.0 = energia/vibe do PÚBLICO (mãos pra cima, '
    "pulos, aglomeração, delírio, luzes/pyro = alto; pista vazia ou parada = "
    "baixo).\n"
    '- "worthy": true se a cena tem movimento/energia que justifique cortes e '
    "zooms dinâmicos; false se é estática/vazia demais (corte seco é melhor).\n"
    '- "moments": lista de até 3 instantes (segundos, entre 0 e {duration:.0f}) '
    "de maior auge visual — o drop das mãos, o jato de CO2, a explosão; lista "
    "vazia se não houver pico claro.\n"
    '- "frames": UMA entrada POR FRAME recebido, na mesma ordem: '
    '{{"t": instante do frame, "focus": "dj"|"crowd"|"dancer"|"wide", '
    '"box": [cx, cy, w, h] ou null}}.\n'
    '  - "focus" = o que mais rende NAQUELE instante: "dj" (artista/cabine), '
    '"crowd" (a massa do público reagindo), "dancer" (UMA pessoa dançando em '
    'destaque) ou "wide" (plano aberto: a cena inteira, luzes/pyro, ou nada '
    "se destaca).\n"
    '  - "box" = retângulo que envolve o alvo NAQUELE frame, em frações '
    "0.0-1.0 do frame (centro x, centro y, largura, altura). DJ: corpo + "
    "cabine; dancer: o corpo inteiro; crowd: a aglomeração. Em \"wide\", o "
    "box marca onde está a ação principal (para centralizar o plano aberto), "
    "ou null.\n"
    "Dirija com intenção: abra situando a cena, feche no artista nos auges "
    '("moments"), mostre a reação do público ou de quem dança, dê respiros '
    "em wide. Não fique preso num só focus se a cena oferece mais, mas também "
    "não troque sem motivo. Se o alvo não aparece num frame (a câmera da "
    "gravação trocou), não invente: escolha outro focus para aquele frame.\n"
    'Exemplo: {{"hype": 0.8, "worthy": true, "moments": [12.5], "frames": ['
    '{{"t": 2.5, "focus": "wide", "box": [0.5, 0.4, 0.3, 0.5]}}, '
    '{{"t": 7.5, "focus": "dj", "box": [0.52, 0.38, 0.2, 0.45]}}, '
    '{{"t": 12.5, "focus": "dj", "box": [0.5, 0.37, 0.2, 0.45]}}, '
    '{{"t": 17.5, "focus": "crowd", "box": [0.5, 0.8, 0.9, 0.35]}}]}}'
    "{hint}"
)


_TITLE_PROMPT = (
    "Estas imagens são keyframes de {n} CORTES já selecionados de um SET DE DJ "
    "(balada/festival), prontos para virar vídeos curtos de TikTok/Reels. Cada "
    'frame vem rotulado "Corte {{id}}, t={{t}}s".\n\n'
    "Para CADA corte, escreva um TÍTULO/LEGENDA em PORTUGUÊS-BR pensado para "
    "PARAR o scroll e viralizar — um gancho curto e com energia, na vibe de "
    "quem posta clipe de balada (ex.: \"quando o drop DESTRUIU a pista 🔥\", "
    "\"ninguém esperava esse b2b\", \"esse momento deu arrepio\").\n"
    "Regras do título: no máximo ~60 caracteres; 0 a 2 emojis; SEM hashtags; "
    "SEM aspas ao redor; nada genérico como \"Drop 1\" ou só o BPM.\n\n"
    "Responda APENAS com um ARRAY JSON (sem texto ao redor, sem markdown), um "
    "objeto por corte, com exatamente estas chaves:\n"
    '- "window": o id do corte (inteiro, o mesmo número do rótulo).\n'
    '- "title": o título/legenda (string).\n'
    "Responda para TODOS os cortes listados, uma entrada cada.\n"
    'Exemplo: [{{"window": 0, "title": "quando o beat dropou 🔥"}}, '
    '{{"window": 1, "title": "a pista inteira cantou junto"}}]'
)


_client = None
_client_failed = False


def _get_client():
    """Cliente Anthropic com cache por processo. ``None`` desliga o diretor.

    ``None`` (sem chave, sem o pacote, ou falha de init) é o gatilho do fallback:
    o pipeline ignora a IA e usa só o score local. Nunca levanta exceção.
    """
    if _client is not None:
        return _client
    with _lock:
        return _init_client()


def _init_client():
    """Cria o cliente (uma vez por processo); chamado sob ``_lock``."""
    global _client, _client_failed
    if _client is not None:
        return _client
    if _client_failed:
        return None
    if not settings.anthropic_api_key:
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


def _grab_frame(video_path: str, t_abs: float, width: int) -> str | None:
    """Um frame JPEG (base64) em ``t_abs`` via seek rápido do FFmpeg.

    ``-ss`` antes do ``-i`` pula direto para o keyframe mais próximo e decoda
    só até o instante pedido — décimos de segundo, em vez de decodificar a
    janela inteira para aproveitar meia dúzia de frames.
    """
    cmd = [
        "ffmpeg",
        "-v", "error",
        "-ss", f"{max(0.0, t_abs):.3f}",
        "-i", video_path,
        "-frames:v", "1",
        "-vf", f"scale='min({int(width)},iw)':-2",
        "-q:v", "4",
        "-f", "image2pipe",
        "-c:v", "mjpeg",
        "pipe:1",
    ]
    result = subprocess.run(cmd, capture_output=True, timeout=30)
    if result.returncode != 0 or not result.stdout:
        return None
    return base64.b64encode(result.stdout).decode("ascii")


def _sample_frames(
    video_path: str, start_sec: float, duration: float, n: int, width: int | None = None
) -> list[tuple[float, str]]:
    """Amostra ``n`` keyframes espalhados na janela → ``[(t_rel, jpeg_b64)]``.

    Cada alvo é a fração (i+0.5)/n da duração (evita as bordas) e vira um grab
    independente com seek rápido (:func:`_grab_frame`), alguns em paralelo.
    ``width`` (px) escala o custo de tokens da chamada — a triagem usa frames
    menores que a direção profunda. Frames que falharem ficam de fora; nunca
    levanta exceção.
    """
    n = max(1, n)
    frame_width = width or settings.ai_director_frame_width
    targets = [duration * (i + 0.5) / n for i in range(n)]
    try:
        with ThreadPoolExecutor(max_workers=min(_GRAB_WORKERS, n)) as pool:
            grabbed = list(
                pool.map(
                    lambda t: _grab_frame(video_path, start_sec + t, frame_width),
                    targets,
                )
            )
    except Exception:  # noqa: BLE001 - amostragem nunca derruba o job (ex.: ffmpeg)
        logger.exception("Falha ao amostrar keyframes (%.1fs)", start_sec)
        return []
    return [(round(t, 2), b64) for t, b64 in zip(targets, grabbed) if b64]


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
    with _lock:
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
    with _lock:
        _usage["usd"] += (
            input_tokens * in_price + output_tokens * out_price
        ) / 1_000_000
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


def _coerce_title(value) -> str:
    """Sanea um título/hook vindo do modelo → string curta (ou ``""``).

    Tira aspas de cercadura, colapsa espaços em branco e trunca em
    :data:`MAX_TITLE_LEN`. Devolve ``""`` para qualquer coisa vazia ou
    não-textual — o chamador cai no título heurístico ("Drop N · BPM").
    """
    if not isinstance(value, str):
        return ""
    title = " ".join(value.split()).strip()
    # Remove aspas/apóstrofos de cercadura que o modelo às vezes adiciona.
    if len(title) >= 2 and title[0] in "\"'“”" and title[-1] in "\"'“”":
        title = title[1:-1].strip()
    if len(title) > MAX_TITLE_LEN:
        title = title[:MAX_TITLE_LEN].rstrip()
    return title


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

    direction = AIDirection(
        hype_score=hype,
        subject=subject,
        moments=deduped[:3],
        worthy=bool(out.get("worthy", True)),
        story=_coerce_story(out.get("story"), duration),
        dj_box=_coerce_box(out.get("dj_box")),
        crowd_box=_coerce_box(out.get("crowd_box")),
        dancer_box=_coerce_box(out.get("dancer_box")),
        frames=_coerce_frames(out.get("frames"), duration),
    )
    if direction.frames:
        _derive_legacy_fields(direction, duration)
    return direction


def _coerce_frames(value, duration: float) -> list[tuple[float, str, Box | None]]:
    """Sanea a direção por frame ``[{t, focus, box}]`` do modelo.

    Entradas com ``t`` fora de ``[0, duration]`` ou ``focus`` desconhecido são
    descartadas; ``box`` inválido vira ``None`` (o planejador trata). Ordena
    por ``t`` e colapsa instantes repetidos (vence o primeiro).
    """
    frames: dict[float, tuple[float, str, Box | None]] = {}
    for item in value or []:
        if not isinstance(item, dict):
            continue
        try:
            t = float(item.get("t"))
        except (TypeError, ValueError):
            continue
        focus = str(item.get("focus") or "").strip().lower()
        if not math.isfinite(t) or not 0.0 <= t <= duration or focus not in STORY_SUBJECTS:
            continue
        frames.setdefault(round(t, 2), (round(t, 2), focus, _coerce_box(item.get("box"))))
    return [frames[t] for t in sorted(frames)]


def _derive_legacy_fields(direction: AIDirection, duration: float) -> None:
    """Preenche ``subject``/``story``/``*_box`` a partir de ``frames``.

    Só o planejador legado (:func:`app.dynamic.build_shot_plan`, usado quando
    a câmera da IA está desligada) lê esses campos; derivá-los evita manter um
    segundo prompt só para ele.
    """
    frames = direction.frames
    counts: dict[str, int] = {}
    for _t, focus, _box in frames:
        key = "crowd" if focus == "dancer" else focus
        counts[key] = counts.get(key, 0) + 1
    direction.subject = max(counts, key=counts.get)

    def _median(focus: str) -> Box | None:
        boxes = [b for _t, f, b in frames if f == focus and b is not None]
        if not boxes:
            return None
        mid = lambda vals: sorted(vals)[len(vals) // 2]  # noqa: E731
        return Box(
            cx=mid([b.cx for b in boxes]), cy=mid([b.cy for b in boxes]),
            w=mid([b.w for b in boxes]), h=mid([b.h for b in boxes]),
            conf=AI_BOX_CONF,
        )

    direction.dj_box = _median("dj")
    direction.crowd_box = _median("crowd")
    direction.dancer_box = _median("dancer")
    runs = [
        {"t": 0.0 if i == 0 else t, "subject": focus}
        for i, (t, focus, _box) in enumerate(frames)
        if i == 0 or focus != frames[i - 1][1]
    ]
    direction.story = _coerce_story(runs, duration)


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
            # Folga larga: em modelos que pensam antes de responder, um teto
            # curto corta o JSON no meio e a direção inteira é perdida.
            max_tokens=8192,
            messages=[{"role": "user", "content": content}],
        )
        _track_usage(settings.ai_director_model, resp)
        if getattr(resp, "stop_reason", None) == "max_tokens":
            logger.warning(
                "Diretor de IA: resposta truncada por max_tokens (janela %.1fs)",
                start_sec,
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
            max_tokens=4096,
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
        out[key] = Triage(
            hype=hype,
            worthy=bool(item.get("worthy", True)),
            title=_coerce_title(item.get("title")),
        )
    return out


def title_group(
    video_path: str, cuts: list[tuple[int, float, float]]
) -> dict[int, str]:
    """Gera um título/hook viral para vários cortes numa única chamada barata.

    ``cuts`` é ``[(chave, start_sec, duration), ...]`` — a chave é opaca (o
    chamador usa o que quiser para casar o resultado, ex. ``id(peak)``). Roda
    só sobre os cortes JÁ SELECIONADOS (não todos os candidatos), com poucos
    keyframes pequenos por corte, no modelo de triagem (Haiku) — por isso é
    barato e serve inclusive o plano free (tier "lite"). Cada corte vira um
    ``title`` saneado (:func:`_coerce_title`).

    Cortes sem título no dict de saída (falha de amostragem, resposta sem
    aquele ``window`` id, título vazio) ficam de fora e o chamador usa o
    título heurístico. Como o resto do módulo, nunca levanta exceção.
    """
    client = _get_client()
    if client is None or not cuts:
        return {}

    content: list[dict] = []
    valid_keys: set[int] = set()
    for key, start_sec, duration in cuts:
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
            content.append({"type": "text", "text": f"Corte {key}, frame t={t:.1f}s:"})
            content.append(
                {
                    "type": "image",
                    "source": {"type": "base64", "media_type": "image/jpeg", "data": b64},
                }
            )
    if not valid_keys:
        return {}
    content.append({"type": "text", "text": _TITLE_PROMPT.format(n=len(cuts))})

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
    except Exception:  # noqa: BLE001 - os títulos nunca são fatais para o job
        logger.exception("Geração de títulos de IA falhou (%d cortes)", len(cuts))
        return {}

    items = _parse_json_array(text)
    if items is None:
        logger.warning("Títulos de IA: resposta sem array JSON válido")
        return {}

    out: dict[int, str] = {}
    for item in items:
        if not isinstance(item, dict):
            continue
        try:
            key = int(item.get("window"))
        except (TypeError, ValueError):
            continue
        if key not in valid_keys:
            continue
        title = _coerce_title(item.get("title"))
        if title:
            out[key] = title
    return out
