# DjViral — Frontend (Vercel)

UI de upload + rotas de orquestração. Hospedado na **Vercel**. O processamento
pesado (librosa + FFmpeg) roda no **worker** (`../backend`, na Railway), porque
não cabe nos limites de serverless da Vercel (body ~4.5 MB, timeout, memória,
sem FFmpeg).

## Fluxo

1. `POST /api/projects` cria o projeto + source no Supabase e devolve uma
   **signed upload URL**.
2. O navegador envia o vídeo **direto ao Supabase Storage** (contorna o limite
   de 4.5 MB da Vercel — o arquivo nunca passa por uma função).
3. `POST /api/projects/[id]/process` dispara o worker na Railway (header
   `X-Worker-Secret`).
4. `GET /api/projects/[id]` é consultado em polling até `status=done`, exibindo
   os clipes.

## Setup

```bash
cd frontend
npm install
cp .env.example .env.local   # preencha as variáveis
npm run dev
```

### Variáveis de ambiente (também configurar na Vercel)

| Var | Descrição |
|-----|-----------|
| `SUPABASE_URL` | URL do projeto Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key (server-side, nunca no browser) |
| `SUPABASE_BUCKET` | Bucket público dos clipes (`clips`) |
| `SUPABASE_SOURCES_BUCKET` | Bucket privado dos vídeos originais (`sources`) |
| `WORKER_URL` | URL pública do worker na Railway |
| `WORKER_SECRET` | Segredo compartilhado com o worker |

## Deploy na Vercel

1. Importe o repositório na Vercel, definindo **Root Directory = `frontend`**.
2. Configure as variáveis de ambiente acima.
3. Deploy. O worker (Railway) e o Supabase devem estar de pé antes do teste.

## Notas

- Para vídeos muito grandes (GBs), o upload via PUT único da signed URL é
  frágil. O caminho robusto é o **upload resumável (TUS)** do Supabase — fica
  como evolução.
