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
    id          uuid primary key default gen_random_uuid(),
    user_id     uuid references users (id) on delete cascade,
    name        text not null,
    status      text not null default 'processing', -- processing | done | error
    date_create timestamptz not null default now()
);

create index if not exists idx_projects_user on projects (user_id);

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

-- ---------------------------------------------------------------------------
-- Pagamento / planos (AbacatePay)
-- ---------------------------------------------------------------------------

-- Assinaturas dos planos pagos ('pro' | 'premium'), pagas via AbacatePay
-- (checkout de assinatura, cartão com recorrência mensal ou PIX). Uma linha é
-- criada com status 'pending' quando o usuário abre o checkout; os webhooks
-- (subscription.completed / renewed / payment_failed / cancelled) atualizam o
-- status e o período vigente, e espelham o plano em `users.plan`.
create table if not exists subscriptions (
    id                       uuid primary key default gen_random_uuid(),
    user_id                  uuid not null references users (id) on delete cascade,
    plan                     text not null,                    -- pro | premium
    status                   text not null default 'pending',  -- pending | active | past_due | cancelled
    method                   text,                             -- PIX | CARD (definido no webhook)
    provider                 text not null default 'abacatepay',
    provider_checkout_id     text,          -- bill_... (checkout de assinatura)
    provider_subscription_id text,          -- subs_... (assinatura ativa)
    external_id              text unique,   -- nosso id enviado no checkout
    current_period_start     timestamptz,
    current_period_end       timestamptz,
    created_at               timestamptz not null default now(),
    updated_at               timestamptz not null default now()
);

create index if not exists idx_subscriptions_user on subscriptions (user_id);
create index if not exists idx_subscriptions_checkout on subscriptions (provider_checkout_id);
create index if not exists idx_subscriptions_provider_sub on subscriptions (provider_subscription_id);

-- Idempotência dos webhooks da AbacatePay: cada evento tem um id único e
-- retentativas reenviam o mesmo id — se já processamos, respondemos 200 sem
-- reprocessar.
create table if not exists webhook_events (
    id          text primary key,          -- id do evento (ex.: log_...)
    event       text not null,             -- ex.: subscription.completed
    received_at timestamptz not null default now()
);
