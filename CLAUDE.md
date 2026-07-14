# DjViral

## Visão geral

Plataforma que gera cortes virais a partir de sets gravados por DJs. O DJ
grava um set e envia para o site, que analisa o áudio e gera automaticamente
clipes curtos otimizados para TikTok/Reels.

> MVP implementado: frontend Next.js (`frontend/`) + worker de análise FastAPI
> (`backend/`). Ver "Arquitetura" abaixo.
>
> Para o sistema de design da UI (tokens de cor, tipografia, breakpoints e
> diretrizes de responsividade), ver **[`design.md`](design.md)**.

## Requisitos funcionais (MVP)

1. Enviar vídeo de até 3 horas
2. Analisar o vídeo pelo áudio
3. Gerar até 30 vídeos curtos (cortes)
4. Guardar os 30 vídeos gerados

## Arquitetura

A aplicação é dividida em dois deploys porque a análise pesada (librosa +
FFmpeg, sets de até 3h) **não cabe nos limites de serverless da Vercel**
(body de request ~4.5 MB, timeout de função, memória ~1–1.7 GB, filesystem
efêmero, sem FFmpeg nativo, sem worker de longa duração).

- **`frontend/` — Next.js na Vercel.** UI de upload + rotas de orquestração.
  A service role key do Supabase fica só no servidor (env vars), nunca no
  browser.
- **`backend/` — worker FastAPI na Railway.** Onde rodam librosa + FFmpeg
  (container com FFmpeg via Dockerfile). Processa em background com
  `BackgroundTasks` (processo persistente).
- **Supabase** — Postgres (tabelas `projects`, `sources`, `cuts`) + Storage
  (bucket privado `sources` para os vídeos originais, bucket público `clips`
  para os cortes gerados).

### Fluxo

```
Navegador (Vercel UI)
  1. POST /api/projects {name, cut_style?, cut_intensity?, max_cuts?}
                                     → cria project + source, gera signed upload URL
                                       (cut_style: 'basic' seco | 'dynamic' com zooms;
                                        cut_intensity: 'subtle'|'medium'|'intense'
                                        p/ o dinâmico; max_cuts: 1..30, clampado ao plano)
  2. PUT do vídeo DIRETO no Supabase Storage (signed URL) — não passa pela Vercel
  3. POST /api/projects/{id}/process → Vercel chama o worker Railway
                                        max_cuts, cut_style, cut_intensity, ai_tier}
                                        (header X-Worker-Secret; ai_tier:
                                        'off'|'lite'|'full' conforme o plano)
  4. Worker (background): baixa o mp4 do Supabase → analyzer (áudio) → visual
                          (re-rank + alvos de zoom) → clipper (seco ou dinâmico)
                          → upload dos clipes → insere cuts → project.status=done
  5. Navegador faz polling em GET /api/projects/{id} até status=done
```

**Origem YouTube:** além do upload de arquivo, o usuário pode colar apenas um
link do YouTube (aba "Link do YouTube" em `/app/novo`). Nesse caso
`POST /api/projects` recebe `{name, youtube_url}` (validado em
`frontend/lib/youtube.ts`; aceita watch/youtu.be/shorts/music.youtube), grava o
link canônico em `sources.url` com `source_type='youtube'` e **pula** o upload
(passos 2). No worker, `pipeline._fetch_source` vê o `source_type` e baixa o
vídeo com **yt-dlp** (`backend/app/youtube.py`: mp4 até 1080p, duração checada
contra `MAX_SOURCE_DURATION`, default 3h, antes do download). O restante do
pipeline (análise, cortes, re-corte) é idêntico; o re-corte re-baixa do
YouTube quando necessário.

### Pipeline de análise (worker)

1. `analyzer.py` — FFmpeg extrai o áudio para um WAV temporário (mono
   22050 Hz) e o librosa lê em **blocos** (`librosa.stream`): calcula **RMS**
   (energia), **onset strength** (fluxo espectral, impacto dos beats) e
   contraste de energia pré/pós drop; normaliza e combina num *score musical*
   (pesos configuráveis, `ANALYZER_WEIGHT_*`). O peak-picking subtrai uma
   **baseline local** (média móvel, `ANALYZER_BASELINE_WINDOW_SECONDS`) do
   score antes de `scipy.signal.find_peaks` com `prominence` (em vez do
   limiar global `mean*1.5` antigo) — um pico só conta se se destacar do
   CONTEXTO ao redor dele, não da média do set inteiro (corrige tanto
   introduções quietas quanto trechos saturados-altos). Um passo de
   deduplicação (`ANALYZER_DEDUP_*`) funde picos vizinhos que são o MESMO
   platô sustentado (ex.: o mesmo drop repetido a cada loop). O BPM é
   estimado pela mediana de 3 janelas curtas (o tempograma do set inteiro
   custaria GB de RAM). Pico de memória constante (~100–150 MB) independente
   da duração do set.
2. `visual.py` — análise visual SÓ das janelas candidatas (~60s em torno de
   cada pico de áudio, nunca o set inteiro): frames amostrados (~2 fps,
   640 px) lidos frame a frame de um pipe do FFmpeg. Frames ESCUROS (luma
   médio abaixo de `VISUAL_LOW_LIGHT_LUMA_THRESHOLD` — balada/laser) passam
   por **CLAHE** (contraste local no canal L do LAB) antes do resto da
   análise, o que ajuda tanto o motion quanto a detecção de pessoas sem ser
   enganado por picos de brilho transitórios (a janela vira `low_light=true`,
   citado no prompt do diretor de IA). **Movimento** (frame differencing) e
   **detecção de pessoas** com YOLOv8n ONNX via `cv2.dnn` (CPU, modelo
   commitado em `backend/models/yolov8n.onnx`, sem torch). Deriva o
   `visual_score` (0-1), o box do **DJ** (track dominante: box mediano
   global, a track no tempo `dj_track` e sua persistência `dj_track_ratio`,
   consumidos pelo corte dinâmico), o box do **público** (frames com 3+
   pessoas além do DJ) e o **dançarino** (`dancer_box` / `dancer_track`:
   melhor track secundária persistente E com movimento próprio — alvo do
   shot "dancer" do corte dinâmico). Um segundo detector, **YuNet**
   (`backend/models/face_detection_yunet.onnx`), roda só na região da CABEÇA
   das pessoas já detectadas (sem passada full-frame extra): o viés vertical
   do rosto dentro da box (`dj_face_bias_y`/`dancer_face_bias_y`) é um sinal
   de ANCORAGEM — refina só o `y` do crop no corte dinâmico, nunca o
   zoom/enquadramento (mostra dança e mãos na controladora; ver passo 4).
   `get_beat_times` detecta os beats da janela para alinhar os cortes do
   estilo dinâmico. Qualquer falha (modelo ausente, cv2 quebrado) degrada
   para score de movimento/sem rosto — a fase visual nunca derruba um job.
3. **Score combinado** — o áudio gera mais candidatos que o pedido
   (`min(2N, 45)`), cada janela ganha `score = 0.6*musical + 0.4*visual`
   (pesos em config), re-ranqueia e ficam os N melhores. Um *time budget*
   (`VISUAL_BUDGET_SECONDS`, default 900 s) limita a fase visual: estourou,
   as janelas restantes ficam só com o score musical. As parcelas são
   persistidas em `cuts.score_musical` / `cuts.score_visual`.
3b. `ai_director.py` — **diretor de IA (opcional), em DOIS ESTÁGIOS + títulos**.
   A Vercel envia um `ai_tier` no `/process` conforme o plano: `off` (sem IA),
   `lite` (só a triagem barata + títulos virais, plano **free**) ou `full`
   (triagem + direção profunda, planos **pagos**). Com `ai_tier != off` **e**
   `ANTHROPIC_API_KEY` presente:
   - **Triagem** (`triage_group`, barata, modelo `AI_TRIAGE_MODEL` default
     Haiku; roda em `lite` e `full`) roda em LOTES (`AI_TRIAGE_GROUP_SIZE`
     janelas por chamada, 1-2 keyframes pequenos cada) cobrindo **TODOS** os
     candidatos, não só um top-K — devolve só `hype`/`worthy` por janela e
     ajusta o score (`adjusted = (1-w)*base + w*hype_lite`,
     `SCORE_HYPE_LITE_WEIGHT`) ANTES de qualquer corte por top-K, o que deixa
     um trecho mal ranqueado pela heurística local mas bem avaliado
     visualmente sobreviver ao corte.
   - **Títulos virais** (`title_group`, barata, mesmo modelo da triagem; roda
     em `lite` e `full`) — depois da seleção final, uma chamada em lote gera um
     **gancho/legenda de TikTok/Reels por corte** a partir de poucos keyframes
     pequenos dos cortes JÁ escolhidos; vira `cuts.titulo` (fallback heurístico
     `Drop N · BPM` quando a IA não deu título; o BPM passa a viver em
     `cuts.bpm`). Saneado em `_coerce_title`.
   - **Direção profunda** (`direct`, só no `ai_tier=full`, modelo
     `AI_DIRECTOR_MODEL` default
     **Sonnet**) roda só nas TOP-K janelas pelo score já AJUSTADO (teto
     `AI_DIRECTOR_MAX_CALLS` + budget de tempo próprio): amostra
     `AI_DIRECTOR_FRAMES` keyframes (`AI_DIRECTOR_FRAME_WIDTH`px, reaproveita
     `visual.iter_frames`), encoda em JPEG e pergunta ao modelo a **vibe do
     público** (`hype`), o **protagonista** (`subject`: dj/crowd/wide), os
     **momentos de auge** (`moments`), se a cena é digna de zoom (`worthy`),
     o **roteiro de câmera** (`story`: até 6 passos `{t, subject}` com
     subject dj/crowd/dancer/wide) e o **enquadramento** do DJ, do público e
     da pessoa dançando em destaque (`dj_box`/`crowd_box`/`dancer_box`,
     `[cx, cy, w, h]` em frações 0-1 do frame; saneados em `_coerce_box`). O
     hype profundo refina o score final (`(1-w_hype)*adjusted + w_hype*hype`,
     `SCORE_HYPE_WEIGHT`) e a direção alimenta o corte dinâmico (passo 4).
   Cada chamada acumula custo estimado (`ai_director.get_usage()`, log por
   job) — é a primeira dependência de API de IA do projeto; como o YOLO,
   **nunca derruba um job**: sem chave, sem o pacote `anthropic`, timeout ou
   JSON inválido → cai na heurística local/estágio anterior. A parcela final
   vira `cuts.score_hype`.
4. `clipper.py` + `dynamic.py` — dois estilos de corte, escolhidos por
   projeto (`projects.cut_style`):
   - **`basic` (seco)** — `clipper.cut()`: crop central 9:16 fixo + re-encode
     (comportamento original).
   - **`dynamic`** — `dynamic.build_shot_plan()` monta uma timeline de shots
     de 3–8s com um **arco narrativo**: abertura (wide/protagonista com
     push-in), punch-in apertado no protagonista exatamente no drop e, depois
     dele, rotação intencional protagonista ↔ dançarino/público com **wide de
     respiro a cada troca** (a rotação intercala wide para não ficar tempo
     demais colada nas pessoas; zooms **sempre aproximam** — sem drift
     alternado cego; fronteiras alinhadas aos beats; as coladas a um punch são
     removidas para não gerar shot-relâmpago). **Três níveis de intensidade**
     (`projects.cut_intensity`: `subtle`/`medium`/`intense`) são presets que
     sobrescrevem os knobs `DYNAMIC_*`/`BEAT_PUNCH_*` por projeto
     (`config.DYNAMIC_INTENSITY_PRESETS` via `settings.model_copy`, sem mutar o
     singleton — `build_shot_plan(intensity=...)` resolve um `cfg` isolado);
     `medium` = os defaults atuais (zero regressão). **Guarda de presença
     per-shot:** antes de segurar um zoom no dj/dançarino, o shot valida que a
     track TEM sustentação naquele trecho (nº de detecções, cobertura temporal
     `DYNAMIC_MIN_SHOT_COVERAGE` sem buraco longo, confiança
     `DYNAMIC_MIN_SHOT_CONF`) — track fraca/intermitente degrada o SUJEITO em
     cascata (dj→dançarino/público→center) em vez de enquadrar um box vazio
     (box de cena única da IA, sem track, pula a guarda). **Respiro reativo à
     ação:** cada shot é medido pela atividade de imagem do trecho (média do
     frame-diff dos `visual.samples`) contra a mediana LOCAL dos vizinhos
     (`DYNAMIC_LOCAL_BASELINE_WINDOW`, pega uma queda de ação no meio de um
     clipe agitado) — um shot de pessoa que não é o punch-in do drop e cuja
     atividade cai abaixo de `DYNAMIC_STILL_ACTIVITY_RATIO`× essa mediana, OU
     abaixo do piso absoluto `DYNAMIC_STILL_ACTIVITY_FLOOR` (janela inteira
     congelada), vira wide (não segura um zoom parado em quem começou a dançar
     e parou); acima de
     `DYNAMIC_TIGHT_ACTIVITY_RATIO`× a mediana o zoom base ganha
     `DYNAMIC_ACTIVITY_ZOOM_BONUS` (take mais fechado quando a pessoa está
     "on", clampado a `DYNAMIC_ZOOM_MAX`). Sem samples (visual off) os dois
     efeitos ficam inertes. O enquadramento do DJ/dançarino é **por
     shot** (mediana da track dentro do trecho; o box global da janela é só o
     fallback), refinado pelo viés de rosto da Fase 6 (só o `y`, nunca o
     zoom — mostra dança/controladora) e a câmera **panoramiza E aproxima AO
     MESMO TEMPO dentro do shot** seguindo a track — efeito Ken Burns em vez
     de escolher um ou outro (`_pan_path`: keyframes com **easing**
     (`_smoothstep`, ease-in/ease-out) em vez de interpolação linear, zona
     morta `DYNAMIC_PAN_DEADBAND` e teto de velocidade
     `DYNAMIC_PAN_MAX_SPEED`). Shots do MESMO protagonista (dj/dancer/crowd)
     têm **continuidade de câmera** (`DYNAMIC_CAMERA_CONTINUITY`): um shot
     estático puxa o enquadramento em direção a onde a câmera parou da última
     vez que mirou aquele protagonista, em vez de saltar reto pro alvo — o
     "operador de câmera" revisita o sujeito em vez de resetar a cada corte.
     Em shots já "tight" (punch-in) com rosto detectado, um bônus PEQUENO de
     zoom (`FACE_ZOOM_BONUS`, teto bem abaixo de `DYNAMIC_ZOOM_MAX`) reforça
     o punch — nunca vira um close-up genérico fora desses momentos. O
     **wide é ancorado no protagonista** (o crop 9:16 de um 16:9 mostra ~1/3
     da largura; wide no centro do frame perdia o DJ no canto do palco).
     Quando o diretor de IA rodou (passo 3b), a `story` comanda a sequência
     de shots no lugar da rotação heurística (kinds sem box degradam:
     dancer→crowd→dj→center), o `subject` enviesa o protagonista, os
     `moments` viram fronteiras extras de punch-in nos auges visuais e os
     `dj_box`/`crowd_box`/`dancer_box` da IA assumem o enquadramento quando o
     YOLO não achou ninguém OU quando a track é fraca/intermitente
     (`dj_track_ratio < DYNAMIC_AI_BOX_TAKEOVER_RATIO`, flicker de balada
     escura/laser) — uma track sólida do YOLO continua vencendo a estimativa
     de cena da IA. `clipper.cut_dynamic()`
     renderiza tudo num único FFmpeg (`split` → `trim`+`crop` por shot →
     `concat`; o filtro `crop` não anima w/h — o "zoom" é a alternância
     cortada no beat + drift com easing via `zoompan` com supersample 2×
     anti-jitter, aplicado EM CIMA do crop já panorâmico quando o shot tem
     pan — mas avalia **x/y por frame**: shots com pan usam expressões
     piecewise com easing (`_smoothstep`) em `t` para seguir a pessoa; áudio
     `-map 0:a` contínuo). **Zoom de antecipação de batida** (níveis
     `medium`/`intense`, `BEAT_PUNCH_ENABLED`): quando o shot tem batida dentro
     dele, `dynamic._beat_zoom_keys` gera keyframes `(t, z)` de zoom
     "lento-depois-punch" (aproxima devagar entre beats — `BEAT_PUNCH_ANTICIP_FRAC`
     do tempo cobre só `BEAT_PUNCH_ANTICIP_ZOOM_FRAC` do ganho — e dá o crop
     forte logo antes de cada beat), persistidos em `Shot.zoom_keys` e
     renderizados como a expressão `z` do `zoompan` via o mesmo `_pan_expr` do
     pan; sem batida no trecho (ou nível `subtle`) cai na rampa de `drift`
     uniforme de sempre. Sem pessoa detectada (nem pelo YOLO, nem pela IA)
     → zoom central. O render em si tem **3 níveis de fallback**
     (`pipeline._cut_dynamic_tiered`): dinâmico com zoom-drift → mesmo shot
     plan sem zoompan/supersample (`cut_dynamic(force_static=True)`, bem mais
     leve em CPU/memória; o pan é barato e é MANTIDO nesse nível) → corte
     seco. `clipper._run_ffmpeg` roda todo
     FFmpeg com timeout (evita job travado) e, se falhar, distingue erro real
     de filtro vs. processo morto por sinal externo (ex. OOM) na mensagem —
     o corte nunca é perdido por causa do zoom.
5. `pipeline.py` — orquestra download → analyze → visual/re-rank → cut →
   upload → persiste `cuts`. O download do vídeo é em **streaming** (chunks
   para disco, nunca o arquivo inteiro em RAM) e um semáforo limita jobs
   pesados simultâneos (`MAX_CONCURRENT_JOBS`, default 1). O re-corte
   (`POST /recut`) respeita o `cut_style` do projeto: num projeto dinâmico,
   re-roda a análise visual só na janela nova e regenera os zooms. Quando o
   `/recut` traz **`keyframes`** (direção manual do editor visual, ver "Editor
   de cortes" abaixo), o render usa `clipper.cut_keyframed` no lugar do plano
   automático: crop 9:16 com pan por expressão (x/y por frame no `crop`) na
   janela do MENOR zoom + `zoompan` (supersample 2×) por cima com o zoom
   residual interpolado com easing — pan e zoom do usuário ao mesmo tempo,
   fallback em 2 níveis (sem zoompan → corte seco). Os keyframes são
   persistidos em `cuts.crop_keyframes` (o editor reabre com eles; `[]` limpa
   a direção manual).

### Frontend / UI (`frontend/app/`)

A UI tem dois contextos visuais (ver [`design.md`](design.md)): **marketing**
(escuro/neon) e **estúdio** (claro/minimalista).

- `layout.tsx` — raiz HTML; importa `globals.css`, carrega as fontes (Google
  Fonts), define `metadata` e `viewport` (`viewport-fit=cover` p/ o notch iOS).
- `globals.css` — base global (reset, `:root` com tokens `--dj-*`), animações de
  escopo global e os **ganchos responsivos `dj-*`** do estúdio (media queries).
- `page.tsx` + `page.module.css` — **landing** (`/`): hero, "como funciona",
  preços, CTA. Estilizada via CSS Modules.
- `login/page.tsx` — login/cadastro (`/login`).
- `app/` — área logada (`/app`), protegida por sessão:
  - `app/page.tsx` — estúdio (Gerador / Edição / Cortes salvos). O Gerador
    fica montado (só escondido) fora da aba, para trocar de aba não perder os
    cortes recém-gerados nem o polling de um set em processamento.
  - `app/novo/page.tsx` — upload de um novo set (mesmo fluxo de polling do MVP).
  - `app/_studio/` — componentes do estúdio + `theme.ts` (tokens claros).
- `s/[token]/page.tsx` — **página pública** de um set compartilhado (`/s/<token>`),
  **fora** de `app/` (não herda o guard de sessão). Ver "Compartilhamento
  público" abaixo.

### Editor de cortes (aba "Edição")

Todo card de corte (Gerador e Cortes salvos) tem um botão **Editar** que abre
o corte na aba "Edição" (`app/_studio/EditorView.tsx`); a aba sem corte aberto
mostra um seletor dos cortes salvos (`EditPicker` em `app/page.tsx`). O editor
é um workspace **escuro estilo CapCut** (paleta própria `dk` no componente —
o resto do estúdio continua claro).

- **Canvas 9:16 central = o resultado final** (modelo CapCut): o usuário
  arrasta o PRÓPRIO VÍDEO dentro do quadro para reposicionar e dá zoom
  (slider 1–4× ou scroll no canvas), com grade de terços durante o arrasto e
  um **minimap** no canto (frame original + retângulo da janela; clicar/
  arrastar nele move a câmera direto). O editor toca o set original via
  `GET /api/projects/{id}/source` (signed URL de 1h do bucket privado
  `sources`; origem YouTube não tem arquivo → `url: null` e o editor degrada
  para trim-only com aviso). **O editor NÃO carrega o set inteiro:** trabalha
  numa **janela de ±60 s** em volta do corte (`WINDOW_PAD`) — timeline, zoom
  da régua e filmstrip ficam confinados a ela e, se o usuário estender o trim,
  a janela acompanha — e os três `<video>` usam `preload="metadata"` + media
  fragment `#t=<início do corte>` na URL, então o browser buferiza direto no
  trecho do corte via range requests (o vídeo oculto do filmstrip usava
  `preload="auto"`, que baixava o set INTEIRO em background). O canvas mostra
  "Carregando o vídeo do set..." até o primeiro frame decodar e, se o
  `<video>` do original falhar (`onError` — ex.: codec que o browser não
  decodifica, como HEVC/MOV de iPhone ou MKV; o upload aceita `video/*` e o
  editor toca o arquivo CRU, só os cortes são re-encodados em H.264), o aviso
  explica o motivo (com o código do `MediaError`) e o editor degrada para o
  MESMO modo trim-only do YouTube, com o player do corte já gerado no lugar
  do canvas — antes ficava um quadro preto sem explicação.
- **Timeline dock inferior** — régua de timecodes (passos "redondos"
  calculados da janela visível), **filmstrip de miniaturas** do set (geradas
  no cliente: um `<video>` oculto com `crossOrigin` + canvas → dataURLs; se o
  CORS/seek falhar a trilha fica lisa), trecho selecionado com **alças de
  trim** roxas (pode ir **além** do que a IA escolheu; a escolha original
  fica marcada na trilha), scrub, loop do trecho, "início/fim aqui", zoom da
  régua (+/−/ajustar/janela toda) e ajuste fino ±0.5s. Duração 3–180 s (rota
  valida ≤ 600 s).
- **Keyframes de câmera** — todo ajuste de enquadramento cria/edita um
  keyframe `{t, cx, cy, zoom}` no playhead (botão ◆ adiciona/remove, estilo
  CapCut); entre keyframes a câmera interpola com o MESMO smoothstep do
  worker (o preview bate com o render). Keyframes aparecem como losangos na
  trilha e numa lista no painel de propriedades (remover/limpar).
- **Salvar** — título via `PATCH /api/projects/{id}/cuts/{cutId}`; trim e/ou
  keyframes via `POST .../recut {inicio, fim, keyframes}` (keyframes com `t`
  relativo ao início; o editor trabalha com `t` absoluto e converte). O worker
  renderiza com `clipper.cut_keyframed` e grava `cuts.crop_keyframes`; o
  editor reabre com os keyframes salvos via `GET .../cuts/{cutId}` (tolerante
  a banco sem a migração, código 42703).

### Compartilhamento público de sets

O dono pode gerar um link público de uma pasta/set (aba "Cortes salvos") para
qualquer pessoa **ver e baixar os cortes salvos** sem login, e deixar uma
**mensagem** exibida no topo. Como o bucket `clips` já é público (`cuts.url` =
URL pública direta), a feature só adiciona o roteamento público, não muda o
armazenamento dos vídeos.

- `projects.share_token` (unique; NULL = não compartilhado) e
  `projects.share_message` guardam o estado do link e a mensagem.
- `POST /api/projects/{id}/share {enabled?, message?}` — dono only (sessão +
  checagem de dono): gera/revoga o `share_token` e salva a `share_message`.
- `GET /api/public/[token]` — **única rota sem sessão**; resolve o token via
  `frontend/lib/share.ts` (`getPublicShare`) → `{setName, message, cuts}` (só
  cortes `saved` e `ready`).
- O painel de compartilhar fica em `app/_studio/SavedView.tsx` (por pasta);
  `GET /api/cuts/saved` devolve `shareToken`/`shareMessage` para a UI abrir
  sincronizada.

A UI é **responsiva** (testada de ~320px até desktop). Como o estúdio usa
estilos inline, os ajustes responsivos vivem em classes globais `dj-*` em
`globals.css` (com media queries); os componentes só adicionam a `className`.
Pontos-chave: `box-sizing: border-box` global, inputs `font-size: 16px` (evita
zoom no iOS), header do estúdio que quebra em 2 linhas no mobile, grids que
colapsam e a tabela de cortes salvos com scroll horizontal. Breakpoints e
ganchos detalhados em [`design.md`](design.md).

## Stack

- **Frontend/orquestração:** Next.js (App Router, TypeScript) na Vercel.
- **Worker de análise:** Python + FastAPI + librosa + scipy + numpy + FFmpeg,
  na Railway (Docker).
- **Banco + storage:** Supabase (Postgres + Storage).

## Configuração (env vars)

- **Worker (`backend/.env`):** `SUPABASE_URL`, `SUPABASE_KEY` (service role),
  `SUPABASE_BUCKET=clips`, `SOURCES_BUCKET=sources`, `WORKER_SECRET`,
  e opcionais `TOP_N`, `CLIP_DURATION`, `PRE_ROLL`. Análise de áudio
  (opcionais, default calibrados): `ANALYZER_WEIGHT_RMS/ONSET/CONTRAST`,
  `ANALYZER_MIN_GAP_SECONDS`, `ANALYZER_BASELINE_WINDOW_SECONDS`,
  `ANALYZER_PEAK_PROMINENCE`, `ANALYZER_DEDUP_WINDOW_SECONDS`,
  `ANALYZER_DEDUP_TROUGH_RATIO`. Análise visual/corte dinâmico (opcionais):
  `VISUAL_ENABLED`, `YOLO_MODEL_PATH`, `VISUAL_FPS`, `VISUAL_DETECT_EVERY`,
  `VISUAL_CANDIDATES_FACTOR`, `VISUAL_CANDIDATES_CAP`, `VISUAL_BUDGET_SECONDS`,
  `SCORE_MUSIC_WEIGHT`, `VISUAL_LOW_LIGHT_ENABLED`,
  `VISUAL_LOW_LIGHT_LUMA_THRESHOLD`, `VISUAL_LOW_LIGHT_CLAHE_CLIP`,
  `DYNAMIC_SHOT_MIN/MAX`, `DYNAMIC_ZOOM_MAX`, `DYNAMIC_DRIFT` (0 desliga o
  zoompan), `DYNAMIC_PAN` (false desliga o pan que segue o DJ),
  `DYNAMIC_PAN_DEADBAND`, `DYNAMIC_PAN_MAX_SPEED`, `DYNAMIC_MAX_SHOTS`,
  `DYNAMIC_CAMERA_CONTINUITY` (0 desliga a continuidade entre shots do mesmo
  protagonista), `DYNAMIC_AI_BOX_TAKEOVER_RATIO`,
  `DYNAMIC_STILL_ACTIVITY_RATIO` (0 desliga o respiro reativo relativo que troca
  por wide quem parou de dançar; compara contra o baseline LOCAL de
  `DYNAMIC_LOCAL_BASELINE_WINDOW` s em vez da janela inteira),
  `DYNAMIC_STILL_ACTIVITY_FLOOR` (piso absoluto — trecho congelado vira wide
  mesmo com baseline local baixo; 0 desliga), `DYNAMIC_MIN_SHOT_COVERAGE` +
  `DYNAMIC_MIN_SHOT_CONF` (guarda de PRESENÇA per-shot: track fraca/intermitente
  no trecho degrada o sujeito dj/dançarino em vez de segurar zoom em box vazio),
  `DYNAMIC_TIGHT_ACTIVITY_RATIO` +
  `DYNAMIC_ACTIVITY_ZOOM_BONUS` (take mais fechado em trechos agitados; bônus
  0 desliga), `BEAT_PUNCH_ENABLED` + `BEAT_PUNCH_ANTICIP_FRAC` +
  `BEAT_PUNCH_ANTICIP_ZOOM_FRAC` (zoom de antecipação: aproxima devagar entre
  batidas e dá o punch no beat). Os três níveis de `cut_intensity`
  (`subtle`/`medium`/`intense`) são presets que sobrescrevem esses `DYNAMIC_*`/
  `BEAT_PUNCH_*` por projeto (`config.DYNAMIC_INTENSITY_PRESETS`, aplicados via
  `settings.model_copy` sem mutar o singleton). Detecção de rosto (sinal de
  ancoragem, opcional): `FACE_ENABLED`, `FACE_MODEL_PATH`, `FACE_CONF`,
  `FACE_ANCHOR_WEIGHT`, `FACE_ZOOM_BONUS`, `FACE_MIN_SIZE_PX`. Diretor de IA
  em dois estágios + títulos (opcional; nível escolhido pelo `ai_tier` do
  `/process`: `lite` no free = triagem + títulos, `full` nos pagos = + direção
  profunda): `ANTHROPIC_API_KEY` (vazio = IA desligada), `AI_DIRECTOR_ENABLED`,
  `AI_TRIAGE_MODEL` (default
  `claude-haiku-4-5`, cobre TODOS os candidatos em lotes),
  `AI_TRIAGE_GROUP_SIZE`, `AI_TRIAGE_FRAMES_PER_WINDOW`,
  `AI_TRIAGE_FRAME_WIDTH`, `AI_TRIAGE_BUDGET_SECONDS`, `SCORE_HYPE_LITE_WEIGHT`,
  `AI_DIRECTOR_MODEL` (default `claude-sonnet-5`, só no top-K pelo score
  ajustado), `AI_DIRECTOR_MAX_CALLS`, `AI_DIRECTOR_FRAMES`,
  `AI_DIRECTOR_FRAME_WIDTH`, `AI_DIRECTOR_BUDGET_SECONDS`,
  `AI_DIRECTOR_TIMEOUT`, `SCORE_HYPE_WEIGHT`.
- **Frontend (`frontend/.env.local`):** `SUPABASE_URL`,
  `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_BUCKET`, `SUPABASE_SOURCES_BUCKET`,
  `WORKER_URL`, `WORKER_SECRET`, `AUTH_SECRET` (assina os cookies de sessão),
  `ABACATEPAY_API_KEY`, `ABACATEPAY_WEBHOOK_SECRET` (pagamento) e `APP_URL`
  (opcional, origem pública para as URLs de retorno do checkout).

O `WORKER_SECRET` é compartilhado entre Vercel e Railway: só quem tem o segredo
consegue disparar `POST /process` no worker.

## Pagamento / planos (AbacatePay)

Três planos, com cota de **horas de set** e limite de cortes por set:

| Plano   | Preço       | Cota                    | Cortes por set |
|---------|-------------|-------------------------|----------------|
| free    | R$0         | 1 hora de set no TOTAL  | 10             |
| pro     | R$39,90/mês | 5 horas de set por mês  | 30             |
| premium | R$59,90/mês | 12 horas de set por mês | 30             |

Cobrança via **AbacatePay** (API v2, `https://api.abacatepay.com/v2`) com
checkout de assinatura hospedado: o usuário escolhe **PIX ou cartão** na
própria página da AbacatePay; cartão renova automaticamente todo mês.

- `frontend/lib/plans.ts` — definição dos planos + cálculo de uso do período
  (soma `sources.duracao` dos projetos não-`error` do usuário; janela = mês da
  assinatura para pagos, desde sempre no free).
- `frontend/lib/abacatepay.ts` — cliente da API (produtos com `cycle=MONTHLY`
  criados sob demanda com `externalId` fixo `djviral-{plano}-monthly`,
  checkout de assinatura, verificação HMAC dos webhooks).
- `POST /api/billing/checkout {plan}` — cria o checkout e a linha
  `subscriptions` (status `pending`); devolve a URL de pagamento.
- `GET /api/billing` — plano atual + uso (alimenta a aba "Plano" do estúdio).
- `POST /api/webhooks/abacatepay?webhookSecret=...` — webhook (assinatura
  HMAC no header `X-Webhook-Signature` + secret na query; idempotência via
  tabela `webhook_events`). `subscription.completed`/`renewed` ativam o plano
  e o período; `payment_failed` marca `past_due`; `cancelled` rebaixa para
  `free`. O plano efetivo é espelhado em `users.plan`.

**Enforcement da cota:**
1. `POST /api/projects` valida a duração enviada pelo navegador (metadados do
   arquivo) contra a cota restante → HTTP 402 com `code: "plan_limit"`; o
   `max_cuts` escolhido pelo usuário (slider do formulário, 1..30) é clampado
   ao `maxCutsPerSet` do plano e persistido em `projects.max_cuts`.
2. `POST /api/projects/{id}/process` envia `limit_seconds` (cota restante),
   `max_cuts` (escolha do usuário re-clampada ao plano ATUAL — protege contra
   downgrade entre criação e process) e `cut_style` ao worker.
3. O worker mede a duração REAL com ffprobe, grava em `sources.duracao` (é o
   que conta na cota) e aborta com `status=error` se estourar `limit_seconds`;
   `max_cuts` limita quantos cortes são gerados (o áudio gera mais candidatos
   e o re-rank visual fica com os N melhores).

## Evoluções planejadas (ainda não implementadas)

- **Upload resumável (TUS):** o upload atual é um PUT único na signed URL,
  frágil para vídeos de vários GB. Migrar para o upload resumável do Supabase.
- **Fila dedicada:** trocar `BackgroundTasks` por Redis/BullMQ/Celery para
  escala real (o corte dinâmico deixa os jobs mais longos; a fila serial do
  semáforo cresce mais rápido).
- **Tuning do corte dinâmico:** pesos do score visual, durações de shot e
  intensidade de zoom calibrados com sets reais de balada (pouca luz, laser).

## Autenticação

Login por email + senha, self-contained (sem Supabase Auth, sem libs externas):

- Tabela `users` (`backend/supabase/schema.sql`) com senha em hash scrypt
  (`salt:hash`). `projects.user_id` referencia o dono.
- `frontend/lib/auth.ts` — hash/verify de senha (scrypt), token de sessão
  assinado por HMAC (`AUTH_SECRET`) e `getSessionUser()` que lê o cookie
  `djviral_session` (httpOnly).
- Rotas: `POST /api/auth/register`, `POST /api/auth/login`,
  `POST /api/auth/logout`, `GET /api/auth/me`. Página `/login` (login +
  cadastro). A área `/app` é protegida por `app/app/layout.tsx` (redireciona
  pra `/login` sem sessão); as rotas de `/api/projects` exigem sessão e
  checam o dono do projeto.
- O cadastro é livre e todo usuário entra no plano `free` (teste grátis);
  upgrade via aba "Plano" do estúdio (ver "Pagamento / planos").

## Modelo de dados

### Usuário
- id
- name
- email
- password
- plan (`free | pro | premium`) — espelhado pelos webhooks da AbacatePay
- date_create

### Subscription (assinatura AbacatePay)
- id
- user_id
- plan (`pro | premium`)
- status (`pending | active | past_due | cancelled`)
- method (`PIX | CARD`)
- provider_checkout_id (`bill_...`) / provider_subscription_id (`subs_...`)
- external_id — nosso id enviado no checkout
- current_period_start / current_period_end
- created_at / updated_at

### Projeto
- id
- user_id
- name
- status
- share_token — token do link público (`/s/<token>`); NULL = não compartilhado
- share_message — mensagem do dono exibida no topo da página pública (opcional)
- cut_style (`basic | dynamic`) — estilo de corte escolhido na criação
- cut_intensity (`subtle | medium | intense`) — intensidade do corte dinâmico
  (nº de trocas de shot, força dos zooms, beat-punch); só relevante no
  `dynamic`. Projetos antigos herdam `medium` (= comportamento anterior)
- max_cuts — quantidade de cortes pedida (NULL = máximo do plano)
- date_create

### Source (vídeo original)
- id
- projeto_id
- name
- duracao
- tamanho
- url — caminho no Storage (`upload`) ou link do YouTube (`youtube`)
- source_type (`upload | youtube`)
- status_processo

### Transcript
- id
- source_id
- texto_completo
- timestamp
- palavra_chave

### Cuts / Clipe
- id
- projeto_id
- titulo — gancho/legenda viral gerado pela IA (`ai_director.title_group`);
  fallback heurístico `Drop N · BPM` quando a IA não rodou/não deu título
- bpm — BPM estimado do set no corte (antes ficava embutido no título; NULL em
  cortes antigos ou sem estimativa)
- inicio
- fim
- duracao
- score (potencial viral) — combinado: `0.6*score_musical + 0.4*score_visual`,
  ainda misturado com o hype da IA quando ela rodou (`SCORE_HYPE_WEIGHT`)
- score_musical / score_visual — parcelas do score (NULL em cortes antigos ou
  quando a análise visual não rodou)
- score_hype — parcela do diretor de IA (vibe do público, 0-1); NULL quando a
  direção profunda não rodou (tier != full, sem chave, ou janela fora do teto
  de chamadas)
- url
- status (`ready | processing | error`) — `processing` enquanto o worker
  regenera o vídeo num re-corte (`POST /recut`)
- crop_keyframes — direção manual de câmera do editor (JSON `[{t, cx, cy,
  zoom}]`, `t` relativo ao início do corte, `cx`/`cy` frações 0-1 do frame da
  fonte, `zoom` ≥ 1); NULL = sem direção manual (render automático), `[]` =
  usuário limpou os keyframes
