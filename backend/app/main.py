"""Worker FastAPI do DjViral — processa um set já enviado ao Supabase Storage.

Este serviço roda fora da Vercel (ex.: Railway), onde há FFmpeg, memória e tempo
suficientes. A Vercel (orquestração) dispara o processamento via POST /process,
autenticando com o header X-Worker-Secret. O vídeo já foi enviado pelo navegador
direto ao Supabase Storage; aqui apenas baixamos e processamos.
"""
from fastapi import BackgroundTasks, FastAPI, Header, HTTPException

from .config import settings
from .pipeline import process_project, recut_cut
from .schemas import ProcessRequest, ProjectCreated, RecutRequest

app = FastAPI(title="DjViral Worker", description="Gera cortes virais de sets de DJ")


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
    Responde 202 imediatamente e processa em background.
    """
    if not settings.worker_secret or x_worker_secret != settings.worker_secret:
        raise HTTPException(status_code=401, detail="Segredo inválido")

    background_tasks.add_task(process_project, body.project_id)
    return ProjectCreated(project_id=body.project_id, status="processing")


@app.post("/recut", response_model=ProjectCreated, status_code=202)
def recut(
    body: RecutRequest,
    background_tasks: BackgroundTasks,
    x_worker_secret: str = Header(default=""),
) -> ProjectCreated:
    """Re-corta um clipe existente com novo início/fim, regenerando o vídeo.

    Mesmo esquema de segurança do ``/process``: exige ``X-Worker-Secret`` e
    processa em background (re-encode FFmpeg). A Vercel já marcou o corte como
    ``processing`` no banco antes de chamar aqui.
    """
    if not settings.worker_secret or x_worker_secret != settings.worker_secret:
        raise HTTPException(status_code=401, detail="Segredo inválido")

    background_tasks.add_task(
        recut_cut, body.project_id, body.cut_id, body.inicio, body.fim
    )
    return ProjectCreated(project_id=body.project_id, status="processing")
