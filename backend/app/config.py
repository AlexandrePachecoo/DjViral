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
    top_n: int = 30         # quantos clipes gerar no máximo (top picos)
    clip_duration: int = 60  # duração de cada clipe em segundos
    pre_roll: int = 5        # segundos antes do pico onde o corte começa
    # Formato de saída dos clipes. Vertical 9:16 (1080x1920) é o padrão de
    # TikTok/Reels; o clipper faz crop central do set horizontal para preencher
    # a tela. Configurável via OUTPUT_WIDTH / OUTPUT_HEIGHT.
    output_width: int = 1080
    output_height: int = 1920
    # Jobs pesados (process/recut) simultâneos. 1 = fila serial; suba apenas
    # se o plano da Railway tiver memória de sobra (cada job usa ~centenas de
    # MB entre FFmpeg e análise, mais o vídeo em disco).
    max_concurrent_jobs: int = 1
    # Threads que o FFmpeg (x264) usa por corte. O container enxerga todos os
    # núcleos do host (~34 na Railway) e o x264 abre uma thread por núcleo,
    # segurando buffers de frame 1080p em cada uma: ~900 MB por corte, o que
    # estoura a memória. 2 threads derrubam isso para ~300 MB sem perda de
    # velocidade real (a CPU da VM é limitada de qualquer forma).
    ffmpeg_threads: int = 2


settings = Settings()
