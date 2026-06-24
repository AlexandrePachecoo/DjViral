"""Configuração da aplicação, carregada de variáveis de ambiente / .env."""
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Supabase
    supabase_url: str = ""
    supabase_key: str = ""  # service role key (uso no backend)
    supabase_bucket: str = "clips"      # bucket público dos clipes gerados
    sources_bucket: str = "sources"     # bucket privado dos vídeos originais

    # Segurança: segredo compartilhado entre a Vercel (orquestração) e este
    # worker. Só quem tiver o segredo consegue disparar /process.
    worker_secret: str = ""

    # Parâmetros de processamento
    top_n: int = 5          # quantos clipes gerar (top picos)
    clip_duration: int = 60  # duração de cada clipe em segundos
    pre_roll: int = 5        # segundos antes do pico onde o corte começa


settings = Settings()
