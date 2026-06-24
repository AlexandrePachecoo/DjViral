# DjViral — Backend (MVP)

API que recebe um set de DJ em vídeo (mp4), detecta os momentos mais "virais"
pelo áudio (drops, viradas) e gera automaticamente clipes curtos de ~60s
prontos para TikTok/Reels.

## Como funciona

1. **Upload** (`POST /projects`) — o set é salvo num arquivo temporário e um
   projeto é criado com status `processing`. O processamento roda em background
   (FastAPI `BackgroundTasks`).
2. **Análise** (`analyzer.py`) — [Librosa](https://librosa.org) carrega o áudio
   do mp4 e calcula dois sinais: **RMS** (energia/volume) e **onset strength**
   (impacto dos beats). Eles são normalizados e combinados num *score de
   viralidade*; `scipy.signal.find_peaks` encontra os picos e selecionamos os
   `TOP_N` mais intensos.
3. **Corte** (`clipper.py`) — para cada pico, o **FFmpeg** corta ~60s de vídeo
   (começando 5s antes do pico).
4. **Storage** — cada clipe é enviado para o **Supabase Storage** e os metadados
   (`titulo`, `inicio`, `fim`, `score`, `url`) ficam na tabela `cuts`.
5. **Resultado** (`GET /projects/{id}`) — retorna o status e a lista de clipes.

## Pré-requisitos

- Python 3.10+
- **FFmpeg** instalado no sistema (`ffmpeg -version` deve funcionar)
- Um projeto no [Supabase](https://supabase.com)

## Setup

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

cp .env.example .env   # preencha SUPABASE_URL e SUPABASE_KEY (service role)
```

No painel do Supabase:

1. **Database → SQL editor**: rode `supabase/schema.sql` (cria `projects`,
   `sources`, `cuts`).
2. **Storage**: crie um bucket público chamado `clips`.

## Rodando

```bash
uvicorn app.main:app --reload
```

### Exemplo de uso

```bash
# Envia o set e recebe o project_id
curl -F "name=Set Sunset" -F "file=@set_teste.mp4" http://localhost:8000/projects

# Acompanha o status / pega os clipes prontos
curl http://localhost:8000/projects/<project_id>
```

### Testar só o núcleo de análise (sem Supabase/FFmpeg)

```bash
python -c "from app.analyzer import analyze; print(analyze('set_teste.mp4', top_n=5))"
```

## Limitações conscientes deste MVP

- Sets de até 3h são carregados em memória pelo `librosa.load` (mono 22050 Hz,
  ~1 GB). Streaming/processamento em blocos fica para depois.
- Sem autenticação e sem fila distribuída — o processamento roda no mesmo
  processo do FastAPI (`BackgroundTasks`). Para produção, mover para um worker
  dedicado (ex.: BullMQ/Celery).
- A heurística de score (RMS + onset) é simples. Refinamentos futuros: detecção
  de BPM, contraste de energia pré/pós drop, etc.
