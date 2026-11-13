"""Orquestra o processamento de um projeto: analisa → corta → sobe → persiste."""
import json
import logging
import os
import subprocess
import tempfile
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from concurrent.futures import TimeoutError as FuturesTimeout

from . import ai_director, analyzer, clipper, dynamic, visual, youtube
from . import style as style_mod
from .analyzer import Peak
from .config import settings
from .supabase_client import download_source, get_client, upload_clip
from .visual import WindowVisual

logger = logging.getLogger("djviral.pipeline")


class PlanLimitExceeded(RuntimeError):
    """O vídeo é mais longo do que a cota restante do plano do usuário."""


def probe_duration(path: str) -> float:
    """Duração real do vídeo em segundos, via ffprobe (0.0 se indisponível)."""
    result = subprocess.run(
        [
            "ffprobe",
            "-v", "error",
            "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1",
            path,
        ],
        capture_output=True,
        text=True,
    )
    try:
        return float(result.stdout.strip())
    except ValueError:
        logger.warning("ffprobe não conseguiu medir %s: %s", path, result.stderr[-500:])
        return 0.0


def probe_video(path: str) -> dict:
    """Dimensões e fps do stream de vídeo (para o corte dinâmico).

    Retorna ``{"width", "height", "fps"}``; zeros/default se o ffprobe falhar
    (o chamador cai para o corte seco).
    """
    result = subprocess.run(
        [
            "ffprobe",
            "-v", "error",
            "-select_streams", "v:0",
            "-show_entries", "stream=width,height,avg_frame_rate",
            "-of", "json",
            path,
        ],
        capture_output=True,
        text=True,
    )
    info = {"width": 0, "height": 0, "fps": 30.0}
    try:
        stream = json.loads(result.stdout)["streams"][0]
        info["width"] = int(stream.get("width") or 0)
        info["height"] = int(stream.get("height") or 0)
        rate = stream.get("avg_frame_rate") or "0/1"
        num, _, den = rate.partition("/")
        if float(den or 1) > 0 and float(num) > 0:
            info["fps"] = float(num) / float(den or 1)
    except (KeyError, IndexError, ValueError, json.JSONDecodeError):
        logger.warning("ffprobe não achou o stream de vídeo de %s", path)
    return info

# Limita quantos jobs pesados (download de GB + análise + FFmpeg) rodam ao
# mesmo tempo neste processo. Com a fila durável (jobs.py) o limite já vem do
# nº de threads consumidoras; o semáforo continua valendo para o modo antigo
# (BackgroundTasks, quando a fila está indisponível) e cobre os dois juntos.
_job_slots = threading.BoundedSemaphore(settings.max_concurrent_jobs)


def _fetch_source(client, project_id: str, limit_seconds: int | None = None) -> str:
    """Baixa o vídeo original do projeto e retorna o caminho local.

    A linha ``sources`` diz a origem: ``source_type='youtube'`` guarda a URL
    do vídeo (baixada via yt-dlp); caso contrário ``url`` é o caminho no
    Storage do Supabase.

    ``limit_seconds`` (cota restante do plano) aperta o teto de duração do
    YouTube, evitando baixar um vídeo que seria rejeitado em seguida.
    """
    source = (
        client.table("sources")
        .select("url, source_type")
        .eq("project_id", project_id)
        .limit(1)
        .execute()
    )
    if not source.data or not source.data[0].get("url"):
        raise RuntimeError(
            f"Nenhum source com origem de vídeo para o projeto {project_id}"
        )
    row = source.data[0]
    max_duration = settings.max_source_duration
    if limit_seconds is not None:
        max_duration = min(max_duration, limit_seconds)
    if row.get("source_type") == "youtube":
        return youtube.download_youtube(row["url"], max_duration)
    return download_source(row["url"])


def process_project(
    project_id: str,
    limit_seconds: int | None = None,
    max_cuts: int | None = None,
    cut_style: str = "basic",
    ai_tier: str = "off",
    cut_intensity: str = "medium",
    edit_style: dict | None = None,
    retry: bool = False,
) -> bool:
    """Pipeline completo, rodado em background. Devolve ``True`` em sucesso.

    Baixa o vídeo original (Supabase Storage ou YouTube, conforme a linha
    ``source`` do projeto), analisa o áudio, corta os top picos em clipes,
    sobe cada clipe no Storage e grava os registros ``cuts``. Em caso de erro,
    marca o projeto como ``error``. Sempre remove o arquivo temporário ao final.

    ``limit_seconds`` e ``max_cuts`` são os limites do plano do usuário
    (enviados pela Vercel): a duração real do vídeo é medida com ffprobe e o
    processamento é abortado se estourar a cota; ``max_cuts`` reduz o número
    de clipes gerados (ex.: 10 no teste grátis). ``cut_style`` é a escolha do
    usuário na criação do projeto: 'basic' (corte seco) ou 'dynamic' (zooms no
    DJ/público no ritmo da batida). ``ai_tier`` liga a camada de IA de visão
    (enviado pela Vercel conforme o plano): 'off' (sem IA), 'lite' (triagem que
    re-ranqueia todos os candidatos + títulos virais, só Haiku — plano free) ou
    'full' ('lite' + direção profunda que dirige os zooms, Sonnet no top-K —
    planos pagos). Qualquer nível degrada para a heurística local sem chave.
    ``cut_intensity`` ('subtle'|'medium'|'intense') controla a agressividade do
    corte dinâmico (nº de trocas, força dos zooms, beat-punch); só relevante
    quando ``cut_style='dynamic'``. ``edit_style`` é o estilo de edição do
    projeto (JSON de :class:`app.style.EditStyle`: cor, transições, efeitos,
    legendas), aplicado sobre cada clipe pronto; ``None`` = sem estilo.
    ``retry`` indica que o job está sendo RETOMADO depois de um worker morrer
    no meio: os cortes parciais da tentativa anterior são apagados antes, para
    não duplicar.
    """
    with _job_slots:
        return _process_project(
            project_id, limit_seconds, max_cuts, cut_style, ai_tier, cut_intensity,
            edit_style, retry,
        )


def run_job(job: dict) -> bool:
    """Handler da fila (:mod:`app.jobs`): executa um job ``process``.

    Os parâmetros do processamento viajam no ``payload`` da linha ``jobs``
    (gravado pelo ``POST /process``). ``attempts`` > 1 = o job foi retomado.
    """
    payload = job.get("payload") or {}
    return process_project(
        job["project_id"],
        payload.get("limit_seconds"),
        payload.get("max_cuts"),
        payload.get("cut_style") or "basic",
        payload.get("ai_tier") or "off",
        payload.get("cut_intensity") or "medium",
        payload.get("edit_style"),
        retry=int(job.get("attempts") or 1) > 1,
    )


def _process_project(
    project_id: str,
    limit_seconds: int | None = None,
    max_cuts: int | None = None,
    cut_style: str = "basic",
    ai_tier: str = "off",
    cut_intensity: str = "medium",
    edit_style: dict | None = None,
    retry: bool = False,
) -> bool:
    client = get_client()
    video_path: str | None = None
    try:
        if retry:
            # Tentativa anterior morreu no meio: descarta o que ela já tinha
            # gravado (os arquivos de clipe são sobrescritos pelo upsert).
            client.table("cuts").delete().eq("project_id", project_id).execute()
            logger.info("Projeto %s: retomando job interrompido", project_id)

        video_path = _fetch_source(client, project_id, limit_seconds)
        logger.info("Projeto %s: vídeo baixado para %s", project_id, video_path)

        # Duração real do vídeo: persiste em sources.duracao (é ela que conta
        # na cota do plano — corrige a duração estimada pelo navegador) e
        # barra sets maiores que a cota restante.
        duration = round(probe_duration(video_path))
        if duration > 0:
            client.table("sources").update({"duracao": duration}).eq(
                "project_id", project_id
            ).execute()
        if limit_seconds is not None and duration > limit_seconds:
            raise PlanLimitExceeded(
                f"Vídeo com {duration:.0f}s excede a cota restante do plano "
                f"({limit_seconds}s)"
            )

        # O áudio gera MAIS candidatos do que o pedido; a análise visual
        # re-ranqueia (score musical + visual) e ficam os n_final melhores.
        n_final = max(
            1, settings.top_n if max_cuts is None else min(settings.top_n, max_cuts)
        )
        n_cand = n_final
        if settings.visual_enabled:
            n_cand = max(
                n_final,
                min(
                    n_final * settings.visual_candidates_factor,
                    settings.visual_candidates_cap,
                ),
            )
        peaks, bpm = analyzer.analyze(video_path, top_n=n_cand)
        logger.info(
            "Projeto %s: %d picos candidatos (%d BPM)", project_id, len(peaks), bpm
        )

        candidates = _score_candidates(
            video_path, peaks, cut_style, ai_tier
        )[:n_final]

        # Títulos/hooks virais (IA barata) para os cortes JÁ selecionados —
        # roda em qualquer tier com IA ligada (inclusive 'lite'/free). Sem IA
        # (ou falha), cada corte cai no título heurístico "Drop N · BPM".
        titles = _generate_titles(video_path, candidates, ai_tier)

        src_dims = probe_video(video_path) if cut_style == "dynamic" else None
        # Revisão do render pela IA: só no tier 'full' (mesmo nível da direção
        # profunda) e só faz sentido no corte dinâmico.
        _, deep_on = _ai_flags(ai_tier)
        review = deep_on and settings.ai_review_enabled
        # Estilo de edição (efeitos/transições/legendas): saneado uma vez; a
        # intensidade de câmera do estilo, quando definida, vence a do projeto.
        style = style_mod.coerce_style(edit_style)
        if style is not None and style.intensity:
            cut_intensity = style.intensity

        for idx, (peak, wv, ai, final_score) in enumerate(candidates):
            with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as tmp:
                clip_path = tmp.name
            try:
                shots, beats = _render_clip(
                    video_path, peak, wv, cut_style, clip_path, src_dims, bpm,
                    ai, cut_intensity, review,
                )
                clip_start = max(0.0, peak.start_sec - settings.pre_roll)
                _apply_edit_style(
                    video_path,
                    clip_path,
                    style,
                    clip_start,
                    float(settings.clip_duration),
                    shots=shots,
                    beats=beats,
                    drop=peak.start_sec - clip_start,
                    bpm=bpm,
                    # Só um título de verdade (IA) vira legenda — o fallback
                    # "Drop N · BPM" não é um gancho.
                    title=titles.get(id(peak)),
                    label=f"clipe {peak.start_sec:.1f}s",
                )

                dest_name = f"{project_id}/clipe_{idx + 1}_{int(peak.start_sec)}s.mp4"
                url = upload_clip(clip_path, dest_name)

                start = max(0.0, peak.start_sec - settings.pre_roll)
                titulo = titles.get(id(peak)) or f"Drop {idx + 1} · {bpm} BPM"
                _insert_cut(
                    client,
                    {
                        "project_id": project_id,
                        "titulo": titulo,
                        "inicio": start,
                        "fim": start + settings.clip_duration,
                        "duracao": settings.clip_duration,
                        "score": final_score,
                        "score_musical": peak.score,
                        "score_visual": wv.visual_score if wv is not None else None,
                        "score_hype": ai.hype_score if ai is not None else None,
                        "bpm": bpm,
                        "url": url,
                    },
                )
            finally:
                if os.path.exists(clip_path):
                    os.remove(clip_path)

        client.table("projects").update({"status": "done"}).eq(
            "id", project_id
        ).execute()
        if ai_tier != "off":
            usage = ai_director.get_usage()
            logger.info(
                "Projeto %s: custo total estimado de IA ~$%.4f (%d chamadas)",
                project_id, usage["usd"], usage["calls"],
            )
        logger.info("Projeto %s concluído", project_id)
        return True

    except Exception:  # noqa: BLE001 - queremos registrar qualquer falha
        logger.exception("Falha ao processar projeto %s", project_id)
        client.table("projects").update({"status": "error"}).eq(
            "id", project_id
        ).execute()
        return False
    finally:
        if video_path and os.path.exists(video_path):
            os.remove(video_path)


# Colunas de ``cuts`` adicionadas por migrações posteriores: se o banco ainda
# não as aplicou, o PostgREST rejeita a coluna e reinserimos sem ela em vez de
# perder o corte.
_OPTIONAL_CUT_COLUMNS = ("score_hype", "bpm")


def _insert_cut(client, row: dict) -> None:
    """Insere um ``cut``, tolerando bancos sem as colunas opcionais recentes.

    ``score_hype`` (diretor de IA) e ``bpm`` (título viral) foram adicionadas
    depois; se o banco ainda não aplicou a migração, o PostgREST rejeita a
    coluna — nesse caso reinserimos sem as opcionais em vez de derrubar o job.
    """
    try:
        client.table("cuts").insert(row).execute()
    except Exception:  # noqa: BLE001 - coluna ausente não deve perder o corte
        optional = [c for c in _OPTIONAL_CUT_COLUMNS if c in row]
        if not optional:
            raise
        logger.warning(
            "Insert de cut falhou; tentando sem colunas opcionais %s "
            "(migração ausente?)",
            optional,
        )
        client.table("cuts").insert(
            {k: v for k, v in row.items() if k not in _OPTIONAL_CUT_COLUMNS}
        ).execute()


def _ai_flags(ai_tier: str) -> tuple[bool, bool]:
    """Traduz o ``ai_tier`` em ``(triagem ligada, direção profunda ligada)``.

    Ambas exigem o diretor habilitado e uma ``ANTHROPIC_API_KEY``. 'lite' liga
    só a triagem (barata: re-rank de todos os candidatos + títulos); 'full'
    liga também a direção profunda (Sonnet no top-K). 'off' desliga tudo.
    """
    on = settings.ai_director_enabled and bool(settings.anthropic_api_key)
    triage_on = on and ai_tier in ("lite", "full")
    deep_on = on and ai_tier == "full"
    return triage_on, deep_on


def _generate_titles(
    video_path: str,
    candidates: list[tuple[Peak, WindowVisual | None, "ai_director.AIDirection | None", float]],
    ai_tier: str,
) -> dict[int, str]:
    """Gera títulos/hooks virais (IA barata) para os cortes já selecionados.

    Roda em qualquer tier com IA ligada (inclusive 'lite'/free), pois usa só o
    modelo de triagem. Devolve ``{id(peak): título}``; cortes sem título ficam
    de fora e o chamador usa o heurístico. Nunca derruba o job.
    """
    triage_on, _ = _ai_flags(ai_tier)
    if not triage_on or not candidates:
        return {}
    windows = [
        (
            id(peak),
            max(0.0, peak.start_sec - settings.pre_roll),
            float(settings.clip_duration),
        )
        for peak, _wv, _ai, _score in candidates
    ]
    titles = ai_director.title_group(video_path, windows)
    logger.info("Títulos de IA: %d/%d cortes com hook", len(titles), len(candidates))
    return titles


def _score_candidates(
    video_path: str,
    peaks: list[Peak],
    cut_style: str,
    ai_tier: str = "off",
) -> list[tuple[Peak, WindowVisual | None, "ai_director.AIDirection | None", float]]:
    """Roda a análise das janelas candidatas e re-ranqueia.

    Quatro etapas:
    1. Score LOCAL por janela = ``score_music_weight * musical + (1 - peso) *
       visual`` (áudio + YOLO), como antes. Janela sem análise visual (visual
       desligado, budget estourado ou erro) fica só com o score musical.
    2. Se o tier liga a triagem ('lite'/'full'), a TRIAGEM da IA roda em lotes
       cobrindo TODOS os candidatos (barata: poucos keyframes pequenos, várias
       janelas por chamada) e ajusta o score: ``adjusted = (1-w1)*base +
       w1*hype_lite``. Diferente da direção profunda, isto nunca corta
       candidatos por um top-K — só reordena.
    3. Só no tier 'full', a DIREÇÃO PROFUNDA da IA roda nas TOP-K janelas pelo
       score AJUSTADO (teto ``ai_director_max_calls`` + budget de tempo
       próprio); o hype profundo refina o score final: ``final = (1-w2)*
       adjusted + w2*hype``.
    4. Sem IA (tier 'off' ou sem chave), o score final é o local de sempre.

    Nenhuma das fases (visual, triagem, direção) derruba o job.
    """
    if not settings.visual_enabled or not peaks:
        return [(peak, None, None, peak.score) for peak in peaks]

    net = visual.load_model()
    net_face = visual.load_face_model() if cut_style == "dynamic" else None
    if cut_style == "dynamic":
        detect_every = settings.visual_detect_every
    else:
        detect_every = max(1, int(8 * settings.visual_fps))  # ~1 detecção/8s
    deadline = time.monotonic() + settings.visual_budget_seconds
    w_music = settings.score_music_weight

    # ---- 1) score local (áudio + YOLO) ----
    scored: list[tuple[Peak, WindowVisual | None, float]] = []
    for peak in peaks:
        wv: WindowVisual | None = None
        if time.monotonic() < deadline:
            try:
                wv = visual.analyze_window(
                    video_path,
                    max(0.0, peak.start_sec - settings.pre_roll),
                    float(settings.clip_duration),
                    net=net,
                    detect_every=detect_every,
                    fps=settings.visual_fps,
                    net_face=net_face,
                )
            except Exception:  # noqa: BLE001 - análise visual nunca é fatal
                logger.exception(
                    "Análise visual falhou na janela %.1fs", peak.start_sec
                )
        elif not scored or scored[-1][1] is not None:
            logger.warning(
                "Budget visual (%ss) estourado — janelas restantes só com "
                "score musical",
                settings.visual_budget_seconds,
            )
        base = (
            w_music * peak.score + (1 - w_music) * wv.visual_score
            if wv is not None
            else peak.score
        )
        scored.append((peak, wv, base))

    triage_on, deep_on = _ai_flags(ai_tier)
    if triage_on:
        ai_director.reset_usage()

    # ---- 2) triagem da IA em TODOS os candidatos (opcional, barata) ----
    adjusted_map: dict[int, float] = {id(peak): base for peak, _wv, base in scored}
    if triage_on and settings.ai_triage_group_size > 0:
        triage_deadline = time.monotonic() + settings.ai_triage_budget_seconds
        w1 = min(1.0, max(0.0, settings.score_hype_lite_weight))
        group_size = max(1, settings.ai_triage_group_size)
        n_triaged = 0
        for i in range(0, len(scored), group_size):
            if time.monotonic() >= triage_deadline:
                logger.warning(
                    "Budget de triagem de IA (%ss) estourado — candidatos "
                    "restantes ficam só com o score local",
                    settings.ai_triage_budget_seconds,
                )
                break
            group = scored[i : i + group_size]
            windows = [
                (
                    id(peak),
                    max(0.0, peak.start_sec - settings.pre_roll),
                    float(settings.clip_duration),
                )
                for peak, _wv, _base in group
            ]
            triage_map = ai_director.triage_group(video_path, windows)
            for peak, _wv, base in group:
                triage = triage_map.get(id(peak))
                if triage is not None:
                    n_triaged += 1
                    adjusted_map[id(peak)] = (1 - w1) * base + w1 * triage.hype
        logger.info("Triagem de IA: %d/%d janelas avaliadas", n_triaged, len(scored))

    # ---- 3) direção profunda da IA nas top-K janelas pelo score ajustado ----
    ai_map: dict[int, "ai_director.AIDirection"] = {}
    if deep_on:
        ai_deadline = time.monotonic() + settings.ai_director_budget_seconds
        ordered = sorted(scored, key=lambda it: adjusted_map[id(it[0])], reverse=True)
        top = ordered[: max(0, settings.ai_director_max_calls)]
        calls = len(top)
        # As chamadas são I/O (rede) — rodam em paralelo num pool pequeno para
        # caber mais direções no mesmo budget de tempo. Estourou o budget, as
        # que ainda não começaram são canceladas e as em andamento ignoradas
        # (essas janelas ficam só com o score ajustado da triagem).
        pool = ThreadPoolExecutor(
            max_workers=max(1, settings.ai_director_concurrency)
        )
        try:
            futures = {
                pool.submit(
                    ai_director.direct,
                    video_path,
                    max(0.0, peak.start_sec - settings.pre_roll),
                    float(settings.clip_duration),
                    wv,
                ): peak
                for peak, wv, _base in top
            }
            try:
                for fut in as_completed(
                    futures, timeout=max(0.0, ai_deadline - time.monotonic())
                ):
                    try:
                        ai = fut.result()
                    except Exception:  # noqa: BLE001 - direção nunca é fatal
                        logger.exception("Direção de IA falhou numa janela")
                        continue
                    if ai is not None:
                        ai_map[id(futures[fut])] = ai
            except FuturesTimeout:
                logger.warning(
                    "Budget da direção de IA (%ss) estourado — janelas "
                    "restantes ficam só com o score ajustado",
                    settings.ai_director_budget_seconds,
                )
        finally:
            pool.shutdown(wait=False, cancel_futures=True)
        usage = ai_director.get_usage()
        logger.info(
            "Diretor de IA: %d chamadas de direção, %d direções aproveitadas, "
            "custo estimado do job ~$%.4f (%d chamadas no total)",
            calls, len(ai_map), usage["usd"], usage["calls"],
        )

    # ---- 4) score final (ajustado + hype profundo) e re-rank ----
    w2 = min(1.0, max(0.0, settings.score_hype_weight))
    result: list[tuple[Peak, WindowVisual | None, "ai_director.AIDirection | None", float]] = []
    for peak, wv, _base in scored:
        adjusted = adjusted_map[id(peak)]
        ai = ai_map.get(id(peak))
        final = (1 - w2) * adjusted + w2 * ai.hype_score if ai is not None else adjusted
        result.append((peak, wv, ai, final))

    result.sort(key=lambda item: item[3], reverse=True)
    return result


def _cut_dynamic_tiered(
    video_path: str,
    start_sec: float,
    clip_path: str,
    shots: list[dynamic.Shot],
    duration: int,
    pre_roll: int,
    fps: float,
    label: str,
) -> bool:
    """Tenta o corte dinâmico em 2 níveis: com zoom-drift, depois sem.

    O 2º nível (``force_static=True``) usa o MESMO shot plan (mesmos
    cortes/tempos/beats), só sem zoompan/supersample — bem mais leve em
    CPU/memória. Preserva a alternância wide/zoom no beat (o essencial do
    estilo "dinâmico") mesmo quando só a parte pesada falha. Devolve
    ``False`` se as duas tentativas falharem (o chamador cai pro corte seco).
    """
    try:
        clipper.cut_dynamic(
            input_file=video_path,
            start_sec=start_sec,
            output_path=clip_path,
            shots=shots,
            duration=duration,
            pre_roll=pre_roll,
            fps=fps,
        )
        return True
    except Exception:  # noqa: BLE001 - tenta o nível mais leve antes do seco
        logger.exception(
            "%s: corte dinâmico com zoom falhou — tentando sem zoompan", label
        )

    try:
        clipper.cut_dynamic(
            input_file=video_path,
            start_sec=start_sec,
            output_path=clip_path,
            shots=shots,
            duration=duration,
            pre_roll=pre_roll,
            fps=fps,
            force_static=True,
        )
        return True
    except Exception:  # noqa: BLE001 - último nível antes do corte seco
        logger.exception(
            "%s: corte dinâmico sem zoompan também falhou — usando corte seco",
            label,
        )
    return False


def _review_and_fix(
    video_path: str,
    peak: Peak,
    clip_path: str,
    shots: list[dynamic.Shot],
    src_dims: dict,
) -> list[dynamic.Shot]:
    """Revisão do clipe dinâmico PRONTO pela IA + um re-render de conserto.

    O shot plan é montado sem ver o resultado; aqui a IA "assiste" o clipe
    (1 frame por shot fechado) e aponta os enquadramentos que falharam. Esses
    shots viram wide (``dynamic.widen_shots``) e o clipe é re-renderizado UMA
    vez num arquivo à parte, que só substitui o original se o render der
    certo — qualquer falha (revisão ou re-render) mantém o clipe original.
    Devolve o shot plan que de fato está no arquivo final.
    """
    try:
        bad = ai_director.review_render(clip_path, shots)
        if not bad:
            return shots
        label = f"clipe {peak.start_sec:.1f}s (pós-revisão)"
        logger.info(
            "%s: revisão reprovou %d/%d shots — re-renderizando com wide",
            label, len(bad), len(shots),
        )
        fixed = dynamic.widen_shots(
            shots, bad, src_dims["width"], src_dims["height"]
        )
        fixed_path = clip_path + ".fix.mp4"
        try:
            if _cut_dynamic_tiered(
                video_path,
                peak.start_sec,
                fixed_path,
                fixed,
                settings.clip_duration,
                settings.pre_roll,
                src_dims["fps"],
                label=label,
            ):
                os.replace(fixed_path, clip_path)
                return fixed
        finally:
            if os.path.exists(fixed_path):
                os.remove(fixed_path)
    except Exception:  # noqa: BLE001 - a revisão nunca derruba/perde o clipe
        logger.exception("Revisão do clipe %.1fs falhou", peak.start_sec)
    return shots


def _apply_edit_style(
    video_path: str,
    clip_path: str,
    style: "style_mod.EditStyle | None",
    start: float,
    duration: float,
    shots: list[dynamic.Shot] | None = None,
    beats: list[float] | None = None,
    drop: float | None = None,
    bpm: int = 0,
    title: str | None = None,
    label: str = "clipe",
) -> None:
    """Aplica o estilo de edição do projeto sobre o clipe pronto (2º passe).

    ``shots`` (corte dinâmico) dá os instantes de troca para as transições;
    ``drop`` o instante do pico; ``beats``/``bpm`` a grade de batidas (se o
    estilo pulsa na batida e não há ``beats``, detecta agora). O resultado vai
    para um arquivo à parte que só substitui o clipe se o FFmpeg der certo —
    qualquer falha mantém o clipe sem estilo (nunca perde o corte).
    """
    if style is None or not settings.edit_style_enabled or style.is_noop():
        return
    styled_path = clip_path + ".style.mp4"
    try:
        if not beats and style.beat_pulse > 0:
            try:
                beats = visual.get_beat_times(video_path, start, duration, bpm)
            except Exception:  # noqa: BLE001 - sem beats → grade pelo BPM
                logger.exception("%s: falha ao detectar beats para o estilo", label)
        period, phase = 0.0, 0.0
        if beats and len(beats) >= 3:
            gaps = sorted(b - a for a, b in zip(beats, beats[1:]))
            period, phase = gaps[len(gaps) // 2], beats[0]
        elif bpm > 0:
            period = 60.0 / bpm
        ctx = style_mod.StyleContext(
            duration=duration,
            cuts=[sh.t0 for sh in shots[1:]] if shots else [],
            drop=drop,
            beat_period=period,
            beat_phase=phase,
        )
        if clipper.apply_style(clip_path, styled_path, style, ctx, title):
            os.replace(styled_path, clip_path)
    except Exception:  # noqa: BLE001 - o estilo nunca derruba/perde o clipe
        logger.exception("%s: estilo de edição falhou — mantendo sem estilo", label)
    finally:
        if os.path.exists(styled_path):
            os.remove(styled_path)


def _render_clip(
    video_path: str,
    peak: Peak,
    wv: WindowVisual | None,
    cut_style: str,
    clip_path: str,
    src_dims: dict | None,
    bpm: int,
    ai: "ai_director.AIDirection | None" = None,
    cut_intensity: str = "medium",
    review: bool = False,
) -> tuple[list[dynamic.Shot] | None, list[float] | None]:
    """Renderiza um clipe no estilo pedido, com fallback para o corte seco.

    O corte dinâmico exige as dimensões da fonte e vale a pena quando há
    gente detectada OU movimento na cena; janela parada e vazia fica no corte
    seco (zoom no nada só chama atenção para o vazio). ``ai`` (do diretor de IA,
    quando disponível) dirige o enquadramento no shot plan — inclusive com os
    boxes de enquadramento dela quando o YOLO não achou ninguém — e pode marcar
    a cena como ``worthy=False`` (força corte seco). Qualquer erro do render
    dinâmico cai para o corte seco — o clipe nunca é perdido. ``review``
    liga a revisão do clipe pronto pela IA (ver :func:`_review_and_fix`).

    Devolve ``(shots, beats)`` do render dinâmico que ficou no arquivo — ou
    ``(None, None)`` no corte seco — para o estilo de edição saber onde estão
    as trocas de shot e as batidas.
    """
    start = max(0.0, peak.start_sec - settings.pre_roll)
    if cut_style == "dynamic" and src_dims and src_dims["width"] and src_dims["height"]:
        # Detecção rodou, não achou ninguém e a cena está parada → seco... a
        # menos que a IA tenha visto o DJ onde o YOLO falhou (cena escura); e a
        # IA também pode declarar a cena "não digna" de zooms (worthy=False).
        boring = (
            wv is not None
            and wv.detected
            and wv.dj_box is None
            and wv.motion_score < 0.1
            and (ai is None or ai.dj_box is None)
        ) or (ai is not None and not ai.worthy)
        if not boring:
            shots = None
            beats = None
            try:
                beats = visual.get_beat_times(
                    video_path, start, float(settings.clip_duration), bpm
                )
                shots = dynamic.build_shot_plan(
                    wv,
                    beats,
                    float(settings.clip_duration),
                    src_dims["width"],
                    src_dims["height"],
                    peak_at=peak.start_sec - start,
                    ai=ai,
                    intensity=cut_intensity,
                )
            except Exception:  # noqa: BLE001 - sem shot plan, cai pro seco
                logger.exception(
                    "Falha ao montar o shot plan em %.1fs", peak.start_sec
                )
            if shots and _cut_dynamic_tiered(
                video_path,
                peak.start_sec,
                clip_path,
                shots,
                settings.clip_duration,
                settings.pre_roll,
                src_dims["fps"],
                label=f"clipe {peak.start_sec:.1f}s",
            ):
                if review:
                    shots = _review_and_fix(
                        video_path, peak, clip_path, shots, src_dims
                    )
                return shots, beats

    clipper.cut(
        input_file=video_path,
        start_sec=peak.start_sec,
        output_path=clip_path,
        duration=settings.clip_duration,
        pre_roll=settings.pre_roll,
    )
    return None, None
