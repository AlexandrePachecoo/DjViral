"""Análise visual das janelas candidatas a corte.

Complementa o :mod:`analyzer` (áudio): para cada janela de ~60–75 s em torno de
um pico musical, mede o quanto a IMAGEM tem potencial viral — movimento na
cena, presença de pessoas e de público — e localiza o DJ e o público para o
corte dinâmico (zooms). Nunca analisa o set inteiro: só as janelas candidatas,
com frames amostrados (~2 fps) e reduzidos (640 px), lidos de um pipe do FFmpeg
frame a frame (a janela nunca fica inteira em RAM).

A detecção de pessoas usa YOLOv8n em ONNX via ``cv2.dnn`` (CPU, ~13 MB, sem
torch). Qualquer falha — modelo ausente, cv2 quebrado — degrada para score só
de movimento e o chamador cai nos fallbacks (zoom central / corte seco); a
análise visual nunca derruba um job.

Como o analyzer, este módulo é puro (sem FastAPI/Supabase) e testável isolado.
"""
import json
import logging
import math
import os
import subprocess
import tempfile
from dataclasses import dataclass, field

import numpy as np

from .config import settings

logger = logging.getLogger("djviral.visual")

try:  # opencv-python-headless; sem ele a análise degrada para motion-only
    import cv2
except Exception:  # noqa: BLE001 - qualquer falha de import conta como "sem cv2"
    cv2 = None

# Lado do blob de entrada do YOLOv8n (o modelo é exportado com imgsz=640).
DETECT_INPUT = 640
# Lado maior dos frames usados no frame differencing (movimento). Bem pequeno:
# interessa o movimento global da cena, não detalhes.
MOTION_SIZE = 160
# Confiança mínima de uma detecção de pessoa e IoU do NMS.
PERSON_CONF = 0.35
NMS_IOU = 0.45
# Movimento médio (|diff| normalizado 0-1 entre frames a ~2 fps) considerado
# "cena muito agitada" — satura o motion_score em 1.
MOTION_REF = 0.08
# Nº de pessoas (além do DJ) que satura o crowd_score em 1.
CROWD_REF = 6.0
# Distância máxima (normalizada) entre centros para associar um box a uma
# track existente entre dois frames detectados consecutivos.
TRACK_MAX_DIST = 0.18
# Track "dançarina" (melhor pessoa além do DJ): persistência mínima (fração
# dos frames detectados), altura mínima da pessoa (fração do frame — alguém
# minúsculo ao fundo não rende zoom) e deslocamento médio entre detecções
# que satura o score de movimento.
DANCER_MIN_RATIO = 0.2
DANCER_MIN_H = 0.10
DANCER_MOTION_REF = 0.04
# Movimento próprio mínimo para alguém contar como "dançando" — parado não é
# dançarino, mesmo que persista a janela inteira.
DANCER_MIN_MOTION = 0.01


@dataclass
class Box:
    """Box de pessoa em coordenadas NORMALIZADAS (0-1) do frame fonte."""

    cx: float
    cy: float
    w: float
    h: float
    conf: float


@dataclass
class FrameSample:
    """Um frame amostrado da janela: instante relativo, movimento e detecções."""

    t: float                       # segundos relativos ao início da janela
    motion: float                  # |diff| médio vs. frame anterior (0-1)
    persons: list[Box] | None      # None = YOLO não rodou neste frame


@dataclass
class WindowVisual:
    """Resultado visual de uma janela candidata."""

    samples: list[FrameSample] = field(default_factory=list)
    motion_score: float = 0.0      # 0-1
    presence_ratio: float = 0.0    # frames com pessoa / frames detectados
    crowd_score: float = 0.0       # 0-1 (nº de pessoas além do DJ, satura)
    dj_box: Box | None = None      # box mediano da track dominante
    # Track do DJ no tempo: (t relativo à janela, box) de cada detecção da
    # track dominante — permite enquadramento POR SHOT no corte dinâmico
    # (o box mediano global erra quando o DJ circula pela cabine).
    dj_track: list[tuple[float, Box]] = field(default_factory=list)
    # Fração dos frames detectados em que a track do DJ aparece. Default 1.0
    # ("forte"): só analyze_window rebaixa; track intermitente (< ~0.3) deixa
    # o box da IA assumir o enquadramento no shot plan.
    dj_track_ratio: float = 1.0
    # Melhor pessoa "dançante" além do DJ (track secundária persistente e com
    # movimento próprio) — alvo do shot "dancer" do corte dinâmico. ``None``
    # quando ninguém além do DJ dança/persiste o suficiente.
    dancer_box: Box | None = None
    dancer_track: list[tuple[float, Box]] = field(default_factory=list)
    crowd_box: Box | None = None   # box mediano do cluster de público
    visual_score: float = 0.0      # 0-1 combinado
    detected: bool = False         # True se o YOLO rodou em algum frame
    # True se a MAIORIA dos frames amostrados estava escura (luma abaixo de
    # `visual_low_light_luma_threshold`) — balada/laser. O CLAHE já roda nesse
    # caso (ver `_maybe_enhance_low_light`), mas o flag também vira uma dica
    # explícita no prompt do diretor de IA (a detecção local é menos confiável).
    low_light: bool = False
    # Viés vertical do rosto dentro da box de pessoa (mediana de
    # ``(face.cy - box.cy) / box.h`` nas detecções da track): ``None`` = sem
    # rosto detectado na track (YuNet ausente, ninguém de frente pra câmera
    # etc.) — o corte dinâmico usa isso só pra afinar o `y` do crop (nunca o
    # zoom/enquadramento), ver `app/dynamic.py::crop_for_kind`.
    dj_face_bias_y: float | None = None
    dancer_face_bias_y: float | None = None


_net = None
_net_failed = False
_face_net = None
_face_net_failed = False


def _resolve_model_path(model_path: str) -> str:
    """Caminho absoluto de um modelo relativo à raiz do worker (acima de ``app/``)."""
    if os.path.isabs(model_path):
        return model_path
    base = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    return os.path.join(base, model_path)


def load_model(path: str | None = None):
    """Carrega o YOLOv8n ONNX (com cache por processo). ``None`` se falhar.

    ``None`` é o gatilho de todos os fallbacks: score motion-only e zoom
    central em vez de zoom em pessoas. Nunca levanta exceção.
    """
    global _net, _net_failed
    if _net is not None:
        return _net
    if _net_failed:
        return None
    model_path = path or settings.yolo_model_path
    if cv2 is None:
        logger.warning("cv2 indisponível — análise visual será motion-only")
        _net_failed = True
        return None
    try:
        _net = cv2.dnn.readNetFromONNX(_resolve_model_path(model_path))
    except Exception:  # noqa: BLE001 - modelo ausente/corrompido → fallback
        logger.exception("Falha ao carregar o modelo YOLO em %s", model_path)
        _net_failed = True
        return None
    return _net


def load_face_model(path: str | None = None):
    """Carrega o detector de rosto YuNet (cache por processo). ``None`` se falhar.

    ``None`` é o gatilho do fallback: sem rosto, o corte dinâmico usa só o
    box de corpo do YOLO/IA (comportamento anterior à Fase 6). Nunca levanta
    exceção — igual ao ``load_model`` do YOLO.
    """
    global _face_net, _face_net_failed
    if _face_net is not None:
        return _face_net
    if _face_net_failed:
        return None
    if not settings.face_enabled:
        _face_net_failed = True
        return None
    model_path = path or settings.face_model_path
    if cv2 is None:
        _face_net_failed = True
        return None
    resolved = _resolve_model_path(model_path)
    if not os.path.exists(resolved):
        logger.info("Modelo de rosto ausente em %s — sinal de rosto desligado", resolved)
        _face_net_failed = True
        return None
    try:
        _face_net = cv2.FaceDetectorYN_create(
            resolved, "", (320, 320), score_threshold=settings.face_conf
        )
    except Exception:  # noqa: BLE001 - modelo ausente/corrompido → fallback
        logger.exception("Falha ao carregar o modelo de rosto em %s", resolved)
        _face_net_failed = True
        return None
    return _face_net


# Fração superior da altura da box de pessoa usada como região de busca do
# rosto (cabeça) — nunca a box inteira, pra manter a detecção barata e focada.
FACE_HEAD_REGION_FRACTION = 0.35
# Lado mínimo (px) da região recortada pra valer a pena rodar o detector.
FACE_MIN_REGION_PX = 12


def detect_face_in_region(net_face, frame_bgr: np.ndarray, box: Box) -> Box | None:
    """Detecta um rosto na região da CABEÇA de ``box`` (top da pessoa).

    Roda só no recorte da box JÁ ESCOLHIDA (DJ/dançarino) — nunca uma passada
    full-frame. Devolve o box do rosto em coordenadas normalizadas do FRAME
    INTEIRO (não da região recortada), ou ``None`` (sem rosto, região
    pequena demais, ou qualquer falha do detector).
    """
    if net_face is None:
        return None
    h, w = frame_bgr.shape[:2]
    x0 = int(max(0, (box.cx - box.w / 2) * w))
    x1 = int(min(w, (box.cx + box.w / 2) * w))
    y0 = int(max(0, (box.cy - box.h / 2) * h))
    y1 = int(min(h, y0 + box.h * h * FACE_HEAD_REGION_FRACTION))
    if x1 - x0 < FACE_MIN_REGION_PX or y1 - y0 < FACE_MIN_REGION_PX:
        return None
    region = frame_bgr[y0:y1, x0:x1]
    try:
        net_face.setInputSize((region.shape[1], region.shape[0]))
        _ok, faces = net_face.detect(region)
    except Exception:  # noqa: BLE001 - detecção de rosto nunca derruba o job
        logger.exception("Falha na detecção de rosto")
        return None
    if faces is None or len(faces) == 0:
        return None
    # Maior rosto da região (mais provável de ser o protagonista, não alguém
    # ao fundo que entrou na box por acaso).
    best = max(faces, key=lambda f: float(f[2]) * float(f[3]))
    fx, fy, fw, fh = (float(v) for v in best[:4])
    if fw < settings.face_min_size_px or fh < settings.face_min_size_px:
        return None
    return Box(
        cx=(x0 + fx + fw / 2) / w,
        cy=(y0 + fy + fh / 2) / h,
        w=fw / w,
        h=fh / h,
        conf=float(best[-1]),
    )


def _face_bias_y(pairs: list[tuple[int, Box]], faces: dict[int, Box | None]) -> float | None:
    """Viés vertical mediano ``(face.cy - box.cy) / box.h`` da track.

    ``None`` se nenhuma detecção da track tiver rosto associado.
    """
    diffs = [
        (faces[id(box)].cy - box.cy) / box.h
        for _idx, box in pairs
        if faces.get(id(box)) is not None and box.h > 0
    ]
    if not diffs:
        return None
    return float(np.median(diffs))


def _video_dims(path: str) -> tuple[int, int]:
    """(largura, altura) do primeiro stream de vídeo, via ffprobe."""
    result = subprocess.run(
        [
            "ffprobe",
            "-v", "error",
            "-select_streams", "v:0",
            "-show_entries", "stream=width,height",
            "-of", "json",
            path,
        ],
        capture_output=True,
        text=True,
    )
    try:
        stream = json.loads(result.stdout)["streams"][0]
        return int(stream["width"]), int(stream["height"])
    except (KeyError, IndexError, ValueError, json.JSONDecodeError):
        logger.warning("ffprobe não achou dimensões de %s", path)
        return 0, 0


def iter_frames(
    video_path: str,
    start_sec: float,
    duration: float,
    fps: float = 2.0,
    width: int = DETECT_INPUT,
):
    """Itera ``(t_rel, frame_bgr)`` da janela, amostrado a ``fps``.

    Um único processo FFmpeg decodifica a janela e escreve rawvideo no stdout;
    lemos um frame por vez (nunca a janela inteira em RAM). O ``-ss`` antes do
    ``-i`` é o MESMO padrão do clipper → o t=0 daqui coincide com o t=0 do
    clipe renderizado.
    """
    src_w, src_h = _video_dims(video_path)
    if not src_w or not src_h:
        return
    out_w = min(width, src_w)
    out_h = max(2, round(src_h * out_w / src_w / 2) * 2)
    frame_bytes = out_w * out_h * 3

    cmd = [
        "ffmpeg",
        "-v", "error",
        "-ss", str(max(0.0, start_sec)),
        "-i", video_path,
        "-t", str(duration),
        "-vf", f"fps={fps},scale={out_w}:{out_h}",
        "-f", "rawvideo",
        "-pix_fmt", "bgr24",
        "pipe:1",
    ]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    try:
        idx = 0
        while True:
            buf = proc.stdout.read(frame_bytes)
            if len(buf) < frame_bytes:
                break
            frame = np.frombuffer(buf, dtype=np.uint8).reshape(out_h, out_w, 3)
            yield idx / fps, frame
            idx += 1
    finally:
        if proc.stdout:
            proc.stdout.close()
        proc.terminate()
        proc.wait()


def detect_persons(net, frame_bgr: np.ndarray) -> list[Box]:
    """Detecta pessoas num frame BGR e devolve boxes normalizados (0-1).

    Letterbox para 640×640 (mantém proporção, borda cinza), blob 1/255,
    saída YOLOv8 ``(1, 84, 8400)`` → filtra classe 0 (person) por confiança,
    NMS, desfaz o letterbox e normaliza pelas dimensões do frame.
    """
    h, w = frame_bgr.shape[:2]
    scale = DETECT_INPUT / max(h, w)
    new_w, new_h = round(w * scale), round(h * scale)
    resized = cv2.resize(frame_bgr, (new_w, new_h))
    pad_x = (DETECT_INPUT - new_w) // 2
    pad_y = (DETECT_INPUT - new_h) // 2
    canvas = np.full((DETECT_INPUT, DETECT_INPUT, 3), 114, dtype=np.uint8)
    canvas[pad_y : pad_y + new_h, pad_x : pad_x + new_w] = resized

    blob = cv2.dnn.blobFromImage(canvas, scalefactor=1 / 255.0, swapRB=True)
    net.setInput(blob)
    out = net.forward()  # (1, 84, 8400): 4 coords + 80 classes, por âncora
    preds = out[0].T  # (8400, 84)

    confs = preds[:, 4]  # classe 0 = person
    keep = confs >= PERSON_CONF
    if not np.any(keep):
        return []
    preds, confs = preds[keep], confs[keep]

    # cx,cy,w,h no espaço 640×640 do letterbox → x,y,w,h topo-esquerda p/ NMS.
    rects = []
    for cx, cy, bw, bh in preds[:, :4]:
        rects.append([float(cx - bw / 2), float(cy - bh / 2), float(bw), float(bh)])
    idxs = cv2.dnn.NMSBoxes(rects, confs.astype(float).tolist(), PERSON_CONF, NMS_IOU)
    if len(idxs) == 0:
        return []

    boxes: list[Box] = []
    for i in np.array(idxs).flatten():
        x, y, bw, bh = rects[i]
        # Desfaz o letterbox e normaliza pelo frame original.
        cx = (x + bw / 2 - pad_x) / scale / w
        cy = (y + bh / 2 - pad_y) / scale / h
        nw = bw / scale / w
        nh = bh / scale / h
        if nw <= 0 or nh <= 0:
            continue
        boxes.append(
            Box(
                cx=float(np.clip(cx, 0, 1)),
                cy=float(np.clip(cy, 0, 1)),
                w=float(min(nw, 1.0)),
                h=float(min(nh, 1.0)),
                conf=float(confs[i]),
            )
        )
    return boxes


def _median_box(boxes: list[Box]) -> Box:
    return Box(
        cx=float(np.median([b.cx for b in boxes])),
        cy=float(np.median([b.cy for b in boxes])),
        w=float(np.median([b.w for b in boxes])),
        h=float(np.median([b.h for b in boxes])),
        conf=float(np.median([b.conf for b in boxes])),
    )


def _build_tracks(detected_frames: list[list[Box]]) -> list[dict]:
    """Associa detecções em tracks por proximidade de centro (gulosa).

    Cada track é ``{"boxes": [(índice do frame detectado, Box)], "last": Box}``.
    """
    tracks: list[dict] = []
    for f_idx, persons in enumerate(detected_frames):
        used = set()
        for box in persons:
            best, best_dist = None, TRACK_MAX_DIST
            for t_idx, track in enumerate(tracks):
                if t_idx in used:
                    continue
                last = track["last"]
                dist = math.hypot(box.cx - last.cx, box.cy - last.cy)
                if dist < best_dist:
                    best, best_dist = t_idx, dist
            if best is None:
                tracks.append({"boxes": [(f_idx, box)], "last": box})
                used.add(len(tracks) - 1)
            else:
                tracks[best]["boxes"].append((f_idx, box))
                tracks[best]["last"] = box
                used.add(best)
    return tracks


def _pick_dj_track(
    detected_frames: list[list[Box]],
) -> tuple[Box | None, list[tuple[int, Box]], list[list[Box]], list[dict]]:
    """Escolhe a track dominante (o DJ): ``(dj_box, track, resto, outras_tracks)``.

    A track do DJ é a de maior soma de "peso de protagonista" (área ×
    centralidade × confiança) vezes a persistência (fração dos frames em que
    aparece). O box devolvido é a MEDIANA da track — imune a flicker de
    detecção. ``track`` são os pares ``(índice do frame detectado, box)`` da
    própria track (para o enquadramento por shot); ``resto`` são as demais
    pessoas de cada frame (candidatas a público) e ``outras_tracks`` as
    tracks restantes (candidatas a "dançarino").
    """
    tracks = _build_tracks(detected_frames)
    if not tracks:
        return None, [], [[] for _ in detected_frames], []

    n_frames = max(1, len(detected_frames))

    def protagonism(track: dict) -> float:
        weight = 0.0
        for _, b in track["boxes"]:
            centrality = 1.0 - min(1.0, abs(b.cx - 0.5) * 2)
            weight += b.w * b.h * (0.35 + 0.65 * centrality) * b.conf
        return weight * (len(track["boxes"]) / n_frames)

    dj_track = max(tracks, key=protagonism)
    pairs = dj_track["boxes"]
    dj_ids = {id(b) for _, b in pairs}
    rest = [[b for b in persons if id(b) not in dj_ids] for persons in detected_frames]
    others = [t for t in tracks if t is not dj_track]
    return _median_box([b for _, b in pairs]), pairs, rest, others


def _pick_dancer_track(
    tracks: list[dict], n_frames: int
) -> tuple[Box | None, list[tuple[int, Box]]]:
    """Melhor track "dançante" além do DJ: ``(dancer_box, track)``.

    Uma pessoa vale um zoom quando persiste na cena (>= :data:`DANCER_MIN_RATIO`
    dos frames detectados), tem tamanho útil (>= :data:`DANCER_MIN_H` de
    altura) e SE MOVE (deslocamento médio do centro entre detecções — parado
    não é dançarino). Entre as elegíveis vence a de maior
    ``movimento × persistência``. ``(None, [])`` quando ninguém qualifica.
    """
    n_frames = max(1, n_frames)
    best: dict | None = None
    best_score = 0.0
    for track in tracks:
        pairs = track["boxes"]
        ratio = len(pairs) / n_frames
        if len(pairs) < 2 or ratio < DANCER_MIN_RATIO:
            continue
        med = _median_box([b for _, b in pairs])
        if med.h < DANCER_MIN_H:
            continue
        steps = [
            math.hypot(b2.cx - b1.cx, b2.cy - b1.cy)
            for (_, b1), (_, b2) in zip(pairs, pairs[1:])
        ]
        motion = sum(steps) / len(steps)
        if motion < DANCER_MIN_MOTION:
            continue
        score = min(1.0, motion / DANCER_MOTION_REF) * ratio
        if score > best_score:
            best, best_score = track, score
    if best is None:
        return None, []
    pairs = best["boxes"]
    return _median_box([b for _, b in pairs]), pairs


def _maybe_enhance_low_light(frame_bgr: np.ndarray) -> tuple[np.ndarray, bool]:
    """Aplica CLAHE (contraste local, canal L do LAB) se o frame estiver escuro.

    Balada/festival = pouca luz + laser/strobe: o YOLO perde detecções nesse
    cenário (é por isso que o box da IA existe como fallback). CLAHE realça o
    contraste LOCAL sem ser enganado por um pico de brilho transitório (um
    flash de laser), diferente de aplicar gamma fixo no frame inteiro. Só roda
    quando o luma médio fica abaixo do limiar — em cena bem iluminada é
    puro custo (poucos ms) sem ganho, então nem tenta. Devolve
    ``(frame_processado, era_escuro)``.
    """
    luma = float(cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2GRAY).mean())
    if luma >= settings.visual_low_light_luma_threshold:
        return frame_bgr, False
    lab = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2LAB)
    l_chan, a_chan, b_chan = cv2.split(lab)
    clahe = cv2.createCLAHE(clipLimit=settings.visual_low_light_clahe_clip, tileGridSize=(8, 8))
    enhanced_l = clahe.apply(l_chan)
    enhanced = cv2.merge((enhanced_l, a_chan, b_chan))
    return cv2.cvtColor(enhanced, cv2.COLOR_LAB2BGR), True


def analyze_window(
    video_path: str,
    start_sec: float,
    duration: float,
    net=None,
    detect_every: int = 3,
    fps: float = 2.0,
    net_face=None,
) -> WindowVisual:
    """Analisa uma janela candidata e devolve o :class:`WindowVisual`.

    ``detect_every``: roda o YOLO a cada N frames amostrados (os demais só
    contribuem para o movimento). Com ``net=None`` a janela é avaliada apenas
    pelo movimento (``visual_score = motion_score``). ``net_face`` (opcional,
    de :func:`load_face_model`) roda YuNet na região da cabeça de CADA pessoa
    detectada nesses mesmos frames (mesma cadência do YOLO, sem passada
    extra) — usado depois para derivar ``dj_face_bias_y``/``dancer_face_bias_y``
    da track escolhida.
    """
    samples: list[FrameSample] = []
    prev_gray: np.ndarray | None = None
    dark_frames = 0
    total_frames = 0
    faces_by_box_id: dict[int, Box | None] = {}

    for idx, (t, frame) in enumerate(iter_frames(video_path, start_sec, duration, fps)):
        total_frames += 1
        if cv2 is not None and settings.visual_low_light_enabled:
            try:
                frame, is_dark = _maybe_enhance_low_light(frame)
            except Exception:  # noqa: BLE001 - CLAHE nunca derruba o job
                logger.exception("Falha no realce de baixa luz (t=%.1fs)", t)
                is_dark = False
            if is_dark:
                dark_frames += 1
        if cv2 is not None:
            small = cv2.resize(frame, (MOTION_SIZE, MOTION_SIZE * frame.shape[0] // frame.shape[1]))
            gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY).astype(np.float32)
        else:
            # Sem cv2: downsample por stride + média dos canais (mais grosso,
            # mas mantém o sinal de movimento).
            stride = max(1, frame.shape[1] // MOTION_SIZE)
            gray = frame[::stride, ::stride].mean(axis=2).astype(np.float32)
        motion = 0.0
        if prev_gray is not None and prev_gray.shape == gray.shape:
            motion = float(np.abs(gray - prev_gray).mean() / 255.0)
        prev_gray = gray

        persons: list[Box] | None = None
        if net is not None and idx % max(1, detect_every) == 0:
            try:
                persons = detect_persons(net, frame)
            except Exception:  # noqa: BLE001 - inferência nunca derruba o job
                logger.exception("Falha na detecção de pessoas (t=%.1fs)", t)
            if persons and net_face is not None:
                # Só nas pessoas JÁ detectadas neste frame — nunca uma
                # passada full-frame extra do detector de rosto.
                for box in persons:
                    faces_by_box_id[id(box)] = detect_face_in_region(net_face, frame, box)
        samples.append(FrameSample(t=t, motion=motion, persons=persons))

    wv = WindowVisual(samples=samples)
    if not samples:
        return wv
    wv.low_light = total_frames > 0 and (dark_frames / total_frames) > 0.5

    motions = np.array([s.motion for s in samples[1:]] or [0.0])
    raw = 0.5 * float(motions.mean()) + 0.5 * float(np.percentile(motions, 90))
    wv.motion_score = float(np.clip(raw / MOTION_REF, 0.0, 1.0))

    detected_samples = [s for s in samples if s.persons is not None]
    detected_frames = [s.persons for s in detected_samples]
    wv.detected = len(detected_frames) > 0
    if wv.detected:
        with_person = sum(1 for p in detected_frames if p)
        wv.presence_ratio = with_person / len(detected_frames)

        wv.dj_box, dj_pairs, rest, other_tracks = _pick_dj_track(detected_frames)
        wv.dj_track = [(detected_samples[i].t, box) for i, box in dj_pairs]
        wv.dj_track_ratio = len(dj_pairs) / len(detected_frames)
        wv.dj_face_bias_y = _face_bias_y(dj_pairs, faces_by_box_id)

        wv.dancer_box, dancer_pairs = _pick_dancer_track(
            other_tracks, len(detected_frames)
        )
        wv.dancer_track = [(detected_samples[i].t, box) for i, box in dancer_pairs]
        wv.dancer_face_bias_y = _face_bias_y(dancer_pairs, faces_by_box_id)

        # Público: frames com 3+ pessoas além do DJ. O box do público é a
        # mediana do bounding box do cluster nesses frames.
        crowd_counts = [len(r) for r in rest]
        crowd_frames = [r for r in rest if len(r) >= 3]
        if crowd_counts:
            wv.crowd_score = float(
                np.clip(np.median(crowd_counts) / CROWD_REF, 0.0, 1.0)
            )
        if crowd_frames:
            hulls = []
            for persons in crowd_frames:
                x0 = min(b.cx - b.w / 2 for b in persons)
                x1 = max(b.cx + b.w / 2 for b in persons)
                y0 = min(b.cy - b.h / 2 for b in persons)
                y1 = max(b.cy + b.h / 2 for b in persons)
                hulls.append(
                    Box(cx=(x0 + x1) / 2, cy=(y0 + y1) / 2, w=x1 - x0, h=y1 - y0, conf=1.0)
                )
            wv.crowd_box = _median_box(hulls)

        wv.visual_score = float(
            np.clip(
                0.5 * wv.motion_score
                + 0.25 * wv.presence_ratio
                + 0.25 * wv.crowd_score,
                0.0,
                1.0,
            )
        )
    else:
        wv.visual_score = wv.motion_score
    return wv


def get_beat_times(
    video_path: str,
    start_sec: float,
    duration: float,
    bpm_hint: int = 0,
) -> list[float]:
    """Instantes dos beats (s, relativos à janela) via ``librosa.beat_track``.

    Extrai só o áudio da janela (mono 22.05 kHz) — custo desprezível para
    60–75 s. Lista vazia se não detectar beats (o chamador usa grade fixa).
    """
    import librosa
    import soundfile as sf

    fd, wav_path = tempfile.mkstemp(suffix=".wav")
    os.close(fd)
    try:
        cmd = [
            "ffmpeg",
            "-y",
            "-v", "error",
            "-ss", str(max(0.0, start_sec)),
            "-i", video_path,
            "-t", str(duration),
            "-vn",
            "-ac", "1",
            "-ar", "22050",
            "-c:a", "pcm_s16le",
            wav_path,
        ]
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0 or not os.path.getsize(wav_path):
            return []
        y, sr = sf.read(wav_path, dtype="float32")
        if y.ndim > 1:
            y = y.mean(axis=1)
        y = np.nan_to_num(y, nan=0.0, posinf=0.0, neginf=0.0)
        _, beat_frames = librosa.beat.beat_track(
            y=y, sr=sr, start_bpm=float(bpm_hint) if bpm_hint else 120.0
        )
        times = librosa.frames_to_time(beat_frames, sr=sr)
        return [float(t) for t in np.atleast_1d(times)]
    except Exception:  # noqa: BLE001 - sem beats → grade fixa no chamador
        logger.exception("Falha ao detectar beats da janela %.1fs", start_sec)
        return []
    finally:
        if os.path.exists(wav_path):
            os.remove(wav_path)
