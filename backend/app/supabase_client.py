"""Cliente Supabase compartilhado (Postgres + Storage)."""
import os
import tempfile
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


def download_source(storage_path: str) -> str:
    """Baixa o vídeo original do bucket `sources` para um arquivo temporário.

    Retorna o caminho local. O chamador é responsável por remover o arquivo.
    """
    client = get_client()
    data = client.storage.from_(settings.sources_bucket).download(storage_path)
    suffix = os.path.splitext(storage_path)[1] or ".mp4"
    fd, local_path = tempfile.mkstemp(suffix=suffix)
    with os.fdopen(fd, "wb") as f:
        f.write(data)
    return local_path
