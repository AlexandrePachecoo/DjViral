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
    # Duração máxima do vídeo original (3h). Fontes do YouTube são checadas
    # pelos metadados antes do download.
    max_source_duration: int = 10800
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

    # ---- Análise visual (score combinado + corte dinâmico) ----
    # Desliga toda a fase visual (score volta a ser 100% musical e o corte
    # dinâmico degrada para zoom central).
    visual_enabled: bool = True
    # Caminho do YOLOv8n ONNX (relativo à raiz do worker). Se ausente ou
    # corrompido, a análise degrada para movimento-apenas.
    yolo_model_path: str = "models/yolov8n.onnx"
    # Frames amostrados por segundo nas janelas candidatas.
    visual_fps: float = 2.0
    # Roda o YOLO a cada N frames amostrados no estilo dinâmico (precisa de
    # boxes densos p/ derivar os alvos de zoom). No corte seco a detecção é
    # bem mais esparsa (1 a cada ~8 s), só para o score.
    visual_detect_every: int = 3
    # O áudio gera `min(N * factor, cap)` janelas candidatas; a análise visual
    # re-ranqueia e ficam as N pedidas. O cap segura o tempo de job em sets
    # longos (45 janelas ≈ 10–25 min de análise visual).
    visual_candidates_factor: int = 2
    visual_candidates_cap: int = 45
    # Teto de tempo (s) da fase visual por job; estourou, as janelas restantes
    # ficam sem análise (score só musical) em vez de atrasar o set inteiro.
    visual_budget_seconds: int = 900
    # Peso da parte musical no score final (visual = 1 - este valor).
    score_music_weight: float = 0.6

    # ---- Corte dinâmico (zooms) ----
    dynamic_shot_min: float = 3.0   # duração mínima de um shot (s)
    dynamic_shot_max: float = 8.0   # duração máxima de um shot (s)
    dynamic_zoom_max: float = 1.8   # zoom máximo sobre a fonte (evita pixelação)
    # Zoom-drift suave dentro dos shots de zoom (via zoompan). 0 desliga e os
    # shots ficam 100% estáticos (só a alternância wide/zoom nos beats).
    dynamic_drift: float = 0.06


settings = Settings()
