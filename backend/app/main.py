"""Worker FastAPI do DjViral — processa um set já enviado ao Supabase Storage.

Este serviço roda fora da Vercel (ex.: Railway), onde há FFmpeg, memória e tempo
suficientes. A Vercel (orquestração) dispara o processamento via POST /process,
autenticando com o header X-Worker-Secret. O vídeo já foi enviado pelo navegador
direto ao Supabase Storage; aqui apenas baixamos e processamos.

O processamento em si não roda no request: o ``/process`` enfileira um job na
tabela ``jobs`` e as threads consumidoras (ver :mod:`app.jobs`) o executam.
"""
import logging
from contextlib import asynccontextmanager

from fastapi import BackgroundTasks, FastAPI, Header, HTTPException

from . import jobs
from .config import settings
from . import ai_director
from .pipeline import process_project, run_job
from .schemas import ProcessRequest, ProjectCreated, StyleFromTextRequest

logging.basicConfig(level=logging.INFO)
# O cliente HTTP loga cada request em INFO — o polling da fila viraria ruído.
logging.getLogger("httpx").setLevel(logging.WARNING)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    jobs.start_workers(run_job)
    yield
    jobs.stop_workers()


app = FastAPI(
    title="DjViral Worker",
    description="Gera cortes virais de sets de DJ",
    lifespan=lifespan,
)


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.post("/process", response_model=ProjectCreated, status_code=202)
def process(
    body: ProcessRequest,
    background_tasks: BackgroundTasks,
    x_worker_secret: str = Header(default=""),
) -> ProjectCreated:
    """Dispara o processamento de um projeto cujo vídeo já está no Storage.

    Exige o header ``X-Worker-Secret`` (segredo compartilhado com a Vercel).
    Responde 202 imediatamente: o job vai para a fila durável e é executado
    por uma thread consumidora. Se a fila estiver indisponível (migração
    ``jobs`` não aplicada), cai no ``BackgroundTasks`` em memória de antes.
    """
    if not settings.worker_secret or x_worker_secret != settings.worker_secret:
        raise HTTPException(status_code=401, detail="Segredo inválido")

    payload = body.model_dump(exclude={"project_id"})
    if settings.job_queue_enabled and jobs.enqueue(body.project_id, payload):
        return ProjectCreated(project_id=body.project_id, status="processing")

    background_tasks.add_task(
        process_project,
        body.project_id,
        body.limit_seconds,
        body.max_cuts,
        body.cut_style,
        body.ai_tier,
        body.cut_intensity,
        body.edit_style,
    )
    return ProjectCreated(project_id=body.project_id, status="processing")


@app.post("/styles/generate")
def generate_style(
    body: StyleFromTextRequest,
    x_worker_secret: str = Header(default=""),
) -> dict:
    """Estilo de edição escrito pela IA a partir da descrição do usuário.

    Síncrono (uma chamada curta à IA): devolve ``{"name", "style"}`` pronto
    para o frontend salvar. 503 quando a IA está indisponível ou não devolveu
    um estilo válido — o frontend mostra o erro e o usuário monta à mão.
    """
    if not settings.worker_secret or x_worker_secret != settings.worker_secret:
        raise HTTPException(status_code=401, detail="Segredo inválido")
    result = ai_director.style_from_description(body.description)
    if result is None:
        raise HTTPException(status_code=503, detail="IA indisponível")
    return result
