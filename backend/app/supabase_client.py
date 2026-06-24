"""Cliente Supabase compartilhado (Postgres + Storage)."""
from functools import lru_cache

from supabase import Client, create_client

from .config import settings


@lru_cache(maxsize=1)
def get_client() -> Client:
    """Retorna um cliente Supabase singleton.

    Levanta erro claro se as credenciais não estiverem configuradas, evitando
    falhas obscuras mais adiante no pipeline.
    """
    if not settings.supabase_url or not settings.supabase_key:
        raise RuntimeError(
            "SUPABASE_URL e SUPABASE_KEY precisam estar definidos no ambiente/.env"
        )
    return create_client(settings.supabase_url, settings.supabase_key)


def upload_clip(local_path: str, dest_name: str) -> str:
    """Sobe um arquivo para o bucket de clipes e retorna a URL pública."""
    client = get_client()
    bucket = settings.supabase_bucket
    with open(local_path, "rb") as f:
        client.storage.from_(bucket).upload(
            path=dest_name,
            file=f,
            file_options={"content-type": "video/mp4", "upsert": "true"},
        )
    return client.storage.from_(bucket).get_public_url(dest_name)
