"""Fila durável de jobs, guardada no Postgres do Supabase (tabela ``jobs``).

Substitui o ``BackgroundTasks`` do FastAPI, que vivia só na memória do
processo: um redeploy ou crash do container perdia o job e deixava o projeto
preso em ``processing`` para sempre. Aqui:

- ``POST /process`` só INSERE uma linha ``queued`` (:func:`enqueue`) e responde;
- threads consumidoras (:func:`start_workers`, uma por ``MAX_CONCURRENT_JOBS``)
  pegam o job mais antigo com a função SQL ``claim_job`` — um único UPDATE com
  ``FOR UPDATE SKIP LOCKED``, então dois workers nunca pegam o mesmo job;
- enquanto roda, o job bate um heartbeat; se o worker morrer, o heartbeat
  envelhece (``JOB_STALE_SECONDS``) e o próximo ``claim_job`` devolve o job à
  fila — até ``JOB_MAX_ATTEMPTS``, depois vira ``error`` junto com o projeto.

Não precisa de infraestrutura nova (Redis etc.): usa o Postgres que o projeto
já tem. Sem a migração aplicada (tabela/função ausentes), :func:`enqueue`
devolve ``False`` e o chamador cai no ``BackgroundTasks`` de antes.
"""
import logging
import os
import socket
import threading
import uuid
from datetime import datetime, timezone
from typing import Callable

from .config import settings
from .supabase_client import get_client

logger = logging.getLogger("djviral.jobs")

# Identifica este processo nas linhas que ele pegou (diagnóstico).
WORKER_ID = f"{socket.gethostname()}-{os.getpid()}-{uuid.uuid4().hex[:6]}"

# Acorda as threads consumidoras assim que um job é enfileirado NESTE
# processo, sem esperar o próximo ciclo de polling.
_wake = threading.Event()
_stop = threading.Event()
_threads: list[threading.Thread] = []

# Quanto esperar para tentar de novo quando a fila está inacessível (migração
# ausente, Supabase fora do ar) — evita martelar o banco e o log.
_BACKOFF_SECONDS = 60.0


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def enqueue(project_id: str, payload: dict) -> bool:
    """Enfileira o processamento de um projeto. ``False`` = fila indisponível.

    Um projeto só tem um job vivo: se já existe um ``queued``/``running`` para
    ele (duplo clique, retry da Vercel), não cria outro.
    """
    try:
        client = get_client()
        live = (
            client.table("jobs")
            .select("id")
            .eq("project_id", project_id)
            .in_("status", ["queued", "running"])
            .limit(1)
            .execute()
        )
        if live.data:
            logger.info("Projeto %s já tem job na fila", project_id)
        else:
            client.table("jobs").insert(
                {"project_id": project_id, "kind": "process", "payload": payload}
            ).execute()
    except Exception:  # noqa: BLE001 - sem fila, o chamador usa o modo antigo
        logger.exception(
            "Fila indisponível (migração `jobs` aplicada?) — projeto %s vai "
            "rodar em background no próprio processo",
            project_id,
        )
        return False
    _wake.set()
    return True


def claim() -> dict | None:
    """Pega o próximo job da fila (ou ``None`` se não há nenhum)."""
    result = (
        get_client()
        .rpc(
            "claim_job",
            {
                "p_worker": WORKER_ID,
                "p_stale_seconds": settings.job_stale_seconds,
                "p_max_attempts": settings.job_max_attempts,
            },
        )
        .execute()
    )
    rows = result.data or []
    # Uma função `returns jobs` sem linha devolve um registro todo NULL.
    if isinstance(rows, dict):
        rows = [rows]
    for row in rows:
        if row and row.get("id"):
            return row
    return None


def _finish(job_id: str, ok: bool, error: str | None = None) -> None:
    """Marca o job como concluído. Só mexe se ele AINDA é deste worker — um
    job que perdemos por heartbeat velho pode já estar com outro worker."""
    try:
        get_client().table("jobs").update(
            {
                "status": "done" if ok else "error",
                "error": (error or "")[:2000] or None,
                "finished_at": _now(),
            }
        ).eq("id", job_id).eq("worker_id", WORKER_ID).eq(
            "status", "running"
        ).execute()
    except Exception:  # noqa: BLE001 - o job já rodou; não há o que desfazer
        logger.exception("Falha ao finalizar o job %s", job_id)


def _heartbeat(job_id: str, done: threading.Event) -> None:
    """Renova ``heartbeat_at`` enquanto o job roda (thread própria: o job em
    si passa minutos bloqueado em FFmpeg/análise)."""
    while not done.wait(settings.job_heartbeat_seconds):
        try:
            get_client().table("jobs").update({"heartbeat_at": _now()}).eq(
                "id", job_id
            ).eq("worker_id", WORKER_ID).eq("status", "running").execute()
        except Exception:  # noqa: BLE001 - tenta de novo no próximo ciclo
            logger.warning("Heartbeat do job %s falhou", job_id)


def run_one(handler: Callable[[dict], bool]) -> bool:
    """Pega e executa um job. Devolve ``True`` se havia job para rodar.

    ``handler(job)`` devolve ``True`` em sucesso; ``False`` ou exceção marcam o
    job como ``error``. Falha do handler NÃO re-enfileira: é erro do próprio
    set (vídeo inválido, cota estourada) e repetir daria no mesmo. Só job
    interrompido (worker morto) volta para a fila, via heartbeat velho.
    """
    job = claim()
    if job is None:
        return False

    logger.info(
        "Job %s (projeto %s, tentativa %s) iniciado",
        job["id"], job.get("project_id"), job.get("attempts"),
    )
    done = threading.Event()
    beat = threading.Thread(
        target=_heartbeat, args=(job["id"], done), daemon=True, name="job-heartbeat"
    )
    beat.start()
    ok, error = False, None
    try:
        ok = bool(handler(job))
        if not ok:
            error = "processamento falhou (ver log do worker)"
    except Exception as exc:  # noqa: BLE001 - o loop da fila nunca pode morrer
        logger.exception("Job %s falhou", job["id"])
        error = f"{type(exc).__name__}: {exc}"
    finally:
        done.set()
        _finish(job["id"], ok, error)
    return True


def _loop(handler: Callable[[dict], bool]) -> None:
    while not _stop.is_set():
        try:
            if run_one(handler):
                continue  # pode haver mais: tenta de novo sem esperar
            wait = settings.job_poll_seconds
        except Exception:  # noqa: BLE001 - fila fora do ar: espera e tenta
            logger.exception(
                "Não foi possível consultar a fila — nova tentativa em %.0fs",
                _BACKOFF_SECONDS,
            )
            wait = _BACKOFF_SECONDS
        _wake.wait(wait)
        _wake.clear()


def start_workers(handler: Callable[[dict], bool]) -> None:
    """Sobe as threads consumidoras (idempotente). Sem credenciais do Supabase
    (testes, dev sem .env) não sobe nada."""
    if _threads or not settings.job_queue_enabled:
        return
    if not settings.supabase_url or not settings.supabase_key:
        logger.warning("Fila de jobs desligada: Supabase não configurado")
        return
    _stop.clear()
    for i in range(max(1, settings.max_concurrent_jobs)):
        thread = threading.Thread(
            target=_loop, args=(handler,), daemon=True, name=f"job-worker-{i}"
        )
        thread.start()
        _threads.append(thread)
    logger.info("Fila de jobs: %d consumidor(es) como %s", len(_threads), WORKER_ID)


def stop_workers() -> None:
    """Pede para as threads pararem de pegar jobs novos (shutdown). Um job em
    andamento é interrompido pelo fim do processo e volta à fila pelo
    heartbeat."""
    _stop.set()
    _wake.set()
    _threads.clear()
