# DjViral — Design

Sistema de design da interface do DjViral. Complementa o `CLAUDE.md` (que cobre
arquitetura e backend); aqui o foco é **UI, UX e responsividade**.

A fonte única de estilo é [`frontend/app/globals.css`](frontend/app/globals.css).
A UI **não usa estilos inline** — todo visual é aplicado por `className`, o que
permite media queries e mantém o JSX limpo.

## Princípios

1. **Mobile-first.** A maioria dos DJs vai abrir o site no celular. Os estilos
   base já são os do mobile; media queries só ajustam para telas maiores ou
   muito estreitas.
2. **Uma tela só.** O MVP é uma página: enviar set → acompanhar processamento →
   assistir aos cortes. Sem navegação, sem distração.
3. **Tema escuro.** Combina com o contexto (DJ, palco, vídeo) e reduz brilho no
   celular.
4. **Conteúdo nunca estoura a viewport.** `box-sizing: border-box` global,
   `overflow-x: hidden` no `body`, larguras fluidas (`width: 100%` / `max-width`).

## Tokens

Definidos como CSS custom properties em `:root` (em `globals.css`). Use os
tokens em vez de valores soltos.

### Cores

| Token            | Valor                       | Uso                                  |
| ---------------- | --------------------------- | ------------------------------------ |
| `--bg`           | `#0b0b10`                   | Fundo da página                      |
| `--surface`      | `#15151c`                   | Cards, inputs                        |
| `--border`       | `#2a2a35`                   | Bordas de cards e inputs             |
| `--text`         | `#e9e9f0`                   | Texto principal                      |
| `--muted`        | `rgba(233,233,240,0.6)`     | Texto secundário (metadados, score)  |
| `--accent`       | `#7c5cff`                   | Botão primário                       |
| `--accent-soft`  | `#9d8cff`                   | Mensagens de status (info)           |
| `--danger`       | `#ff6b6b`                   | Mensagens de erro                    |

### Forma e espaçamento

| Token         | Valor   | Uso                          |
| ------------- | ------- | ---------------------------- |
| `--radius`    | `12px`  | Cards                        |
| `--radius-sm` | `8px`   | Inputs, botões, vídeo        |
| `--maxw`      | `720px` | Largura máxima do conteúdo   |

### Tipografia

- Fonte: `system-ui, -apple-system, sans-serif` (nativa, zero download).
- `h1`: escala fluida com `clamp(1.6rem, 6vw, 2.25rem)` — encolhe no celular,
  cresce no desktop.
- `line-height: 1.5`; títulos longos quebram com `word-break: break-word`.

## Layout e breakpoints

- O `body` é centralizado (`margin: 0 auto`) com `max-width: var(--maxw)`.
- Padding lateral usa `max(1rem, env(safe-area-inset-left))` para respeitar a
  safe-area (notch) do iOS. O `viewport` em `layout.tsx` usa
  `viewport-fit=cover` para isso funcionar.

| Breakpoint        | Comportamento                                              |
| ----------------- | --------------------------------------------------------- |
| base (mobile)     | Layout em coluna, inputs e botão ocupam 100% da largura.  |
| `≤ 480px`         | Padding reduzido, menor gap entre os cards.               |
| `≥ 720px`         | Conteúdo deixa de crescer (limitado por `--maxw`).        |

## Componentes (classes)

| Classe          | Descrição                                                        |
| --------------- | --------------------------------------------------------------- |
| `.subtitle`     | Texto auxiliar abaixo do título (`--muted`).                    |
| `.form`         | Grid vertical com gap; agrupa os campos de upload.             |
| `.input`        | Campo de texto e de arquivo. `font-size: 16px`, `width: 100%`. |
| `.button`       | Ação primária. `width: 100%`, `min-height: 48px`, estado `:disabled`. |
| `.status` / `.status--error` | Mensagem de progresso/erro.                       |
| `.cuts`         | Grid da lista de cortes gerados.                              |
| `.card`         | Cartão de um corte (cabeçalho + vídeo + metadados).          |
| `.card__header` | Título + score; `flex-wrap` para quebrar no mobile.          |
| `.card__title` / `.card__score` / `.card__meta` | Partes do card.            |
| `.card video`   | Player; `width: 100%`, `max-height: 70vh` para vídeos verticais. |

## Diretrizes de responsividade (checklist)

Ao mexer na UI, garanta que:

- [ ] Nenhum elemento estoura a largura — testar em ~320px (iPhone SE).
- [ ] Inputs têm `font-size: 16px` (senão o iOS dá zoom ao focar).
- [ ] Alvos de toque têm pelo menos ~44–48px de altura.
- [ ] Flex containers que podem espremer usam `flex-wrap` + `gap`.
- [ ] Vídeos têm `width: 100%`, `height: auto` e `max-height` (verticais!).
- [ ] `<video>` usa `playsInline` para não abrir em fullscreen no iOS.
- [ ] Estilo novo vai em `globals.css` por `className`, não inline.

## Acessibilidade

- Tema escuro com contraste suficiente entre `--text` e `--surface`/`--bg`.
- Botão tem estado `:disabled` visível durante upload/processamento.
- `lang="pt-BR"` no `<html>`.

## Evoluções de UI planejadas

- Indicador de progresso do upload (barra/porcentagem) em vez de só texto.
- Estado de loading com skeleton nos cards enquanto o worker processa.
- Botão de download por corte e ação de compartilhar.
- Histórico de projetos (depende da autenticação, ainda não implementada).
