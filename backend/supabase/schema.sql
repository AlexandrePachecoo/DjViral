-- Schema do MVP DjViral (subconjunto do modelo em CLAUDE.md, sem `users`).
-- Rode no SQL editor do Supabase. Crie também dois buckets de Storage:
--   - `clips`   (público)  → clipes gerados
--   - `sources` (privado)  → vídeos originais enviados pelo navegador
-- Lembre de aumentar o limite de tamanho de upload do projeto para comportar
-- vídeos longos (o default do plano free é baixo, ~50 MB).

create extension if not exists "pgcrypto";

-- Usuários. Autenticação por email + senha (hash scrypt salvo em `password`).
-- `plan` espelha o plano efetivo ('free' | 'pro' | 'premium') e é atualizado
-- pelos webhooks da AbacatePay (ver tabela `subscriptions`).
create table if not exists users (
    id          uuid primary key default gen_random_uuid(),
    name        text not null,
    email       text not null unique,
    password    text not null,            -- hash scrypt no formato salt:hash
    plan        text not null default 'free',
    date_create timestamptz not null default now()
);

create table if not exists projects (
    id            uuid primary key default gen_random_uuid(),
    user_id       uuid references users (id) on delete cascade,
    name          text not null,
    status        text not null default 'processing', -- processing | done | error
    share_token   text unique,   -- token do link público (NULL = não compartilhado)
    share_message text,          -- mensagem do dono exibida no topo da página pública
    date_create   timestamptz not null default now()
);

create index if not exists idx_projects_user on projects (user_id);

-- Migração: compartilhamento público de um set. `share_token` (quando não-NULL)
-- publica o projeto em /s/<token> — qualquer pessoa vê e baixa os cortes SALVOS,
-- sem login. `share_message` é uma mensagem opcional do dono exibida no topo.
alter table projects add column if not exists share_token text;
alter table projects add column if not exists share_message text;
create unique index if not exists idx_projects_share_token on projects (share_token);

create table if not exists sources (
    id              uuid primary key default gen_random_uuid(),
    project_id      uuid not null references projects (id) on delete cascade,
    name            text,
    duracao         double precision,
    tamanho         bigint,
    url             text,        -- caminho no Storage (upload) ou URL do YouTube
    source_type     text not null default 'upload', -- upload | youtube
    status_processo text default 'processing'
);

create table if not exists cuts (
    id          uuid primary key default gen_random_uuid(),
    project_id  uuid not null references projects (id) on delete cascade,
    titulo      text,
    inicio      double precision,
    fim         double precision,
    duracao     integer,
    score       double precision,
    url         text,
    status      text not null default 'ready', -- ready | processing | error
    saved       boolean not null default false  -- o usuário salvou este corte?
);

-- Migração para bancos já existentes (cuts criado antes da coluna `status`).
-- O re-corte de um clipe marca `processing` enquanto o worker regenera o vídeo.
alter table cuts add column if not exists status text not null default 'ready';

-- Migração: flag de "salvo". Todo corte nasce `false` (o worker insere assim);
-- só vira `true` quando o usuário salva pela UI. Cortes não salvos são
-- descartados quando a página do estúdio recarrega (ver /api/cleanup).
alter table cuts add column if not exists saved boolean not null default false;

-- Migração: origem do vídeo do source. 'upload' = arquivo no bucket privado
-- `sources` (url = caminho no Storage); 'youtube' = url é o link do vídeo,
-- baixado pelo worker com yt-dlp na hora de processar.
alter table sources add column if not exists source_type text not null default 'upload';

create index if not exists idx_sources_project on sources (project_id);
create index if not exists idx_cuts_project on cuts (project_id);

-- Migração: preferências de geração escolhidas na criação do projeto.
-- `cut_style`: 'basic' (corte seco, crop central fixo) | 'dynamic' (zoom no
-- DJ/público sincronizado com a batida). `max_cuts`: quantos cortes o usuário
-- pediu (NULL = máximo do plano; sempre clampado ao plano ao disparar o worker).
alter table projects add column if not exists cut_style text not null default 'basic';
alter table projects add column if not exists max_cuts integer;

-- Migração: nível de intensidade do corte dinâmico — 'subtle' (poucas trocas,
-- zooms contidos) | 'medium' (padrão) | 'intense' (bastante troca dj/público,
-- zooms fortes na batida). Só relevante quando cut_style='dynamic'. Projetos
-- antigos herdam 'medium' (= comportamento atual).
alter table projects add column if not exists cut_intensity text not null default 'medium';

-- Migração: decomposição do score do corte. `score` passa a ser o combinado
-- (musical + visual); as parcelas ficam disponíveis para a UI. Cortes antigos
-- ficam com as parcelas NULL.
alter table cuts add column if not exists score_musical double precision;
alter table cuts add column if not exists score_visual double precision;
-- Parcela do "diretor de IA" (vibe/energia do público, 0-1). NULL quando a IA
-- não rodou (plano free, sem chave, ou janela fora do teto de chamadas).
alter table cuts add column if not exists score_hype double precision;
-- BPM estimado do set no momento do corte. Antes ficava embutido no título
-- ("Drop N · 120 BPM"); com o título viral gerado por IA ele passa a ter
-- coluna própria (a UI lê daqui, com fallback no regex do título p/ cortes
-- antigos). NULL em cortes antigos ou quando o BPM não pôde ser estimado.
alter table cuts add column if not exists bpm integer;

-- Legado: direção manual de câmera do editor de cortes (keyframes
-- `{t, cx, cy, zoom}`). O editor foi removido; a coluna não é mais lida nem
-- escrita e fica só para não perder o que já foi salvo.
alter table cuts add column if not exists crop_keyframes jsonb;

-- ---------------------------------------------------------------------------
-- Pagamento / planos (AbacatePay)
-- ---------------------------------------------------------------------------

-- Assinaturas dos planos pagos ('pro' | 'premium'), cobradas pela AbacatePay
-- (BRL, PIX ou cartão). Uma linha é criada com status 'pending' quando o
-- usuário abre o checkout; o webhook (subscription.completed / renewed /
-- payment_failed / cancelled) atualiza o status e o período vigente, e espelha
-- o plano em `users.plan`. `provider` = 'stripe' só existe em linhas antigas,
-- da época da cobrança internacional (integração removida).
create table if not exists subscriptions (
    id                       uuid primary key default gen_random_uuid(),
    user_id                  uuid not null references users (id) on delete cascade,
    plan                     text not null,                    -- pro | premium
    status                   text not null default 'pending',  -- pending | active | past_due | cancelled
    method                   text,                             -- PIX | CARD (definido no webhook)
    provider                 text not null default 'abacatepay', -- abacatepay | stripe
    provider_checkout_id     text,          -- bill_... (AbacatePay) / cs_... (Stripe)
    provider_subscription_id text,          -- subs_... (AbacatePay) / sub_... (Stripe)
    external_id              text unique,   -- nosso id enviado no checkout
    current_period_start     timestamptz,
    current_period_end       timestamptz,
    created_at               timestamptz not null default now(),
    updated_at               timestamptz not null default now()
);

create index if not exists idx_subscriptions_user on subscriptions (user_id);
create index if not exists idx_subscriptions_checkout on subscriptions (provider_checkout_id);
create index if not exists idx_subscriptions_provider_sub on subscriptions (provider_subscription_id);

-- Idempotência dos webhooks (AbacatePay e Stripe): cada evento tem um id único
-- e retentativas reenviam o mesmo id — se já processamos, respondemos 200 sem
-- reprocessar.
create table if not exists webhook_events (
    id          text primary key,          -- id do evento (ex.: log_...)
    event       text not null,             -- ex.: subscription.completed
    received_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Fila de jobs do worker
-- ---------------------------------------------------------------------------

-- Migração: fila durável de processamento. `POST /process` do worker insere
-- uma linha `queued`; as threads consumidoras pegam a mais antiga com
-- `claim_job` e batem `heartbeat_at` enquanto rodam. Um job cujo worker morreu
-- (heartbeat velho) volta sozinho para a fila. Sem esta migração o worker cai
-- no modo antigo (BackgroundTasks em memória, que perde o job num redeploy).
create table if not exists jobs (
    id           uuid primary key default gen_random_uuid(),
    project_id   uuid not null references projects (id) on delete cascade,
    kind         text not null default 'process',
    payload      jsonb not null default '{}'::jsonb,  -- limites do plano, estilo, ai_tier
    status       text not null default 'queued',      -- queued | running | done | error
    attempts     integer not null default 0,
    worker_id    text,          -- processo que pegou o job (diagnóstico)
    error        text,
    created_at   timestamptz not null default now(),
    started_at   timestamptz,
    heartbeat_at timestamptz,
    finished_at  timestamptz
);

-- A fila só é lida/escrita pelo worker (service role, que ignora RLS). Com RLS
-- ligado e sem policy, as chaves públicas do projeto não enxergam a tabela.
alter table jobs enable row level security;

create index if not exists idx_jobs_queue on jobs (status, created_at);
create index if not exists idx_jobs_project on jobs (project_id);

-- Pega o próximo job, de forma atômica (FOR UPDATE SKIP LOCKED: dois workers
-- nunca pegam o mesmo). Candidatos: os `queued` e os `running` com heartbeat
-- mais velho que `p_stale_seconds` (worker morreu no meio). Antes, os
-- abandonados que já gastaram `p_max_attempts` tentativas viram `error`, e o
-- projeto junto — senão ele ficaria em `processing` para sempre.
create or replace function claim_job(
    p_worker text,
    p_stale_seconds integer default 180,
    p_max_attempts integer default 3
) returns setof jobs
language plpgsql
as $$
declare
    v_cutoff timestamptz := now() - make_interval(secs => p_stale_seconds);
begin
    with dead as (
        update jobs
           set status = 'error',
               error = 'worker interrompido ' || attempts || 'x durante o processamento',
               finished_at = now()
         where status = 'running'
           and heartbeat_at < v_cutoff
           and attempts >= p_max_attempts
        returning project_id
    )
    update projects
       set status = 'error'
     where id in (select project_id from dead)
       and status = 'processing';

    return query
    update jobs
       set status = 'running',
           worker_id = p_worker,
           attempts = attempts + 1,
           started_at = now(),
           heartbeat_at = now(),
           error = null
     where id = (
        select id
          from jobs
         where status = 'queued'
            or (status = 'running' and heartbeat_at < v_cutoff)
         order by created_at
         limit 1
           for update skip locked
     )
    returning *;
end;
$$;

-- ---------------------------------------------------------------------------
-- Estilos de edição
-- ---------------------------------------------------------------------------

-- Migração: estilo de edição (efeitos, transições, legendas). `projects.edit_style`
-- guarda uma CÓPIA do estilo escolhido na criação do set (JSON de
-- backend/app/style.py::EditStyle; NULL = sem estilo). `edit_styles` são os
-- estilos personalizados do usuário (montados à mão ou escritos pela IA a
-- partir de uma descrição em texto, guardada em `description`).
alter table projects add column if not exists edit_style jsonb;

create table if not exists edit_styles (
    id          uuid primary key default gen_random_uuid(),
    user_id     uuid not null references users (id) on delete cascade,
    name        text not null,
    description text,
    style       jsonb not null,
    created_at  timestamptz not null default now()
);

create index if not exists idx_edit_styles_user on edit_styles (user_id);
