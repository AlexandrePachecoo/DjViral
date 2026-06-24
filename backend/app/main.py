"""API FastAPI do DjViral — upload de set e geração de cortes virais."""
import os
import shutil
import tempfile

from fastapi import BackgroundTasks, FastAPI, File, Form, HTTPException, UploadFile

from .pipeline import process_project
from .schemas import CutOut, ProjectCreated, ProjectStatus
from .supabase_client import get_client

app = FastAPI(title="DjViral", description="Gera cortes virais de sets de DJ")


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.post("/projects", response_model=ProjectCreated, status_code=202)
async def create_project(
    background_tasks: BackgroundTasks,
    name: str = Form(...),
    file: UploadFile = File(...),
) -> ProjectCreated:
    """Recebe um set em mp4, cria o projeto e dispara o processamento."""
    client = get_client()

    # Salva o upload em arquivo temporário (não cabe em memória para sets longos).
    suffix = os.path.splitext(file.filename or "")[1] or ".mp4"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        shutil.copyfileobj(file.file, tmp)
        video_path = tmp.name
    size = os.path.getsize(video_path)

    project = (
        client.table("projects")
        .insert({"name": name, "status": "processing"})
        .execute()
    )
    project_id = project.data[0]["id"]

    client.table("sources").insert(
        {
            "project_id": project_id,
            "name": file.filename,
            "tamanho": size,
            "status_processo": "processing",
        }
    ).execute()

    background_tasks.add_task(process_project, project_id, video_path)

    return ProjectCreated(project_id=str(project_id), status="processing")


@app.get("/projects/{project_id}", response_model=ProjectStatus)
def get_project(project_id: str) -> ProjectStatus:
    """Retorna o status do projeto e os clipes já gerados."""
    client = get_client()

    project = (
        client.table("projects").select("*").eq("id", project_id).execute()
    )
    if not project.data:
        raise HTTPException(status_code=404, detail="Projeto não encontrado")
    row = project.data[0]

    cuts = (
        client.table("cuts")
        .select("*")
        .eq("project_id", project_id)
        .order("score", desc=True)
        .execute()
    )

    return ProjectStatus(
        project_id=str(project_id),
        name=row["name"],
        status=row["status"],
        cuts=[
            CutOut(
                titulo=c["titulo"],
                inicio=c["inicio"],
                fim=c["fim"],
                duracao=c["duracao"],
                score=c["score"],
                url=c["url"],
            )
            for c in cuts.data
        ],
    )
