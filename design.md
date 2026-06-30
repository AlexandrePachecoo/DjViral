# DjViral — Design

Sistema de design da interface do DjViral. Complementa o `CLAUDE.md` (arquitetura
e backend); aqui o foco é **UI, UX e responsividade**.

A UI tem **dois contextos visuais distintos**, cada um com seu próprio conjunto
de tokens:

| Contexto | Onde | Tema | Tokens |
| -------- | ---- | ---- | ------ |
| **Marketing** | landing `/` e auth `/login`, `/app/novo` | escuro / neon | `globals.css` (`--dj-*`) + `page.module.css` |
| **Estúdio** | área logada `/app` | claro / minimalista | `app/app/_studio/theme.ts` |

Base global e animações ficam em [`frontend/app/globals.css`](frontend/app/globals.css).
A landing usa CSS Modules ([`page.module.css`](frontend/app/page.module.css)); o
estúdio usa **estilos inline** a partir dos tokens de `theme.ts`.

## Princípios

1. **Mobile-first na prática.** A maioria dos DJs abre no celular. Toda tela é
   testada de ~320px até desktop sem scroll horizontal nem conteúdo cortado.
2. **Landing vende, estúdio trabalha.** A landing é escura/impactante (neon,
   gradientes, waveforms animadas). O estúdio é claro e sóbrio pra não cansar em
   uso prolongado.
3. **Acento único por contexto.** Estúdio: violeta `#7c3aed`. Landing: gradiente
   `violeta → magenta → rosa → ciano`.
4. **Conteúdo nunca estoura a viewport.** `box-sizing: border-box` global; layouts
   fluidos; grids que colapsam e linhas que quebram (`flex-wrap`) no mobile.

## Tipografia

Fontes carregadas via Google Fonts em `layout.tsx`:

- **Space Grotesk** — títulos e números (`font.display`).
- **Outfit** — corpo da landing e wordmark (`font.wordmark`).
- **Sora** — corpo do estúdio (`font.body`).

Fallback `system-ui, sans-serif` em todas. Títulos grandes da landing encolhem por
breakpoint (ex.: `.h1` 74px → 48px → 40px).

## Tokens

### Estúdio (`app/app/_studio/theme.ts`)

Tema claro. Principais: `bg #fafafa`, `surface #ffffff`, `border #ececec`,
`textPrimary #18181b`, `textMuted #a1a1aa`, `accent #7c3aed`. Helpers reutilizáveis:
`btnPrimary`, `btnGhost`, `statusChip` (post/prog/draft) e `scoreColor()`
(≥85 = acento).

### Marketing (`globals.css` `:root`)

Tema escuro: `--dj-bg #08080d`, `--dj-panel #15151f`, e a paleta neon
`--dj-purple #a855f7`, `--dj-magenta #d946ef`, `--dj-pink #ec4899`,
`--dj-cyan #22d3ee`.

## Animações

Definidas em `globals.css` (escopo global, referenciadas por inline styles do
estúdio) e em `page.module.css` (escopo de módulo, para a landing):

- `dj-eq` / `eq` — barras de equalizador (logo, tiles).
- `wavemove` — waveform da landing.
- `dj-fadeUp`, `dj-fadeIn`, `dj-modalIn` — entrada de views e do modal.

Tudo que anima usa o atributo `data-anim`; em `prefers-reduced-motion` o
`globals.css` zera as animações via `[data-anim] { animation: none !important; }`.

## Responsividade

Como o estúdio usa estilos inline, os ajustes responsivos vivem em **classes
globais `dj-*`** com media queries em `globals.css` — os componentes só adicionam
a `className` como "gancho". Onde a propriedade também é inline, a regra usa
`!important` pra vencer a especificidade.

### Breakpoints

| Largura | O que acontece |
| ------- | -------------- |
| `≤ 900px` | Landing: hero, "como funciona" e preços viram 1 coluna; paddings menores. |
| `≤ 820px` | Editor do estúdio colapsa pra 1 coluna (`.dj-editor-grid`). |
| `≤ 720px` | Header do estúdio quebra: logo + ações na 1ª linha, abas roláveis na 2ª (`.dj-header*`); padding do `main` reduz. |
| `≤ 640px` | Estúdio: card do set e linhas da lista quebram; barra de score full-width; tabela de salvos rola na horizontal (`.dj-table-scroll`); busca full-width. |
| `≤ 560px` | Landing: links do nav somem (sobra o CTA); botões do hero empilham. Editor: topo quebra. |
| `≤ 420px` | Header do estúdio esconde o nome do usuário (mantém o avatar). |

### Ganchos responsivos (classes `dj-*`)

| Classe | Efeito no mobile |
| ------ | ---------------- |
| `.dj-header` / `.dj-header-nav` / `.dj-header-actions` / `.dj-header-username` | Header em 2 linhas, abas roláveis, nome do usuário oculto. |
| `.dj-studio-main` | Padding lateral menor. |
| `.dj-editor-grid` | Preview acima do painel (1 coluna). |
| `.dj-editor-topbar` | Voltar/título/ações quebram. |
| `.dj-genset` | Card do set quebra (chip de status desce). |
| `.dj-list-row` / `.dj-list-score` / `.dj-list-actions` | Linha da lista quebra; score e ações ocupam a largura toda. |
| `.dj-saved-tools` / `.dj-saved-search` | Ferramentas e busca full-width. |
| `.dj-table-scroll` / `.dj-table` | Tabela de salvos rola na horizontal com colunas legíveis. |

## Diretrizes (checklist ao mexer na UI)

- [ ] Testar em ~320px (iPhone SE): nada estoura a largura.
- [ ] Inputs com `font-size: 16px` (senão o iOS dá zoom ao focar).
- [ ] Alvos de toque com ~44–48px de altura.
- [ ] Linhas/flex que podem espremer usam `flex-wrap` (+ `gap`).
- [ ] Grids fixos colapsam ou ganham scroll horizontal no mobile.
- [ ] Vídeos com `width: 100%`, `height: auto` e `playsInline`.
- [ ] Estúdio: ajuste responsivo entra como classe `dj-*` em `globals.css`, não
      como novo `@media` solto (os estilos são inline).
- [ ] Respeitar `prefers-reduced-motion` (usar `data-anim`).

## Acessibilidade

- Contraste adequado em ambos os temas.
- `lang="pt-BR"` no `<html>`; `viewport-fit=cover` para a safe-area do iOS.
- Estados `:disabled` visíveis em botões durante upload/processamento.
- Animações desligáveis via `prefers-reduced-motion`.

## Evoluções de UI planejadas

- ~~Player de vídeo real nos cards~~ — feito: o estúdio carrega os cortes reais
  do usuário e usa `<video>` nos cards (Gerador e Cortes salvos).
- ~~Skeletons enquanto carrega~~ — feito: `StudioStates.tsx` (`.dj-skeleton`) +
  empty state com CTA quando não há set processado.
- Barra de progresso de upload (em vez de só texto de status).
- Tornar o menu do header um drawer no mobile (hoje as abas rolam).
- Edição e publicação reais (hoje a aba Edição e o modal de publicar abrem com o
  corte real, mas trim/legendas/postagem ainda são visuais — sem backend).
