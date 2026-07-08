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

    # ---- Análise de áudio (analyzer.py) ----
    # Pesos dos três sinais no score combinado (RMS/onset/contraste). Somam 1.0
    # no default; expostos só para permitir calibrar sem redeploy.
    analyzer_weight_rms: float = 0.4
    analyzer_weight_onset: float = 0.3
    analyzer_weight_contrast: float = 0.3
    # Distância mínima entre dois picos, em segundos, para não gerar clipes
    # sobrepostos.
    analyzer_min_gap_seconds: int = 30
    # Janela (s) usada para medir o contraste de energia em torno de um drop.
    analyzer_contrast_window_seconds: int = 4
    # Janela (s) de cada uma das 3 amostras usadas para estimar o BPM global.
    analyzer_tempo_window_seconds: int = 60
    # Janela (s) da baseline local (média móvel) subtraída do score antes do
    # peak-picking — troca o limiar GLOBAL (mean*1.5, cego a trechos mais
    # quietos ou mais saturados do set) por um limiar RELATIVO ao contexto
    # local de cada trecho.
    analyzer_baseline_window_seconds: int = 60
    # Prominência mínima (no score já subtraído da baseline, ~0-1) para um
    # pico contar — descarta ruído/micro-flutuações sem depender de um valor
    # absoluto por set.
    analyzer_peak_prominence: float = 0.05
    # Janela (s) de deduplicação: dois picos dentro dela que não "descem" o
    # bastante entre si (ver `analyzer_dedup_trough_ratio`) são o mesmo platô
    # sustentado (ex.: o mesmo drop repetido) — fica só o mais alto.
    analyzer_dedup_window_seconds: int = 90
    # Se o vale entre dois picos próximos não cair abaixo desta fração do
    # menor dos dois, eles são fundidos num só.
    analyzer_dedup_trough_ratio: float = 0.85

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
    # boxes densos p/ derivar os alvos de zoom e o pan que segue o DJ — a
    # 2 fps, N=2 dá 1 detecção/s). No corte seco a detecção é bem mais
    # esparsa (1 a cada ~8 s), só para o score.
    visual_detect_every: int = 2
    # O áudio gera `min(N * factor, cap)` janelas candidatas; a análise visual
    # re-ranqueia e ficam as N pedidas. Um funil mais largo dá à IA (triagem +
    # direção) mais chance de resgatar um momento que o áudio subestimou; o cap
    # segura o tempo de job em sets longos (60 janelas ≈ 15–30 min de análise
    # visual, ainda limitado pelo `visual_budget_seconds`).
    visual_candidates_factor: int = 3
    visual_candidates_cap: int = 60
    # Teto de tempo (s) da fase visual por job; estourou, as janelas restantes
    # ficam sem análise (score só musical) em vez de atrasar o set inteiro.
    visual_budget_seconds: int = 900
    # Peso da parte musical no score final (visual = 1 - este valor).
    score_music_weight: float = 0.6
    # Pré-processamento de baixa luz (balada/laser escuros): CLAHE (contraste
    # local) no frame ANTES do YOLO/motion quando o brilho médio (luma) fica
    # abaixo do limiar — melhora a detecção sem ser enganado por picos de
    # brilho transitórios (strobe/laser), diferente de um gamma fixo.
    visual_low_light_enabled: bool = True
    visual_low_light_luma_threshold: float = 60.0
    visual_low_light_clahe_clip: float = 2.0
    # Track do YOLO presente em menos que esta fração dos frames detectados é
    # "fraca" (flicker em cena escura): o box da IA, quando existe, assume o
    # enquadramento no lugar da mediana de meia dúzia de detecções tremidas.
    dynamic_ai_box_takeover_ratio: float = 0.3

    # ---- Detecção de rosto (sinal de ancoragem, NÃO de corte fechado) ----
    # Roda YuNet só na região da CABEÇA da box já escolhida (DJ/dançarino) —
    # nunca uma passada full-frame nem um punch-in genérico. Refina a
    # centralização vertical do crop e, em shots já "tight" (punch-in no
    # drop/auge), dá um bônus PEQUENO de zoom — nunca troca o enquadramento
    # por um close-up de rosto (a dança/controladora continuam no quadro).
    face_enabled: bool = True
    face_model_path: str = "models/face_detection_yunet.onnx"
    # Confiança mínima de uma detecção de rosto (score do YuNet).
    face_conf: float = 0.6
    # Lado mínimo (px, na região recortada da cabeça) de um rosto detectado
    # pra contar — evita reagir a falsos-positivos minúsculos.
    face_min_size_px: int = 20
    # Peso do ajuste vertical do crop em direção ao rosto (0 = desliga; 1 =
    # centraliza total no rosto). É um NUDGE, não um travamento — só toca o
    # `y` do crop, nunca `w`/`h`/zoom.
    face_anchor_weight: float = 0.3
    # Bônus de zoom (adicional ao zoom normal do shot) SÓ em shots já
    # marcados como "tight"/punch-in E com rosto detectado — teto bem abaixo
    # de `dynamic_zoom_max`, pra nunca virar um close-up genérico.
    face_zoom_bonus: float = 0.15

    # ---- Corte dinâmico (zooms) ----
    dynamic_shot_min: float = 3.0   # duração mínima de um shot (s)
    dynamic_shot_max: float = 8.0   # duração máxima de um shot (s)
    dynamic_zoom_max: float = 1.8   # zoom máximo sobre a fonte (evita pixelação)
    # Zoom-drift suave dentro dos shots de zoom (via zoompan). 0 desliga e os
    # shots ficam 100% estáticos (só a alternância wide/zoom nos beats).
    dynamic_drift: float = 0.06
    # Pan contínuo dentro dos shots de zoom: o crop segue a track do DJ
    # (x/y animados por frame no filtro crop; o nível de zoom fica fixo).
    # False = crop estático por shot (comportamento anterior).
    dynamic_pan: bool = True
    # Zona morta do pan: deslocamento mínimo do centro da pessoa (fração do
    # frame) para a câmera se mover — abaixo disso o crop fica parado (evita
    # micro-jitter quando o DJ está no lugar).
    dynamic_pan_deadband: float = 0.04
    # Velocidade máxima do pan (fração da largura do frame por segundo) —
    # acima disso a câmera "atrasa" e alcança no keyframe seguinte, em vez
    # de chicotear atrás do DJ.
    dynamic_pan_max_speed: float = 0.10
    # Teto de shots por clipe (largura do `split=N` no filtergraph). Motion
    # alto pode gerar até ~20 shots num clipe de 60s (shot_min=3s) — o teto
    # limita a complexidade/memória do filtro independente da cena.
    dynamic_max_shots: int = 10
    # Threads do FILTRO (split/scale/zoompan) do corte dinâmico, via
    # -filter_threads/-filter_complex_threads. Mesma razão do `ffmpeg_threads`
    # do encoder: sem limitar, o FFmpeg escalona por núcleo do host (~34 na
    # Railway), e com vários branches de zoompan supersampleados ativos ao
    # mesmo tempo isso pode inflar bastante o pico de memória do processo.
    dynamic_filter_threads: int = 2
    # Continuidade de câmera entre shots do MESMO kind (dj/dancer/crowd): um
    # shot estático (sem pan próprio) tem seu enquadramento puxado uma fração
    # em direção a onde a câmera estava no FIM do último shot desse kind, em
    # vez de saltar direto para o alvo — o "operador de câmera" revisita o
    # sujeito em vez de resetar o enquadramento a cada corte. 0 = desliga
    # (comportamento anterior, cada shot 100% independente).
    dynamic_camera_continuity: float = 0.35
    # Respiro (wide) reativo à AÇÃO do trecho: um shot de pessoa (dj/dançarino/
    # público) que NÃO é o punch-in do drop e cuja atividade de imagem no trecho
    # (média do frame-diff dos samples) cai abaixo desta fração da atividade
    # MEDIANA da janela vira um wide — evita segurar um zoom parado em quem
    # começou a dançar e parou. 0 desliga (segura o zoom independente da ação).
    dynamic_still_activity_ratio: float = 0.55
    # Take mais FECHADO quando a pessoa está claramente "on": num shot de pessoa
    # cuja atividade no trecho passa desta fração da mediana da janela, o zoom
    # base ganha `dynamic_activity_zoom_bonus` (somado, sempre clampado a
    # `dynamic_zoom_max`). 0 no bônus desliga o fechamento reativo.
    dynamic_tight_activity_ratio: float = 1.4
    dynamic_activity_zoom_bonus: float = 0.2

    # ---- Diretor de IA (visão / "vibe" do público) ----
    # Camada opcional de IA de visão (Claude), em DOIS estágios: uma triagem
    # barata cobre TODOS os candidatos (nenhum fica de fora só por causa do
    # score local), e a direção profunda (boxes/story) roda só nas melhores
    # janelas pelo score já ajustado pela triagem. Só roda quando o disparo do
    # /process pede (planos pagos) E há chave da API. Qualquer falha degrada
    # para a heurística local (nunca derruba o job), igual à fase visual do YOLO.
    ai_director_enabled: bool = True
    # Chave da API da Claude (via ambiente; NUNCA commitar). Vazia = IA desligada.
    anthropic_api_key: str = ""
    # Modelo da DIREÇÃO PROFUNDA (boxes/story) — a etapa mais cara, mas só
    # roda no top-K; Sonnet dá enquadramento e roteiro de câmera bem melhores
    # que Haiku pelo custo adicional (poucas chamadas por job).
    ai_director_model: str = "claude-sonnet-5"
    # Teto de chamadas da direção profunda por job (gasta o orçamento nas
    # janelas mais promissoras pelo score AJUSTADO pela triagem).
    ai_director_max_calls: int = 20
    # Quantos keyframes amostrar por janela para a direção profunda. Mais
    # frames dão à IA melhor noção espacial (boxes) e temporal (story/moments),
    # ao custo de mais tokens por chamada — mas só no top-K.
    ai_director_frames: int = 7
    # Largura (px) dos frames enviados à direção profunda.
    ai_director_frame_width: int = 768
    # Teto de tempo (s) da direção profunda por job; estourou, as janelas
    # restantes ficam só com o score ajustado da triagem.
    ai_director_budget_seconds: int = 180
    # Timeout (s) de cada chamada individual à API.
    ai_director_timeout: float = 30.0
    # Peso do hype da direção profunda no score final: final = (1-peso)*ajustado
    # + peso*hype. Janela sem direção profunda fica só no score ajustado. Mais
    # alto = a leitura visual de auge da IA pesa mais que a energia do áudio.
    score_hype_weight: float = 0.40

    # Modelo da TRIAGEM (barata, cobre todos os candidatos) — fica em Haiku
    # mesmo com a direção profunda em Sonnet, pra o custo por janela ficar baixo.
    ai_triage_model: str = "claude-haiku-4-5"
    # Quantos candidatos por chamada de triagem (1 chamada avalia várias janelas
    # de uma vez — é o que torna cobrir TODOS os candidatos barato).
    ai_triage_group_size: int = 6
    # Keyframes por janela na triagem (bem menos que a direção profunda —
    # só precisa classificar hype/worthy, não localizar boxes).
    ai_triage_frames_per_window: int = 2
    # Largura (px) dos frames da triagem (menor que a direção profunda).
    ai_triage_frame_width: int = 256
    # Teto de tempo (s) da fase de triagem por job (separado do budget da
    # direção profunda).
    ai_triage_budget_seconds: int = 90
    # Peso do hype "lite" da triagem no score ajustado (usado ANTES do corte
    # do top-K da direção profunda): adjusted = (1-peso)*base + peso*hype_lite.
    # É o que deixa uma janela mal ranqueada localmente mas bem avaliada
    # visualmente sobreviver ao corte do top-K — por isso pesa relativamente
    # forte (a triagem é o único filtro de IA que vê TODOS os candidatos).
    score_hype_lite_weight: float = 0.30


settings = Settings()
