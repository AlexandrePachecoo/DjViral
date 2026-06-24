-- Schema do MVP DjViral (subconjunto do modelo em CLAUDE.md, sem `users`).
-- Rode no SQL editor do Supabase. Crie também dois buckets de Storage:
--   - `clips`   (público)  → clipes gerados
--   - `sources` (privado)  → vídeos originais enviados pelo navegador
-- Lembre de aumentar o limite de tamanho de upload do projeto para comportar
-- vídeos longos (o default do plano free é baixo, ~50 MB).

create extension if not exists "pgcrypto";

create table if not exists projects (
    id          uuid primary key default gen_random_uuid(),
    name        text not null,
    status      text not null default 'processing', -- processing | done | error
    date_create timestamptz not null default now()
);

create table if not exists sources (
    id              uuid primary key default gen_random_uuid(),
    project_id      uuid not null references projects (id) on delete cascade,
    name            text,
    duracao         double precision,
    tamanho         bigint,
    url             text,
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
    url         text
);

create index if not exists idx_sources_project on sources (project_id);
create index if not exists idx_cuts_project on cuts (project_id);
