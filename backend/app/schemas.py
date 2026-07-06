"""Modelos Pydantic de request/response do worker."""
from pydantic import BaseModel


class ProcessRequest(BaseModel):
    project_id: str
    # Limites do plano do usuário, calculados pela Vercel na hora do disparo.
    # limit_seconds: duração máxima do set para caber na cota restante do
    # plano (o worker valida contra a duração REAL do vídeo). max_cuts:
    # máximo de cortes a gerar (ex.: 10 no teste grátis). None = sem limite
    # de plano (usa só os defaults do worker).
    limit_seconds: int | None = None
    max_cuts: int | None = None
    # Estilo de corte escolhido na criação do projeto: 'basic' (corte seco,
    # crop central fixo) ou 'dynamic' (zooms no DJ/público no ritmo da batida).
    cut_style: str = "basic"
    # Nível da camada de IA de visão, enviado pela Vercel conforme o plano:
    #   'off'  — sem IA (só heurística local áudio + YOLO).
    #   'lite' — triagem (re-rank de TODOS os candidatos) + títulos virais;
    #            só o modelo barato (Haiku). Plano free.
    #   'full' — 'lite' + direção profunda (boxes/story/hype para os zooms do
    #            corte dinâmico, modelo Sonnet no top-K). Planos pagos.
    # Qualquer nível degrada para a heurística local sem ANTHROPIC_API_KEY.
    ai_tier: str = "off"


class ProjectCreated(BaseModel):
    project_id: str
    status: str


class RecutRequest(BaseModel):
    """Re-corta um clipe existente com novo início/fim (em segundos do set)."""

    project_id: str
    cut_id: str
    inicio: float
    fim: float
