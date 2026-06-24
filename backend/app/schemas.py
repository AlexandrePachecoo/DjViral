"""Modelos Pydantic de request/response do worker."""
from pydantic import BaseModel


class ProcessRequest(BaseModel):
    project_id: str


class ProjectCreated(BaseModel):
    project_id: str
    status: str
