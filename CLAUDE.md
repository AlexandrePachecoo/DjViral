# DjViral

## Visão geral

Plataforma que gera cortes virais a partir de sets gravados por DJs. O DJ
grava um set e envia para o site, que analisa o áudio e gera automaticamente
clipes curtos otimizados para TikTok/Reels.

> Projeto em fase de planejamento — ainda não há código implementado.

## Requisitos funcionais (MVP)

1. Enviar vídeo de até 3 horas
2. Analisar o vídeo pelo áudio
3. Gerar até 30 vídeos curtos (cortes)
4. Guardar os 30 vídeos gerados

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
