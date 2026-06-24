"""Modelos Pydantic de request/response da API."""
from pydantic import BaseModel


class CutOut(BaseModel):
    titulo: str
    inicio: float
    fim: float
    duracao: int
    score: float
    url: str


class ProjectCreated(BaseModel):
    project_id: str
    status: str


class ProjectStatus(BaseModel):
    project_id: str
    name: str
    status: str
    cuts: list[CutOut] = []
