-- Schema do MVP DjViral (subconjunto do modelo em CLAUDE.md, sem `users`).
-- Rode no SQL editor do Supabase. Crie também dois buckets de Storage:
--   - `clips`   (público)  → clipes gerados
--   - `sources` (privado)  → vídeos originais enviados pelo navegador
-- Lembre de aumentar o limite de tamanho de upload do projeto para comportar
-- vídeos longos (o default do plano free é baixo, ~50 MB).

create extension if not exists "pgcrypto";

-- Usuários. Autenticação por email + senha (hash scrypt salvo em `password`).
-- Pagamento ainda não implementado: todo mundo nasce no plano 'free'.
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
