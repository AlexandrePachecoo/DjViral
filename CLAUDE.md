# DjViral

## Visão geral

Plataforma que gera cortes virais a partir de sets gravados por DJs. O DJ
grava um set e envia para o site, que analisa o áudio e gera automaticamente
clipes curtos otimizados para TikTok/Reels.

> MVP implementado: frontend Next.js (`frontend/`) + worker de análise FastAPI
> (`backend/`). Ver "Arquitetura" abaixo.

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
  1. POST /api/projects {name}       → cria project + source, gera signed upload URL
  2. PUT do vídeo DIRETO no Supabase Storage (signed URL) — não passa pela Vercel
  3. POST /api/projects/{id}/process → Vercel chama o worker Railway
                                        POST /process {project_id} (header X-Worker-Secret)
  4. Worker (background): baixa o mp4 do Supabase → analyzer → clipper
                          → upload dos clipes → insere cuts → project.status=done
  5. Navegador faz polling em GET /api/projects/{id} até status=done
```

### Pipeline de análise (worker)

1. `analyzer.py` — librosa carrega o áudio do mp4 e calcula **RMS** (energia) +
   **onset strength** (impacto dos beats); normaliza e combina num *score de
   viralidade*; `scipy.signal.find_peaks` seleciona os `TOP_N` picos.
2. `clipper.py` — FFmpeg corta ~60s de vídeo em torno de cada pico (re-encode
   para corte preciso; seek com clamp em 0).
3. `pipeline.py` — orquestra download → analyze → cut → upload → persiste `cuts`.

## Stack

- **Frontend/orquestração:** Next.js (App Router, TypeScript) na Vercel.
- **Worker de análise:** Python + FastAPI + librosa + scipy + numpy + FFmpeg,
  na Railway (Docker).
- **Banco + storage:** Supabase (Postgres + Storage).

## Configuração (env vars)

- **Worker (`backend/.env`):** `SUPABASE_URL`, `SUPABASE_KEY` (service role),
  `SUPABASE_BUCKET=clips`, `SOURCES_BUCKET=sources`, `WORKER_SECRET`,
  e opcionais `TOP_N`, `CLIP_DURATION`, `PRE_ROLL`.
- **Frontend (`frontend/.env.local`):** `SUPABASE_URL`,
  `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_BUCKET`, `SUPABASE_SOURCES_BUCKET`,
  `WORKER_URL`, `WORKER_SECRET`.

O `WORKER_SECRET` é compartilhado entre Vercel e Railway: só quem tem o segredo
consegue disparar `POST /process` no worker.

## Evoluções planejadas (ainda não implementadas)

- **Upload resumável (TUS):** o upload atual é um PUT único na signed URL,
  frágil para vídeos de vários GB. Migrar para o upload resumável do Supabase.
- **Fila dedicada:** trocar `BackgroundTasks` por Redis/BullMQ/Celery para
  escala real.
- **Score mais rico:** detecção de BPM, contraste de energia pré/pós drop.
- **Autenticação de usuário** (tabela `Usuário` abaixo ainda não usada no MVP).

## Modelo de dados

### Usuário
- id
- name
- email
- password
- plan
- date_create

### Projeto
- id
- user_id
- name
- status
- date_create

### Source (vídeo original)
- id
- projeto_id
- name
- duracao
- tamanho
- url
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
- titulo
- inicio
- fim
- duracao
- score (potencial viral)
- url
