# DjViral — Worker (Railway)

Worker que detecta os momentos mais "virais" de um set de DJ (drops, viradas)
pelo áudio e gera automaticamente clipes curtos de ~60s prontos para
TikTok/Reels.

Roda **fora da Vercel** (ex.: Railway), onde há FFmpeg, memória e tempo
suficientes. A Vercel (`../frontend`) faz a orquestração e dispara este worker.

## Como funciona

1. **Disparo** (`POST /process`, JSON `{project_id}` + header `X-Worker-Secret`)
   — a Vercel chama este endpoint depois que o navegador subiu o vídeo direto ao
   Supabase Storage. Responde 202 e enfileira um job na tabela `jobs`; uma
   thread consumidora do worker o executa (`app/jobs.py`).
2. **Download** (`pipeline.py`) — busca a linha `source` do projeto, baixa o
   vídeo do bucket `sources` para um arquivo temporário.
3. **Análise** (`analyzer.py`) — [Librosa](https://librosa.org) carrega o áudio
   do mp4 e calcula três sinais: **RMS** (energia/volume), **onset strength**
   (impacto dos beats) e **contraste de energia pré/pós drop** (o quanto a
   energia explode depois de um buildup). Eles são normalizados e combinados num
   *score de viralidade*; `scipy.signal.find_peaks` encontra os picos e
   selecionamos os `TOP_N` mais intensos. O **BPM** global do set também é
   estimado e usado no título de cada corte.
4. **Corte** (`clipper.py`) — para cada pico, o **FFmpeg** corta ~60s de vídeo
   (começando 5s antes do pico).
5. **Storage** — cada clipe é enviado para o bucket `clips` e os metadados
   (`titulo`, `inicio`, `fim`, `score`, `url`) ficam na tabela `cuts`. Ao final,
   `project.status = done`.

## Pré-requisitos

- Python 3.10+ e **FFmpeg** (`ffmpeg -version`) — ou simplesmente Docker
- Um projeto no [Supabase](https://supabase.com)

## Supabase

1. **Database → SQL editor**: rode `supabase/schema.sql` (cria `projects`,
   `sources`, `cuts`, a fila `jobs` e a função `claim_job`). O arquivo é
   idempotente: rode de novo a cada migração.
2. **Storage**: crie o bucket público `clips` e o bucket privado `sources`.
3. Aumente o limite de tamanho de upload do projeto para comportar sets longos.

## Rodando local com Docker

```bash
docker build -t djviral-worker backend/
docker run -p 8000:8000 --env-file backend/.env djviral-worker
```

Ou direto com Python:

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # preencha as variáveis
uvicorn app.main:app --reload
```

### Exemplo de uso

```bash
curl http://localhost:8000/health

# Dispara o processamento de um projeto cujo vídeo já está no bucket `sources`
curl -X POST http://localhost:8000/process \
  -H "content-type: application/json" \
  -H "x-worker-secret: SEU_SEGREDO" \
  -d '{"project_id": "<uuid>"}'
```

### Calibrar o corte dinâmico com um set real (sem Supabase)

```bash
python -m tools.calibrate set.mp4 --top 15 --json relatorio.json
```

Roda áudio → janelas candidatas → análise visual → plano de shots, sem
renderizar, e mostra por janela: pouca luz, persistência da track do DJ,
movimento, score visual e os shots de cada intensidade. As variáveis de
ambiente valem, então dá para comparar um ajuste
(`DYNAMIC_MIN_SHOT_CONF=0.2 python -m tools.calibrate set.mp4`).

### Testar só o núcleo de análise (sem Supabase)

```bash
python -c "from app.analyzer import analyze; print(analyze('set_teste.mp4', top_n=30))"
```

## Deploy na Railway

1. Novo projeto a partir do repo, **Root Directory = `backend`** (usa o
   `Dockerfile`).
2. Configure as variáveis de ambiente (veja `.env.example`): `SUPABASE_URL`,
   `SUPABASE_KEY`, `SUPABASE_BUCKET`, `SOURCES_BUCKET`, `WORKER_SECRET`.
3. Anote a URL pública gerada → ela vira `WORKER_URL` no frontend (Vercel).

## Limitações conscientes deste MVP

- A análise roda em streaming (FFmpeg extrai o áudio para WAV e o librosa lê
  em blocos), então o pico de memória é constante (~100–150 MB) mesmo em sets
  de 3h. O vídeo original e o WAV temporário ficam em **disco** durante o
  processamento (alguns GB livres são necessários).
- Cada corte re-encoda com FFmpeg limitado a `FFMPEG_THREADS` (default 2). Sem
  esse limite o x264 abre uma thread por núcleo do host (~34 na Railway) e cada
  uma segura buffers de frame 1080p → ~900 MB por corte; com 2 threads o pico
  fica em ~300 MB, sem custo real de velocidade.
- Os jobs ficam numa fila durável no Postgres (tabela `jobs`): no máximo
  `MAX_CONCURRENT_JOBS` (default 1) rodam ao mesmo tempo neste processo, os
  demais esperam. Um job interrompido por redeploy/crash volta para a fila
  depois de `JOB_STALE_SECONDS` sem heartbeat (até `JOB_MAX_ATTEMPTS` vezes).
  Sem a migração da fila aplicada, o worker cai no `BackgroundTasks` em
  memória (que perde o job num redeploy).
- A heurística de score (RMS + onset + contraste) é simples. Refinamentos
  futuros: análise de vocais, estrutura da música, etc.
