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
  1. POST /api/projects {name}       → cria project + source, gera signed upload URL
  2. PUT do vídeo DIRETO no Supabase Storage (signed URL) — não passa pela Vercel
  3. POST /api/projects/{id}/process → Vercel chama o worker Railway
                                        POST /process {project_id} (header X-Worker-Secret)
  4. Worker (background): baixa o mp4 do Supabase → analyzer → clipper
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
   contraste de energia pré/pós drop; normaliza e combina num *score de
   viralidade*; `scipy.signal.find_peaks` seleciona os `TOP_N` picos. O BPM é
   estimado pela mediana de 3 janelas curtas (o tempograma do set inteiro
   custaria GB de RAM). Pico de memória constante (~100–150 MB) independente
   da duração do set.
2. `clipper.py` — FFmpeg corta ~60s de vídeo em torno de cada pico (re-encode
   para corte preciso; seek com clamp em 0).
3. `pipeline.py` — orquestra download → analyze → cut → upload → persiste
   `cuts`. O download do vídeo é em **streaming** (chunks para disco, nunca o
   arquivo inteiro em RAM) e um semáforo limita jobs pesados simultâneos
   (`MAX_CONCURRENT_JOBS`, default 1).

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
  - `app/page.tsx` — estúdio (Gerador / Edição / Cortes salvos).
  - `app/novo/page.tsx` — upload de um novo set (mesmo fluxo de polling do MVP).
  - `app/_studio/` — componentes do estúdio + `theme.ts` (tokens claros).
- `s/[token]/page.tsx` — **página pública** de um set compartilhado (`/s/<token>`),
  **fora** de `app/` (não herda o guard de sessão). Ver "Compartilhamento
  público" abaixo.

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
  e opcionais `TOP_N`, `CLIP_DURATION`, `PRE_ROLL`.
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
   arquivo) contra a cota restante → HTTP 402 com `code: "plan_limit"`.
2. `POST /api/projects/{id}/process` envia `limit_seconds` (cota restante) e
   `max_cuts` ao worker.
3. O worker mede a duração REAL com ffprobe, grava em `sources.duracao` (é o
   que conta na cota) e aborta com `status=error` se estourar `limit_seconds`;
   `max_cuts` limita o `top_n` da análise.

## Evoluções planejadas (ainda não implementadas)

- **Upload resumável (TUS):** o upload atual é um PUT único na signed URL,
  frágil para vídeos de vários GB. Migrar para o upload resumável do Supabase.
- **Fila dedicada:** trocar `BackgroundTasks` por Redis/BullMQ/Celery para
  escala real.
- **Score mais rico:** detecção de BPM, contraste de energia pré/pós drop.

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
- titulo
- inicio
- fim
- duracao
- score (potencial viral)
- url
- status (`ready | processing | error`) — `processing` enquanto o worker
  regenera o vídeo num re-corte (`POST /recut`)
