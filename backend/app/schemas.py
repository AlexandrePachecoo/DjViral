"""Modelos Pydantic de request/response do worker."""
from pydantic import BaseModel


class ProcessRequest(BaseModel):
    project_id: str


class ProjectCreated(BaseModel):
    project_id: str
    status: str


class RecutRequest(BaseModel):
    """Re-corta um clipe existente com novo início/fim (em segundos do set)."""

    project_id: str
    cut_id: str
    inicio: float
    fim: float
